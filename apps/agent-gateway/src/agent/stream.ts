import { randomUUID } from 'node:crypto';
import type { UserContext } from '@ff/contracts';
import {
  AgentGatewayError,
  GLOBAL_ERROR_ISOLATED_MESSAGE,
  GLOBAL_TOOL_OUTPUT_ISOLATED_SUMMARY,
  createAgentToolCall,
  createOrReuseAgentRun,
  getAgentConversation,
  updateAgentRun,
  updateAgentToolCall,
  type AgentConversationDetails,
  type AgentRun,
} from '../core/conversations';
import {
  buildAdminReviewToolPolicy,
  createAdminReviewAgent,
} from './admin-review';
import { getAgentPostgresSaver } from './checkpointer';
import { buildAgentRuntimeContext } from './context';
import { buildGlobalContextTrace } from './context-trace';
import { createAgentChatModel, createCompanyBrainAgent } from './factory';
import { ReasoningContentChatOpenAICompletions } from './reasoning-content';
import {
  buildGlobalKnowledgeTool,
  type GlobalKnowledgeCitationsSink,
  type GlobalKnowledgeRetrievalSink,
  type GlobalKnowledgeRetrieveFn,
} from './global-knowledge-tool';
import { resolveGlobalChatScope } from './global-metadata';
import {
  createAdminReviewModuleHttpTools,
  createModuleHttpTools,
  type ModuleHttpToolsSession,
} from './module-http-tools';
import { extractTextContent, summarizeUnknown } from './message-content';
import { buildAgentSystemPrompt } from './prompt';
import { createShortTermMemoryMiddleware, type ProvenanceFilterFn } from './short-term-memory';
import { createSummarizerMiddleware } from './summarizer';
import { acquireThreadLock } from './thread-lock';
import { resolveStoreUser } from './user-context';

export type AgentStreamEventName =
  | 'run_started'
  | 'message_delta'
  | 'tool_call_started'
  | 'tool_call_finished'
  | 'message_completed'
  | 'run_completed'
  | 'error';

export type AgentStreamEvent = {
  event: AgentStreamEventName;
  data: Record<string, unknown>;
  id?: string;
};

export type AgentStreamDependencies = {
  /**
   * Per-run model seam. Use this for stateful provider transports; the factory
   * is invoked inside events() so concurrent runs cannot share completions
   * protocol state. `model` remains supported for existing stateless fakes.
   */
  modelFactory?: () => unknown;
  model?: unknown;
  tools?: unknown[];
  checkpointer?: unknown;
  /** Test-only lifecycle seam. Production defaults to native protected HTTP Tools. */
  loadTools?: (input: { user: UserContext; bearerToken: string }) => Promise<ModuleHttpToolsSession>;
  /** P36b T3/T4 测试注入点：覆盖 global profile 复合检索工具内部调用的窄口函数，默认走真实 retrieveGlobalKnowledge。 */
  globalKnowledgeRetrieve?: GlobalKnowledgeRetrieveFn;
  /** P36c 阶段2 测试注入点：覆盖 summarizerMiddleware 的摘要 LLM，默认复用 dependencies.model（同一主模型）。 */
  summaryModel?: unknown;
  /** P36c 阶段3 测试注入点：覆盖 provenance 撤权重校验窄口，默认走 platform 真实 filterReadableCitationRefs。 */
  provenanceFilter?: ProvenanceFilterFn;
};

const leasedReasoningAwareModels = new WeakSet<object>();

/** Resolve the model inside a run, rejecting a stateful singleton injection. */
export function resolveRunScopedAgentModel(dependencies?: AgentStreamDependencies): unknown {
  if (
    dependencies?.model
    && (dependencies.model as { completions?: unknown }).completions instanceof ReasoningContentChatOpenAICompletions
  ) {
    throw new AgentGatewayError(
      'reasoning-aware model 注入必须使用 modelFactory 以按 run 隔离协议状态',
      'invalid_input',
      500,
    );
  }
  const model = dependencies?.modelFactory?.() ?? dependencies?.model ?? createAgentChatModel();
  if ((model as { completions?: unknown }).completions instanceof ReasoningContentChatOpenAICompletions) {
    if (leasedReasoningAwareModels.has(model as object)) {
      throw new AgentGatewayError(
        'modelFactory 返回了已被其他 run 使用的 reasoning-aware model，必须返回新实例',
        'invalid_input',
        500,
      );
    }
    leasedReasoningAwareModels.add(model as object);
  }
  return model;
}

export type AgentStreamMode = 'default' | 'admin_review';

export type PrepareAgentStreamInput = {
  user: UserContext;
  bearerToken: string;
  conversationId: string;
  message: string;
  mode?: AgentStreamMode;
  requestId?: string;
  /** P36d 阶段1a：幂等去重键（阶段0.5 §2）。同 {conversationId, idempotencyKey}（非 failed）已存在
   * 一条 run 时，createAgentRun 直接返回既有 run，不新建。 */
  idempotencyKey?: string;
  dependencies?: AgentStreamDependencies;
};

export type PreparedAgentStream = {
  conversation: AgentConversationDetails;
  run: AgentRun;
  /** P36d 阶段1a（codex 审 E BLOCK 修复）：true = 同 idempotencyKey 命中已有 run。此时 events()
   * 是空生成器，绝不重复执行 agent（不调模型/不写 checkpoint/不覆盖已有 run）；调用方（server.ts /
   * 1b relay）据此分诊——返回已有 run 终态（status/id/outputMessageId），不重跑。 */
  reused: boolean;
  events: (signal?: AbortSignal) => AsyncGenerator<AgentStreamEvent>;
};

/**
 * Admin-review is a Nano Brain-only workflow. Call this only after the
 * authenticated conversation has been loaded, and before creating a run,
 * constructing an Agent, or selecting any Tool surface.
 */
export function assertAdminReviewConversationModule(
  mode: AgentStreamMode,
  activeModule: AgentConversationDetails['activeModule'],
): void {
  if (mode === 'admin_review' && activeModule !== 'nano-brain') {
    throw new AgentGatewayError(
      '管理员审核辅助 Agent 仅支持 Nano Brain 会话',
      'unsupported_module',
      400,
    );
  }
}

function assertValidMessage(value: string): string {
  const message = value.trim();
  if (!message) throw new Error('message 不能为空');
  if (message.length > 20_000) throw new Error('message 长度不能超过 20000 字符');
  return message;
}

function getLastAssistantMessage(output: any): { id: string | null; content: string } {
  const messages = Array.isArray(output?.messages) ? output.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const typeName = message?.constructor?.name ?? '';
    const hasToolCalls = Array.isArray(message?.tool_calls) || Array.isArray(message?.toolCalls);
    if (typeName.includes('AIMessage') || hasToolCalls || message?.kwargs?.type === 'ai') {
      const content = message?.content ?? message?.kwargs?.content ?? '';
      return {
        id: message?.id ?? message?.kwargs?.id ?? null,
        content: extractTextContent(content),
      };
    }
  }
  return { id: null, content: '' };
}

function eventId(runId: string, seq: number | string): string {
  return `${runId}:${seq}`;
}

// P36c 阶段3（codex 五轮审 HIGH-1/HIGH-2，SSE 实时流维度）：global 会话的实时 SSE 不发原始工具
// 输出摘录 / 错误响应原文（两者都可能含 excerpt）——tool_call_finished.result_summary 与 error
// 事件 message 分别换成隔离常量。当轮授权引用统一走 message_completed.citations，功能不受损；原始
// 输出/错误仍完整落 agent_tool_calls/agent_runs 审计表（DB）。非 global 模块行为不变。
export function normalizeLangChainEvent(
  raw: any,
  runId: string,
  activeToolNames: Map<string, string>,
  redactRawOutput: boolean,
): AgentStreamEvent[] {
  const seq = typeof raw?.seq === 'number' ? raw.seq : undefined;
  const data = raw?.params?.data;
  const events: AgentStreamEvent[] = [];

  // streamEvents 同时包含主回答与 middleware 内部模型调用；只有 model_request 才是应显示给用户的回答。
  if (raw?.method === 'messages' && raw?.params?.node === 'model_request' && data?.event === 'content-block-delta') {
    const delta = data.delta ?? {};
    if (delta.type === 'text-delta' && typeof delta.text === 'string' && delta.text.length > 0) {
      events.push({
        event: 'message_delta',
        id: seq === undefined ? undefined : eventId(runId, seq),
        data: {
          run_id: runId,
          seq,
          text: delta.text,
          node: raw.params?.node,
          namespace: raw.params?.namespace ?? [],
        },
      });
    }
  }

  if (raw?.method === 'tools' && data?.event === 'tool-started') {
    events.push({
      event: 'tool_call_started',
      id: seq === undefined ? undefined : eventId(runId, seq),
      data: {
        run_id: runId,
        seq,
        tool_call_id: data.tool_call_id,
        tool_name: data.tool_name,
        input: data.input,
      },
    });
  }

  if (raw?.method === 'tools' && data?.event === 'tool-finished') {
    events.push({
      event: 'tool_call_finished',
      id: seq === undefined ? undefined : eventId(runId, seq),
      data: {
        run_id: runId,
        seq,
        tool_call_id: data.tool_call_id,
        tool_name: activeToolNames.get(data.tool_call_id) ?? data.tool_name ?? null,
        status: 'completed',
        result_summary: redactRawOutput ? GLOBAL_TOOL_OUTPUT_ISOLATED_SUMMARY : summarizeUnknown(data.output, 1000),
      },
    });
  }

  if (raw?.method === 'tools' && data?.event === 'tool-error') {
    events.push({
      event: 'error',
      id: seq === undefined ? undefined : eventId(runId, seq),
      data: {
        run_id: runId,
        seq,
        tool_call_id: data.tool_call_id,
        tool_name: activeToolNames.get(data.tool_call_id) ?? data.tool_name ?? null,
        message: redactRawOutput ? GLOBAL_ERROR_ISOLATED_MESSAGE : (data.message ?? data.error ?? 'tool error'),
      },
    });
  }

  return events;
}

export async function prepareAgentStream(input: PrepareAgentStreamInput): Promise<PreparedAgentStream> {
  const message = assertValidMessage(input.message);
  const mode: AgentStreamMode = input.mode ?? 'default';
  if (mode === 'admin_review' && !input.user.isAdmin) {
    throw new AgentGatewayError('只有管理员可以使用管理员审核辅助 Agent', 'forbidden', 403);
  }
  const conversation = await getAgentConversation(input.user, input.conversationId, { messageLimit: 1, runLimit: 5 });
  assertAdminReviewConversationModule(mode, conversation.activeModule);
  const { run, reused } = await createOrReuseAgentRun({
    conversationId: conversation.id,
    userId: input.user.userId,
    threadId: conversation.threadId,
    activeModule: conversation.activeModule,
    status: 'running',
    provider: process.env.AGENT_PROVIDER ?? 'unknown',
    model: process.env.AGENT_MODEL ?? 'unknown',
    runName: mode === 'admin_review' ? 'admin-review-agent-stream' : 'agent-chat-stream',
    streamProtocol: 'langchain-event-stream',
    streamVersion: 'v3',
    startedAt: new Date(),
    metadata: { requestId: input.requestId ?? null, mode },
    idempotencyKey: input.idempotencyKey ?? null,
  });

  // P36d 阶段1a（codex 审 E BLOCK 修复）：同 idempotencyKey 命中已有 run（并发/断流重试）→ 绝不
  // 第二次执行 agent。events() 为空生成器：不建 agent、不调模型、不写 checkpoint、不 updateAgentRun，
  // 已 completed 的 run 字段（output_message_id/citations/traceId 等）保持不变。调用方据 reused 返回
  // 已有 run 终态，用户侧「返回完整结果 vs 稍后重试」的恢复分诊留 1b relay（它查 platform session 的
  // msg_${idempotencyKey} 判 projection 是否已落）。
  if (reused) {
    async function* noEvents(): AsyncGenerator<AgentStreamEvent> {
      // 故意不产生任何事件，也不触碰 run 状态。
    }
    return { conversation, run, reused: true, events: noEvents };
  }

  async function* events(signal?: AbortSignal): AsyncGenerator<AgentStreamEvent> {
    let lastSeq = 0;
    let latestCheckpointId: string | null = null;
    let closeToolsSession: any = null;
    // P36c 阶段3：同 thread_id 并发串行化的释放函数（try 外声明，finally 才能访问）。
    let releaseThreadLock: (() => void) | null = null;
    const activeToolNames = new Map<string, string>();
    // T4：global profile 复合检索工具产出的 citations 存到 run 级闭包，events 收尾读出注入 message_completed。
    let globalCitationsSink: GlobalKnowledgeCitationsSink | null = null;
    // P52 §六阶段3（3B）：run 级路由决策聚合 sink——与 globalCitationsSink 并列，routingDecisionPromise
    // 惰性单算，本轮所有工具调用复用同一 immutable RoutingDecision（多工具决策缓存冻结）。
    let globalRetrievalSink: GlobalKnowledgeRetrievalSink | null = null;
    // P36c 阶段3（codex 五轮审）：global 会话的实时 SSE 需隔离原始工具输出摘录 / 错误响应原文（含 excerpt）。
    const redactGlobalRawOutput = conversation.activeModule === 'global';
    // P36d 阶段1a（阶段0 勘察3 冻结）：scope 从 conversation.metadata 读，替代硬编码
    // 'company'；非 global profile 不消费，读取无副作用。
    const resolvedScope = resolveGlobalChatScope(conversation.metadata);

    yield {
      event: 'run_started',
      id: eventId(run.id, 'start'),
      data: {
        run_id: run.id,
        conversation_id: conversation.id,
        active_module: conversation.activeModule,
        thread_id: conversation.threadId,
      },
    };

    try {
      // P36c 阶段3：同 thread_id 并发串行化——整个 run 的 checkpoint 读写在锁内串行，防并发 run
      // 交错写同 thread 的 transcript/checkpoint（见 thread-lock.ts）；释放在下方 finally 保证。
      releaseThreadLock = await acquireThreadLock(conversation.threadId);
      // P36a/P36b: 全域 profile 铁律——只用内置的复合检索工具（company_knowledge_search），
      // 优先级高于 dependencies 注入，宿主即便注入 tools/loadTools 也不生效（保 D1 不重现，
      // 不放开三模块 MCP 让 agent 自主检索）。
      let tools: unknown[];
      if (conversation.activeModule === 'global') {
        globalCitationsSink = { citations: [] };
        globalRetrievalSink = { retrievalAttempts: [], routingDecisionPromise: null };
        tools = [
          buildGlobalKnowledgeTool({
            user: resolveStoreUser(input.user),
            scope: resolvedScope,
            // P52 D-1/D-2/AC-原文：路由用 prepareAgentStream 已校验的本轮原文（闭包捕获），
            // 不是工具 schema 的 query（可能是模型改写词）。
            routingQuery: message,
            citationsSink: globalCitationsSink,
            retrievalSink: globalRetrievalSink,
            retrieve: input.dependencies?.globalKnowledgeRetrieve,
          }),
        ];
      } else if (input.dependencies?.tools) {
        tools = input.dependencies.tools;
      } else {
        const activeModule = conversation.activeModule;
        const toolsSession = input.dependencies?.loadTools
          ? await input.dependencies.loadTools({ user: input.user, bearerToken: input.bearerToken })
          : mode === 'admin_review'
            ? createAdminReviewModuleHttpTools({ user: input.user })
            : createModuleHttpTools({ user: input.user, activeModule });
        closeToolsSession = toolsSession.close;
        tools = toolsSession.tools;
      }

      const runModel = resolveRunScopedAgentModel(input.dependencies);

      const createAgentForMode = mode === 'admin_review' ? createAdminReviewAgent : createCompanyBrainAgent;
      // P36c 阶段1+2：三层 state middleware 仅挂 global profile，不影响三个 RAG 模块 profile。
      // 装配顺序硬约束（short-term-memory.ts 顶部 + summarizer.ts 顶部已详述，不可颠倒）：
      //   middleware: [summarizerMiddleware, shortTermMemoryMiddleware]
      // afterModel 逆序执行 → shortTerm 先记 transcript、summarizer 后裁剪 messages，transcript
      // 不漏记；wrapModelCall 正序组合、summarizer 最外层 → summarizer 先切出摘要+delta 段，
      // shortTerm 再对剩余"最近轮次"原始区间截断，两者各管一段、互不覆盖。
      const agent = createAgentForMode({
        model: runModel,
        tools,
        systemPrompt: mode === 'admin_review'
          ? undefined
          : buildAgentSystemPrompt({
              username: input.user.username,
              isAdmin: input.user.isAdmin,
              activeModule: conversation.activeModule,
            }),
        checkpointer: input.dependencies?.checkpointer ?? (await getAgentPostgresSaver()),
        middleware: conversation.activeModule === 'global'
          ? [
              createSummarizerMiddleware({
                // 摘要调用不能复用主 Agent 的 reasoning-aware completions：其独立消息历史
                // 可能触发 protocol-state 清理。默认仍创建独立模型，保持既有隔离语义。
                model: (input.dependencies?.summaryModel ?? input.dependencies?.model ?? createAgentChatModel()) as {
                  invoke: (input: string) => Promise<{ content: unknown }>;
                },
              }),
              // P36c 阶段3：global profile 每 run 现建 provenance-aware 实例——传入本轮 citationsSink
              // （关联 citations 到答案消息，供撤权重校验）+ 当前用户/scope（wrapModelCall 注入前
              // 对历史 assistant 引用做撤权过滤）。checkpointer 只读路径仍用无参 singleton。
              createShortTermMemoryMiddleware({
                citationsSink: globalCitationsSink ?? undefined,
                currentUser: resolveStoreUser(input.user),
                scope: resolvedScope,
                filterReadableRefs: input.dependencies?.provenanceFilter,
              }),
            ]
          : undefined,
      });

      const context = buildAgentRuntimeContext({
        userId: input.user.userId,
        username: input.user.username,
        isAdmin: input.user.isAdmin,
        activeModule: conversation.activeModule,
        conversationId: conversation.id,
        runId: run.id,
        requestId: input.requestId,
        toolPolicy: mode === 'admin_review' ? buildAdminReviewToolPolicy() : undefined,
        permissions: mode === 'admin_review' ? ['admin_review_assistant'] : [],
      });

      const langChainStream = await (agent as any).streamEvents(
        { messages: [{ role: 'user', content: message }] },
        {
          version: 'v3',
          configurable: { thread_id: conversation.threadId },
          context,
          signal,
        },
      );

      for await (const rawEvent of langChainStream) {
        if (signal?.aborted) throw new Error('Agent stream aborted');
        if (typeof rawEvent?.seq === 'number') lastSeq = rawEvent.seq;
        const checkpointId = rawEvent?.method === 'checkpoints' ? rawEvent?.params?.data?.id : null;
        if (typeof checkpointId === 'string') latestCheckpointId = checkpointId;

        const rawData = rawEvent?.params?.data;
        if (rawEvent?.method === 'tools' && rawData?.event === 'tool-started') {
          if (rawData.tool_call_id && rawData.tool_name) activeToolNames.set(rawData.tool_call_id, rawData.tool_name);
          await createAgentToolCall({
            runId: run.id,
            conversationId: conversation.id,
            toolName: rawData.tool_name ?? 'unknown_tool',
            arguments: typeof rawData.input === 'object' && rawData.input !== null ? rawData.input : { value: rawData.input },
            status: 'running',
            sequence: typeof rawEvent.seq === 'number' ? rawEvent.seq : lastSeq,
            langchainToolCallId: rawData.tool_call_id ?? null,
            nodeName: rawEvent.params?.node ?? null,
            namespace: Array.isArray(rawEvent.params?.namespace) ? rawEvent.params.namespace.join('/') : null,
            startedAt: new Date(),
          }).catch(() => undefined);
        }
        if (rawEvent?.method === 'tools' && rawData?.event === 'tool-finished') {
          await updateAgentToolCall({
            runId: run.id,
            langchainToolCallId: rawData.tool_call_id ?? null,
            status: 'completed',
            resultSummary: summarizeUnknown(rawData.output, 1000),
            result: rawData.output,
            error: null,
            finishedAt: new Date(),
          }).catch(() => undefined);
        }
        if (rawEvent?.method === 'tools' && rawData?.event === 'tool-error') {
          await updateAgentToolCall({
            runId: run.id,
            langchainToolCallId: rawData.tool_call_id ?? null,
            status: 'failed',
            resultSummary: rawData.message ?? rawData.error ?? 'tool error',
            error: { message: rawData.message ?? rawData.error ?? 'tool error', code: rawData.code ?? null },
            finishedAt: new Date(),
          }).catch(() => undefined);
        }

        for (const event of normalizeLangChainEvent(rawEvent, run.id, activeToolNames, redactGlobalRawOutput)) {
          yield event;
        }
      }

      const output = await langChainStream.output;
      const finalMessage = getLastAssistantMessage(output);
      const isGlobalProfile = conversation.activeModule === 'global';
      // P36d 阶段1a（D-P36d-3 + 阶段0.5 §1.3）：traceId 由 gateway 权威生成（与 SSE 送达与否无关，
      // 断流补落复用同一 id）；contextTrace 最小完整生成（route+retrievalTracks+4 子字段最小规则，
      // 见 context-trace.ts）。仅 global profile 生成——非 global 无 scope/citations/contextTrace 语义。
      const traceId = isGlobalProfile ? `trace_${randomUUID()}` : null;
      const runCitations = isGlobalProfile ? (globalCitationsSink?.citations ?? []) : null;
      const contextTrace = isGlobalProfile
        ? buildGlobalContextTrace({
            citations: runCitations ?? [],
            scope: resolvedScope,
            finalState: output,
            retrievalAttempts: globalRetrievalSink?.retrievalAttempts ?? []
          })
        : null;
      await updateAgentRun({
        runId: run.id,
        status: 'completed',
        lastEventSeq: lastSeq,
        latestCheckpointId,
        outputMessageId: finalMessage.id,
        finishedAt: new Date(),
        // P36d 阶段1a（D-P36d-1 ②断流补落依赖）：run 完成时（finally 前）落 agent_runs 持久列——
        // SSE 闭包 globalCitationsSink 随 run 结束销毁，不落库则断流丢 citations。
        citations: runCitations,
        contextTrace,
        traceId,
      });

      // T4/P36d 阶段1a：冻结 SSE citations/contextTrace/trace_id 契约（前端消费留 P36d 阶段1b）。
      // - citations?: GlobalChatCitation[] — 复合检索工具产出，只有 global profile 且工具确实产出
      //   citations 时才带上，缺省即省略字段。
      // - contextTrace?: GlobalChatContextTrace — 最小完整生成（route+retrievalTracks 有推导来源，
      //   其余 4 子字段见 context-trace.ts 最小生成规则），只有 global profile 才生成。
      // - trace_id?: string — 平台 traceId adapter（gateway 权威生成），只有 global profile 才生成；
      //   snake_case 对齐既有协议级字段命名（run_id/latest_checkpoint_id），非 P36d 新造惯例。
      yield {
        event: 'message_completed',
        id: eventId(run.id, 'message_completed'),
        data: {
          run_id: run.id,
          message: finalMessage,
          latest_checkpoint_id: latestCheckpointId,
          ...(globalCitationsSink && globalCitationsSink.citations.length > 0
            ? { citations: globalCitationsSink.citations }
            : {}),
          ...(contextTrace ? { contextTrace } : {}),
          ...(traceId ? { trace_id: traceId } : {}),
        },
      };
      yield {
        event: 'run_completed',
        id: eventId(run.id, 'completed'),
        data: { run_id: run.id, status: 'completed', last_event_seq: lastSeq },
      };
    } catch (error) {
      const aborted = signal?.aborted;
      await updateAgentRun({
        runId: run.id,
        status: aborted ? 'cancelled' : 'failed',
        lastEventSeq: lastSeq,
        latestCheckpointId,
        error: aborted ? { message: 'Agent stream aborted' } : { message: error instanceof Error ? error.message : String(error) },
        finishedAt: new Date(),
      }).catch(() => undefined);
      if (!aborted) {
        yield {
          event: 'error',
          id: eventId(run.id, 'error'),
          data: {
            run_id: run.id,
            // P36c 阶段3（codex 五轮审 HIGH-2）：global 会话 run 级错误隔离错误原文（模块失败会把
            // 响应 JSON 含 excerpt 拼进 error.message）；原始错误已落 agent_runs 审计表（见上 updateAgentRun）。
            message: redactGlobalRawOutput
              ? GLOBAL_ERROR_ISOLATED_MESSAGE
              : error instanceof Error
                ? error.message
                : String(error),
          },
        };
      }
    } finally {
      releaseThreadLock?.();
      await closeToolsSession?.().catch(() => undefined);
    }
  }

  return { conversation, run, reused: false, events };
}
