import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireUserByBearerToken } from '@ff/identity';
import type { UserContext } from '@ff/contracts';
import { assertInternalTokenValid } from '@ff/contracts';
import {
  AgentGatewayError,
  IDEMPOTENCY_KEY_PATTERN,
  createAgentConversation,
  deleteAgentConversation,
  getAgentConversation,
  getAgentConversationInternal,
  getAgentRun,
  getAgentRunInternal,
  listAgentConversations,
  toPublicConversation,
  toPublicRun,
  toPublicToolCall,
} from '../core/conversations';
import { getAgentPostgresSaver, hasAgentModelEnv, readConversationCheckpointMessages } from '../agent/checkpointer';
import { resolveGlobalChatScope } from '../agent/global-metadata';
import { prepareAgentStream, type AgentStreamDependencies } from '../agent/stream';
import {
  normalizeTrustedUserContext,
  resolveStoreUser,
} from '../agent/user-context';
import { migrateAgentGatewayDatabase } from '../migrations';

function extractBearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

async function requireAuth(c: any): Promise<{ user: UserContext; bearerToken: string }> {
  const token = extractBearerToken(c.req.header('authorization'));
  if (!token) {
    throw new AgentGatewayError('缺少 Bearer Token', 'forbidden', 401);
  }
  const user = await requireUserByBearerToken(token);
  return {
    bearerToken: token,
    user: normalizeTrustedUserContext({
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      organizationId: user.organizationId,
      teamIds: user.teamIds,
    }),
  };
}

async function requireUser(c: any): Promise<UserContext> {
  return (await requireAuth(c)).user;
}

async function readJson(c: any): Promise<any> {
  try {
    return await c.req.json();
  } catch {
    throw new AgentGatewayError('请求体必须是 JSON', 'invalid_input', 400);
  }
}

function mapError(error: unknown) {
  if (error instanceof AgentGatewayError) {
    return {
      status: error.status,
      body: { error: error.code, message: error.message },
    };
  }
  if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'invalid_credentials') {
    return {
      status: 401,
      body: { error: 'unauthorized', message: '未登录或登录已过期' },
    };
  }
  return {
    status: 500,
    body: {
      error: 'internal_error',
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function encodeSse(input: { event: string; data: unknown; id?: string }): Uint8Array {
  const encoder = new TextEncoder();
  const lines = [
    input.id ? `id: ${input.id}` : null,
    `event: ${input.event}`,
    `data: ${JSON.stringify(input.data)}`,
    '',
    '',
  ].filter((line) => line !== null);
  return encoder.encode(lines.join('\n'));
}

export function createAgentGatewayHttpApp(options: { streamDependencies?: AgentStreamDependencies } = {}): Hono {
  const app = new Hono();
  app.use('*', cors());

  app.get('/health', (c) => c.json({ status: 'ok', service: 'agent-gateway' }));

  app.post('/agent/conversations', async (c) => {
    try {
      const user = await requireUser(c);
      const body = await readJson(c);
      const conversation = await createAgentConversation(user, {
        activeModule: body.active_module,
        title: body.title,
        metadata: body.metadata,
      });
      return c.json({ conversation: toPublicConversation(conversation) }, 201);
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }
  });

  app.get('/agent/conversations', async (c) => {
    try {
      const user = await requireUser(c);
      const conversations = await listAgentConversations(user, { limit: c.req.query('limit') });
      return c.json({ conversations: conversations.map(toPublicConversation) });
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }
  });

  app.get('/agent/conversations/:conversationId', async (c) => {
    try {
      const user = await requireUser(c);
      const details = await getAgentConversation(user, c.req.param('conversationId'), {
        messageLimit: c.req.query('message_limit'),
        runLimit: c.req.query('run_limit'),
      });
      let messages = details.messages;
      let checkpoint_id: string | null = null;
      let message_source = details.messageSource;
      if (options.streamDependencies?.checkpointer || hasAgentModelEnv()) {
        try {
          const checkpoint = await readConversationCheckpointMessages({
            conversation: details,
            checkpointer: options.streamDependencies?.checkpointer,
            model: options.streamDependencies?.model,
            tools: options.streamDependencies?.tools,
            // P36c 阶段3（codex 二轮审 HIGH）：传当前读取用户，global 会话读 transcript 前做 provenance
            // 撤权过滤——撤权来源的历史答案 + 同轮 ToolMessage excerpt 不经历史 API 泄露。
            user: resolveStoreUser(user),
            scope: resolveGlobalChatScope(details.metadata),
            provenanceFilter: options.streamDependencies?.provenanceFilter,
          });
          messages = checkpoint.messages;
          checkpoint_id = checkpoint.checkpointId;
          message_source = 'langgraph_checkpoint';
        } catch {
          // M25/M26 兼容：未配置生产 Agent 模型或 checkpoint 时仍可读取会话索引。
        }
      }
      return c.json({
        conversation: toPublicConversation(details),
        messages,
        message_source,
        checkpoint_id,
        runs: details.runs.map((r) => toPublicRun(r, { redactRawOutput: r.activeModule === 'global' })),
      });
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }
  });

  app.post('/agent/conversations/:conversationId/stream', async (c) => {
    let prepared: Awaited<ReturnType<typeof prepareAgentStream>>;
    const abort = new AbortController();
    try {
      const auth = await requireAuth(c);
      const body = await readJson(c);
      if (typeof body.message !== 'string' || body.message.trim().length === 0) {
        throw new AgentGatewayError('message 不能为空', 'invalid_input', 400);
      }
      const requestId = c.req.header('x-request-id') ?? undefined;
      prepared = await prepareAgentStream({
        user: auth.user,
        bearerToken: auth.bearerToken,
        conversationId: c.req.param('conversationId'),
        message: body.message,
        mode: body.mode === 'admin_review' ? 'admin_review' : 'default',
        requestId,
        // P36d 阶段1a（阶段0.5 §2.2）：web relay（阶段1b）把前端生成的 idempotency key 设进
        // x-request-id 转发；同一个头身兼「审计 requestId」与「幂等去重键」两用。这里做宽松预筛
        // （非 UUID 格式则不当幂等键用，不硬拒请求——历史/非 P36d 调用方的 x-request-id 未必是
        // UUID），核心层 createAgentRun 仍会再校验一次格式（双层防御）。
        idempotencyKey: requestId && IDEMPOTENCY_KEY_PATTERN.test(requestId) ? requestId : undefined,
        dependencies: options.streamDependencies,
      });
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }

    // P36d 阶段1a（codex 审 E BLOCK 修复）：幂等命中已有 run → 不开 SSE、不重跑 agent，直接返回已有
    // run 终态（gateway 层责任 = 不重复执行 + 暴露已有 run 状态）。用户侧「返回完整结果 vs 202 稍后
    // 重试」的恢复分诊由 1b relay 据 status + 查 platform session 的 msg_${idempotencyKey} 做，不在此层。
    // run 详情按既有 global 隔离规则序列化（citations/context_trace 隔离，见 toPublicRun）。
    if (prepared.reused) {
      return c.json(
        {
          reused: true,
          run: toPublicRun(prepared.run, { redactRawOutput: prepared.run.activeModule === 'global' }),
        },
        200,
      );
    }

    c.req.raw.signal.addEventListener('abort', () => abort.abort());

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            for await (const event of prepared.events(abort.signal)) {
              if (abort.signal.aborted) break;
              controller.enqueue(encodeSse(event));
            }
          } catch (error) {
            if (!abort.signal.aborted) {
              controller.enqueue(
                encodeSse({
                  event: 'error',
                  data: { message: error instanceof Error ? error.message : String(error) },
                }),
              );
            }
          } finally {
            controller.close();
          }
        },
        cancel() {
          abort.abort();
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  });

  // P36d 阶段1a（阶段0 勘察缺口7）：core deleteAgentConversation 一直存在但无 HTTP 路由——web
  // DELETE 双端删除（阶段1b）需要接线到它。幂等：会话不存在（含已删除）返回 { ok: false }，
  // 权限不足仍 403（见 deleteAgentConversation 注释）。鉴权同其他路由（requireUser）。
  app.delete('/agent/conversations/:conversationId', async (c) => {
    try {
      const user = await requireUser(c);
      const result = await deleteAgentConversation(user, c.req.param('conversationId'));
      return c.json(result);
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }
  });

  app.get('/agent/conversations/:conversationId/runs/:runId', async (c) => {
    try {
      const user = await requireUser(c);
      const run = await getAgentRun(user, c.req.param('conversationId'), c.req.param('runId'));
      // P36c 阶段3（codex 二轮审 HIGH）：global 会话 run 详情隔离原始工具输出全文（含 excerpt），
      // 不经普通 API 暴露——见 toPublicToolCall 注释。非 global 模块行为不变。
      const redactRawOutput = run.activeModule === 'global';
      return c.json({
        run: toPublicRun(run, { redactRawOutput }),
        tool_calls: run.toolCalls.map((toolCall) => toPublicToolCall(toolCall, { redactRawOutput })),
        events: [],
      });
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }
  });

  // P36d 阶段1b-2b-α：gateway 内部读端点——为断流补落②（web relay 重建 assistant 消息，见 D-P36d-1）
  // 提供 un-redacted citations/context_trace/trace_id + 答案内容。门控用 RAG_INTERNAL_TOKEN（非用户
  // Bearer，见 spec DA），不走 requireAuth/requireUser；按 (conversationId, runId) 取 run 无 per-user
  // 校验（见 spec DB：relay 调用前已校验用户拥有对应 platform session，内部 token 已表示可信调用方）。
  // 只对 global run 有意义（DC）：非 global → 404，收窄面。故意不经 toPublicRun——本端点就是授权的
  // 内部解隔离出口，公开 GET runs/:runId 的 redactRawOutput 隔离保持不变。
  app.get('/internal/agent/conversations/:conversationId/runs/:runId/projection', async (c) => {
    const expectedToken = process.env.RAG_INTERNAL_TOKEN;
    const actualToken = c.req.header('x-internal-token');
    if (!expectedToken || !actualToken || actualToken !== expectedToken) {
      return c.json({ error: 'forbidden', message: '内部调用 token 无效' }, 401);
    }
    try {
      const conversationId = c.req.param('conversationId');
      const runId = c.req.param('runId');
      const run = await getAgentRunInternal(conversationId, runId);
      if (!run || run.activeModule !== 'global') {
        return c.json({ error: 'not_found', message: 'Agent run 不存在' }, 404);
      }
      const conversation = await getAgentConversationInternal(conversationId);
      let answerText: string | null = null;
      if (conversation) {
        const { messages } = await readConversationCheckpointMessages({ conversation });
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          if (messages[i].role === 'assistant') {
            answerText = messages[i].text;
            break;
          }
        }
      }
      return c.json({
        status: run.status,
        output_message_id: run.outputMessageId,
        latest_checkpoint_id: run.latestCheckpointId,
        citations: run.citations,
        context_trace: run.contextTrace,
        trace_id: run.traceId,
        answer_text: answerText,
      });
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }
  });

  return app;
}

export async function startAgentGatewayHttpServer(input: { port?: number; migrate?: boolean } = {}) {
  // A5：监听前校验，放最前——避免无效 token 仍执行迁移等副作用（SF1）。
  assertInternalTokenValid(process.env.RAG_INTERNAL_TOKEN);
  // Runtime is a schema consumer.  Docker/teaching deployments run all DDL in
  // the one-shot migrate service; local callers must opt in explicitly.
  if (input.migrate === true) {
    await migrateAgentGatewayDatabase();
    await getAgentPostgresSaver();
  }
  const app = createAgentGatewayHttpApp();
  const port = input.port ?? Number(process.env.AGENT_GATEWAY_PORT ?? 3002);
  serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
  console.log(`FF-CompanyBrain Agent Gateway listening on http://0.0.0.0:${port}`);
  return { app, port };
}

if (import.meta.main) {
  await startAgentGatewayHttpServer({ migrate: false });
}
