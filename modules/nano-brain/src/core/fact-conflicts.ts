// 015 · T4 · 事实冲突检测(FR-395/396/397 · §5.4)
// ─────────────────────────────────────────────────────────────────────────────
// 冲突判据 = 结构化机械可算,不误报正常演化/单位差异:
//   冲突 ⟺ 同 entity_slug(非空规范化相等)且同 claim_metric(规范化相等)
//          且 claim_period 相等 且 值不一致(claim_unit 归一后 claim_value 差异超容差)。
//   - claim_period 不同        → 正常时间演化,不判冲突
//   - claim_unit 无法归一到同量纲 → 标"单位不可比",不误报
//   - entity_slug/claim_metric 为空 → 不参与结构化冲突检测
//   - 归一后差异在相对容差内   → 视作一致,不判冲突
// 登记(fact_conflicts)用 canonical (fact_id_a < fact_id_b) 排序 + 唯一约束防重复。
// 审核时(fact approve)同事务钩入检测,冲突仅"标记+进队列",不阻断入库。
// 裁决保留其一 → 弃方 valid_until 置为过去 → fact 检索路不再召回(呼应 004 FR-165)。
// dream sweep 相位对全 source facts 兜底扫历史(提交时未拦的历史矛盾)。
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { UserContext } from '@ff/contracts';
import { getNanoBrainPool } from '../db';
import { insertAuditLog } from './audit';
import { NanoBrainPermissionError } from './permissions';
import { NanoBrainError } from './sources';

type Executor = Pick<pg.PoolClient, 'query'>;

// ── 具名常量(魔法数字面量 = 0)────────────────────────────────────────────────
// 浮点容差:归一后两值相对差 ≤ 此比例 → 视作一致(8.00 vs 8.001 不误报)。
export const DEFAULT_RELATIVE_TOLERANCE = 0.01;

// 单位归一表(config 化的量纲换算表,而非某领域硬编码):
//   每个已知单位 → { group 量纲组, factor 归一到组基准单位的倍率 }。
//   同组 → 值 × factor 归一后可比;跨组 / 未知单位 → 单位不可比(不误报)。
//   空单位 = 无量纲组(与自身可比),覆盖"同期同指标裸数值"矛盾场景。
const DIMENSIONLESS_GROUP = 'dimensionless';
type UnitNorm = { group: string; factor: number };
const UNIT_NORMALIZATION: Readonly<Record<string, UnitNorm>> = {
  // 人民币金额组(基准单位:元)
  元: { group: 'cny', factor: 1 },
  千元: { group: 'cny', factor: 1e3 },
  万: { group: 'cny', factor: 1e4 },
  万元: { group: 'cny', factor: 1e4 },
  百万: { group: 'cny', factor: 1e6 },
  百万元: { group: 'cny', factor: 1e6 },
  亿: { group: 'cny', factor: 1e8 },
  亿元: { group: 'cny', factor: 1e8 },
  // 百分比组(基准单位:百分点)
  '%': { group: 'percent', factor: 1 },
  百分比: { group: 'percent', factor: 1 },
  百分点: { group: 'percent', factor: 1 },
};

// 判据结果 reason 枚举(避免魔法串,测试逐态断可引用)。
export const CONFLICT_REASON = {
  SAME_PERIOD_VALUE_MISMATCH: 'same_period_value_mismatch',
  DIFFERENT_PERIOD: 'different_period',
  WITHIN_TOLERANCE: 'within_tolerance',
  INCOMPARABLE_UNIT: 'incomparable_unit',
  INSUFFICIENT_CLAIM: 'insufficient_claim',
  DIFFERENT_ENTITY_OR_METRIC: 'different_entity_or_metric',
} as const;
export type ConflictReason = (typeof CONFLICT_REASON)[keyof typeof CONFLICT_REASON];

export type ConflictJudgment = { conflict: boolean; reason: ConflictReason };

// 参与冲突判据的最小 claim 形状(NanoFact 的子集)。
export type FactClaimShape = {
  entitySlug?: string | null;
  claimMetric?: string | null;
  claimValue?: number | null;
  claimUnit?: string | null;
  claimPeriod?: string | null;
};

function normalizeKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function normalizePeriod(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function resolveUnit(unit: string | null | undefined): UnitNorm | null {
  if (unit === null || unit === undefined || unit.trim() === '') {
    return { group: DIMENSIONLESS_GROUP, factor: 1 };
  }
  const key = unit.trim();
  return UNIT_NORMALIZATION[key] ?? null;
}

// FR-395:五态判据核心(纯函数,确定性可测)。
export function judgeFactPair(a: FactClaimShape, b: FactClaimShape): ConflictJudgment {
  const entityA = normalizeKey(a.entitySlug);
  const entityB = normalizeKey(b.entitySlug);
  const metricA = normalizeKey(a.claimMetric);
  const metricB = normalizeKey(b.claimMetric);

  // ⑥ 空断言:entity_slug 或 claim_metric 为空 → 不参与结构化冲突检测。
  if (!entityA || !entityB || !metricA || !metricB) {
    return { conflict: false, reason: CONFLICT_REASON.INSUFFICIENT_CLAIM };
  }
  // 不同实体/指标 → 非同口径,不判冲突。
  if (entityA !== entityB || metricA !== metricB) {
    return { conflict: false, reason: CONFLICT_REASON.DIFFERENT_ENTITY_OR_METRIC };
  }

  // ② 不同期 → 正常时间演化,不判冲突。
  if (normalizePeriod(a.claimPeriod) !== normalizePeriod(b.claimPeriod)) {
    return { conflict: false, reason: CONFLICT_REASON.DIFFERENT_PERIOD };
  }

  // 值缺失无法比较 → 不参与(不误报)。
  if (a.claimValue === null || a.claimValue === undefined || b.claimValue === null || b.claimValue === undefined) {
    return { conflict: false, reason: CONFLICT_REASON.INSUFFICIENT_CLAIM };
  }

  // ④ 单位不可比:未知单位 / 跨量纲组 → 标记不误报。
  const unitA = resolveUnit(a.claimUnit);
  const unitB = resolveUnit(b.claimUnit);
  if (!unitA || !unitB || unitA.group !== unitB.group) {
    return { conflict: false, reason: CONFLICT_REASON.INCOMPARABLE_UNIT };
  }

  // ③ 单位归一后按值判;⑤ 浮点容差内视作一致。
  const baseA = a.claimValue * unitA.factor;
  const baseB = b.claimValue * unitB.factor;
  const denom = Math.max(Math.abs(baseA), Math.abs(baseB));
  const relativeDiff = denom === 0 ? 0 : Math.abs(baseA - baseB) / denom;
  if (relativeDiff <= DEFAULT_RELATIVE_TOLERANCE) {
    return { conflict: false, reason: CONFLICT_REASON.WITHIN_TOLERANCE };
  }

  // ① 同期矛盾:同口径同期,归一后值超容差 → 判冲突。
  return { conflict: true, reason: CONFLICT_REASON.SAME_PERIOD_VALUE_MISMATCH };
}

// ── 冲突登记 ─────────────────────────────────────────────────────────────────

type CandidateFactRow = {
  id: string;
  entity_slug: string | null;
  claim_metric: string | null;
  claim_value: number | null;
  claim_unit: string | null;
  claim_period: string | null;
};

function rowToClaim(row: CandidateFactRow): FactClaimShape {
  return {
    entitySlug: row.entity_slug,
    claimMetric: row.claim_metric,
    claimValue: row.claim_value === null || row.claim_value === undefined ? null : Number(row.claim_value),
    claimUnit: row.claim_unit,
    claimPeriod: row.claim_period,
  };
}

export type DetectedConflict = {
  otherFactId: string;
  reason: ConflictReason;
};

// FR-395:检出给定 fact 与同 source 现存有效 approved fact 的冲突(不含自身)。
// 粗过滤(同 source + 同规范化 entity/metric + 生命周期内)交给 SQL,五态判据在 TS 复算。
export async function detectConflicts(executor: Executor, fact: { id: string } & FactClaimShape): Promise<DetectedConflict[]> {
  const entity = normalizeKey(fact.entitySlug);
  const metric = normalizeKey(fact.claimMetric);
  if (!entity || !metric) return [];

  const sourceRow = await executor.query(`SELECT source_id FROM facts WHERE id = $1`, [fact.id]);
  const sourceId = sourceRow.rows[0]?.source_id as string | undefined;
  if (!sourceId) return [];

  const { rows } = await executor.query(
    `
      SELECT id, entity_slug, claim_metric, claim_value, claim_unit, claim_period
      FROM facts
      WHERE source_id = $1
        AND id <> $2
        AND lower(btrim(entity_slug)) = $3
        AND lower(btrim(claim_metric)) = $4
        AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
    `,
    [sourceId, fact.id, entity, metric],
  );

  const conflicts: DetectedConflict[] = [];
  for (const row of rows as CandidateFactRow[]) {
    const judgment = judgeFactPair(fact, rowToClaim(row));
    if (judgment.conflict) {
      conflicts.push({ otherFactId: row.id, reason: judgment.reason });
    }
  }
  return conflicts;
}

// 登记冲突(canonical 排序 + ON CONFLICT DO NOTHING 幂等)。返回本次新增登记条数。
export async function registerConflictsForFact(executor: Executor, fact: { id: string } & FactClaimShape): Promise<number> {
  const conflicts = await detectConflicts(executor, fact);
  if (conflicts.length === 0) return 0;

  const sourceRow = await executor.query(`SELECT source_id FROM facts WHERE id = $1`, [fact.id]);
  const sourceId = sourceRow.rows[0]?.source_id as string | undefined;
  if (!sourceId) return 0;

  let registered = 0;
  for (const conflict of conflicts) {
    // canonical (a,b):字典序小的当 fact_id_a,防 (a,b)/(b,a) 双向重复登记。
    const [factIdA, factIdB] = fact.id < conflict.otherFactId ? [fact.id, conflict.otherFactId] : [conflict.otherFactId, fact.id];
    const result = await executor.query(
      `
        INSERT INTO fact_conflicts (id, source_id, entity_slug, claim_metric, claim_period, fact_id_a, fact_id_b, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
        ON CONFLICT (fact_id_a, fact_id_b) DO NOTHING
        RETURNING id
      `,
      [
        randomUUID(),
        sourceId,
        normalizeKey(fact.entitySlug),
        normalizeKey(fact.claimMetric),
        typeof fact.claimPeriod === 'string' ? fact.claimPeriod.trim() : null,
        factIdA,
        factIdB,
      ],
    );
    registered += result.rowCount ?? 0;
  }
  return registered;
}

// ── 冲突队列可见性 ───────────────────────────────────────────────────────────

export type FactConflict = {
  id: string;
  sourceId: string;
  entitySlug: string | null;
  claimMetric: string | null;
  claimPeriod: string | null;
  factIdA: string;
  factIdB: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolvedBy: string | null;
  resolutionNote: string | null;
  detectedAt: Date;
};

function mapConflict(row: any): FactConflict {
  return {
    id: row.id,
    sourceId: row.source_id,
    entitySlug: row.entity_slug,
    claimMetric: row.claim_metric,
    claimPeriod: row.claim_period,
    factIdA: row.fact_id_a,
    factIdB: row.fact_id_b,
    status: row.status,
    resolvedBy: row.resolved_by,
    resolutionNote: row.resolution_note,
    detectedAt: row.detected_at,
  };
}

export type ListFactConflictsInput = {
  sourceId?: string;
  status?: 'open' | 'resolved' | 'dismissed';
  factId?: string;
};

// 队列可见性:列出冲突(可按 source/status/卷入的 fact 过滤),供 fact 详情 / 审核队列下钻。
export async function listFactConflicts(ctx: UserContext, input: ListFactConflictsInput = {}): Promise<FactConflict[]> {
  const conditions: string[] = [
    // 权限:管理员看全量;普通用户仅公开 source 或本人 source。
    `($1::boolean = true OR s.kind = 'public' OR s.owner_user_id = $2)`,
  ];
  const values: unknown[] = [ctx.isAdmin, ctx.userId];

  if (input.sourceId) {
    values.push(input.sourceId);
    conditions.push(`fc.source_id = $${values.length}`);
  }
  if (input.status) {
    values.push(input.status);
    conditions.push(`fc.status = $${values.length}`);
  }
  if (input.factId) {
    values.push(input.factId);
    conditions.push(`(fc.fact_id_a = $${values.length} OR fc.fact_id_b = $${values.length})`);
  }

  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT fc.id, fc.source_id, fc.entity_slug, fc.claim_metric, fc.claim_period,
        fc.fact_id_a, fc.fact_id_b, fc.status, fc.resolved_by, fc.resolution_note, fc.detected_at
      FROM fact_conflicts fc
      JOIN sources s ON s.id = fc.source_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY fc.detected_at DESC, fc.id DESC
    `,
    values,
  );
  return result.rows.map(mapConflict);
}

// ── 冲突裁决 ─────────────────────────────────────────────────────────────────

export type ResolveConflictInput = {
  conflictId: string;
  // 'resolve' = 保留其一(keepFactId 必填,弃方失效);'dismiss' = 两口径并存(检索面不变)。
  resolution: 'resolve' | 'dismiss';
  keepFactId?: string;
  note?: string | null;
};

export type ResolveConflictResult = {
  conflict: FactConflict;
  discardedFactId: string | null;
};

export async function resolveConflict(ctx: UserContext, input: ResolveConflictInput): Promise<ResolveConflictResult> {
  if (!ctx.isAdmin) {
    throw new NanoBrainPermissionError('只有管理员可以裁决事实冲突');
  }
  if (!input.conflictId?.trim()) throw new NanoBrainError('conflict id 不能为空', 'invalid_input');
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null;

  const pool = getNanoBrainPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const conflictResult = await client.query(
      `SELECT id, source_id, entity_slug, claim_metric, claim_period, fact_id_a, fact_id_b, status,
        resolved_by, resolution_note, detected_at
       FROM fact_conflicts WHERE id = $1 FOR UPDATE`,
      [input.conflictId.trim()],
    );
    if (!conflictResult.rows[0]) throw new NanoBrainError('冲突不存在', 'not_found');
    const existing = mapConflict(conflictResult.rows[0]);
    if (existing.status !== 'open') {
      throw new NanoBrainError('该冲突已裁决', 'invalid_input');
    }

    let discardedFactId: string | null = null;
    let nextStatus: 'resolved' | 'dismissed';

    if (input.resolution === 'resolve') {
      const keep = input.keepFactId?.trim();
      if (!keep) throw new NanoBrainError('保留其一时必须指定 keep_fact_id', 'invalid_input');
      if (keep !== existing.factIdA && keep !== existing.factIdB) {
        throw new NanoBrainError('keep_fact_id 必须是本冲突卷入的 fact 之一', 'invalid_input');
      }
      discardedFactId = keep === existing.factIdA ? existing.factIdB : existing.factIdA;
      // 弃方 valid_until 置为过去(CURRENT_DATE - 1)→ fact 检索路 valid_until 过滤即排除(FR-165)。
      await client.query(
        `UPDATE facts SET valid_until = CURRENT_DATE - 1, updated_at = now() WHERE id = $1`,
        [discardedFactId],
      );
      nextStatus = 'resolved';
    } else if (input.resolution === 'dismiss') {
      // 两口径都对:双方检索面不变,仅标记 dismissed。
      nextStatus = 'dismissed';
    } else {
      throw new NanoBrainError('裁决动作不合法', 'invalid_input');
    }

    const updated = await client.query(
      `UPDATE fact_conflicts
         SET status = $2, resolved_by = $3, resolution_note = $4
       WHERE id = $1
       RETURNING id, source_id, entity_slug, claim_metric, claim_period, fact_id_a, fact_id_b, status,
         resolved_by, resolution_note, detected_at`,
      [existing.id, nextStatus, ctx.userId, note],
    );

    await insertAuditLog(client, {
      actorUserId: ctx.userId,
      action: input.resolution === 'resolve' ? 'fact_conflict.resolve' : 'fact_conflict.dismiss',
      targetType: 'fact_conflict',
      targetId: existing.id,
      previousStatus: existing.status,
      nextStatus,
      reviewComment: note,
      payload: {
        fact_id_a: existing.factIdA,
        fact_id_b: existing.factIdB,
        kept_fact_id: input.resolution === 'resolve' ? input.keepFactId?.trim() ?? null : null,
        discarded_fact_id: discardedFactId,
      },
    });

    await client.query('COMMIT');
    return { conflict: mapConflict(updated.rows[0]), discardedFactId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ── dream sweep 兜底 ─────────────────────────────────────────────────────────

// FR-396(时机②)· §5.4:对全 source 的有效 approved fact 跑 FR-395 判据,
//   兜底检出提交时未拦的历史矛盾并登记 open 冲突;唯一约束保证 sweep 重跑幂等。
export async function sweepSourceFactConflicts(sourceId: string): Promise<{ registered: number; scanned: number }> {
  if (!sourceId?.trim()) throw new NanoBrainError('source id 不能为空', 'invalid_input');
  const pool = getNanoBrainPool();
  const { rows } = await pool.query(
    `
      SELECT id, entity_slug, claim_metric, claim_value, claim_unit, claim_period
      FROM facts
      WHERE source_id = $1
        AND entity_slug IS NOT NULL
        AND claim_metric IS NOT NULL
        AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
      ORDER BY id ASC
    `,
    [sourceId.trim()],
  );

  let registered = 0;
  for (const row of rows as CandidateFactRow[]) {
    registered += await registerConflictsForFact(pool, { id: row.id, ...rowToClaim(row) });
  }
  return { registered, scanned: rows.length };
}
