// 015 · T5 · 知识体系质量信号(AM-1520 · AC-9 · FR-398/399 · §7 质量指标定义表)
// ─────────────────────────────────────────────────────────────────────────────
// 纯读聚合:不改别簇数据,只读 pages(孤页/新鲜度)/ links(互链密度,origin 分治)/
//   page_provenance(溯源覆盖,014)/ raw_document_compile_state(编译覆盖,014)/
//   fact_conflicts(冲突下钻)。
//
// 五指标(per-source + 全库两级,同一 SQL 参数化:传 sourceId → 单库;不传 → 全库聚合):
//   ① 孤页率        = 孤页数 / 活跃条目数(孤页判定 origin 无关:活跃页无 outgoing 且无 incoming 链)
//   ② 互链密度      = 有效互链数 / 活跃条目数(有效 = origin∈{manual,auto} 且目标页存在非 dangling 且未 tombstone)
//   ③ 溯源覆盖率    = 有溯源锚点分节数 / 总分节数(读 014 page_provenance:section 至少一行锚到 raw_chunk)
//   ④ 编译覆盖率    = 已编译源文件数 / 已入库源文件总数(读 014 raw_document_compile_state.status='compiled')
//   ⑤ 条目新鲜度    = 新鲜条目数 / 活跃条目数 = 1 − 陈旧条目数/活跃条目数(陈旧 = updated_at 超 staleDays)
//
// 空库(分母 0)→ 指标显式 N/A(status='na' + value=null,不作 0、不除零)。
// 可下钻:孤页率 → 孤页清单(清单条数 == 孤页数);冲突数 → open 冲突队列(数据契约暴露引用)。
// 全库聚合天然可加(同一 SQL 去掉 source_id 谓词 = 各 source 分子/分母之和),支持 delta 复算。
import type { UserContext } from '@ff/contracts';
import { getNanoBrainPool } from '../../../db';
import { LINK_ORIGIN_AUTO, LINK_ORIGIN_MANUAL } from '../../links';

// ── 具名常量(魔法字面量 = 0)──────────────────────────────────────────────────
// 有效互链的 origin 值域:manual+auto(FR-398 语义,与 graphQuery 检索邻域一致);suggested 不计入密度。
export const VALID_LINK_ORIGINS = [LINK_ORIGIN_MANUAL, LINK_ORIGIN_AUTO] as const;
// 条目新鲜度陈旧阈值(天):updated_at 早于 now()-staleDays → 陈旧。config 参数(非硬编码到 SQL)。
export const DEFAULT_FRESHNESS_STALE_DAYS = 90;
// 冲突下钻只暴露待裁决(open)队列。
export const CONFLICT_STATUS_OPEN = 'open';

// ── 指标值形状 ───────────────────────────────────────────────────────────────
// numerator/denominator 恒暴露(即使 na),便于全库两级 delta 复算 + 手工对账;
// denominator===0 → status='na' 且 value=null(空库 N/A 不除零)。
export type MetricValue = {
  status: 'ok' | 'na';
  value: number | null;
  numerator: number;
  denominator: number;
};

export type QualityDrilldownOrphan = { id: string; slug: string; title: string };
export type QualityDrilldownConflict = {
  id: string;
  factIdA: string;
  factIdB: string;
  entitySlug: string | null;
  claimMetric: string | null;
  status: string;
};

export type QualitySignalsScope = { level: 'source'; sourceId: string } | { level: 'global' };

export type QualitySignals = {
  scope: QualitySignalsScope;
  activePages: number;
  metrics: {
    orphanRate: MetricValue;
    interlinkDensity: MetricValue;
    provenanceCoverage: MetricValue;
    compileCoverage: MetricValue;
    freshness: MetricValue;
  };
  drilldowns: {
    orphanPages: QualityDrilldownOrphan[];
    openConflicts: QualityDrilldownConflict[];
  };
};

export type ComputeQualitySignalsOptions = { staleDays?: number };

function asNumber(value: unknown): number {
  return Number(value ?? 0);
}

// 分子/分母 → MetricValue:分母 0 → N/A(不除零);否则 value=分子/分母。
function toMetric(numerator: number, denominator: number): MetricValue {
  if (denominator <= 0) {
    return { status: 'na', value: null, numerator, denominator };
  }
  return { status: 'ok', value: numerator / denominator, numerator, denominator };
}

// source 谓词:传 sourceId → 单库(WHERE ... = $1);不传 → 全库(无谓词,聚合天然可加)。
function scopePredicate(column: string, sourceId: string | undefined): { clause: string; params: unknown[] } {
  if (sourceId) return { clause: `WHERE ${column} = $1`, params: [sourceId] };
  return { clause: '', params: [] };
}

async function getActiveAndFreshnessCounts(
  sourceId: string | undefined,
  staleDays: number,
): Promise<{ active: number; stale: number }> {
  // updated_at 早于 now()-staleDays → 陈旧;staleDays 作参数($ 位)传入,不硬编码进 SQL。
  const values: unknown[] = [staleDays];
  const sourceClause = sourceId ? `AND source_id = $2` : '';
  if (sourceId) values.push(sourceId);
  const result = await getNanoBrainPool().query(
    `
      SELECT
        count(*)::int AS active,
        count(*) FILTER (WHERE updated_at < now() - ($1::int * interval '1 day'))::int AS stale
      FROM pages
      WHERE archived_at IS NULL
        ${sourceClause}
    `,
    values,
  );
  const row = result.rows[0];
  return { active: asNumber(row?.active), stale: asNumber(row?.stale) };
}

// 孤页判定 origin 无关:活跃页无 outgoing(from_page_id)且无 incoming(to_slug)链(与 health-check 一致)。
function orphanWhere(sourceId: string | undefined): { clause: string; params: unknown[] } {
  const sourceClause = sourceId ? `AND p.source_id = $1` : '';
  return {
    clause: `
      p.archived_at IS NULL
      ${sourceClause}
      AND NOT EXISTS (
        SELECT 1 FROM links outgoing
        WHERE outgoing.source_id = p.source_id AND outgoing.from_page_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM links incoming
        WHERE incoming.source_id = p.source_id AND incoming.to_slug = p.slug
      )
    `,
    params: sourceId ? [sourceId] : [],
  };
}

async function getOrphanCount(sourceId: string | undefined): Promise<number> {
  const where = orphanWhere(sourceId);
  const result = await getNanoBrainPool().query(
    `SELECT count(*)::int AS count FROM pages p WHERE ${where.clause}`,
    where.params,
  );
  return asNumber(result.rows[0]?.count);
}

// 孤页下钻清单:全量返回(条数须 == 孤页数,不加 LIMIT)。
async function getOrphanList(sourceId: string | undefined): Promise<QualityDrilldownOrphan[]> {
  const where = orphanWhere(sourceId);
  const result = await getNanoBrainPool().query(
    `SELECT p.id, p.slug, p.title FROM pages p WHERE ${where.clause} ORDER BY p.source_id ASC, p.slug ASC, p.id ASC`,
    where.params,
  );
  return result.rows.map((row: any) => ({ id: row.id, slug: row.slug, title: row.title }));
}

// 有效互链数:origin∈{manual,auto} 且目标页存在(非 dangling)且未 tombstone(不在 link_suppressions)。
async function getValidLinkCount(sourceId: string | undefined): Promise<number> {
  const values: unknown[] = [VALID_LINK_ORIGINS as unknown as string[]];
  const sourceClause = sourceId ? `AND l.source_id = $2` : '';
  if (sourceId) values.push(sourceId);
  const result = await getNanoBrainPool().query(
    `
      SELECT count(*)::int AS count
      FROM links l
      JOIN pages target_page
        ON target_page.source_id = l.source_id
       AND target_page.slug = l.to_slug
       AND target_page.archived_at IS NULL
      LEFT JOIN link_suppressions ls
        ON ls.source_id = l.source_id
       AND ls.from_slug = l.from_slug
       AND ls.to_slug = l.to_slug
       AND ls.link_type = l.link_type
      WHERE l.origin = ANY($1::text[])
        AND ls.id IS NULL
        ${sourceClause}
    `,
    values,
  );
  return asNumber(result.rows[0]?.count);
}

// 溯源覆盖(读 014 page_provenance):有溯源锚点分节数 / 总分节数。
//   分节 = distinct (page_id, section_id);有锚点 = 该分节至少一行 raw_chunk_id NOT NULL(锚到可寻址原文分片)。
async function getProvenanceCounts(sourceId: string | undefined): Promise<{ anchored: number; total: number }> {
  const scope = scopePredicate('source_id', sourceId);
  const result = await getNanoBrainPool().query(
    `
      SELECT
        count(DISTINCT page_id || chr(31) || section_id)::int AS total,
        count(DISTINCT page_id || chr(31) || section_id) FILTER (WHERE raw_chunk_id IS NOT NULL)::int AS anchored
      FROM page_provenance
      ${scope.clause}
    `,
    scope.params,
  );
  const row = result.rows[0];
  return { anchored: asNumber(row?.anchored), total: asNumber(row?.total) };
}

// 编译覆盖(读 014 raw_document_compile_state):已编译源文件数 / 已入库源文件总数。
async function getCompileCounts(sourceId: string | undefined): Promise<{ compiled: number; total: number }> {
  const sourceClause = sourceId ? `WHERE rd.source_id = $1` : '';
  const params = sourceId ? [sourceId] : [];
  const result = await getNanoBrainPool().query(
    `
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE cs.status = 'compiled')::int AS compiled
      FROM raw_documents rd
      LEFT JOIN raw_document_compile_state cs ON cs.raw_document_id = rd.id
      ${sourceClause}
    `,
    params,
  );
  const row = result.rows[0];
  return { compiled: asNumber(row?.compiled), total: asNumber(row?.total) };
}

// open 冲突下钻队列(读 fact_conflicts):数据契约暴露引用(双方 fact_id + 口径)。
async function getOpenConflicts(sourceId: string | undefined): Promise<QualityDrilldownConflict[]> {
  const values: unknown[] = [CONFLICT_STATUS_OPEN];
  const sourceClause = sourceId ? `AND source_id = $2` : '';
  if (sourceId) values.push(sourceId);
  const result = await getNanoBrainPool().query(
    `
      SELECT id, fact_id_a, fact_id_b, entity_slug, claim_metric, status
      FROM fact_conflicts
      WHERE status = $1
        ${sourceClause}
      ORDER BY detected_at DESC, id DESC
    `,
    values,
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    factIdA: row.fact_id_a,
    factIdB: row.fact_id_b,
    entitySlug: row.entity_slug,
    claimMetric: row.claim_metric,
    status: row.status,
  }));
}

// FR-398/399 · AC-9:计算知识体系质量信号。
//   sourceId 传入 → per-source 单库;不传 → 全库聚合(两级同一套聚合逻辑,分子/分母天然可加)。
export async function computeQualitySignals(
  _ctx: UserContext,
  sourceId?: string,
  options: ComputeQualitySignalsOptions = {},
): Promise<QualitySignals> {
  const staleDays = options.staleDays ?? DEFAULT_FRESHNESS_STALE_DAYS;

  const [
    { active, stale },
    orphanCount,
    validLinkCount,
    provenance,
    compile,
    orphanPages,
    openConflicts,
  ] = await Promise.all([
    getActiveAndFreshnessCounts(sourceId, staleDays),
    getOrphanCount(sourceId),
    getValidLinkCount(sourceId),
    getProvenanceCounts(sourceId),
    getCompileCounts(sourceId),
    getOrphanList(sourceId),
    getOpenConflicts(sourceId),
  ]);

  const fresh = active - stale;

  return {
    scope: sourceId ? { level: 'source', sourceId } : { level: 'global' },
    activePages: active,
    metrics: {
      orphanRate: toMetric(orphanCount, active),
      interlinkDensity: toMetric(validLinkCount, active),
      provenanceCoverage: toMetric(provenance.anchored, provenance.total),
      compileCoverage: toMetric(compile.compiled, compile.total),
      freshness: toMetric(fresh, active),
    },
    drilldowns: {
      orphanPages,
      openConflicts,
    },
  };
}
