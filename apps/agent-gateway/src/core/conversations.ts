import { randomUUID } from 'node:crypto';
import type { ModuleId, UserContext } from '@ff/contracts';
import type { GlobalChatCitation, GlobalChatContextTrace } from '@ff/platform/platform-store';
import { getAgentGatewayPool } from '../db';
import { getAgentPostgresSaver } from '../agent/checkpointer';

export const SUPPORTED_AGENT_MODULES: ModuleId[] = ['nano-brain', 'traditional-rag', 'graph-rag'];

// P36a: 全域会话 profile —— agent-gateway 内部概念，不污染 contracts 的 ModuleId（RAG 模块标识）。
export type AgentProfile = ModuleId | 'global';
export const SUPPORTED_AGENT_PROFILES: AgentProfile[] = ['nano-brain', 'traditional-rag', 'graph-rag', 'global'];

export type AgentConversationStatus = 'active' | 'archived';
export type AgentRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentToolCallStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export class AgentGatewayError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_input'
      | 'unsupported_module'
      | 'not_found'
      | 'forbidden'
      | 'internal_error',
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'AgentGatewayError';
  }
}

export type AgentConversation = {
  id: string;
  userId: string;
  username: string;
  activeModule: AgentProfile;
  title: string | null;
  status: AgentConversationStatus;
  threadId: string;
  latestCheckpointId: string | null;
  checkpointBootstrappedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type CheckpointMessage = Record<string, unknown>;

export type AgentRun = {
  id: string;
  conversationId: string;
  userId: string;
  threadId: string;
  status: AgentRunStatus;
  provider: string | null;
  model: string | null;
  activeModule: AgentProfile;
  inputMessageId: string | null;
  outputMessageId: string | null;
  langsmithRunId: string | null;
  langsmithTraceId: string | null;
  runName: string | null;
  tags: unknown[];
  streamProtocol: string | null;
  streamVersion: string | null;
  lastEventSeq: number;
  latestCheckpointId: string | null;
  tokenUsage: Record<string, unknown>;
  error: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  // P36d 阶段1a：断流补落依赖的持久列（D-P36d-1 ②）——global profile run 完成时落，其余 profile 恒 null。
  citations: GlobalChatCitation[] | null;
  contextTrace: GlobalChatContextTrace | null;
  traceId: string | null;
  // P36d 阶段1a：幂等去重键（阶段0.5 §2）。
  idempotencyKey: string | null;
};

export type AgentToolCall = {
  id: string;
  runId: string;
  conversationId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  resultSummary: string | null;
  result: unknown;
  status: AgentToolCallStatus;
  error: Record<string, unknown> | null;
  sequence: number;
  langchainToolCallId: string | null;
  nodeName: string | null;
  namespace: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

export type AgentConversationDetails = AgentConversation & {
  messages: CheckpointMessage[];
  messageSource: 'langgraph_checkpoint';
  runs: AgentRun[];
};

export type AgentRunDetails = AgentRun & {
  toolCalls: AgentToolCall[];
};

function normalizeLimit(value: unknown, fallback: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(Math.max(Math.trunc(numberValue), 1), max);
}

function isModuleId(value: string): value is ModuleId {
  return value === 'nano-brain' || value === 'traditional-rag' || value === 'graph-rag';
}

function isAgentProfile(value: string): value is AgentProfile {
  return isModuleId(value) || value === 'global';
}

function assertSupportedProfile(value: unknown): AgentProfile {
  if (typeof value !== 'string' || !isAgentProfile(value)) {
    throw new AgentGatewayError('active_module 不合法', 'invalid_input', 400);
  }
  if (!SUPPORTED_AGENT_PROFILES.includes(value)) {
    throw new AgentGatewayError(`Agent Gateway 暂不支持 active_module=${value}`, 'unsupported_module', 400);
  }
  return value;
}

function normalizeTitle(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AgentGatewayError('title 必须是字符串', 'invalid_input', 400);
  const title = value.trim();
  if (title.length > 200) throw new AgentGatewayError('title 长度不能超过 200 个字符', 'invalid_input', 400);
  return title.length > 0 ? title : null;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentGatewayError('metadata 必须是对象', 'invalid_input', 400);
  }
  return value as Record<string, unknown>;
}

function mapConversation(row: any): AgentConversation {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    activeModule: row.active_module,
    title: row.title,
    status: row.status,
    threadId: row.thread_id,
    latestCheckpointId: row.latest_checkpoint_id,
    checkpointBootstrappedAt: row.checkpoint_bootstrapped_at,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: any): AgentRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    threadId: row.thread_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    activeModule: row.active_module,
    inputMessageId: row.input_message_id,
    outputMessageId: row.output_message_id,
    langsmithRunId: row.langsmith_run_id,
    langsmithTraceId: row.langsmith_trace_id,
    runName: row.run_name,
    tags: row.tags ?? [],
    streamProtocol: row.stream_protocol,
    streamVersion: row.stream_version,
    lastEventSeq: row.last_event_seq,
    latestCheckpointId: row.latest_checkpoint_id,
    tokenUsage: row.token_usage ?? {},
    error: row.error,
    metadata: row.metadata ?? {},
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    citations: row.citations ?? null,
    contextTrace: row.context_trace ?? null,
    traceId: row.trace_id ?? null,
    idempotencyKey: row.idempotency_key ?? null,
  };
}

function mapToolCall(row: any): AgentToolCall {
  return {
    id: row.id,
    runId: row.run_id,
    conversationId: row.conversation_id,
    toolName: row.tool_name,
    arguments: row.arguments ?? {},
    resultSummary: row.result_summary,
    result: row.result,
    status: row.status,
    error: row.error,
    sequence: row.sequence,
    langchainToolCallId: row.langchain_tool_call_id,
    nodeName: row.node_name,
    namespace: row.namespace,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

function assertCanReadConversation(ctx: UserContext, conversation: AgentConversation): void {
  if (conversation.userId !== ctx.userId) {
    throw new AgentGatewayError('无权读取该 Agent 会话', 'forbidden', 403);
  }
}

export async function createAgentConversation(
  ctx: UserContext,
  input: { activeModule: unknown; title?: unknown; metadata?: unknown },
): Promise<AgentConversation> {
  const activeModule = assertSupportedProfile(input.activeModule);
  const title = normalizeTitle(input.title);
  const metadata = normalizeMetadata(input.metadata);
  const id = randomUUID();
  const threadId = id;
  const pool = getAgentGatewayPool();
  const result = await pool.query(
    `
      INSERT INTO agent_conversations (id, user_id, username, active_module, title, thread_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING *
    `,
    [id, ctx.userId, ctx.username, activeModule, title, threadId, JSON.stringify(metadata)],
  );
  return mapConversation(result.rows[0]);
}

export async function listAgentConversations(
  ctx: UserContext,
  input: { limit?: unknown } = {},
): Promise<AgentConversation[]> {
  const limit = normalizeLimit(input.limit, 20, 100);
  const pool = getAgentGatewayPool();
  const result = await pool.query(
    `
      SELECT *
      FROM agent_conversations
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [ctx.userId, limit],
  );
  return result.rows.map(mapConversation);
}

export async function getAgentConversation(
  ctx: UserContext,
  conversationId: string,
  input: { messageLimit?: unknown; runLimit?: unknown } = {},
): Promise<AgentConversationDetails> {
  // M25 不再维护自有 agent_messages 表；消息历史将由后续 LangGraph checkpointer 读取。
  // 这里保留 messageLimit 入参以稳定 HTTP API，但当前不用于 SQL 查询。
  normalizeLimit(input.messageLimit, 100, 500);
  const runLimit = normalizeLimit(input.runLimit, 20, 100);
  const pool = getAgentGatewayPool();
  const result = await pool.query(`SELECT * FROM agent_conversations WHERE id = $1`, [conversationId]);
  const row = result.rows[0];
  if (!row) throw new AgentGatewayError('Agent 会话不存在', 'not_found', 404);
  const conversation = mapConversation(row);
  assertCanReadConversation(ctx, conversation);

  const runs = await pool.query(
    `
      SELECT *
      FROM agent_runs
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [conversationId, runLimit],
  );

  return {
    ...conversation,
    messages: [],
    messageSource: 'langgraph_checkpoint',
    runs: runs.rows.map(mapRun),
  };
}

// P36a: 删除 Agent 会话（含全域 profile）——先清 LangGraph checkpoint（按 thread_id），
// 再删会话行（外键 CASCADE 连带 agent_runs / agent_tool_calls）。跨 PLATFORM/AGENT 两库无 FK，
// 平台侧 global_chat_sessions 的双端清理由 web 接线层（P36d）编排，本函数只负责 AGENT 侧。
export async function deleteAgentConversation(
  ctx: UserContext,
  conversationId: string,
): Promise<{ ok: boolean }> {
  // 复用 getAgentConversation：存在性校验 + 权限校验（assertCanReadConversation），并拿到 threadId。
  // 幂等语义：会话不存在（含已删除）返回 { ok: false }，与 platform deleteGlobalChatSession 一致；
  // 权限不足（forbidden）仍抛出，不吞安全错误。
  let conversation: AgentConversationDetails;
  try {
    conversation = await getAgentConversation(ctx, conversationId);
  } catch (error) {
    if (error instanceof AgentGatewayError && error.code === 'not_found') return { ok: false };
    throw error;
  }
  const saver = await getAgentPostgresSaver();
  // deleteThread 对不存在的 thread 幂等；先清 checkpoint，避免删行后 checkpoint 无主泄漏。
  await saver.deleteThread(conversation.threadId);
  const pool = getAgentGatewayPool();
  await pool.query(`DELETE FROM agent_conversations WHERE id = $1`, [conversationId]);
  return { ok: true };
}

// P36d 阶段1a（阶段0.5 §2.5 边界校验冻结5）：idempotency_key 受限为标准 UUID 格式，防超长/异常
// 字符串进这个专用 TEXT 列。导出供 http 层复用同一规则（宽松预筛 x-request-id，避免非 UUID 的
// 历史 requestId 值被硬拒 400）。
export const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeIdempotencyKey(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AgentGatewayError('idempotency_key 必须是字符串', 'invalid_input', 400);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!IDEMPOTENCY_KEY_PATTERN.test(trimmed)) {
    throw new AgentGatewayError('idempotency_key 必须是合法 UUID', 'invalid_input', 400);
  }
  return trimmed;
}

export type CreateAgentRunInput = {
  conversationId: string;
  userId: string;
  threadId: string;
  activeModule: AgentProfile;
  status?: AgentRunStatus;
  provider?: string | null;
  model?: string | null;
  runName?: string | null;
  streamProtocol?: string | null;
  streamVersion?: string | null;
  startedAt?: Date | null;
  metadata?: Record<string, unknown>;
  /** P36d 阶段1a：幂等去重键（阶段0.5 §2.3-2.4）。同 {conversationId, idempotencyKey}（排除 failed 行）
   * 已存在时不新建 run，直接返回既有 run（`INSERT ... ON CONFLICT ... DO NOTHING` + 回查，阶段0.5 §2.5
   * 推荐做法，避免"先查后插"竞态窗口）。 */
  idempotencyKey?: string | null;
};

/**
 * P36d 阶段1a（codex 审 E BLOCK 修复）：区分「新建 run」与「幂等命中复用已有 run」。
 * 唯一索引 + `ON CONFLICT DO NOTHING` 只能防「重复建行」；调用方（prepareAgentStream）还必须据
 * `reused` 信号防「重复执行 agent」——reused 时插入影响 0 行（RETURNING 无行），回查既有非 failed
 * run，`reused: true`。这样 stream 层能在 reused 时**完全不生成/不消费 events()**，绝不第二次调
 * 模型、写 checkpoint、覆盖已 completed 的 run。
 */
export async function createOrReuseAgentRun(input: CreateAgentRunInput): Promise<{ run: AgentRun; reused: boolean }> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const pool = getAgentGatewayPool();
  const result = await pool.query(
    `
      INSERT INTO agent_runs (
        id, conversation_id, user_id, thread_id, status, provider, model, active_module,
        run_name, stream_protocol, stream_version, started_at, metadata, idempotency_key
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
      ${idempotencyKey ? `ON CONFLICT (conversation_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND status <> 'failed' DO NOTHING` : ''}
      RETURNING *
    `,
    [
      randomUUID(),
      input.conversationId,
      input.userId,
      input.threadId,
      input.status ?? 'pending',
      input.provider ?? null,
      input.model ?? null,
      input.activeModule,
      input.runName ?? null,
      input.streamProtocol ?? null,
      input.streamVersion ?? null,
      input.startedAt ?? null,
      JSON.stringify(input.metadata ?? {}),
      idempotencyKey,
    ],
  );
  // RETURNING 有行 = 真新建（未冲突）。
  if (result.rows[0]) return { run: mapRun(result.rows[0]), reused: false };
  // 零行只可能发生在 idempotencyKey 分支的 ON CONFLICT DO NOTHING——回查既有（非 failed）run，标记复用。
  const existing = idempotencyKey ? await getAgentRunByIdempotencyKey(input.conversationId, idempotencyKey) : null;
  if (existing) return { run: existing, reused: true };
  throw new AgentGatewayError('创建 Agent run 失败', 'internal_error', 500);
}

/** 向后兼容薄封装：不关心 reused 信号的调用方（非幂等路径 / 测试）继续拿 AgentRun。 */
export async function createAgentRun(input: CreateAgentRunInput): Promise<AgentRun> {
  return (await createOrReuseAgentRun(input)).run;
}

export const createAgentRunForTest = createAgentRun;

/** P36d 阶段1a（阶段0.5 §2.5）：按幂等键查 run，只返回 active/completed（排除 failed，取最新一条）——
 * 冻结4：允许 failed 状态复用同一 idempotency_key 重试，故 failed 行不算"已存在"。 */
export async function getAgentRunByIdempotencyKey(
  conversationId: string,
  idempotencyKey: string,
): Promise<AgentRun | null> {
  const pool = getAgentGatewayPool();
  const result = await pool.query(
    `
      SELECT * FROM agent_runs
      WHERE conversation_id = $1 AND idempotency_key = $2 AND status <> 'failed'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [conversationId, idempotencyKey],
  );
  return result.rows[0] ? mapRun(result.rows[0]) : null;
}

export async function updateAgentRun(input: {
  runId: string;
  status?: AgentRunStatus;
  lastEventSeq?: number;
  latestCheckpointId?: string | null;
  tokenUsage?: Record<string, unknown>;
  error?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  outputMessageId?: string | null;
  finishedAt?: Date | null;
  /** P36d 阶段1a：断流补落依赖，run 完成时（finally 前）随 status='completed' 一起落（D-P36d-1 ②）。 */
  citations?: GlobalChatCitation[] | null;
  contextTrace?: GlobalChatContextTrace | null;
  traceId?: string | null;
}): Promise<AgentRun> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  function add(sql: string, value: unknown) {
    values.push(value);
    assignments.push(`${sql} = $${values.length}`);
  }
  if (input.status !== undefined) add('status', input.status);
  if (input.lastEventSeq !== undefined) add('last_event_seq', input.lastEventSeq);
  if (input.latestCheckpointId !== undefined) add('latest_checkpoint_id', input.latestCheckpointId);
  if (input.tokenUsage !== undefined) add('token_usage', JSON.stringify(input.tokenUsage));
  if (input.error !== undefined) add('error', input.error === null ? null : JSON.stringify(input.error));
  if (input.metadata !== undefined) add('metadata', JSON.stringify(input.metadata));
  if (input.outputMessageId !== undefined) add('output_message_id', input.outputMessageId);
  if (input.finishedAt !== undefined) add('finished_at', input.finishedAt);
  if (input.citations !== undefined) add('citations', input.citations === null ? null : JSON.stringify(input.citations));
  if (input.contextTrace !== undefined) add('context_trace', input.contextTrace === null ? null : JSON.stringify(input.contextTrace));
  if (input.traceId !== undefined) add('trace_id', input.traceId);
  if (assignments.length === 0) {
    const pool = getAgentGatewayPool();
    const result = await pool.query(`SELECT * FROM agent_runs WHERE id = $1`, [input.runId]);
    if (!result.rows[0]) throw new AgentGatewayError('Agent run 不存在', 'not_found', 404);
    return mapRun(result.rows[0]);
  }
  values.push(input.runId);
  const pool = getAgentGatewayPool();
  const result = await pool.query(
    `UPDATE agent_runs SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  if (!result.rows[0]) throw new AgentGatewayError('Agent run 不存在', 'not_found', 404);
  return mapRun(result.rows[0]);
}

export async function createAgentToolCall(input: {
  runId: string;
  conversationId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  status?: AgentToolCallStatus;
  sequence: number;
  langchainToolCallId?: string | null;
  nodeName?: string | null;
  namespace?: string | null;
  startedAt?: Date | null;
}): Promise<AgentToolCall> {
  const pool = getAgentGatewayPool();
  const result = await pool.query(
    `
      INSERT INTO agent_tool_calls (
        id, run_id, conversation_id, tool_name, arguments, status, sequence,
        langchain_tool_call_id, node_name, namespace, started_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (run_id, sequence) DO UPDATE SET
        tool_name = EXCLUDED.tool_name,
        arguments = EXCLUDED.arguments,
        status = EXCLUDED.status,
        langchain_tool_call_id = EXCLUDED.langchain_tool_call_id,
        node_name = EXCLUDED.node_name,
        namespace = EXCLUDED.namespace,
        started_at = EXCLUDED.started_at
      RETURNING *
    `,
    [
      randomUUID(),
      input.runId,
      input.conversationId,
      input.toolName,
      JSON.stringify(input.arguments ?? {}),
      input.status ?? 'running',
      input.sequence,
      input.langchainToolCallId ?? null,
      input.nodeName ?? null,
      input.namespace ?? null,
      input.startedAt ?? null,
    ],
  );
  return mapToolCall(result.rows[0]);
}

export async function updateAgentToolCall(input: {
  runId: string;
  langchainToolCallId?: string | null;
  sequence?: number;
  status: AgentToolCallStatus;
  resultSummary?: string | null;
  result?: unknown;
  error?: Record<string, unknown> | null;
  finishedAt?: Date | null;
}): Promise<AgentToolCall | null> {
  const where: string[] = ['run_id = $1'];
  const values: unknown[] = [input.runId];
  if (input.langchainToolCallId) {
    values.push(input.langchainToolCallId);
    where.push(`langchain_tool_call_id = $${values.length}`);
  } else if (input.sequence !== undefined) {
    values.push(input.sequence);
    where.push(`sequence = $${values.length}`);
  } else {
    throw new AgentGatewayError('更新 tool call 需要 langchainToolCallId 或 sequence', 'invalid_input', 400);
  }

  const assignments: string[] = [];
  function add(sql: string, value: unknown) {
    values.push(value);
    assignments.push(`${sql} = $${values.length}`);
  }
  add('status', input.status);
  if (input.resultSummary !== undefined) add('result_summary', input.resultSummary);
  if (input.result !== undefined) {
    const resultValue = typeof input.result === 'object' && input.result !== null ? input.result : { value: input.result };
    add('result', JSON.stringify(resultValue));
  }
  if (input.error !== undefined) add('error', input.error === null ? null : JSON.stringify(input.error));
  if (input.finishedAt !== undefined) add('finished_at', input.finishedAt);

  const pool = getAgentGatewayPool();
  const result = await pool.query(
    `UPDATE agent_tool_calls SET ${assignments.join(', ')} WHERE ${where.join(' AND ')} RETURNING *`,
    values,
  );
  return result.rows[0] ? mapToolCall(result.rows[0]) : null;
}

export async function getAgentRun(
  ctx: UserContext,
  conversationId: string,
  runId: string,
): Promise<AgentRunDetails> {
  const conversation = await getAgentConversation(ctx, conversationId, { messageLimit: 1, runLimit: 1 });
  const pool = getAgentGatewayPool();
  const result = await pool.query(
    `SELECT * FROM agent_runs WHERE id = $1 AND conversation_id = $2`,
    [runId, conversationId],
  );
  const row = result.rows[0];
  if (!row) throw new AgentGatewayError('Agent run 不存在', 'not_found', 404);
  const run = mapRun(row);
  if (run.conversationId !== conversation.id) {
    throw new AgentGatewayError('Agent run 不属于该会话', 'not_found', 404);
  }
  const toolCalls = await pool.query(
    `
      SELECT *
      FROM agent_tool_calls
      WHERE run_id = $1
      ORDER BY sequence ASC
    `,
    [runId],
  );
  return { ...run, toolCalls: toolCalls.rows.map(mapToolCall) };
}

/**
 * P36d 阶段1b-2b-α：内部无 user 门控取 run（按 (conversationId, runId) 配对，取不到返回 null 而非
 * 抛错——供 server.ts 内部 projection 端点使用）。区别于 getAgentRun：不做 assertCanReadConversation
 * 权限校验（DB 设计决策：内部 token 已表示可信调用方，relay 在调用前已校验用户拥有对应 platform
 * session）。
 */
export async function getAgentRunInternal(conversationId: string, runId: string): Promise<AgentRun | null> {
  const pool = getAgentGatewayPool();
  const result = await pool.query(
    `SELECT * FROM agent_runs WHERE id = $1 AND conversation_id = $2`,
    [runId, conversationId],
  );
  return result.rows[0] ? mapRun(result.rows[0]) : null;
}

/**
 * P36d 阶段1b-2b-α：内部无 user 门控取 conversation（按 id，取不到返回 null 而非抛错）。同上，
 * 供内部 projection 端点取 conversation 以调用 readConversationCheckpointMessages。
 */
export async function getAgentConversationInternal(conversationId: string): Promise<AgentConversation | null> {
  const pool = getAgentGatewayPool();
  const result = await pool.query(`SELECT * FROM agent_conversations WHERE id = $1`, [conversationId]);
  return result.rows[0] ? mapConversation(result.rows[0]) : null;
}

export function toPublicConversation(conversation: AgentConversation) {
  return {
    id: conversation.id,
    user_id: conversation.userId,
    username: conversation.username,
    active_module: conversation.activeModule,
    title: conversation.title,
    status: conversation.status,
    thread_id: conversation.threadId,
    latest_checkpoint_id: conversation.latestCheckpointId,
    checkpoint_bootstrapped_at: conversation.checkpointBootstrappedAt?.toISOString() ?? null,
    metadata: conversation.metadata,
    created_at: conversation.createdAt.toISOString(),
    updated_at: conversation.updatedAt.toISOString(),
  };
}

export function toPublicRun(run: AgentRun, options?: { redactRawOutput?: boolean }) {
  const redactRawOutput = options?.redactRawOutput === true;
  return {
    id: run.id,
    conversation_id: run.conversationId,
    user_id: run.userId,
    thread_id: run.threadId,
    status: run.status,
    provider: run.provider,
    model: run.model,
    active_module: run.activeModule,
    input_message_id: run.inputMessageId,
    output_message_id: run.outputMessageId,
    langsmith_run_id: run.langsmithRunId,
    langsmith_trace_id: run.langsmithTraceId,
    run_name: run.runName,
    tags: run.tags,
    stream_protocol: run.streamProtocol,
    stream_version: run.streamVersion,
    last_event_seq: run.lastEventSeq,
    latest_checkpoint_id: run.latestCheckpointId,
    token_usage: run.tokenUsage,
    // P36c 阶段3（codex 四轮审 MEDIUM）：失败冒泡后 error.message 可能含平台响应摘录，global 隔离。
    error: redactRawOutput && run.error ? { isolated: true } : run.error,
    metadata: run.metadata,
    started_at: run.startedAt?.toISOString() ?? null,
    finished_at: run.finishedAt?.toISOString() ?? null,
    created_at: run.createdAt.toISOString(),
    // P36d 阶段1a：citations/contextTrace 同样含 excerpt（GlobalChatCitation.excerpt），是与
    // agent_tool_calls.result 同一泄露类别的数据——延续下方 P36c 隔离原则，global run 详情/列表
    // 出口同样不经普通 API 暴露（isolated 占位），只落库供 D-P36d-1 ②断流补落的内部读路径使用
    // （该内部读路径的实现留 1b：web relay 需要免隔离的读取通道，非本 1a 范围）。trace_id 是不含
    // excerpt 的不透明关联 id，不隔离。
    citations: redactRawOutput ? (run.citations ? { isolated: true } : null) : run.citations,
    context_trace: redactRawOutput ? (run.contextTrace ? { isolated: true } : null) : run.contextTrace,
    trace_id: run.traceId,
    idempotency_key: run.idempotencyKey,
  };
}

/**
 * P36c 阶段3（codex 二轮审 HIGH，最后一个持久化证据出口）：agent_tool_calls.result 存的是复合
 * 检索工具 company_knowledge_search 的**原始输出全文**，内含带 excerpt 的结构化检索结果；
 * result_summary 又是该全文的前 1000 字截断——两者都会泄露 excerpt。撤权后所有者经 run 详情
 * API 仍能读到。
 *
 * 处置（root-cause，贯彻 P36b "原始全文隔离在审计表、不经普通 API 暴露" 隔离原则）：**global 会话
 * 的 run 详情不经普通 API 暴露原始工具输出全文**——result 置空、result_summary 换成隔离说明。
 * 采用**无条件**隔离而非撤权条件过滤，因为工具输出 JSON 只保留 {source,scenario,type,excerpt}、
 * 已剥掉 engine/objectId（见 global-knowledge-tool.ts），无法把某条 result 反查回 canonical ref
 * 做逐条撤权判定；且 result_summary 同样含 excerpt，"只返 summary" 不足以堵。原始全文仍完整留在
 * agent_tool_calls 审计表（DB），供内部审计，只是不经会话 run 详情 API 输出。当轮实时引用（已授权）
 * 走 SSE message_completed.citations，功能不受损。global 铁律下唯一工具就是 company_knowledge_search，
 * 无差别隔离不误伤其它工具。
 */
export const GLOBAL_TOOL_OUTPUT_ISOLATED_SUMMARY =
  '[全域检索工具原始输出已隔离，仅留存于审计表，不经会话 API 暴露；本轮引用见 message_completed.citations]';

/**
 * P36c 阶段3（codex 五轮审 HIGH-2，SSE 实时流维度）：模块失败会把响应 JSON 前若干字拼进错误消息
 * （含 excerpt），若原样经 SSE `error` 事件（工具错误 / run 级错误）发前端就绕过了隔离。global 会话
 * 的实时错误事件用本常量替换错误原文，保留"发生错误"信号（+ tool_name/code 等结构字段照旧），
 * 原始错误详情仍完整落 agent_tool_calls/agent_runs 审计表（DB）。
 */
export const GLOBAL_ERROR_ISOLATED_MESSAGE =
  '[全域会话执行出错，错误详情已隔离至审计表，不经实时流暴露]';

export function toPublicToolCall(toolCall: AgentToolCall, options?: { redactRawOutput?: boolean }) {
  const redactRawOutput = options?.redactRawOutput === true;
  return {
    id: toolCall.id,
    run_id: toolCall.runId,
    conversation_id: toolCall.conversationId,
    tool_name: toolCall.toolName,
    arguments: toolCall.arguments,
    result_summary: redactRawOutput ? GLOBAL_TOOL_OUTPUT_ISOLATED_SUMMARY : toolCall.resultSummary,
    result: redactRawOutput ? null : toolCall.result,
    status: toolCall.status,
    // P36c 阶段3（codex 四轮审 MEDIUM，第四个出口）：工具失败时 error 里可能拼进平台响应 JSON
    // 前 500 字（含 excerpt，见 platform-store 模块调用失败拼装），global run 详情同样隔离——
    // 保留"有错误发生"信号但不暴露原文（原始 error 仍留审计表 DB）。
    error: redactRawOutput && toolCall.error ? { isolated: true } : toolCall.error,
    sequence: toolCall.sequence,
    langchain_tool_call_id: toolCall.langchainToolCallId,
    node_name: toolCall.nodeName,
    namespace: toolCall.namespace,
    started_at: toolCall.startedAt?.toISOString() ?? null,
    finished_at: toolCall.finishedAt?.toISOString() ?? null,
    created_at: toolCall.createdAt.toISOString(),
  };
}
