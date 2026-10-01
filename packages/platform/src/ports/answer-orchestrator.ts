/**
 * AnswerOrchestrator Port 接口
 *
 * 平台"问答生成"领域抽象：场景问答 + 全域/场景对话的答案生成链路
 * （路由 → 跨引擎检索 → 精排 → LLM 合成）。这些操作在生成答案的同时会经
 * PlatformStore 持久化会话/消息，具体实现（含检索编排）在别处。
 * 边界：本接口不读 env、不拼 token、不 import apps 或外部框架。
 *
 * 说明：方法签名与 platform-store.ts（本包） 现有同名函数逐字一致
 * （P12 Phase 0，行为不变）。
 */
import type {
  GlobalChatScope,
  StoredGlobalChatSession,
  StoredScenarioAnswer,
  StoredScenarioChatSession,
  StoreUser,
  TraceSpan,
} from '../store-types';

export interface AnswerOrchestrator {
  askStoredScenarioKnowledge(user: StoreUser, input: { scenarioId: string; query: string }, spans?: TraceSpan[]): Promise<StoredScenarioAnswer | null>;
  createGlobalChatSession(user: StoreUser, input?: { query?: string; scope?: GlobalChatScope }): Promise<StoredGlobalChatSession>;
  appendGlobalChatMessage(user: StoreUser, input: { sessionId: string; query: string }): Promise<StoredGlobalChatSession | null>;
  createScenarioChatSession(user: StoreUser, input: { scenarioId: string; query?: string }): Promise<StoredScenarioChatSession | null>;
  appendScenarioChatMessage(user: StoreUser, input: { scenarioId: string; sessionId: string; query: string }): Promise<StoredScenarioChatSession | null>;
}
