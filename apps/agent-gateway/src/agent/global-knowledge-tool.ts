import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  resolveGlobalRetrieveRouting,
  retrieveGlobalKnowledge,
  type GlobalChatCitation,
  type GlobalChatScope,
  type RetrievalAttempt,
  type RoutingDecision,
  type StoreUser,
} from '@ff/platform/platform-store';

// P36b T3：全域问答的复合检索工具。架构取舍（P36 设计审 §2.2 已拍板，非违规）——
// CLAUDE.md 边界 #4 要求 Agent Gateway 只通过模块 MCP Server 编排工具，不直接实现 RAG 业务逻辑；
// 本工具走 `@ff/platform` 窄口（retrieveGlobalKnowledge）→ 模块 HTTP，是编排 platform 既有的
// 三引擎检索 + qwen3-rerank 服务，而非自实现 RAG。之所以不直接放开三模块 MCP 让 agent 自主检索，
// 是为了保住 rerank 后的统一相关度排序（放开会重现 D1 死结：agent 拿到三套互不可比的原始分数，
// 无法判断哪个引擎的结果更相关）。

export type GlobalKnowledgeRetrieveFn = typeof retrieveGlobalKnowledge;

export type GlobalKnowledgeCitationsSink = { citations: GlobalChatCitation[] };

// P52 §四/§六阶段3（3A）：run 级路由决策聚合 sink——与 GlobalKnowledgeCitationsSink 并列（不合并，
// stream.ts 各建一份，二者语义独立：citations 是 SSE/落库要用的引用，retrievalSink 是路由可观测性）。
// routingDecisionPromise 惰性单算：本轮首个工具调用创建，同轮所有工具调用复用同一 immutable
// RoutingDecision（§四 v0.3 多工具决策缓存冻结，防第二次 classifier 非确定性得到不同 engines）。
export type GlobalKnowledgeRetrievalSink = {
  retrievalAttempts: RetrievalAttempt[];
  routingDecisionPromise: Promise<RoutingDecision> | null;
};

export const GLOBAL_KNOWLEDGE_TOOL_NAME = 'company_knowledge_search';

export type BuildGlobalKnowledgeToolInput = {
  user: StoreUser;
  /** 本期固定 scope（会话级 scope 传递留 P36d），company 恒放行，不依赖 team resolver 也能跑。 */
  scope: GlobalChatScope;
  /**
   * P52 D-1/D-2：本轮用户原文（prepareAgentStream 已校验的 message），路由专用闭包参数——
   * 只用于 resolveGlobalRetrieveRouting，绝不进 LLM 工具 schema、也不从工具 query 回推。
   * 工具 schema 的 `query` 参数（可能是模型改写词）只用于检索，两者严格分离（AC-原文）。
   */
  routingQuery: string;
  /** T4：把本次工具调用产出的 citations 收集起来，供 stream.ts 注入 message_completed SSE。 */
  citationsSink?: GlobalKnowledgeCitationsSink;
  /** P52 3A：run 级路由决策聚合 sink，仅 global profile 传入；不传则不做剪枝（routingDecision 用占位常量全查）。 */
  retrievalSink?: GlobalKnowledgeRetrievalSink;
  /** 测试注入点：覆盖窄口检索函数，默认走真实 retrieveGlobalKnowledge。 */
  retrieve?: GlobalKnowledgeRetrieveFn;
};

export function buildGlobalKnowledgeTool(input: BuildGlobalKnowledgeToolInput) {
  const retrieve = input.retrieve ?? retrieveGlobalKnowledge;
  return tool(
    async ({ query }: { query: string }) => {
      let routingDecision: RoutingDecision | undefined;
      if (input.retrievalSink) {
        // 惰性单算：??= 保证同一 run 内多次工具调用只触发一次 resolveGlobalRetrieveRouting。
        input.retrievalSink.routingDecisionPromise ??= resolveGlobalRetrieveRouting(input.routingQuery);
        routingDecision = await input.retrievalSink.routingDecisionPromise;
      }
      const result = await retrieve(input.user, { query, scope: input.scope, routingDecision });
      const citations = result.citations;
      if (input.citationsSink) input.citationsSink.citations.push(...citations);
      if (input.retrievalSink) {
        input.retrievalSink.retrievalAttempts.push({
          routingDecision: routingDecision!,
          executionSpans: result.executionSpans,
          toolInvoked: true,
          zeroHit: result.zeroHit
        });
      }
      if (citations.length === 0) return '未检索到相关的公司知识。';
      // T5：回传给模型的内容是结构化限长摘录（GlobalChatCitation.excerpt 已在窄口内限长），
      // 不是模块 HTTP 的原始全文——审计隔离本期最小实现即已满足。
      return JSON.stringify(
        citations.map((c) => ({
          source: c.sourceOriginalName,
          scenario: c.scenarioName,
          type: c.knowledgeType,
          excerpt: c.excerpt,
        })),
      );
    },
    {
      name: GLOBAL_KNOWLEDGE_TOOL_NAME,
      description:
        '检索公司全域知识库（跨 Nano Brain / Traditional RAG / GraphRAG 三引擎，已按相关度精排），用于回答全域问答中的事实性问题。',
      schema: z.object({
        query: z.string().describe('检索查询语句，用用户问题原文或改写后的检索关键词'),
      }),
    },
  );
}
