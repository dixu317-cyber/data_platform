// 014 · T4 · FR-372/373/374 · §5.2/§6.1(阶段3)/§7.3:主题聚合多源合成(N-2)。
//   compileTheme(cluster members) → 调主题 LLM 熔合同 source 同主题的 N 份原始资料 → 1 个 theme_entry
//   {跨文件 summary/outline/key_points} 落 pages(entry_kind='theme_entry'),page_members 记账 N 成员,
//   theme_entry 每分节的 evidence 溯源到**具体某成员**的 raw span → 多源 provenance(覆盖 ≥2 raw_document,不静默只熔首篇)。
//   聚合边界:cluster < 最小簇大小(默认 2)→ 不合成 theme_entry(单文件不硬熔,AM-1415)。
//   source_entry 与 theme_entry **并存不替换**(FR-373:细粒度层保留,主题层叠加)。
//   LLM 客户端注入(ThemeCompileLlmClient),测试在接口层 patch(确定性验成员记账 + 多源溯源硬映射;真 LLM 归 T6/AM-1417 门控)。
import { createHash, randomUUID } from 'node:crypto';
import { getNanoBrainPool } from '../db';
import { COMPILE_PROMPT_VERSION } from './compile';
import type { ThemeCompileLlmClient } from './llm';
import { getRawDocument, listRawChunks, type RawChunkRow, type RawDocument } from './raw-documents';

// 最小簇大小:成员数 < 此值不合成 theme_entry(避免"1 文件也硬熔成主题条目",AM-1415)。
export const DEFAULT_MIN_CLUSTER_SIZE = 2;

// 聚类成员:某 raw_document(可选其已编译的 source_entry 页 id)+ 聚类得分。
export type ThemeMemberInput = {
  rawDocumentId: string;
  sourceEntryPageId?: string | null;
  clusterScore?: number;
};

export type CompileThemeInput = {
  sourceId: string;
  members: ThemeMemberInput[];
  llm: ThemeCompileLlmClient;
  createdBy: string;
  title?: string;
  compileVersion?: string;
  minClusterSize?: number;
};

export type CompileThemeOutcome = {
  // 'skipped_singleton' = 簇 < 最小簇大小(不合成 theme_entry,聚合边界);
  // 'skipped' = LLM 网关不可用(诚实降级,不伪造);'compiled' = 已合成 theme_entry。
  status: 'compiled' | 'skipped_singleton' | 'skipped';
  themePageId?: string;
  slug?: string;
  memberCount: number;
  sectionsTotal: number;
  sectionsCited: number;
  uncitedSections: number;
  fidelityFlag: 'ok' | 'low';
  // theme provenance 覆盖的**不同** raw_document_id(多源保留度量:≥2 = 不只熔首篇)。
  provenanceRawDocumentIds: string[];
};

// 载入的成员(原文 + 可寻址分片 + 记账信息)。
type LoadedMember = {
  doc: RawDocument;
  chunks: RawChunkRow[];
  sourceEntryPageId: string | null;
  clusterScore: number | null;
};

type AssembledSection = {
  sectionId: string;
  heading: string;
  level: number;
  order: number;
  content: string;
  evidence: Array<{ rawDocumentId: string; quote: string }>;
};

type OutlineItem = { section_id: string; heading: string; level: number; order: number };

type ThemeProvenanceRow = {
  sectionId: string;
  rawDocumentId: string;
  rawChunkId: string | null;
  charStart: number;
  charEnd: number;
  quote: string;
};

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// theme_entry slug(Round-4 复审⑤根治"身份不稳"):聚类策略是"一个 source = 一个主题簇"，故 slug 只应是
//   sourceId 的稳定派生——不能编码标题或成员 id 集合。旧实现把成员集合短哈编进 slug，成员增减(2→3→1 篇)
//   就派生出新 slug，ON CONFLICT (source_id, slug) upsert 命中不到旧行，旧 theme_entry 孤儿化留在库里。
//   改为纯 sourceId 派生，同 source 任意次重编永远撞同一行，天然无孤儿。
function resolveThemeSlug(sourceId: string): string {
  return `theme-${hashContent(sourceId).slice(0, 16)}`;
}

// 簇跌破最小簇大小(如 3→1 篇)、或该 source 重编成功产出新 theme_entry 时，都要清掉该 source 下其余的
//   活跃 theme_entry，不留孤儿页继续以 entry_kind='theme_entry' 存在(listPages 按 archived_at IS NULL 过滤，
//   归档后不再被检索/浏览到)。
// Round-5 收敛(STILL-OPEN #5 归档没覆盖旧 slug):此前按 slug 精确匹配——Round-4 把 slug 稳定为纯 sourceId
//   派生后，"新稳定 slug"确实不会再有孤儿；但 Round-4 上线**之前**遗留的历史行(旧版本按成员 id 集合短哈编 slug)
//   与新稳定 slug 不同名，按 slug 匹配永远查不到，成了清不掉的历史孤儿。改为按 source 归档该 source 下**全部**
//   活跃 theme_entry，只保留 keepThemePageId 指定的这一行(若提供)，天然覆盖任意历史 slug 版本。
export async function archiveStaleThemeEntry(sourceId: string, archivedBy: string, keepThemePageId?: string): Promise<void> {
  const pool = getNanoBrainPool();
  await pool.query(
    `UPDATE pages SET archived_at = now(), archived_by = $3
       WHERE source_id = $1 AND entry_kind = 'theme_entry' AND archived_at IS NULL
         AND ($2::text IS NULL OR id <> $2)`,
    [sourceId, keepThemePageId ?? null, archivedBy],
  );
}

// 溯源映射:把某成员的 evidence 逐字子串定位回**该成员** raw_body → char 区间(落其 raw_body 内)+ 覆盖该位置的 raw_chunk。
//   定位失败 → 无溯源(该分节可能 uncited)。多成员各自独立定位 → theme provenance 天然多源。
function locateInMember(quote: string, member: LoadedMember): Omit<ThemeProvenanceRow, 'sectionId'> | null {
  if (!quote) return null;
  const rawBody = member.doc.rawBody;
  const idx = rawBody.indexOf(quote);
  if (idx < 0) return null;
  const charStart = idx;
  const charEnd = idx + quote.length;
  if (!(charStart >= 0 && charStart < charEnd && charEnd <= rawBody.length)) return null;
  const chunk = member.chunks.find((c) => c.charStart <= charStart && charStart < c.charEnd) ?? null;
  return {
    rawDocumentId: member.doc.id,
    rawChunkId: chunk ? chunk.id : null,
    charStart,
    charEnd,
    quote: rawBody.slice(charStart, charEnd),
  };
}

function buildThemeBodyMarkdown(title: string, summary: string, sections: AssembledSection[], keyPoints: string[]): string {
  const parts: string[] = [`# ${title}`, ''];
  if (summary.trim()) parts.push('## 主题概览', '', summary.trim(), '');
  for (const s of sections) parts.push(`## ${s.heading}`, '', s.content.trim(), '');
  if (keyPoints.length > 0) parts.push('## 要点', '', ...keyPoints.map((k) => `- ${k}`), '');
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * 主题聚合合成 v1:N 源(同 source 同主题簇)→ 1 theme_entry + page_members(N 成员记账)+ 多源 provenance。
 *   - 簇 < 最小簇大小 → status='skipped_singleton'(不合成,聚合边界 AM-1415)。
 *   - LLM 网关不可用(compileTheme 返回 null)→ status='skipped'(诚实降级,不伪造)。
 *   - source_entry 与 theme_entry 并存(本函数只建/更新 theme_entry,不触碰成员 source_entry)。
 *   原子落 pages(theme_entry)+ page_members + page_provenance(重编先清后写,幂等)。
 */
export async function compileTheme(input: CompileThemeInput): Promise<CompileThemeOutcome> {
  const compileVersion = input.compileVersion ?? COMPILE_PROMPT_VERSION;
  const minClusterSize = Math.max(1, input.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE);

  // 载入簇成员(原文 + 可寻址分片)。不存在的成员剔除(不静默计入记账)。
  const members: LoadedMember[] = [];
  for (const m of input.members) {
    const doc = await getRawDocument(m.rawDocumentId);
    if (!doc) continue;
    const chunks = await listRawChunks(doc.id);
    members.push({
      doc,
      chunks,
      sourceEntryPageId: m.sourceEntryPageId ?? null,
      clusterScore: m.clusterScore ?? null,
    });
  }
  const memberCount = members.length;

  const emptyOutcome = (status: CompileThemeOutcome['status']): CompileThemeOutcome => ({
    status,
    memberCount,
    sectionsTotal: 0,
    sectionsCited: 0,
    uncitedSections: 0,
    fidelityFlag: 'ok',
    provenanceRawDocumentIds: [],
  });

  // 聚合边界:簇 < 最小簇大小 → 不合成 theme_entry(单文件不硬熔,AM-1415)。
  //   Round-4 复审⑤:若该 source 此前已有 theme_entry(旧成员集合更大时的产物)→ 归档，不留孤儿页。
  if (memberCount < minClusterSize) {
    await archiveStaleThemeEntry(input.sourceId, input.createdBy);
    return emptyOutcome('skipped_singleton');
  }

  const title = input.title?.trim() || `主题合成(${memberCount} 源)`;

  // 调主题 LLM 熔合(map);网关不可用 → 诚实降级 skipped(不伪造)。
  const llmResult = await input.llm.compileTheme({
    title,
    members: members.map((m) => ({ rawDocumentId: m.doc.id, title: m.doc.title, rawText: m.doc.rawBody })),
  });
  if (llmResult === null) return emptyOutcome('skipped');

  const memberById = new Map(members.map((m) => [m.doc.id, m]));

  // 组装分节(全局 order/section_id)+ 多源溯源(reduce:逐分节逐 evidence 定位回**其所属成员**原文)。
  const assembled: AssembledSection[] = [];
  let order = 0;
  for (const s of llmResult.sections) {
    order += 1;
    assembled.push({
      sectionId: `t${order}`,
      heading: s.heading,
      level: s.level,
      order,
      content: s.content,
      evidence: s.evidence,
    });
  }

  const provenanceRows: ThemeProvenanceRow[] = [];
  const citedSectionIds = new Set<string>();
  for (const section of assembled) {
    for (const ev of section.evidence) {
      const member = memberById.get(ev.rawDocumentId);
      if (!member) continue; // evidence 指向非成员 → 丢弃(不越簇溯源)
      const located = locateInMember(ev.quote, member);
      if (!located) continue;
      provenanceRows.push({ sectionId: section.sectionId, ...located });
      citedSectionIds.add(section.sectionId);
    }
  }

  // 忠实度自检(FR-366):无对应 provenance 的分节 → uncited;flag=low。
  const sectionsTotal = assembled.length;
  const sectionsCited = citedSectionIds.size;
  const uncitedSections = sectionsTotal - sectionsCited;
  const fidelityFlag: 'ok' | 'low' = uncitedSections > 0 ? 'low' : 'ok';
  const provenanceRawDocumentIds = [...new Set(provenanceRows.map((r) => r.rawDocumentId))];

  const summary = (llmResult.summary ?? '').trim();
  const keyPoints = Array.isArray(llmResult.keyPoints) ? llmResult.keyPoints : [];
  const outline: OutlineItem[] = assembled.map((s) => ({ section_id: s.sectionId, heading: s.heading, level: s.level, order: s.order }));
  const body = buildThemeBodyMarkdown(title, summary, assembled, keyPoints);
  const contentHash = hashContent(body);
  const slug = resolveThemeSlug(input.sourceId);
  const metadata = {
    entry: { summary, outline, key_points: keyPoints },
    compile: {
      model: llmResult.model ?? '',
      prompt_version: compileVersion,
      segments: 1,
      member_count: memberCount,
      token_cost: { prompt: 0, completion: 0 },
      latency_ms: 0,
      error: null,
    },
    fidelity: {
      sections_total: sectionsTotal,
      sections_cited: sectionsCited,
      uncited_sections: uncitedSections,
      flag: fidelityFlag,
    },
    granularity: 'theme',
  };

  const pool = getNanoBrainPool();
  const client = await pool.connect();
  let themePageId: string;
  try {
    await client.query('BEGIN');
    const upserted = await client.query(
      `
        INSERT INTO pages (
          id, source_id, slug, title, body, content_hash, created_by, updated_by,
          entry_kind, compile_status, compile_version, granularity, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 'theme_entry', 'compiled', $8, 'theme', $9::jsonb)
        ON CONFLICT (source_id, slug)
        DO UPDATE SET
          title = EXCLUDED.title,
          body = EXCLUDED.body,
          content_hash = EXCLUDED.content_hash,
          updated_by = EXCLUDED.updated_by,
          updated_at = now(),
          entry_kind = 'theme_entry',
          compile_status = 'compiled',
          compile_version = EXCLUDED.compile_version,
          granularity = 'theme',
          metadata = EXCLUDED.metadata,
          archived_at = NULL,
          archived_by = NULL
        RETURNING id
      `,
      [randomUUID(), input.sourceId, slug, title, body, contentHash, input.createdBy, compileVersion, JSON.stringify(metadata)],
    );
    themePageId = upserted.rows[0].id;

    // 重编幂等:先清旧成员记账 + 旧溯源,再写新(避免重复条目)。
    await client.query('DELETE FROM page_members WHERE theme_page_id = $1', [themePageId]);
    await client.query('DELETE FROM page_provenance WHERE page_id = $1', [themePageId]);

    // page_members 记账:每成员一行(==入库源数,无静默丢)。有 source_entry → member_kind='source_entry',否则 'raw_document'。
    for (const m of members) {
      const memberKind = m.sourceEntryPageId ? 'source_entry' : 'raw_document';
      await client.query(
        `
          INSERT INTO page_members (
            id, theme_page_id, member_kind, member_page_id, raw_document_id, cluster_score
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [randomUUID(), themePageId, memberKind, m.sourceEntryPageId, m.doc.id, m.clusterScore],
      );
    }

    // 多源 provenance:theme_entry 分节 → 具体某成员的 raw span(覆盖多 raw_document,不只熔首篇)。
    for (const row of provenanceRows) {
      await client.query(
        `
          INSERT INTO page_provenance (
            id, page_id, source_id, section_id, assertion_ordinal, raw_document_id, raw_chunk_id, char_start, char_end, quote, confidence
          )
          VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, 1.0)
        `,
        [randomUUID(), themePageId, input.sourceId, row.sectionId, row.rawDocumentId, row.rawChunkId, row.charStart, row.charEnd, row.quote],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // Round-5 收敛(STILL-OPEN #5 归档没覆盖旧 slug):本次写入的 upsert 只按(source_id, 新稳定 slug)命中同一行，
  //   不会触碰 Round-4 之前遗留的旧 slug 版本孤儿。写入成功后额外做一次"清该 source 下除本行外的全部活跃
  //   theme_entry"扫尾，覆盖旧 slug 孤儿。best-effort:此步失败不影响已提交的写入结果，异常直接抛出让上层感知
  //   (调用方 dream phase 已有非阻断容错,不会回滚本次已落盘的合成结果)。
  await archiveStaleThemeEntry(input.sourceId, input.createdBy, themePageId);

  return {
    status: 'compiled',
    themePageId,
    slug,
    memberCount,
    sectionsTotal,
    sectionsCited,
    uncitedSections,
    fidelityFlag,
    provenanceRawDocumentIds,
  };
}
