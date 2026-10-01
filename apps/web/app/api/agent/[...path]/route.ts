import { proxyToUpstream } from "../../_proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const agentBaseUrl =
  process.env.AGENT_GATEWAY_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_AGENT_GATEWAY_BASE_URL ?? "http://localhost:3002";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function proxy(request: Request, context: RouteContext) {
  return proxyToUpstream(request, context, agentBaseUrl);
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
