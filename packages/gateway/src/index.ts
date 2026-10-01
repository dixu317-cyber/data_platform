import type { HealthResponse, ModuleId, UserContext } from '@ff/contracts';

export type RegisteredModule = {
  id: ModuleId;
  name: string;
  httpBaseUrl?: string;
  mcpCommand?: string;
  mcpEnvTokenName?: string;
};

export type GatewayJsonResponse<T = unknown> = {
  status: number;
  body: T;
  headers: Record<string, string>;
};

export type ModuleHttpRequest = {
  method: string;
  path: string;
  queryString?: string;
  body?: unknown;
  rawBody?: BodyInit;
  contentType?: string;
  user: UserContext;
};

const INTERNAL_TOKEN_ENV = 'RAG_INTERNAL_TOKEN';

const moduleDefaults: Record<ModuleId, Omit<RegisteredModule, 'httpBaseUrl'>> = {
  'nano-brain': {
    id: 'nano-brain',
    name: 'Nano Brain',
    mcpCommand: 'bun --cwd modules/nano-brain mcp',
    mcpEnvTokenName: 'NANO_BRAIN_MCP_TOKEN',
  },
  'traditional-rag': {
    id: 'traditional-rag',
    name: 'Traditional RAG',
    mcpCommand: 'uv run --project modules/traditional-rag python -m traditional_rag.mcp.server',
    mcpEnvTokenName: 'TRADITIONAL_RAG_MCP_TOKEN',
  },
  'graph-rag': {
    id: 'graph-rag',
    name: 'GraphRAG',
    mcpCommand: 'uv run --project modules/graph-rag python -m graph_rag.mcp.server',
    mcpEnvTokenName: 'GRAPH_RAG_MCP_TOKEN',
  },
};

const moduleHttpUrlEnv: Record<ModuleId, string> = {
  'nano-brain': 'NANO_BRAIN_HTTP_URL',
  'traditional-rag': 'TRADITIONAL_RAG_HTTP_URL',
  'graph-rag': 'GRAPH_RAG_HTTP_URL',
};

const moduleDefaultHttpUrl: Record<ModuleId, string> = {
  'nano-brain': 'http://127.0.0.1:8100',
  'traditional-rag': 'http://127.0.0.1:8101',
  'graph-rag': 'http://127.0.0.1:8102',
};

export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid_module' | 'missing_config' | 'module_unavailable' | 'invalid_response',
    public readonly status = 502,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export function getModuleHttpBaseUrl(moduleId: ModuleId): string {
  return process.env[moduleHttpUrlEnv[moduleId]] ?? moduleDefaultHttpUrl[moduleId];
}

export function getRegisteredModules(): RegisteredModule[] {
  return (Object.keys(moduleDefaults) as ModuleId[]).map((id) => ({
    ...moduleDefaults[id],
    httpBaseUrl: getModuleHttpBaseUrl(id),
  }));
}

function getInternalToken(): string {
  const token = process.env[INTERNAL_TOKEN_ENV];
  if (!token) {
    throw new GatewayError(`未配置 ${INTERNAL_TOKEN_ENV}，无法调用模块 HTTP 服务`, 'missing_config', 500);
  }
  return token;
}

function buildModuleUrl(moduleId: ModuleId, path: string, queryString?: string): string {
  const baseUrl = getModuleHttpBaseUrl(moduleId).replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);
  if (queryString) {
    const normalizedQuery = queryString.startsWith('?') ? queryString.slice(1) : queryString;
    url.search = normalizedQuery;
  }
  return url.toString();
}

function buildInternalHeaders(user: UserContext, contentType?: string): Headers {
  const headers = new Headers({
    'x-ff-internal-token': getInternalToken(),
    'x-ff-user-id': user.userId,
    'x-ff-username': user.username,
    'x-ff-is-admin': String(user.isAdmin),
  });
  if (contentType) headers.set('content-type', contentType);
  return headers;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new GatewayError('模块 HTTP 服务返回了非 JSON 响应', 'invalid_response');
  }
}

export async function callModuleJson<T = unknown>(
  moduleId: ModuleId,
  request: ModuleHttpRequest,
): Promise<GatewayJsonResponse<T>> {
  const method = request.method.toUpperCase();
  const canHaveBody = method !== 'GET' && method !== 'HEAD';
  const hasRawBody = request.rawBody !== undefined && canHaveBody;
  const hasJsonBody = request.body !== undefined && canHaveBody && !hasRawBody;
  const response = await fetch(buildModuleUrl(moduleId, request.path, request.queryString), {
    method: request.method,
    headers: buildInternalHeaders(
      request.user,
      hasRawBody ? request.contentType : hasJsonBody ? 'application/json' : undefined,
    ),
    body: hasRawBody ? request.rawBody : hasJsonBody ? JSON.stringify(request.body) : undefined,
  }).catch((error) => {
    throw new GatewayError(`模块 ${moduleId} HTTP 服务不可用：${error instanceof Error ? error.message : String(error)}`, 'module_unavailable');
  });

  return {
    status: response.status,
    body: (await readJsonResponse(response)) as T,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

export async function getModuleHealth(moduleId: ModuleId): Promise<HealthResponse> {
  const response = await fetch(buildModuleUrl(moduleId, '/health')).catch(() => null);
  if (!response) return { status: 'error', service: moduleId };
  const body = await readJsonResponse(response).catch(() => null);
  if (body && typeof body === 'object' && 'status' in body && 'service' in body) {
    return body as HealthResponse;
  }
  return { status: response.ok ? 'ok' : 'error', service: moduleId };
}

export async function initializeModuleUser(moduleId: ModuleId, user: UserContext): Promise<GatewayJsonResponse> {
  // 模块可在用户注册后通过同名内部端点初始化自己的默认私有 workspace/source。
  return callModuleJson(moduleId, {
    method: 'POST',
    path: '/internal/users/default-source',
    user,
    body: {},
  });
}
