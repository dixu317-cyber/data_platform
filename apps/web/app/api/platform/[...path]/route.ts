import { proxyToUpstream } from "../../_proxy";
import {
  authenticateUser,
  clearSessionCookie,
  getRequestSessionToken,
  getRequestUser,
  isPlatformIdentityToken,
  listRegistrationTeams,
  RegistrationError,
  registerUser,
  revokeSession,
  SessionRevocationError,
  sessionCookie,
  userToStoreUser
} from "../../../../lib/server/auth-store";
import { isEmergencyLegacy, createGlobalAgentConversation, deleteAgentConversationBestEffort, getAgentConversationForOwnerPreflight } from "../../../../lib/server/global-qa-arch";
import { relayAgentTurn, resolveIdempotencyKey } from "../../../../lib/server/global-qa-relay";
import {
  aggregateLlmUsage,
  appendGlobalChatMessage,
  appendScenarioChatMessage,
  askStoredScenarioKnowledge,
  createAdminScenarioTemplate,
  createGlobalChatSession,
  deleteGlobalChatSession,
  renameGlobalChatSession,
  createScenarioChatSession,
  createStoredScenario,
  createScenarioDataRequest,
  setTraceFeedback,
  listGraphCurationSources,
  getGraphCurationDetail,
  mergeGraphCurationEntities,
  editGraphCurationEntity,
  deleteGraphCurationEntity,
  deleteGraphCurationRelation,
  createGraphCurationEntity,
  createGraphCurationRelation,
  deleteGraphCurationSource,
  getDocumentChunks,
  deleteDocumentChunk,
  listGbrainPages,
  editGbrainPage,
  deleteAdminScenarioTemplate,
  decideAdminIntakeRequest,
  getAdminDashboardSnapshot,
  getAdminIntegrationSettings,
  probeIntegration,
  updateRuntimeConfig,
  updateEngineRetrievalConfig,
  getGlobalChatSession,
  getScenarioChatSession,
  getStoredFilePreview,
  getStoredScenarioWorkbench,
  listAdminAuditEvents,
  listAdminIntakeRequests,
  listIngestQueue,
  listAdminKnowledgeAssetDetails,
  listNotifications,
  unreadNotificationCount,
  markNotificationsRead,
  updateScenarioDescriptionCard,
  adminEngineRecallVerify,
  adminExportKnowledgeAssetsCsv,
  adminBatchReviewRequests,
  listAdminScenarioTemplates,
  listGlobalChatSessions,
  listScenarioChatSessions,
  listStoredKnowledgeObjects,
  listStoredScenarios,
  listStoredTasks,
  updateAdminScenarioTemplate,
  type AdminKnowledgeAssetKind,
  type AdminRagEngine,
  type AdminStrategyParameters,
  type AdminTemplateMutationInput,
  type GlobalChatScope,
  type StoreUploadFile,
  type StoreUser,
  type StoreVisibility
} from "@ff/platform/platform-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 900s：与 pollGraphDocument 的 FF_GRAPH_DOC_TIMEOUT_MS 默认 900000 对齐（I82/codex 审 NIT）。
// GraphRAG 多文件 approve 走本 route 同步等建图轮询，300s 会在 15 分钟轮询完成前打断请求（场景C approve fetch failed 疑因）。
export const maxDuration = 900;

const rawPlatformBaseUrl =
  process.env.API_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export function resolvePlatformBaseUrl(baseUrl = rawPlatformBaseUrl): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");

  try {
    const url = new URL(normalizedBase);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.at(-1) === "platform") return normalizedBase;
  } catch {
    if (normalizedBase.endsWith("/platform")) return normalizedBase;
  }

  return `${normalizedBase}/platform`;
}

const platformBaseUrl = resolvePlatformBaseUrl();

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

async function proxy(request: Request, context: RouteContext) {
  const local = await handleLocalPlatformRoute(request, context);
  if (local) return local;
  return proxyToUpstream(request, context, platformBaseUrl);
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;

async function handleLocalPlatformRoute(request: Request, context: RouteContext): Promise<Response | null> {
  const { path = [] } = await context.params;
  const method = request.method.toUpperCase();

  if (path[0] === "auth") {
    return handleAuthRoute(request, method, path);
  }

  if (method === "POST" && path.join("/") === "scenarios") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const input = await parseScenarioSubmission(request);
    const created = await createStoredScenario(userToStoreUser(user), input);
    return Response.json(created, { status: 201 });
  }

  if (method === "GET" && path.join("/") === "tasks") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const tasks = await listStoredTasks(userToStoreUser(user));
    return Response.json({ tasks });
  }

  if (method === "GET" && path.join("/") === "scenarios") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const scenarios = await listStoredScenarios(userToStoreUser(user));
    return Response.json({ scenarios });
  }

  // 024 T1 · FR-554：通知列表(本人可见，新→旧，cap100)。
  if (method === "GET" && path.join("/") === "notifications") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const notifications = await listNotifications(userToStoreUser(user));
    return Response.json({ notifications });
  }

  // 024 T1 · FR-554：未读计数(本人可见)。
  if (method === "GET" && path.join("/") === "notifications/unread-count") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const count = await unreadNotificationCount(userToStoreUser(user));
    return Response.json({ count });
  }

  // 024 T1 · FR-554：标已读(只标本人可见的，越权标他人 0 生效，权限正交在 store 层 markNotificationsRead 内冻)。
  if (method === "POST" && path.join("/") === "notifications/mark-read") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const body = await request.json().catch(() => ({}));
    const marked = await markNotificationsRead(userToStoreUser(user), {
      ids: arrayOfStrings(body.ids),
      all: body.all === true
    });
    return Response.json({ marked });
  }

  if (method === "GET" && path[0] === "scenarios" && path[1] && path[2] === "workbench") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const workbench = await getStoredScenarioWorkbench(userToStoreUser(user), path[1]);
    if (!workbench) {
      return Response.json({ error: "not_found", message: "没有找到这个场景，或当前账号没有访问权限。" }, { status: 404 });
    }
    return Response.json({
      scenario: workbench.scenario,
      template: workbench.template,
      surface: workbench.surface,
      tasks: workbench.tasks,
      knowledge_objects: workbench.knowledgeObjects
    });
  }

  if (method === "GET" && path[0] === "scenarios" && path[1] && path[2] === "sessions" && !path[3]) {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const sessions = await listScenarioChatSessions(userToStoreUser(user), path[1]);
    return Response.json({ sessions });
  }

  if (method === "POST" && path[0] === "scenarios" && path[1] && path[2] === "sessions" && !path[3]) {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const body = await request.json().catch(() => ({}));
    const session = await createScenarioChatSession(userToStoreUser(user), {
      scenarioId: path[1],
      query: typeof body.query === "string" ? body.query : undefined
    });
    if (!session) {
      return Response.json({ error: "not_found", message: "没有找到这个场景，或当前账号没有访问权限。" }, { status: 404 });
    }
    return Response.json({ session }, { status: 201 });
  }

  if (method === "GET" && path[0] === "scenarios" && path[1] && path[2] === "sessions" && path[3]) {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const session = await getScenarioChatSession(userToStoreUser(user), { scenarioId: path[1], sessionId: path[3] });
    if (!session) {
      return Response.json({ error: "not_found", message: "没有找到这条场景会话。" }, { status: 404 });
    }
    return Response.json({ session });
  }

  if (method === "POST" && path[0] === "scenarios" && path[1] && path[2] === "sessions" && path[3] && path[4] === "messages") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const body = await request.json().catch(() => ({}));
    const session = await appendScenarioChatMessage(userToStoreUser(user), {
      scenarioId: path[1],
      sessionId: path[3],
      query: String(body.query ?? "")
    });
    if (!session) {
      return Response.json({ error: "not_found", message: "没有找到这条场景会话，或问题为空。" }, { status: 404 });
    }
    return Response.json({ session });
  }

  if (method === "POST" && path[0] === "scenarios" && path[1] && path[2] === "ask") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const body = await request.json().catch(() => ({}));
    const query = String(body.query ?? "");
    const answer = await askStoredScenarioKnowledge(userToStoreUser(user), { scenarioId: path[1], query });
    if (!answer) {
      return Response.json({ error: "not_found", message: "没有找到可提问的场景或问题为空。" }, { status: 404 });
    }
    return Response.json(answer);
  }

  // 场景资料变更申请（申请更新 / 申请删除）→ 创建真实任务进入处理管线
  if (method === "POST" && path[0] === "scenarios" && path[1] && path[2] === "data-request") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const body = await request.json().catch(() => ({}));
    const result = await createScenarioDataRequest(userToStoreUser(user), {
      scenarioId: path[1],
      action: body.action === "delete" ? "delete" : "update"
    });
    return Response.json(result, { status: result.ok ? 201 : 404 });
  }

  // 终端用户对一次问答点赞/点踩 → 写入对应 trace(差评进后台待改进队列)
  if (method === "POST" && path[0] === "traces" && path[1] && path[2] === "feedback") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const body = await request.json().catch(() => ({}));
    const result = await setTraceFeedback(userToStoreUser(user), {
      traceId: path[1],
      vote: body.vote === "up" ? "up" : "down",
      note: typeof body.note === "string" ? body.note : undefined
    });
    return Response.json(result, { status: result.ok ? 200 : 404 });
  }

  // 图谱型可编辑工作台:列源 / 详情 / 合并 / 编辑 / 删除实体 / 删除关系(全部真改 LightRAG)
  if (method === "GET" && path.join("/") === "admin/graph-curation/sources") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = requireAdminCurationUser(userToStoreUser(user));
    if (storeUser instanceof Response) return storeUser;
    const sources = await listGraphCurationSources(storeUser);
    return Response.json({ sources });
  }
  if (method === "GET" && path.join("/") === "admin/graph-curation/detail") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = requireAdminCurationUser(userToStoreUser(user));
    if (storeUser instanceof Response) return storeUser;
    const sourceId = new URL(request.url).searchParams.get("sourceId") ?? "";
    const detail = await getGraphCurationDetail(storeUser, sourceId);
    return detail ? Response.json(detail) : Response.json({ error: "未找到图谱源" }, { status: 404 });
  }
  if (method === "POST" && path.join("/") === "admin/graph-curation/merge") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = requireAdminCurationUser(userToStoreUser(user));
    if (storeUser instanceof Response) return storeUser;
    const body = await request.json().catch(() => ({}));
    const result = await mergeGraphCurationEntities(storeUser, { sourceId: body.sourceId, sourceEntities: body.sourceEntities ?? [], targetEntity: body.targetEntity });
    return Response.json(result);
  }
  if (method === "POST" && path.join("/") === "admin/graph-curation/entity/edit") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = requireAdminCurationUser(userToStoreUser(user));
    if (storeUser instanceof Response) return storeUser;
    const body = await request.json().catch(() => ({}));
    const result = await editGraphCurationEntity(storeUser, body);
    return Response.json(result);
  }
  if (method === "POST" && path.join("/") === "admin/graph-curation/entity/delete") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = requireAdminCurationUser(userToStoreUser(user));
    if (storeUser instanceof Response) return storeUser;
    const body = await request.json().catch(() => ({}));
    const result = await deleteGraphCurationEntity(storeUser, body);
    return Response.json(result);
  }
  if (method === "POST" && path.join("/") === "admin/graph-curation/relation/delete") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = requireAdminCurationUser(userToStoreUser(user));
    if (storeUser instanceof Response) return storeUser;
    const body = await request.json().catch(() => ({}));
    const result = await deleteGraphCurationRelation(storeUser, body);
    return Response.json(result);
  }
  if (method === "POST" && path.join("/") === "admin/graph-curation/entity/create") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = requireAdminCurationUser(userToStoreUser(user));
    if (storeUser instanceof Response) return storeUser;
    const body = await request.json().catch(() => ({}));
    const result = await createGraphCurationEntity(storeUser, { sourceId: body.sourceId, entityName: body.entityName, entityType: body.entityType, description: body.description });
    return Response.json(result);
  }
  if (method === "POST" && path.join("/") === "admin/graph-curation/relation/create") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = requireAdminCurationUser(userToStoreUser(user));
    if (storeUser instanceof Response) return storeUser;
    const body = await request.json().catch(() => ({}));
    const result = await createGraphCurationRelation(storeUser, { sourceId: body.sourceId, sourceEntity: body.sourceEntity, targetEntity: body.targetEntity, description: body.description, keywords: body.keywords, weight: body.weight });
    return Response.json(result);
  }
  if (method === "POST" && path.join("/") === "admin/graph-curation/source/delete") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = requireAdminCurationUser(userToStoreUser(user));
    if (storeUser instanceof Response) return storeUser;
    const body = await request.json().catch(() => ({}));
    const result = await deleteGraphCurationSource(storeUser, { sourceId: body.sourceId });
    return Response.json(result);
  }

  // 文档型:列 chunk / 删 chunk(真改 traditional_chunks)
  if (method === "GET" && path.join("/") === "admin/doc-curation/chunks") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = requireAdminCurationUser(userToStoreUser(user));
    if (storeUser instanceof Response) return storeUser;
    const documentId = new URL(request.url).searchParams.get("documentId") ?? "";
    const chunks = await getDocumentChunks(storeUser, documentId);
    return Response.json({ chunks });
  }
  if (method === "POST" && path.join("/") === "admin/doc-curation/chunk/delete") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = requireAdminCurationUser(userToStoreUser(user));
    if (storeUser instanceof Response) return storeUser;
    const body = await request.json().catch(() => ({}));
    const result = await deleteDocumentChunk(storeUser, body);
    return Response.json(result);
  }
  // 知识页型:列页面 / 编辑页面(真改 nano pages + 重索引)
  if (method === "GET" && path.join("/") === "admin/page-curation/pages") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = requireAdminCurationUser(userToStoreUser(user));
    if (storeUser instanceof Response) return storeUser;
    const bucketId = new URL(request.url).searchParams.get("bucketId") ?? "";
    if (!bucketId) return Response.json({ pages: [] });
    const pages = await listGbrainPages(storeUser, bucketId);
    return Response.json({ pages });
  }
  if (method === "POST" && path.join("/") === "admin/page-curation/page/edit") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = requireAdminCurationUser(userToStoreUser(user));
    if (storeUser instanceof Response) return storeUser;
    const body = await request.json().catch(() => ({}));
    const result = await editGbrainPage(storeUser, body);
    return Response.json(result);
  }

  if (method === "GET" && path.join("/") === "chat-sessions") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const sessions = await listGlobalChatSessions(userToStoreUser(user));
    return Response.json({ sessions });
  }

  if (method === "POST" && path.join("/") === "chat-sessions") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const body = await request.json().catch(() => ({}));
    const query = typeof body.query === "string" ? body.query : undefined;
    const scope = globalScopeField(body.scope);
    const token = getRequestSessionToken(request);

    // P52 §三 D-5/§六阶段4（转正）：agent-gateway 是默认（唯一）全域问答架构。显式 kill switch
    // （GLOBAL_QA_EMERGENCY_LEGACY=on）才走 legacy 建会话——这是唯一合法的 legacy 建会话入口。
    if (isEmergencyLegacy()) {
      const session = await createGlobalChatSession(userToStoreUser(user), { query, scope });
      return Response.json({ session }, { status: 201 });
    }

    // 非 emergency：唯一路径是 agent-gateway。失败一律显式错误（AC-转正无静默），不再静默退 legacy。
    if (!isPlatformIdentityToken(token)) {
      return Response.json(
        { error: "unauthorized", message: "创建全域问答会话需要有效身份，请重新登录后重试。" },
        { status: 401 }
      );
    }
    const conversationId = await createGlobalAgentConversation(token!, { scope });
    if (!conversationId) {
      return Response.json(
        { error: "gateway_unavailable", message: "Agent 服务暂时不可用，请稍后重试。" },
        { status: 503 }
      );
    }
    try {
      const session = await createGlobalChatSession(userToStoreUser(user), {
        query,
        scope,
        threadId: conversationId,
        architectureVersion: "agent-gateway"
      });
      return Response.json({ session }, { status: 201 });
    } catch (error) {
      // platform 建会话失败 → best-effort 回收孤儿 agent 会话（失败仅日志，不阻断响应；错误继续冒泡为显式错误）。
      await deleteAgentConversationBestEffort(token!, conversationId);
      throw error;
    }
  }

  if (method === "GET" && path[0] === "chat-sessions" && path[1]) {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const session = await getGlobalChatSession(userToStoreUser(user), path[1]);
    if (!session) {
      return Response.json({ error: "not_found", message: "没有找到这条会话。" }, { status: 404 });
    }
    return Response.json({ session });
  }

  if (method === "PATCH" && path[0] === "chat-sessions" && path[1] && !path[2]) {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const body = await request.json().catch(() => ({}));
    const summary = await renameGlobalChatSession(userToStoreUser(user), {
      sessionId: path[1],
      title: String(body.title ?? "")
    });
    if (!summary) {
      return Response.json({ error: "not_found", message: "没有找到这条会话，或标题为空。" }, { status: 404 });
    }
    return Response.json({ session: summary });
  }

  if (method === "DELETE" && path[0] === "chat-sessions" && path[1] && !path[2]) {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    const session = await getGlobalChatSession(storeUser, path[1]);
    if (!session) {
      return Response.json({ error: "not_found", message: "没有找到这条会话。" }, { status: 404 });
    }
    const token = getRequestSessionToken(request);
    if (session.architectureVersion === "agent-gateway") {
      if (!session.threadId || !isPlatformIdentityToken(token) || !(await getAgentConversationForOwnerPreflight(token!, session.threadId))) {
        return Response.json({ error: "not_found", message: "没有找到这条会话。" }, { status: 404 });
      }
    }
    const result = await deleteGlobalChatSession(storeUser, path[1]);
    if (!result.ok) {
      return Response.json({ error: "not_found", message: "没有找到这条会话。" }, { status: 404 });
    }
    // 回滚窗口铁律：网关删除只按 architectureVersion 判定，不用 canUseAgentGateway——
    // 已建的新架构会话即使 env 已切回 legacy，其 agent thread 仍必须清理（best-effort，失败仅日志，不阻断响应）。
    if (result.architectureVersion === "agent-gateway" && result.threadId) {
      // 只有真 ff_ 身份 token 才转发给 gateway（降级 token 会被 gateway 401，无意义调用徒增孤儿日志噪音）。
      if (isPlatformIdentityToken(token)) {
        await deleteAgentConversationBestEffort(token!, result.threadId);
      }
    }
    return Response.json({ ok: true });
  }

  if (method === "POST" && path[0] === "chat-sessions" && path[1] && path[2] === "messages") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    const body = await request.json().catch(() => ({}));
    const query = String(body.query ?? "");
    if (!query.trim()) {
      return Response.json({ error: "not_found", message: "没有找到这条会话，或问题为空。" }, { status: 404 });
    }

    // P52 §三 D-5/§六阶段4（转正）：追问按会话自身 architectureVersion 分流——旧 legacy 会话兼容 append；
    // 新 agent-gateway 会话唯一路径是 relay，失败显式错误（AC-转正无静默），不再静默退 legacy append。
    const existingSession = await getGlobalChatSession(storeUser, path[1]);
    if (!existingSession) {
      return Response.json({ error: "not_found", message: "没有找到这条会话，或问题为空。" }, { status: 404 });
    }
    const token = getRequestSessionToken(request);

    if (existingSession.architectureVersion === "agent-gateway") {
      // AC-回滚：既有 agent-gateway 会话追问不看 isEmergencyLegacy，只看 threadId+真 token——即使
      // kill switch 切回 legacy，老会话仍必须能继续 relay 追问/补落（不因运维应急开关而失去访问）。
      if (existingSession.threadId && isPlatformIdentityToken(token)) {
        return relayAgentTurn(storeUser, {
          sessionId: existingSession.id,
          threadId: existingSession.threadId,
          query,
          idempotencyKey: resolveIdempotencyKey(body),
          token: token!,
          startedAtMs: Date.now()
        });
      }
      // codex 必修 #5：非真 token 是身份问题，应 401（提示重新登录），不该伪装成可重试的 gateway 故障（503）；
      // 建会话路径（上方 POST /chat-sessions）已正确区分 401/503，追问要一致。
      if (!isPlatformIdentityToken(token)) {
        return Response.json(
          { error: "unauthorized", message: "该会话需要有效身份才能继续，请重新登录后重试。" },
          { status: 401 }
        );
      }
      // 到这说明真 token 但 threadId 缺失——agent-gateway 会话理应有 threadId，属数据完整性异常（罕见）。
      return Response.json(
        { error: "gateway_unavailable", message: "该会话状态异常，请稍后重试。" },
        { status: 503 }
      );
    }

    // legacy 老会话：兼容路径，保持 append（D-5：不删 legacy）。
    const session = await appendGlobalChatMessage(storeUser, {
      sessionId: path[1],
      query
    });
    if (!session) {
      return Response.json({ error: "not_found", message: "没有找到这条会话，或问题为空。" }, { status: 404 });
    }
    return Response.json({ session });
  }

  if (method === "GET" && path.join("/") === "knowledge-objects") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const knowledgeObjects = await listStoredKnowledgeObjects(userToStoreUser(user));
    return Response.json({ knowledge_objects: knowledgeObjects });
  }

  if (method === "GET" && path[0] === "admin" && path[1] === "files" && path[2] && path[3] === "preview") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const preview = await getStoredFilePreview(storeUser, path[2]);
    if (!preview) {
      return Response.json({ error: "not_found", message: "原始文件不可用，可能已经按入库策略清理。" }, { status: 404 });
    }
    return new Response(toArrayBuffer(preview.bytes), {
      headers: {
        "Content-Type": previewContentType(preview.file.mimeType, preview.file.originalName),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(preview.file.originalName)}`,
        "Cache-Control": "no-store",
        "X-Original-File-State": preview.file.originalState,
        "X-Retention-Policy": preview.file.retentionPolicy
      }
    });
  }

  if (method === "GET" && path.join("/") === "admin/requests") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const requests = await listAdminIntakeRequests(storeUser);
    return Response.json({ requests });
  }

  if (path[0] === "admin" && path[1] === "templates") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }

    if (method === "GET" && path.length === 2) {
      const templates = await listAdminScenarioTemplates(storeUser);
      return Response.json({ templates });
    }
    if (method === "POST" && path.length === 2) {
      const body = await request.json().catch(() => ({}));
      try {
        const template = await createAdminScenarioTemplate(storeUser, adminTemplateMutationInput(body));
        return Response.json({ template }, { status: 201 });
      } catch (error) {
        return Response.json({ error: "invalid_template", message: error instanceof Error ? error.message : "模板信息不完整。" }, { status: 400 });
      }
    }
    if (method === "PATCH" && path[2]) {
      const body = await request.json().catch(() => ({}));
      const template = await updateAdminScenarioTemplate(storeUser, path[2], adminTemplateMutationInput(body));
      if (!template) return Response.json({ error: "not_found", message: "没有找到这个模板。" }, { status: 404 });
      return Response.json({ template });
    }
    if (method === "DELETE" && path[2]) {
      const result = await deleteAdminScenarioTemplate(storeUser, path[2]);
      if (result.ok) return Response.json({ ok: true });
      if (result.reason === "official_locked") {
        return Response.json({ error: "official_locked", message: "官方模板不允许硬删除，可以暂停或归档。" }, { status: 409 });
      }
      return Response.json({ error: result.reason, message: "没有找到这个模板。" }, { status: result.reason === "forbidden" ? 403 : 404 });
    }
  }

  if (method === "GET" && path.join("/") === "admin/dashboard") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const dashboard = await getAdminDashboardSnapshot(storeUser);
    return Response.json({ dashboard });
  }

  if (method === "GET" && path.join("/") === "admin/llm-usage") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const usage = await aggregateLlmUsage(storeUser);
    return Response.json({ usage });
  }

  if (method === "GET" && path.join("/") === "admin/settings") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const settings = await getAdminIntegrationSettings(storeUser);
    return Response.json({ settings });
  }

  if (method === "POST" && path.join("/") === "admin/integrations/test") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const target = String(body.target ?? "");
    const allowed = ["agent", "embedding", "rerank", "nano-brain", "traditional-rag", "graph-rag"];
    if (!allowed.includes(target)) {
      return Response.json({ error: "bad_request", message: "未知探活目标。" }, { status: 400 });
    }
    const result = await probeIntegration(storeUser, target);
    return Response.json({ result });
  }

  if (method === "POST" && path.join("/") === "admin/runtime-config") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    try {
      const settings = await updateRuntimeConfig(storeUser, body);
      return Response.json({ settings });
    } catch (error) {
      return Response.json(
        { error: "invalid_runtime_config", message: error instanceof Error ? error.message : "运行策略配置无效。" },
        { status: 400 }
      );
    }
  }

  if (method === "POST" && path.join("/") === "admin/engine-retrieval-config") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    try {
      const settings = await updateEngineRetrievalConfig(storeUser, body);
      return Response.json({ settings });
    } catch (error) {
      return Response.json(
        { error: "invalid_engine_retrieval_config", message: error instanceof Error ? error.message : "引擎检索配置无效。" },
        { status: 400 }
      );
    }
  }

  if (method === "GET" && path.join("/") === "admin/audit") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const events = await listAdminAuditEvents(storeUser);
    return Response.json({ events });
  }

  // 022b T2 · 持久摄取队列可观测（AM-2210）：各态计数 + 逐 job attempts/lastError。
  if (method === "GET" && path.join("/") === "admin/ingest-queue") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const queue = await listIngestQueue(storeUser);
    return Response.json({ queue });
  }

  if (method === "GET" && path.join("/") === "admin/knowledge-assets") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const url = new URL(request.url);
    const assets = await listAdminKnowledgeAssetDetails(storeUser, {
      engine: adminEngineField(url.searchParams.get("engine")),
      kind: assetKindField(url.searchParams.get("kind"))
    });
    return Response.json({ assets });
  }

  // 018 T3 · 人工编辑源级描述卡：保存后 origin 强制 manual(人工优先，AM-1815)+ 清 staleHint +
  // 记 curation audit(AM-1817)。内容不完整（无半卡，AM-1801 同规则）或场景不存在 → 400。
  if (method === "PATCH" && path[0] === "admin" && path[1] === "scenarios" && path[2] && path[3] === "description-card") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const scenario = await updateScenarioDescriptionCard(storeUser, {
      scenarioId: path[2],
      summaryScope: String(body.summary_scope ?? body.summaryScope ?? ""),
      typicalQuestions: arrayOfStrings(body.typical_questions ?? body.typicalQuestions) ?? [],
      entityHints: arrayOfStrings(body.entity_hints ?? body.entityHints)
    });
    if (!scenario) {
      return Response.json(
        { error: "invalid_card", message: "描述卡内容不完整（说明范围必填，典型问题需 3~5 条）或场景不存在。" },
        { status: 400 }
      );
    }
    return Response.json({ scenario });
  }

  // 召回验证 / 运行检索 / 运行路径查询 / 图谱·关系复核 / 引用抽检 / 发布复核：对真实引擎跑一次真实检索
  if (method === "POST" && path.join("/") === "admin/recall-verify") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const engine = adminEngineField(body.engine) ?? "Naive RAG";
    const result = await adminEngineRecallVerify(storeUser, {
      engine,
      query: typeof body.query === "string" ? body.query : undefined
    });
    return Response.json(result);
  }

  // 导出资产表：真实知识对象 → CSV
  if (method === "GET" && path.join("/") === "admin/knowledge-assets/export") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const url = new URL(request.url);
    const csv = await adminExportKnowledgeAssetsCsv(storeUser, { engine: adminEngineField(url.searchParams.get("engine")) });
    return new Response("﻿" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename*=UTF-8''knowledge-assets.csv",
        "Cache-Control": "no-store"
      }
    });
  }

  // 批量复核：把待确认请求一次性真实入库发布
  if (method === "POST" && path.join("/") === "admin/batch-review") {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const result = await adminBatchReviewRequests(storeUser, { engine: adminEngineField(body.engine) });
    return Response.json(result);
  }

  if (method === "PATCH" && path[0] === "admin" && path[1] === "requests" && path[2]) {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const storeUser = userToStoreUser(user);
    if (storeUser.role !== "admin") {
      return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const updated = await decideAdminIntakeRequest(storeUser, {
      requestId: path[2],
      action: body.action === "reject" ? "reject" : "approve",
      selectedMode: ragModeField(body.selected_mode ?? body.selectedMode),
      selectedEngine: adminEngineField(body.selected_engine ?? body.selectedEngine),
      strategyParameters: strategyParametersField(body.strategy_parameters ?? body.strategyParameters),
      reason: typeof body.reason === "string" ? body.reason : undefined
    });
    if (!updated) {
      return Response.json({ error: "not_found", message: "没有找到这条资料处理请求。" }, { status: 404 });
    }
    return Response.json({ request: updated, sourceIds: updated.sourceIds ?? [], naiveReplicaStats: updated.naiveReplicaStats });
  }

  return null;
}

async function handleAuthRoute(request: Request, method: string, path: string[]) {
  if (method === "GET" && path[1] === "registration-teams") {
    try {
      return Response.json({ teams: await listRegistrationTeams() });
    } catch (error) {
      const status = error instanceof RegistrationError ? error.status : 502;
      return Response.json(
        {
          error: "identity_unavailable",
          message: "身份服务暂时不可用",
        },
        { status },
      );
    }
  }

  if (method === "POST" && path[1] === "register") {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { error: "invalid_input", message: "注册请求体必须是有效 JSON 对象" },
        { status: 400 },
      );
    }
    for (const field of ["organization_id", "team_ids", "is_admin"]) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        return Response.json(
          { error: "invalid_input", message: `注册请求不允许字段 ${field}` },
          { status: 400 },
        );
      }
    }
    if (
      body.team_id !== undefined
      && body.team_id !== null
      && typeof body.team_id !== "string"
    ) {
      return Response.json(
        { error: "invalid_input", message: "team_id 必须是字符串" },
        { status: 400 },
      );
    }
    try {
      const user = await registerUser({
        username: String(body.username ?? ""),
        password: String(body.password ?? ""),
        displayName: typeof body.display_name === "string" ? body.display_name : undefined,
        teamId: typeof body.team_id === "string" && body.team_id.trim()
          ? body.team_id.trim()
          : undefined,
        role: "member",
      });
      return Response.json({ user }, { status: 201 });
    } catch (error) {
      if (error instanceof RegistrationError) {
        return Response.json(
          {
            error: error.code,
            message: error.message,
          },
          { status: error.status },
        );
      }
      return Response.json({ error: "invalid_register", message: error instanceof Error ? error.message : "注册失败" }, { status: 400 });
    }
  }

  if (method === "POST" && path[1] === "login") {
    const body = await request.json().catch(() => ({}));
    const session = await authenticateUser({ username: String(body.username ?? ""), password: String(body.password ?? "") });
    if (!session) {
      return Response.json({ error: "invalid_credentials", message: "账号或密码不正确。" }, { status: 401 });
    }
    return Response.json(
      { token: session.token, token_type: "Bearer", user: session.user },
      { headers: { "Set-Cookie": sessionCookie(session.token) } }
    );
  }

  if (method === "GET" && path[1] === "me") {
    const user = await getRequestUser(request);
    if (!user) return Response.json({ error: "unauthorized", message: "请先登录。" }, { status: 401 });
    return Response.json({ user });
  }

  if (method === "POST" && path[1] === "logout") {
    try {
      await revokeSession(getRequestSessionToken(request));
      return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
    } catch (error) {
      const status = error instanceof SessionRevocationError ? error.status : 502;
      return Response.json(
        {
          error: status === 401 ? "unauthorized" : "identity_unavailable",
          message: error instanceof Error ? error.message : "身份服务暂时不可用"
        },
        { status }
      );
    }
  }

  return Response.json({ error: "not_found", message: "没有找到认证接口。" }, { status: 404 });
}

async function requireUser(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "unauthorized", message: "请先登录。" }, { status: 401 });
  return user;
}

function requireAdminCurationUser(user: StoreUser): StoreUser | Response {
  if (user.role === "admin") return user;
  return Response.json({ error: "forbidden", message: "需要管理员权限。" }, { status: 403 });
}

async function parseScenarioSubmission(request: Request): Promise<{
  templateId: string;
  name: string;
  description: string;
  visibility: StoreVisibility;
  processingGoal: string;
  files: StoreUploadFile[];
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return {
      templateId: textField(form, "template_id", "custom-scenario"),
      name: textField(form, "name", "未命名场景"),
      description: textField(form, "description", ""),
      visibility: visibilityField(textField(form, "visibility", "private")),
      processingGoal: textField(form, "processing_goal", ""),
      files: await Promise.all(form.getAll("files").filter((item): item is File => item instanceof File).map(fileToUpload))
    };
  }

  const body = await request.json().catch(() => ({}));
  const uploadedFiles = Array.isArray(body.uploaded_files) ? body.uploaded_files : [];
  return {
    templateId: String(body.template_id ?? body.templateId ?? "custom-scenario"),
    name: String(body.name ?? "未命名场景"),
    description: String(body.description ?? ""),
    visibility: visibilityField(String(body.visibility ?? "private")),
    processingGoal: String(body.processing_goal ?? body.processingGoal ?? ""),
    files: uploadedFiles.map((file: any) => ({
      name: String(file.name ?? "资料.txt"),
      type: typeof file.type === "string" ? file.type : "text/plain",
      bytes: new TextEncoder().encode(String(file.text ?? ""))
    }))
  };
}

function textField(form: FormData, key: string, fallback: string) {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value : fallback;
}

function visibilityField(value: string): StoreVisibility {
  return value === "team" || value === "company" ? value : "private";
}

function ragModeField(value: unknown) {
  return value === "知识百科" || value === "文档证据" || value === "关系图谱" || value === "混合处理" ? value : undefined;
}

function adminEngineField(value: unknown): AdminRagEngine | undefined {
  return value === "Gbrain" || value === "Naive RAG" || value === "GraphRAG" ? value : undefined;
}

function assetKindField(value: unknown): AdminKnowledgeAssetKind | undefined {
  const allowedKinds: AdminKnowledgeAssetKind[] = [
    "wiki",
    "fact",
    "link",
    "source",
    "chunk",
    "embedding",
    "citation",
    "eval",
    "entity",
    "relationship",
    "graph",
    "review"
  ];
  return typeof value === "string" && allowedKinds.includes(value as AdminKnowledgeAssetKind) ? value as AdminKnowledgeAssetKind : undefined;
}

function strategyParametersField(value: unknown): AdminStrategyParameters | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key.trim(), String(entry ?? "").trim()] as const)
      .filter(([key, entry]) => key && entry)
  );
}

function adminTemplateMutationInput(body: any): AdminTemplateMutationInput {
  return {
    id: typeof body.id === "string" ? body.id : undefined,
    name: typeof body.name === "string" ? body.name : undefined,
    category: typeof body.category === "string" ? body.category : undefined,
    state: typeof body.state === "string" ? body.state as AdminTemplateMutationInput["state"] : undefined,
    owner: typeof body.owner === "string" ? body.owner : undefined,
    headline: typeof body.headline === "string" ? body.headline : undefined,
    acceptedFiles: arrayOfStrings(body.accepted_files ?? body.acceptedFiles),
    inputExamples: arrayOfStrings(body.input_examples ?? body.inputExamples),
    outputCapabilities: arrayOfStrings(body.output_capabilities ?? body.outputCapabilities),
    productForm: arrayOfStrings(body.product_form ?? body.productForm) as AdminTemplateMutationInput["productForm"],
    reviewRequirement: typeof (body.review_requirement ?? body.reviewRequirement) === "string"
      ? body.review_requirement ?? body.reviewRequirement
      : undefined,
    evidenceSources: arrayOfStrings(body.evidence_sources ?? body.evidenceSources)
  };
}

function arrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function globalScopeField(value: unknown): GlobalChatScope | undefined {
  return value === "private" || value === "team" || value === "company" ? value : undefined;
}

async function fileToUpload(file: File): Promise<StoreUploadFile> {
  return {
    name: file.name,
    type: file.type,
    bytes: new Uint8Array(await file.arrayBuffer())
  };
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function previewContentType(mimeType: string, fileName: string) {
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "csv") return "text/csv; charset=utf-8";
  if (extension === "md" || extension === "markdown") return "text/markdown; charset=utf-8";
  if (extension === "json") return "application/json; charset=utf-8";
  if (extension === "txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}
