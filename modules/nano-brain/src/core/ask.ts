// 015 · T2 · FR-387/388/390/391:askNanoBrain 真合成(检索证据 → LLM 网关合成答案 + 可溯源引用)。
//   删除写死串"第一阶段问答仅返回检索引用…"(search.ts 旧 stub),改为:
//     ① 有证据 → searchNanoBrain 拿证据 → 调 LLM 网关基于证据合成 answer(非写死串、非 citations 逐字拼接);
//     ② 无证据(citations 空)→ 显式"未在本知识库检索到相关依据",**不调 LLM 空编**;
//     ③ LLM 失败(返回 null/抛错)→ 降级为证据摘要 + 可见降级标注(citations 仍在),**不静默返回假答案**。
//   条目内追问(entry_slug):检索侧由 searchNanoBrain 锚定条目 + auto 邻域(第三路 link-expansion),
//   引用侧携带 chunk 级 locator(五字段 + entrySlug)+ 来源条目标注(本条目 vs 关联条目,邻域不冒充)。
//   LLM 客户端接口层可注入(deps.llm),AM-1509 patch spy 验"真调 / 无证据不调 / 失败降级"机制;
//   默认实现走 llm.ts 的 callCompileChatModel(同 openrouter 契约,不自造协议),真合成能用级归 AM-1517 门控。

import type { UserContext } from '@ff/contracts';
import { callCompileChatModel } from './llm';
import { searchNanoBrain, type NanoSearchResult } from './search';

// 无证据显式文案(AM-1509②:无证据不空编)。
export const ASK_NO_EVIDENCE_NOTE = '未在本知识库检索到相关依据';
// LLM 网关不可用时的可见降级标注(AM-1509③:降级为证据摘要,不静默返回假答案)。
export const ASK_DEGRADED_PREFIX = '（生成服务暂不可用，以下为检索到的证据摘要）';

// 引用来源条目关系:anchor=本条目 / neighbor=关联条目(auto 邻域)。仅条目内追问模式标注。
export type CitationRelation = 'anchor' | 'neighbor';

// chunk 级 locator(复用 004 FR-175 五字段 + 015 增 entrySlug)。各字段指向真实 chunk/page。
export type CitationLocator = {
  chunkId: string;
  pageId: string;
  sourceId: string;
  slug: string;
  chunkIndex: number;
  entrySlug: string;
};

export type AskCitation = NanoSearchResult & {
  locator: CitationLocator;
  // 条目内追问模式下的来源条目标注(本条目 vs 关联条目);全库问 = null。
  sourceEntry: { slug: string; relation: CitationRelation } | null;
};

export type AskResult = {
  query: string;
  answer: string;
  citations: AskCitation[];
  // 是否真调了 LLM 网关合成(AM-1509 spy 口径:有证据=true、无证据=false、失败降级=false)。
  llmUsed: boolean;
  // LLM 失败 → 降级为证据摘要(AM-1509③)。
  degraded: boolean;
  // 无证据 → 显式 note 不空编(AM-1509②)。
  noEvidence: boolean;
  // 条目内追问模式(带 entry_slug)。
  entryScoped: boolean;
};

// ─── LLM 合成客户端接口(可注入,AM-1509 在此层 patch spy)────────────────────
export type AskEvidenceItem = { index: number; slug: string; title: string; snippet: string };
export type AskLlmRequest = { query: string; evidence: AskEvidenceItem[] };

export interface AskLlmClient {
  // 返回合成文本;网关不可用/不可解析 → null(诚实降级,交由 askNanoBrain 降级为证据摘要)。
  synthesize(req: AskLlmRequest): Promise<string | null>;
}

const ASK_SYSTEM_PROMPT = [
  '你是企业知识库的问答助手。只依据用户给出的"检索证据片段"回答问题,不得编造证据外的事实。',
  '要求:用简洁中文作答;在引用某片段的结论后标注其编号如 [1][2];',
  '若证据不足以回答,请如实说明"依据不足",不要臆测。只输出答案正文,不要复述证据原文清单。',
].join('\n');

// 默认 openrouter 合成客户端:底层复用 llm.ts callCompileChatModel(同契约),网关不可用 → null。
export function createOpenRouterAskClient(env: NodeJS.ProcessEnv = process.env): AskLlmClient {
  return {
    async synthesize(req: AskLlmRequest): Promise<string | null> {
      const evidenceBlock = req.evidence
        .map((e) => `[${e.index}](${e.title})${e.snippet}`)
        .join('\n');
      const userPrompt = [`问题:${req.query}`, '检索证据片段:', evidenceBlock, '请依据以上证据回答:'].join('\n');
      const result = await callCompileChatModel(
        [
          { role: 'system', content: ASK_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.2, maxTokens: 1024 },
        env,
      );
      const content = result?.content?.trim();
      return content ? content : null;
    },
  };
}

function buildCitations(results: NanoSearchResult[], anchorSlug: string | null): AskCitation[] {
  return results.map((r) => {
    const entrySlug = r.slug;
    const sourceEntry = anchorSlug
      ? { slug: entrySlug, relation: (entrySlug === anchorSlug ? 'anchor' : 'neighbor') as CitationRelation }
      : null;
    return {
      ...r,
      locator: {
        chunkId: r.chunkId,
        pageId: r.pageId,
        sourceId: r.sourceId,
        slug: r.slug,
        chunkIndex: r.chunkIndex,
        entrySlug,
      },
      sourceEntry,
    };
  });
}

// LLM 失败降级:把检索证据摘要拼给用户(可见降级标注),非编造答案(答案内容全部来自真实 snippet)。
function buildDegradedSummary(citations: AskCitation[]): string {
  const lines = citations.map((c, i) => `[${i + 1}] ${c.title}:${c.snippet}`);
  return [ASK_DEGRADED_PREFIX, ...lines].join('\n');
}

export async function askNanoBrain(
  ctx: UserContext,
  input: { query: unknown; limit?: unknown; source_id?: unknown; page_ids?: unknown; entry_slug?: unknown },
  deps: { llm?: AskLlmClient } = {},
): Promise<AskResult> {
  const llm = deps.llm ?? createOpenRouterAskClient();
  const entrySlug =
    typeof input.entry_slug === 'string' && input.entry_slug.trim() ? input.entry_slug.trim().toLowerCase() : null;

  const search = await searchNanoBrain(ctx, {
    query: input.query,
    limit: input.limit,
    source_id: input.source_id,
    page_ids: input.page_ids, // I110：场景内问答透传 page_ids 做查询级隔离。
    entry_slug: input.entry_slug,
  });
  const citations = buildCitations(search.results, entrySlug);

  // ② 无证据 → 显式 note,不调 LLM(AM-1509②:无证据不空编,spy 调用=0)。
  if (citations.length === 0) {
    return {
      query: search.query,
      answer: ASK_NO_EVIDENCE_NOTE,
      citations,
      llmUsed: false,
      degraded: false,
      noEvidence: true,
      entryScoped: entrySlug !== null,
    };
  }

  // ① 有证据 → 调 LLM 基于证据合成(AM-1509①:spy 被调 ≥1)。
  let answer: string | null = null;
  try {
    answer = await llm.synthesize({
      query: search.query,
      evidence: citations.map((c, i) => ({ index: i + 1, slug: c.slug, title: c.title, snippet: c.snippet })),
    });
  } catch {
    answer = null;
  }

  if (answer && answer.trim()) {
    return {
      query: search.query,
      answer: answer.trim(),
      citations,
      llmUsed: true,
      degraded: false,
      noEvidence: false,
      entryScoped: entrySlug !== null,
    };
  }

  // ③ LLM 失败 → 降级为证据摘要 + 可见标注(AM-1509③:不静默返回假答案,citations 仍在)。
  return {
    query: search.query,
    answer: buildDegradedSummary(citations),
    citations,
    llmUsed: false,
    degraded: true,
    noEvidence: false,
    entryScoped: entrySlug !== null,
  };
}
