import { randomUUID } from "node:crypto";
import { agentGatewayServerBaseUrl } from "./global-qa-arch";
import {
  checkChatCostGuards,
  commitAgentChatGuardRejection,
  commitAgentChatTurn,
  getGlobalChatSession,
  type GlobalChatCitation,
  type GlobalChatContextTrace,
  type StoreUser,
  type StoredGlobalChatSession
} from "@ff/platform/platform-store";

// P36d 阶段1b-2b-β：web relay 核心——把 agent-gateway 追问入口
// POST /agent/conversations/:threadId/stream 的两种响应形态（reused JSON / live SSE）
// 分诊/透传/原子落到 platform（commitAgentChatTurn），供 route.ts 追问分支消费。
// 只 web 侧，不碰 gateway/platform 生产代码。

// 与 apps/agent-gateway/src/core/conversations.ts 的 IDEMPOTENCY_KEY_PATTERN 保持完全一致——
// gateway 只把合法 UUID 的 x-request-id 当幂等键，若 relay 把非 UUID 原样转发，gateway 侧会
// 静默丢弃幂等语义（跑成两个独立 run），而 commitAgentChatTurn 的 `^[A-Za-z0-9_-]+$` 校验又足够宽松
// 会照单接受——两侧标准不一致会导致"浏览器展示第 N 次答案、库里存的是另一次"的分叉。
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DE：idempotencyKey 读 body.idempotency_key，仅当其为合法 UUID 时才采用（与 gateway 判定口径一致）；
// 否则（缺失或非法）服务端生成新 UUID v4——保证 relay 用来做 x-request-id 的 key 一定会被 gateway
// 也当作幂等键，两侧行为一致。跨请求断流去重依赖前端每轮传同一个合法 key（3a 的事）。
export function resolveIdempotencyKey(body: unknown): string {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).idempotency_key : undefined;
  if (typeof raw === "string" && IDEMPOTENCY_KEY_PATTERN.test(raw.trim())) return raw.trim();
  return randomUUID();
}

type ReusedRunBody = {
  reused?: boolean;
  run?: { id?: string; status?: string };
};

type ProjectionResponse = {
  status?: string;
  citations?: GlobalChatCitation[] | null;
  context_trace?: GlobalChatContextTrace | null;
  trace_id?: string | null;
  answer_text?: string | null;
};

// ②补落：读 1b-2b-α 内部投影端点，重建 assistant 消息并落库。
// answer_text 为空（checkpoint 无答案）或缺少 context_trace/trace_id → 返回 null，调用方转③可重试。
export async function backfillFromRun(
  user: StoreUser,
  input: { sessionId: string; threadId: string; runId: string; query: string; idempotencyKey: string }
): Promise<StoredGlobalChatSession | null> {
  const internalToken = process.env.RAG_INTERNAL_TOKEN;
  if (!internalToken) return null;

  let res: Response;
  try {
    res = await fetch(
      `${agentGatewayServerBaseUrl()}/internal/agent/conversations/${encodeURIComponent(input.threadId)}/runs/${encodeURIComponent(input.runId)}/projection`,
      { headers: { "x-internal-token": internalToken } }
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const projection = (await res.json().catch(() => null)) as ProjectionResponse | null;
  if (!projection?.answer_text || !projection.context_trace || !projection.trace_id) return null;

  return commitAgentChatTurn(user, {
    sessionId: input.sessionId,
    idempotencyKey: input.idempotencyKey,
    query: input.query,
    answerText: projection.answer_text,
    citations: projection.citations ?? [],
    contextTrace: projection.context_trace,
    // DF：route 直接取 contextTrace.route（gateway 已是 "direct"|"retrieve"，与 commit 入参同词汇）。
    route: projection.context_trace.route,
    totalLatencyMs: 0,
    traceId: projection.trace_id
  });
}

// reused 分诊核心（依赖注入，供集成测确定性构造 running/completed/已落 三态）。
// ① 已落该轮 → 返既有 session；② run completed 且 backfill 成功 → 返补落 session；③ 其余 → 202 retryable。
export async function resolveReusedRun(
  reused: ReusedRunBody | null,
  deps: {
    assistantId: string;
    getExistingSession: () => Promise<StoredGlobalChatSession | null>;
    backfill: (runId: string) => Promise<StoredGlobalChatSession | null>;
  }
): Promise<Response> {
  const runId = reused?.run?.id;
  const status = reused?.run?.status;

  const existing = await deps.getExistingSession();
  if (existing?.messages.some((message) => message.id === deps.assistantId)) {
    return Response.json({ session: existing });
  }

  if (runId && status === "completed") {
    const backfilled = await deps.backfill(runId);
    if (backfilled) return Response.json({ session: backfilled });
  }

  return Response.json({ status: "retryable" }, { status: 202 });
}

// reused（JSON）分支：① platform 已落该轮 → 直接返回既有 session；
// ② run 已完成但 platform 未落 → 调 backfillFromRun 补落；
// ③ run 仍在跑，或②补落失败 → 202 retryable。
async function relayReusedRun(
  user: StoreUser,
  upstream: Response,
  input: { sessionId: string; threadId: string; query: string; idempotencyKey: string }
): Promise<Response> {
  const body = (await upstream.json().catch(() => null)) as ReusedRunBody | null;
  return resolveReusedRun(body, {
    assistantId: `msg_${input.idempotencyKey}`,
    getExistingSession: () => getGlobalChatSession(user, input.sessionId),
    backfill: (runId) =>
      backfillFromRun(user, {
        sessionId: input.sessionId,
        threadId: input.threadId,
        runId,
        query: input.query,
        idempotencyKey: input.idempotencyKey
      })
  });
}

// 服务端 SSE 块解析：复刻 apps/web/lib/api.ts readSseStream 的 flushBlock 逻辑（浏览器私有函数，
// 服务端不能复用），按 event:/id:/data: 三种前缀行解析一个已按 \n\n 切好的块。
function parseSseBlock(block: string): { event: string; id?: string; data: string } | null {
  const lines = block.split(/\r?\n/);
  let event = "message";
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("id:")) id = line.slice("id:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, id, data: dataLines.join("\n") };
}

// live（SSE）分支：边读边解析上游块，非 message_completed 原样透传；message_completed 命中
// DH 交付原子性——先 await commitAgentChatTurn 成功，才把该事件 enqueue 给浏览器；commit 失败则
// 发终止 error 事件、不发 message_completed，不留半落（同 key 供下次追问走②补落）。
function relayLiveStream(
  user: StoreUser,
  upstream: Response,
  input: { sessionId: string; query: string; idempotencyKey: string; startedAtMs: number }
): Response {
  if (!upstream.body) {
    return Response.json({ error: "upstream_unavailable", message: "Agent 服务没有返回可读流。" }, { status: 502 });
  }
  const upstreamBody = upstream.body;
  const encoder = new TextEncoder();

  // reader/closed 提升到 start 与 cancel 共享的闭包：cancel 必须能拿到已加锁的 reader 本身
  // 发起取消（对已被 getReader() 锁定的 upstreamBody 直接 cancel 会被 Streams 规范拒绝，静默失效，
  // 上游连接/读循环不会真正停下——即 cancel 泄漏）。
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      reader = upstreamBody.getReader();
      const activeReader = reader;
      const decoder = new TextDecoder();
      let buffer = "";

      const emitRaw = (block: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${block}\n\n`));
      };
      const emitError = (message: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      const handleBlock = async (block: string) => {
        if (closed || !block.trim()) return;
        const parsed = parseSseBlock(block);
        if (!parsed) return;

        if (parsed.event !== "message_completed") {
          emitRaw(block);
          return;
        }

        let data: any;
        try {
          data = JSON.parse(parsed.data);
        } catch {
          emitError("答案数据解析失败，无法保存。");
          finish();
          return;
        }

        const contextTrace = data?.contextTrace as GlobalChatContextTrace | undefined;
        const traceId = typeof data?.trace_id === "string" ? data.trace_id : undefined;
        const answerText = typeof data?.message?.content === "string" ? data.message.content : "";
        if (!contextTrace || !traceId) {
          emitError("答案缺少必要的追踪信息，无法保存。");
          finish();
          return;
        }

        // DH：先落库成功，才把 message_completed 送到浏览器。
        const committed = await commitAgentChatTurn(user, {
          sessionId: input.sessionId,
          idempotencyKey: input.idempotencyKey,
          query: input.query,
          answerText,
          citations: Array.isArray(data.citations) ? data.citations : [],
          contextTrace,
          route: contextTrace.route,
          totalLatencyMs: Date.now() - input.startedAtMs,
          traceId
        });
        if (!committed) {
          emitError("保存回答失败，请重试。");
          finish();
          return;
        }
        emitRaw(block);
      };

      try {
        while (!closed) {
          const { value, done } = await activeReader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // 与 parseSseBlock 的 \r\n 行切分对齐：块之间的空行分隔符可能是 \n\n 或 \r\n\r\n（甚至混用）。
          const parts = buffer.split(/\r?\n\r?\n/);
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            if (closed) break;
            await handleBlock(part);
          }
        }
        if (!closed) {
          buffer += decoder.decode();
          if (buffer.trim()) await handleBlock(buffer);
        }
      } catch (error) {
        emitError(error instanceof Error ? error.message : String(error));
      } finally {
        finish();
      }
    },
    // 客户端 abort → Next.js 取消消费该流 → 触发本 cancel（best-effort 取消上游 reader）。
    // 必须通过已加锁的 reader 取消，不能对 upstreamBody 本体调用 cancel——它已被 start() 里的
    // getReader() 锁定，Streams 规范会拒绝该调用，取消静默失效（上游连接/读循环不会真正停下）。
    cancel() {
      closed = true;
      reader?.cancel().catch(() => undefined);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

// relay 主编排：服务端转发追问到 gateway /stream（x-request-id 带幂等 key），据响应
// content-type 分诊到 reused-JSON（①②③）或 live-SSE（透传 + 原子落）路径。
export async function relayAgentTurn(
  user: StoreUser,
  input: {
    sessionId: string;
    threadId: string;
    query: string;
    idempotencyKey: string;
    token: string;
    startedAtMs: number;
  }
): Promise<Response> {
  // 025 T1：成本护栏——agent-gateway 独有入口(main 无此路径)，必须先于 upstream fetch，
  // 否则新架构会话会完全绕过限流/配额(memory feedback_multilayer_dispatch_locate_hit_layer 实证)。
  // skipAudit:该路径有 idempotencyKey 幂等短路(commitAgentChatGuardRejection)，audit 责任移到那里，
  // 确认是"新拒答"才记，避免同 key 重发(网络重试)在这里先记一遍。
  const guard = await checkChatCostGuards(user, undefined, { skipAudit: true });
  if (!guard.allowed) {
    const rejected = await commitAgentChatGuardRejection(user, {
      sessionId: input.sessionId,
      query: input.query,
      idempotencyKey: input.idempotencyKey,
      message: guard.message,
      kind: guard.kind
    });
    if (!rejected) {
      return Response.json({ error: "not_found", message: "没有找到这条会话，或问题为空。" }, { status: 404 });
    }
    return Response.json({ session: rejected });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${agentGatewayServerBaseUrl()}/agent/conversations/${encodeURIComponent(input.threadId)}/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
        "x-request-id": input.idempotencyKey
      },
      body: JSON.stringify({ message: input.query })
    });
  } catch {
    return Response.json({ error: "upstream_unavailable", message: "Agent 服务暂时不可用，请稍后重试。" }, { status: 502 });
  }

  // 非 2xx 必须在 content-type 分诊前拦截：gateway 的 401/404/500 也可能是 application/json，
  // 若先按 content-type 分诊会掉进 relayReusedRun，被误判成合法的 {reused,run} 报文并可能误返 202。
  if (!upstream.ok) {
    const message = await upstream.text().catch(() => "");
    return Response.json(
      { error: "upstream_error", message: message || `Agent 服务返回错误状态 ${upstream.status}。` },
      { status: 502 }
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return relayReusedRun(user, upstream, input);
  }
  return relayLiveStream(user, upstream, input);
}
