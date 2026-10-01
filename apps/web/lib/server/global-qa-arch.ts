import { isPlatformIdentityToken } from "./auth-store";

// P52 §三 D-5/§六阶段4：转正——agent-gateway 是默认（唯一）全域问答架构。显式 kill switch
// （GLOBAL_QA_EMERGENCY_LEGACY=on）才回退 legacy，非静默 fallback（AC-转正无静默）。
export function isEmergencyLegacy(): boolean {
  return process.env.GLOBAL_QA_EMERGENCY_LEGACY === "on";
}

// P36d 阶段1b-2a 定义 → P52 阶段4 转正翻转默认：非 emergency 恒 'agent-gateway'。
export function readGlobalQaArch(): "legacy" | "agent-gateway" {
  return isEmergencyLegacy() ? "legacy" : "agent-gateway";
}

// env 开新架构 + 真 ff_ 身份 token 才允许走 agent-gateway；本地降级 token（勘察5 边界）一律退 legacy。
export function canUseAgentGateway(token: string | null | undefined): boolean {
  return readGlobalQaArch() === "agent-gateway" && isPlatformIdentityToken(token);
}

// 服务端直连 gateway 的 base URL。与服务端代理 apps/web/app/api/agent/[...path]/route.ts 完全一致的解析链：
// lib/api.ts 的 agentGatewayBaseUrl 默认是浏览器相对路径 /api/agent（走 web 自身代理），服务端 fetch 相对
// URL 无 origin 会失败——服务端建/删 agent 会话必须用内网绝对地址，不能复用 agentApi.*。
// P36d 阶段1b-2b-β：export 供 global-qa-relay.ts 复用（追问 relay 同样需要服务端绝对内网地址）。
export function agentGatewayServerBaseUrl(): string {
  return (
    process.env.AGENT_GATEWAY_INTERNAL_BASE_URL ??
    process.env.NEXT_PUBLIC_AGENT_GATEWAY_BASE_URL ??
    "http://localhost:3002"
  );
}

// D1 agent-first 建会话：服务端直连 gateway 建 global profile agent conversation，metadata 平铺存 scope。
// 成功返回 conversation.id（= threadId），非 2xx / 抛错 / 结构异常一律返回 null（吞错，调用方据此退 legacy）。
export async function createGlobalAgentConversation(
  token: string,
  metadata: { scope?: string }
): Promise<string | null> {
  try {
    const res = await fetch(`${agentGatewayServerBaseUrl()}/agent/conversations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ active_module: "global", metadata })
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { conversation?: { id?: string } };
    return data.conversation?.id ?? null;
  } catch {
    return null;
  }
}

// 建会话补偿：platform 建会话失败时 best-effort 回收已建的孤儿 agent 会话；失败仅日志，不抛不阻断。
export async function deleteAgentConversationBestEffort(token: string, conversationId: string): Promise<void> {
  try {
    const res = await fetch(`${agentGatewayServerBaseUrl()}/agent/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    // 非 2xx（401/403/500 等）不进 catch：显式记录 conversationId+status（不记 token），否则孤儿会静默残留。
    if (!res.ok) {
      console.error(`[chat-sessions] 回收孤儿 agent 会话非 2xx: conversationId=${conversationId} status=${res.status}`);
    }
  } catch (error) {
    console.error(`[chat-sessions] 回收孤儿 agent 会话失败 conversationId=${conversationId}`, error);
  }
}

/** Owner-only Gateway detail doubles as the delete orchestration preflight. */
export async function getAgentConversationForOwnerPreflight(token: string, conversationId: string): Promise<boolean> {
  try {
    const res = await fetch(`${agentGatewayServerBaseUrl()}/agent/conversations/${encodeURIComponent(conversationId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.ok;
  } catch {
    return false;
  }
}
