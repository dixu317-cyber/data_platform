import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { filterReadableCitationRefs, type GlobalChatScope, type StoreUser } from '@ff/platform/platform-store';
import { getAgentModelConfig } from './config';
import { createCompanyBrainAgent } from './factory';
import { joinTextBlocks } from './message-content';
import {
  applyProvenanceFilterToTranscript,
  shortTermMemoryMiddleware,
  type CitationRefEntry,
  type ProvenanceFilterFn,
  type TranscriptEntry,
} from './short-term-memory';
import { createSummarizerMiddleware } from './summarizer';
import type { AgentConversation } from '../core/conversations';

let checkpointer: PostgresSaver | null = null;

function getCheckpointSchema(): string {
  return process.env.AGENT_CHECKPOINT_SCHEMA?.trim() || 'langgraph';
}

function getAgentDatabaseUrl(): string {
  const url = process.env.AGENT_DATABASE_URL?.trim();
  if (!url) throw new Error('未配置 AGENT_DATABASE_URL，无法初始化 LangGraph PostgresSaver');
  return url;
}

export async function getAgentPostgresSaver(): Promise<PostgresSaver> {
  if (!checkpointer) {
    checkpointer = PostgresSaver.fromConnString(getAgentDatabaseUrl(), { schema: getCheckpointSchema() });
  }
  return checkpointer;
}

/** Run LangGraph's DDL exactly from the one-shot migrate process. */
export async function setupAgentCheckpointSchema(connectionString?: string): Promise<void> {
  const migrationUrl = connectionString ?? process.env.AGENT_MIGRATION_DATABASE_URL?.trim();
  if (!migrationUrl) {
    throw new Error('AGENT_MIGRATION_DATABASE_URL is required for LangGraph schema setup');
  }
  const saver = PostgresSaver.fromConnString(migrationUrl, { schema: getCheckpointSchema() });
  try {
    await saver.setup();
  } finally {
    await saver.end();
  }
}

export async function closeAgentPostgresSaver(): Promise<void> {
  if (checkpointer) {
    await checkpointer.end();
    checkpointer = null;
  }
}

export type CheckpointMessageDto = {
  id: string | null;
  type: string;
  role: string;
  content: unknown;
  text: string | null;
  name: string | null;
  tool_call_id: string | null;
  tool_calls: unknown[];
  invalid_tool_calls: unknown[];
  usage_metadata: unknown;
  response_metadata: unknown;
  status: string | null;
  raw: unknown;
};

function getMessageType(message: any): string {
  if (typeof message?.getType === 'function') return message.getType();
  return message?.type ?? message?.kwargs?.type ?? message?.constructor?.name ?? 'unknown';
}

function roleFromType(type: string): string {
  if (type === 'human' || type === 'HumanMessage') return 'user';
  if (type === 'ai' || type === 'AIMessage') return 'assistant';
  if (type === 'system' || type === 'SystemMessage') return 'system';
  if (type === 'tool' || type === 'ToolMessage') return 'tool';
  return type;
}

function serializeRawMessage(message: any): unknown {
  if (typeof message?.toDict === 'function') return message.toDict();
  if (typeof message?.toJSON === 'function') return message.toJSON();
  return message;
}

export function serializeCheckpointMessage(message: any): CheckpointMessageDto {
  const type = getMessageType(message);
  const content = message?.content ?? message?.kwargs?.content ?? '';
  return {
    id: message?.id ?? message?.kwargs?.id ?? null,
    type,
    role: roleFromType(type),
    content,
    text: typeof message?.text === 'string' ? message.text : joinTextBlocks(content),
    name: message?.name ?? message?.kwargs?.name ?? null,
    tool_call_id: message?.tool_call_id ?? message?.kwargs?.tool_call_id ?? null,
    tool_calls: message?.tool_calls ?? message?.toolCalls ?? [],
    invalid_tool_calls: message?.invalid_tool_calls ?? [],
    usage_metadata: message?.usage_metadata ?? null,
    response_metadata: message?.response_metadata ?? {},
    status: message?.status ?? null,
    raw: serializeRawMessage(message),
  };
}

export type ReadCheckpointMessagesInput = {
  conversation: AgentConversation;
  checkpointer?: unknown;
  model?: unknown;
  tools?: unknown[];
  /** P36c 阶段3：当前读取用户（StoreUser），global 会话读 transcript 前用它做 provenance 撤权过滤。
   * 未传时不过滤（向后兼容旧调用）——但生产读取出口（server.ts GET conversation）必须传，否则撤权
   * 后的 ToolMessage excerpt 会从历史 API 泄露（codex 阶段3 二轮审 HIGH）。 */
  user?: StoreUser;
  /** provenance 重校验的 chat scope，默认 'company'（与 stream.ts 全域 profile 一致）。 */
  scope?: GlobalChatScope;
  /** 测试注入点：覆盖真实撤权重校验窄口，默认走 platform filterReadableCitationRefs。 */
  provenanceFilter?: ProvenanceFilterFn;
};

// getState() 只读取 checkpoint thread state，不会触发任何 model 调用（beforeModel/afterModel/
// wrapModelCall 钩子都不会跑）——summarizerMiddleware 只是为了 schema 一致性而装配进这里的
// 读路径 agent，这个占位模型永远不会被真正 invoke。若真的被调用说明用错了路径，主动报错而非
// 静默返回空摘要，避免掩盖 bug。
const NEVER_INVOKED_SUMMARY_MODEL = {
  invoke: async (): Promise<{ content: unknown }> => {
    throw new Error('NEVER_INVOKED_SUMMARY_MODEL 被调用：readConversationCheckpointMessages 只应做 getState 只读，不应触发摘要模型');
  },
};

function transcriptEntryToCheckpointMessage(entry: TranscriptEntry): CheckpointMessageDto {
  return {
    id: entry.messageId,
    type: entry.type,
    role: roleFromType(entry.type),
    content: entry.content,
    text: joinTextBlocks(entry.content),
    name: entry.name,
    tool_call_id: entry.toolCallId,
    tool_calls: entry.toolCalls,
    // codex 第5：invalid_tool_calls / status 从 transcript 序列化字段原样映射，不再硬编码 []/null。
    invalid_tool_calls: Array.isArray(entry.invalidToolCalls) ? entry.invalidToolCalls : [],
    usage_metadata: entry.usageMetadata,
    response_metadata: entry.responseMetadata,
    status: entry.status,
    raw: entry,
  };
}

export async function readConversationCheckpointMessages(
  input: ReadCheckpointMessagesInput,
): Promise<{ messages: CheckpointMessageDto[]; checkpointId: string | null }> {
  const checkpointer = input.checkpointer ?? (await getAgentPostgresSaver());
  const isGlobal = input.conversation.activeModule === 'global';
  // P36c 阶段1+2：global profile 挂了私有 transcript/summary state channel，读 checkpoint 时须
  // 用同一套 middleware 构图（装配顺序同 stream.ts），否则 getState 解析到私有 channel 会因
  // schema 不一致而读取失败/丢字段。
  const agent = createCompanyBrainAgent({
    model: input.model,
    tools: input.tools ?? [],
    checkpointer,
    middleware: isGlobal
      ? [
          createSummarizerMiddleware({
            model: (input.model as { invoke: (input: string) => Promise<{ content: unknown }> } | undefined) ?? NEVER_INVOKED_SUMMARY_MODEL,
          }),
          shortTermMemoryMiddleware,
        ]
      : undefined,
  });

  const state = await (agent as any).getState({ configurable: { thread_id: input.conversation.threadId } });
  const checkpointId = state?.config?.configurable?.checkpoint_id ?? null;
  // P36c 阶段2 红线：摘要绝不覆盖默认 messages channel 的真相，但**会**把已折叠进摘要的旧消息
  // 从 messages channel 物理裁剪掉（RemoveMessage，见 summarizer.ts），换取运行时/token 效率。
  // 因此"完整历史"的真相源变成 ①transcript 私有 channel（只追加、永不裁剪）——global profile
  // 优先读 transcript；非 global profile（未挂 summarizer，没有 transcript channel）继续读
  // messages，行为不变。
  if (isGlobal && Array.isArray(state?.values?.transcript)) {
    const transcript = state.values.transcript as TranscriptEntry[];
    // P36c 阶段3（codex 二轮审 HIGH）：读取出口也必须做 provenance 撤权过滤——否则撤权后的历史
    // assistant 答案 + 其同轮 ToolMessage 的原始 excerpt 仍会经本 API 泄露给读取方。用**当前读取
    // 用户**的权限重校验（与注入模型出口 wrapModelCall 同一 applyProvenanceFilter* 逻辑、同一窄口）。
    // transcript 真相源不变（只追加不裁剪），这里只过滤返回视图。
    const citationRefs = Array.isArray(state?.values?.citationRefs)
      ? (state.values.citationRefs as CitationRefEntry[])
      : [];
    const filterFn = input.provenanceFilter ?? filterReadableCitationRefs;
    const scope: GlobalChatScope = input.scope ?? 'company';
    const visible = await applyProvenanceFilterToTranscript(transcript, citationRefs, input.user, scope, filterFn);
    return { messages: visible.map(transcriptEntryToCheckpointMessage), checkpointId };
  }
  const messages = Array.isArray(state?.values?.messages) ? state.values.messages : [];
  return { messages: messages.map(serializeCheckpointMessage), checkpointId };
}

export function hasAgentModelEnv(): boolean {
  try {
    getAgentModelConfig();
    return true;
  } catch {
    return false;
  }
}
