const hopByHopHeaders = new Set([
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

type ProxyContext = {
  params: Promise<{ path?: string[] }>;
};

function buildTargetUrl(baseUrl: string, pathSegments: string[], requestUrl: string): string {
  const sourceUrl = new URL(requestUrl);
  const encodedPath = pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
  return `${baseUrl.replace(/\/+$/, "")}/${encodedPath}${sourceUrl.search}`;
}
function forwardHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  for (const header of hopByHopHeaders) headers.delete(header);
  return headers;
}

export async function proxyToUpstream(request: Request, context: ProxyContext, baseUrl: string): Promise<Response> {
  const { path = [] } = await context.params;
  const method = request.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: forwardHeaders(request),
    body: hasBody ? request.body : undefined,
    cache: "no-store",
    redirect: "manual",
    duplex: hasBody ? "half" : undefined,
  };

  try {
    const upstream = await fetch(buildTargetUrl(baseUrl, path, request.url), init);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("access-control-allow-origin");
    responseHeaders.delete("access-control-allow-credentials");
    responseHeaders.delete("access-control-allow-headers");
    responseHeaders.delete("access-control-allow-methods");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: "upstream_unavailable", message: "本地服务暂时不可用，请确认对应进程已启动。" },
      { status: 502 },
    );
  }
}
