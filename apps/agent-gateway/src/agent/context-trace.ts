import type { BaseMessage } from '@langchain/core/messages';
import {
  buildGlobalRetrievalTracks,
  type GlobalChatCitation,
  type GlobalChatContextTrace,
  type GlobalChatScope,
  type RetrievalAttempt,
} from '@ff/platform/platform-store';
import { KEPT_TURNS, splitIntoTurns } from './short-term-memory';

// P36d 阶段1a：contextTrace 最小完整生成（D-P36d-3 不降级，阶段0 勘察4 缺口清单第3条）。
// 6 个子字段中 route/retrievalTracks 有清晰推导来源；其余 4 个逐一给定最小生成规则（如实反映
// 新架构（P36c）当前的记忆层次，不编造内容）：
// - scopeLabel/routeReason：纯派生自 scope/citations，无歧义。
// - shortTermTurns/compressedContext：读 P36c middleware 私有 state（transcript 轮次 / summaryText），
//   real 值而非占位符。
// - longTermMemoryHits：新架构目前只有「短期 transcript + 自动摘要」两层 working state，尚无独立
//   长期记忆事实库（P36c 执行 spec 未建）——固定空数组是对当前架构层次的忠实反映，不是遗漏占位。

const SCOPE_LABELS: Record<GlobalChatScope, string> = {
  company: '全公司',
  team: '团队',
  private: '仅本人',
};

export type GlobalAgentFinalState = {
  messages?: BaseMessage[];
  summaryText?: string | null;
};

export type BuildGlobalContextTraceInput = {
  citations: GlobalChatCitation[];
  scope: GlobalChatScope;
  /** LangGraph agent 最终 state（`await langChainStream.output`），承载 P36c middleware 私有 state。 */
  finalState: GlobalAgentFinalState | null | undefined;
  /** P52 §六阶段3（3B）：本轮全部工具调用的执行记录（同 run 内共享同一 routingDecision）；空数组=本轮未调工具。 */
  retrievalAttempts: RetrievalAttempt[];
};

export function buildGlobalContextTrace(input: BuildGlobalContextTraceInput): GlobalChatContextTrace {
  // P52 route bug 修复（§二.7/Δ4）：route 由"是否调过工具"决定，不再用 citations.length——
  // 工具调了但零命中（如全查后仍无匹配文档）也必须是 retrieve，不能因 citations 为空而误判成 direct
  // （AC-零命中一致：toolInvoked=true 时 route 恒 retrieve）。
  const toolInvoked = input.retrievalAttempts.length > 0;
  const route: 'direct' | 'retrieve' = toolInvoked ? 'retrieve' : 'direct';
  const routeReason =
    route === 'retrieve'
      ? input.citations.length > 0
        ? `本轮命中 ${input.citations.length} 条知识库引用，答案基于检索结果生成。`
        : '本轮已触发复合检索工具（company_knowledge_search）但未命中知识库引用。'
      : '本轮未触发复合检索工具（company_knowledge_search），直接生成回答。';

  const messages = Array.isArray(input.finalState?.messages) ? (input.finalState!.messages as BaseMessage[]) : [];
  const shortTermTurns = Math.min(splitIntoTurns(messages).length, KEPT_TURNS);
  const compressedContext = input.finalState?.summaryText ?? '';

  // 多工具：本轮所有工具调用共享同一 immutable RoutingDecision（§四 v0.3 多工具决策缓存冻结），
  // 取第一条即代表本轮路由决策；retrievalAttempts 整体保留（AC-多工具：两组执行都要留，不只留最后一次）。
  const routing = input.retrievalAttempts[0]?.routingDecision;

  return {
    layers: [
      `短期记忆（近 ${KEPT_TURNS} 轮完整对话，原文截断注入）`,
      '自动摘要（P36c 滚动摘要，压缩更早历史意图/实体）',
      '复合检索工具（company_knowledge_search，跨 Nano Brain/Traditional RAG/GraphRAG 三引擎精排）',
    ],
    scopeLabel: SCOPE_LABELS[input.scope],
    route,
    routeReason,
    shortTermTurns,
    compressedContext,
    longTermMemoryHits: [],
    retrievalTracks: buildGlobalRetrievalTracks(input.citations),
    ...(routing ? { routing } : {}),
    ...(toolInvoked ? { retrievalAttempts: input.retrievalAttempts } : {})
  };
}
