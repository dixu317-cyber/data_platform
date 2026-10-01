import type { UserContext } from '@ff/contracts';
import { getNanoBrainPool } from '../db';
import { embedTexts, vectorToSqlLiteral } from './embeddings';
import { buildFactRecallText } from './facts';
import { graphQuery } from './links';
import { NanoBrainError } from './sources';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const SEARCH_POOL_LIMIT = 40;
const RRF_K = 60;

// 004 · FR-162:fact 召回项来源类型可辨(fact-keyword / fact-vector),供上层与可观测识别。
// 015 · T2 · FR-389:互链扩展召回第三路 = 'link-expansion'(加法融入 RRF,不回改既有两路/fact 路语义)。
export type SearchMatchType = 'keyword' | 'vector' | 'fact-keyword' | 'fact-vector' | 'link-expansion';

export type NanoSearchResult = {
  chunkId: string;
  pageId: string;
  sourceId: string;
  sourceKind: 'private' | 'public';
  sourceName: string;
  slug: string;
  title: string;
  chunkIndex: number;
  snippet: string;
  score: number;
  matchTypes: SearchMatchType[];
  // 004 · FR-164:召回项类型 + fact 引用锚点(chunk 引用时 factId/entitySlug 为空)。
  resultType: 'chunk' | 'fact';
  knowledgeType: string;
  factId?: string;
  entitySlug?: string | null;
  evidenceQuote?: string | null;
  evidenceUrl?: string | null;
};

export type NanoSearchResponse = {
  query: string;
  results: NanoSearchResult[];
  // 004 · FR-171:向量/语义路本次是否降级(embedding 不可用)。关键词路(含 fact)不连坐。
  // 用户可见降级文案 + 检索健康结构由平台层消费此信号。
  vectorDegraded: boolean;
  // 降级时的用户可见文案(embedding 不可用,仅关键词匹配)。未降级为 null。
  degradedNote: string | null;
};

// FR-171:语义检索降级的用户可见文案(embedding 不可用时,关键词路照常返回)。
export const NANO_SEMANTIC_DEGRADED_NOTE = '语义检索本次降级（embedding 不可用，仅关键词匹配）';

type Candidate = {
  chunkId: string;
  pageId: string;
  sourceId: string;
  sourceKind: 'private' | 'public';
  sourceName: string;
  slug: string;
  title: string;
  chunkIndex: number;
  chunkText: string;
};

function normalizeQuery(query: unknown): string {
  if (typeof query !== 'string') {
    throw new NanoBrainError('查询必须是字符串', 'invalid_input');
  }
  const normalized = query.trim();
  if (normalized.length < 1) {
    throw new NanoBrainError('查询不能为空', 'invalid_input');
  }
  if (normalized.length > 500) {
    throw new NanoBrainError('查询不能超过 500 个字符', 'invalid_input');
  }
  return normalized;
}

function normalizeLimit(limit: unknown): number {
  if (limit === undefined || limit === null) return DEFAULT_LIMIT;
  const value = Number(limit);
  if (!Number.isInteger(value) || value < 1) {
    throw new NanoBrainError('limit 必须是正整数', 'invalid_input');
  }
  return Math.min(value, MAX_LIMIT);
}

// undefined/null = 不传，保持“全库检索”语义；非空字符串按 source_id 过滤；空字符串是非法输入，显式拒绝而非静默回退全库（I102）。
export function normalizeSourceId(sourceId: unknown): string | null {
  if (sourceId === undefined || sourceId === null) return null;
  if (typeof sourceId !== 'string') {
    throw new NanoBrainError('source_id 必须是字符串', 'invalid_input');
  }
  const trimmed = sourceId.trim();
  if (trimmed.length === 0) {
    throw new NanoBrainError('source_id 不能为空字符串', 'invalid_input');
  }
  return trimmed;
}

// I110：可选 page 级过滤。个人（"仅自己可用"）场景全部映射到同一 per-user source
// (user/<uid>)，只按 source_id 过滤无法隔离场景——场景内问答会串到同用户其他场景的
// 资料。scene page 由平台层按 page_id 归属场景，场景内问答传本场景 page_ids 做查询级
// 隔离。undefined/null/空数组 = 不按 page 过滤（保持向后兼容）；非空则必须是字符串数组。
export function normalizePageIds(pageIds: unknown): string[] | null {
  if (pageIds === undefined || pageIds === null) return null;
  if (!Array.isArray(pageIds)) {
    throw new NanoBrainError('page_ids 必须是字符串数组', 'invalid_input');
  }
  const cleaned = pageIds.map((id) => {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new NanoBrainError('page_ids 每一项必须是非空字符串', 'invalid_input');
    }
    return id.trim();
  });
  return cleaned.length > 0 ? cleaned : null;
}

function mapCandidate(row: any): Candidate {
  return {
    chunkId: row.chunk_id,
    pageId: row.page_id,
    sourceId: row.source_id,
    sourceKind: row.source_kind,
    sourceName: row.source_name,
    slug: row.slug,
    title: row.title,
    chunkIndex: Number(row.chunk_index),
    chunkText: row.chunk_text,
  };
}

function makeSnippet(text: string, query: string): string {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  const lowerText = normalizedText.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index < 0) return normalizedText.slice(0, 240);

  const start = Math.max(0, index - 80);
  const end = Math.min(normalizedText.length, index + lowerQuery.length + 160);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < normalizedText.length ? '…' : '';
  return `${prefix}${normalizedText.slice(start, end)}${suffix}`;
}

function candidateToResult(
  candidate: Candidate,
  input: { query: string; score: number; matchTypes: Set<SearchMatchType> },
): NanoSearchResult {
  return {
    chunkId: candidate.chunkId,
    pageId: candidate.pageId,
    sourceId: candidate.sourceId,
    sourceKind: candidate.sourceKind,
    sourceName: candidate.sourceName,
    slug: candidate.slug,
    title: candidate.title,
    chunkIndex: candidate.chunkIndex,
    snippet: makeSnippet(candidate.chunkText, input.query),
    score: Number(input.score.toFixed(6)),
    matchTypes: Array.from(input.matchTypes).sort(),
    resultType: 'chunk',
    knowledgeType: '文档片段',
  };
}

// 004 · fact 召回候选(over facts 表 readable 集)。
type FactCandidate = {
  factId: string;
  sourceId: string;
  sourceKind: 'private' | 'public';
  sourceName: string;
  entitySlug: string | null;
  fact: string;
  context: string | null;
  claimMetric: string | null;
  claimValue: number | null;
  claimUnit: string | null;
  claimPeriod: string | null;
  evidenceQuote: string | null;
  evidenceUrl: string | null;
};

function mapFactCandidate(row: any): FactCandidate {
  return {
    factId: row.fact_id,
    sourceId: row.source_id,
    sourceKind: row.source_kind,
    sourceName: row.source_name,
    entitySlug: row.entity_slug,
    fact: row.fact,
    context: row.context,
    claimMetric: row.claim_metric,
    claimValue: row.claim_value === null || row.claim_value === undefined ? null : Number(row.claim_value),
    claimUnit: row.claim_unit,
    claimPeriod: row.claim_period,
    evidenceQuote: row.evidence_quote,
    evidenceUrl: row.evidence_url,
  };
}

function factCandidateToResult(
  candidate: FactCandidate,
  input: { query: string; score: number; matchTypes: Set<SearchMatchType> },
): NanoSearchResult {
  const recallText = buildFactRecallText(candidate);
  return {
    // fact 无 chunk/page;chunkId 复用为 factId 保持融合去重键唯一,resultType 区分类型。
    chunkId: candidate.factId,
    pageId: '',
    sourceId: candidate.sourceId,
    sourceKind: candidate.sourceKind,
    sourceName: candidate.sourceName,
    slug: candidate.entitySlug ?? '',
    title: candidate.entitySlug ?? candidate.sourceName,
    chunkIndex: 0,
    snippet: makeSnippet(recallText, input.query),
    score: Number(input.score.toFixed(6)),
    matchTypes: Array.from(input.matchTypes).sort(),
    resultType: 'fact',
    knowledgeType: '审核事实',
    factId: candidate.factId,
    entitySlug: candidate.entitySlug,
    evidenceQuote: candidate.evidenceQuote,
    evidenceUrl: candidate.evidenceUrl,
  };
}

async function keywordSearch(
  ctx: UserContext,
  query: string,
  sourceId: string | null,
  pageIds: string[] | null,
): Promise<Candidate[]> {
  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT
        c.id AS chunk_id,
        c.page_id,
        c.source_id,
        s.kind AS source_kind,
        s.name AS source_name,
        c.slug,
        p.title,
        c.chunk_index,
        c.chunk_text
      FROM chunks c
      JOIN pages p ON p.id = c.page_id
      JOIN sources s ON s.id = c.source_id
      WHERE p.archived_at IS NULL
        AND ($1::boolean = true OR s.kind = 'public' OR s.owner_user_id = $2)
        AND (c.chunk_text ILIKE $3 OR p.title ILIKE $3 OR c.slug ILIKE $3)
        AND ($5::text IS NULL OR c.source_id = $5::text)
        AND ($6::text[] IS NULL OR c.page_id = ANY($6::text[]))
      ORDER BY
        CASE WHEN p.title ILIKE $3 THEN 0 ELSE 1 END,
        p.updated_at DESC,
        c.chunk_index ASC
      LIMIT $4
    `,
    [ctx.isAdmin, ctx.userId, `%${query}%`, SEARCH_POOL_LIMIT, sourceId, pageIds],
  );
  return result.rows.map(mapCandidate);
}

async function vectorSearch(
  ctx: UserContext,
  query: string,
  sourceId: string | null,
  pageIds: string[] | null,
): Promise<Candidate[]> {
  const { embeddings } = await embedTexts([query], 'search');
  const queryVector = embeddings[0];
  if (!queryVector) return [];

  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT
        c.id AS chunk_id,
        c.page_id,
        c.source_id,
        s.kind AS source_kind,
        s.name AS source_name,
        c.slug,
        p.title,
        c.chunk_index,
        c.chunk_text,
        c.embedding <=> $3::vector AS distance
      FROM chunks c
      JOIN pages p ON p.id = c.page_id
      JOIN sources s ON s.id = c.source_id
      WHERE p.archived_at IS NULL
        AND ($1::boolean = true OR s.kind = 'public' OR s.owner_user_id = $2)
        AND vector_dims(c.embedding) = $5
        AND ($6::text IS NULL OR c.source_id = $6::text)
        AND ($7::text[] IS NULL OR c.page_id = ANY($7::text[]))
      ORDER BY c.embedding <=> $3::vector ASC
      LIMIT $4
    `,
    [ctx.isAdmin, ctx.userId, vectorToSqlLiteral(queryVector), SEARCH_POOL_LIMIT, queryVector.length, sourceId, pageIds],
  );
  return result.rows.map(mapCandidate);
}

// FR-162/163/165:fact 关键词召回路。
// 权限谓词与 chunk 完全一致(经 source_id JOIN sources),生命周期以"当前可检索"为准
// (valid_until 过期即过滤);关键词路不依赖 embedding —— 审核通过 fact 立即可关键词召回,不是黑洞。
async function factKeywordSearch(
  ctx: UserContext,
  query: string,
  sourceId: string | null,
  pageIds: string[] | null,
): Promise<FactCandidate[]> {
  // I110：facts 表按 source_id/entity_slug 归属，无 page_id 列，无法按场景 page 隔离。
  // 场景内问答（page_ids 非空）传入时，fact 是 source 级全局知识层，返回会串到同用户其他
  // 场景——为守住场景级隔离，此路整束不参与（返回空），只让 page 级可隔离的 chunk 路召回。
  if (pageIds) return [];
  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT
        f.id AS fact_id,
        f.source_id,
        s.kind AS source_kind,
        s.name AS source_name,
        f.entity_slug,
        f.fact,
        f.context,
        f.claim_metric,
        f.claim_value,
        f.claim_unit,
        f.claim_period,
        f.evidence_quote,
        f.evidence_url
      FROM facts f
      JOIN sources s ON s.id = f.source_id
      WHERE ($1::boolean = true OR s.kind = 'public' OR s.owner_user_id = $2)
        AND (f.valid_until IS NULL OR f.valid_until >= CURRENT_DATE)
        AND (
          f.fact ILIKE $3 OR f.entity_slug ILIKE $3 OR f.context ILIKE $3
          OR f.evidence_quote ILIKE $3 OR f.claim_metric ILIKE $3
          OR f.claim_unit ILIKE $3 OR f.claim_period ILIKE $3
          OR COALESCE(f.claim_value::text, '') ILIKE $3
        )
        AND ($5::text IS NULL OR f.source_id = $5::text)
      ORDER BY f.confidence DESC, f.approved_at DESC
      LIMIT $4
    `,
    [ctx.isAdmin, ctx.userId, `%${query}%`, SEARCH_POOL_LIMIT, sourceId],
  );
  return result.rows.map(mapFactCandidate);
}

// FR-162/163/165:fact 向量召回路。仅 retrievable(嵌入已就绪)集参与;权限/生命周期谓词同上。
async function factVectorSearch(
  ctx: UserContext,
  query: string,
  sourceId: string | null,
  pageIds: string[] | null,
): Promise<FactCandidate[]> {
  // I110：同 factKeywordSearch —— facts 无 page_id 列不可按场景隔离，场景内问答此路整束不参与。
  // 前置于 embedTexts，场景隔离时连 embedding 都不必调（省一次远程往返）。
  if (pageIds) return [];
  const { embeddings } = await embedTexts([query], 'search');
  const queryVector = embeddings[0];
  if (!queryVector) return [];

  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT
        f.id AS fact_id,
        f.source_id,
        s.kind AS source_kind,
        s.name AS source_name,
        f.entity_slug,
        f.fact,
        f.context,
        f.claim_metric,
        f.claim_value,
        f.claim_unit,
        f.claim_period,
        f.evidence_quote,
        f.evidence_url,
        f.embedding <=> $3::vector AS distance
      FROM facts f
      JOIN sources s ON s.id = f.source_id
      WHERE ($1::boolean = true OR s.kind = 'public' OR s.owner_user_id = $2)
        AND f.retrievable = true
        AND f.embedding IS NOT NULL
        AND (f.valid_until IS NULL OR f.valid_until >= CURRENT_DATE)
        AND vector_dims(f.embedding) = $5
        AND ($6::text IS NULL OR f.source_id = $6::text)
      ORDER BY f.embedding <=> $3::vector ASC
      LIMIT $4
    `,
    [ctx.isAdmin, ctx.userId, vectorToSqlLiteral(queryVector), SEARCH_POOL_LIMIT, queryVector.length, sourceId],
  );
  return result.rows.map(mapFactCandidate);
}

// 015 · T2 · FR-388/389:条目内追问时,解析锚定条目所属 source(未显式传 source_id → 由 slug 反查首个可读 source)。
async function resolveAnchorSourceId(
  ctx: UserContext,
  entrySlug: string,
  sourceId: string | null,
): Promise<string | null> {
  if (sourceId) return sourceId;
  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT p.source_id
      FROM pages p
      JOIN sources s ON s.id = p.source_id
      WHERE p.slug = $1
        AND p.archived_at IS NULL
        AND ($2::boolean = true OR s.kind = 'public' OR s.owner_user_id = $3)
      LIMIT 1
    `,
    [entrySlug, ctx.isAdmin, ctx.userId],
  );
  return (result.rows[0]?.source_id as string | undefined) ?? null;
}

// 015 · T2 · FR-389(第三路 link-expansion):取 auto 邻域条目的 chunks 作候选。
//   权限谓词与 keywordSearch 完全一致;scoped 到锚定 source(cross-source slug 邻居不越界泄漏)。
async function linkExpansionSearch(
  ctx: UserContext,
  slugs: string[],
  sourceId: string | null,
  pageIds: string[] | null,
): Promise<Candidate[]> {
  if (slugs.length === 0) return [];
  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT
        c.id AS chunk_id,
        c.page_id,
        c.source_id,
        s.kind AS source_kind,
        s.name AS source_name,
        c.slug,
        p.title,
        c.chunk_index,
        c.chunk_text
      FROM chunks c
      JOIN pages p ON p.id = c.page_id
      JOIN sources s ON s.id = c.source_id
      WHERE p.archived_at IS NULL
        AND ($1::boolean = true OR s.kind = 'public' OR s.owner_user_id = $2)
        AND c.slug = ANY($3::text[])
        AND ($4::text IS NULL OR c.source_id = $4::text)
        AND ($6::text[] IS NULL OR c.page_id = ANY($6::text[]))
      ORDER BY c.slug ASC, c.chunk_index ASC
      LIMIT $5
    `,
    [ctx.isAdmin, ctx.userId, slugs, sourceId, SEARCH_POOL_LIMIT, pageIds],
  );
  return result.rows.map(mapCandidate);
}

export async function searchNanoBrain(
  ctx: UserContext,
  input: { query: unknown; limit?: unknown; source_id?: unknown; page_ids?: unknown; entry_slug?: unknown },
): Promise<NanoSearchResponse> {
  const query = normalizeQuery(input.query);
  const limit = normalizeLimit(input.limit);
  // I102：source_id 空串显式拒绝（不静默回退全库）；I110：page_ids 场景级查询隔离。
  let sourceId = normalizeSourceId(input.source_id);
  const pageIds = normalizePageIds(input.page_ids);

  // 015 · T2 · AM-1510/1511:条目内追问 → 锚定条目 + auto 邻域(第三路 link-expansion),范围限定 source_id。
  //   entry_slug 缺省 → 全走既有全库/全 source 检索(向后兼容,004 语义零改动)。
  const entrySlug =
    typeof input.entry_slug === 'string' && input.entry_slug.trim() ? input.entry_slug.trim().toLowerCase() : null;
  let allowedSlugs: Set<string> | null = null;
  let expansionSlugs: string[] = [];
  if (entrySlug) {
    sourceId = await resolveAnchorSourceId(ctx, entrySlug, sourceId); // 限定 source_id 内(AM-1510②)
    // graphQuery 检索邻域只取 manual+auto(GRAPH_NEIGHBORHOOD_ORIGINS),suggested 天然不进(AM-1504/1511③)。
    const graph = await graphQuery(ctx, { slug: entrySlug, depth: 1, direction: 'both' });
    expansionSlugs = graph.nodes.filter((slug) => slug !== entrySlug);
    allowedSlugs = new Set<string>([entrySlug, ...expansionSlugs]);
  }

  // FR-162/171:chunk 两路 + fact 两路(关键词 + 向量),四路统一进 RRF 融合(沿用 RRF_K)。
  // 关键词路(chunk/fact)必须成功——真 DB 错误照常抛出,不吞;
  // 向量路(chunk/fact)共用 embedding,embedding 不可用时**整束降级为空**,关键词路不连坐(FR-171)。
  const [keywordCandidates, factKeywordCandidates, vectorBundle] = await Promise.all([
    keywordSearch(ctx, query, sourceId, pageIds),
    factKeywordSearch(ctx, query, sourceId, pageIds),
    (async (): Promise<{ vector: Candidate[]; factVector: FactCandidate[]; degraded: boolean }> => {
      try {
        const [vector, factVector] = await Promise.all([
          vectorSearch(ctx, query, sourceId, pageIds),
          factVectorSearch(ctx, query, sourceId, pageIds),
        ]);
        return { vector, factVector, degraded: false };
      } catch {
        return { vector: [], factVector: [], degraded: true };
      }
    })(),
  ]);
  const vectorCandidates = vectorBundle.vector;
  const factVectorCandidates = vectorBundle.factVector;

  // 融合去重键:chunk 用 `c:<chunkId>`、fact 用 `f:<factId>`,避免跨类型 id 碰撞。
  type Ranked = { result: NanoSearchResult; score: number; matchTypes: Set<SearchMatchType>; order: number };
  const byId = new Map<string, Ranked>();

  const accrueChunk = (candidate: Candidate, index: number, matchType: SearchMatchType) => {
    const key = `c:${candidate.chunkId}`;
    const current = byId.get(key) ?? {
      result: candidateToResult(candidate, { query, score: 0, matchTypes: new Set() }),
      score: 0,
      matchTypes: new Set<SearchMatchType>(),
      order: candidate.chunkIndex,
    };
    current.score += 1 / (RRF_K + index + 1);
    current.matchTypes.add(matchType);
    byId.set(key, current);
  };

  const accrueFact = (candidate: FactCandidate, index: number, matchType: SearchMatchType) => {
    const key = `f:${candidate.factId}`;
    const current = byId.get(key) ?? {
      result: factCandidateToResult(candidate, { query, score: 0, matchTypes: new Set() }),
      score: 0,
      matchTypes: new Set<SearchMatchType>(),
      order: 0,
    };
    current.score += 1 / (RRF_K + index + 1);
    current.matchTypes.add(matchType);
    byId.set(key, current);
  };

  keywordCandidates.forEach((candidate, index) => accrueChunk(candidate, index, 'keyword'));
  vectorCandidates.forEach((candidate, index) => accrueChunk(candidate, index, 'vector'));
  factKeywordCandidates.forEach((candidate, index) => accrueFact(candidate, index, 'fact-keyword'));
  factVectorCandidates.forEach((candidate, index) => accrueFact(candidate, index, 'fact-vector'));

  // 015 · T2 · AM-1511:互链扩展召回第三路(link-expansion)加法融入既有 byId RRF 融合(沿用 RRF_K)。
  //   既有 keyword/vector/fact 路 accrue 完全不动;此处只对邻域 chunk 再叠加一路信号(matchTypes 增 'link-expansion')。
  if (entrySlug && expansionSlugs.length > 0) {
    const expansionCandidates = await linkExpansionSearch(ctx, expansionSlugs, sourceId, pageIds);
    expansionCandidates.forEach((candidate, index) => accrueChunk(candidate, index, 'link-expansion'));
  }

  let ranked = Array.from(byId.values()).sort((a, b) => b.score - a.score || a.order - b.order);
  // 015 · T2 · AM-1510:条目内追问 → 结果收敛到 {锚定条目 ∪ auto 邻域}(越界 citation=0)。
  if (allowedSlugs) {
    ranked = ranked.filter((item) => allowedSlugs!.has(item.result.slug));
  }
  const results = ranked.slice(0, limit).map((item) => ({
    ...item.result,
    score: Number(item.score.toFixed(6)),
    matchTypes: Array.from(item.matchTypes).sort(),
  }));

  return {
    query,
    results,
    vectorDegraded: vectorBundle.degraded,
    degradedNote: vectorBundle.degraded ? NANO_SEMANTIC_DEGRADED_NOTE : null
  };
}
