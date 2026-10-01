export type ApiErrorBody = {
  error: string;
  message: string;
};

export type User = {
  id: string;
  username: string;
  display_name?: string;
  is_admin: boolean;
  organization_id: string;
  team_ids: string[];
};

export type RegistrationTeam = {
  id: string;
  name: string;
};

export type RegistrationTeamsResponse = {
  teams: RegistrationTeam[];
};

export type LoginResponse = {
  token: string;
  token_type: "Bearer";
  user: User;
};

export type RegisterResponse = {
  user: User;
};

export type HealthResponse = {
  status: string;
  service: string;
};

export type PlatformModule = {
  id: string;
  name: string;
};

export type ModuleHealth = {
  module_id?: string;
  service?: string;
  status: string;
  message?: string;
};

export type NanoSource = {
  id: string;
  name: string;
  kind: "private" | "public";
  owner_user_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type TraditionalSource = {
  id: string;
  name: string;
  description: string;
  kind: "private" | "public";
  owner_user_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type TraditionalDocument = {
  id: string;
  source_id: string;
  original_filename: string;
  file_type: "pdf" | "docx" | "csv" | "xlsx" | "markdown" | "txt";
  status: "uploaded" | "processing" | "ready" | "failed" | "archived" | string;
  content_hash: string | null;
  storage_path: string | null;
  metadata: Record<string, unknown>;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type TraditionalJob = {
  id: string;
  document_id: string | null;
  source_id: string | null;
  status: "uploaded" | "parsing" | "chunking" | "embedding" | "ready" | "failed" | string;
  stage: string;
  error: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type TraditionalChunk = {
  id: string;
  document_id: string;
  source_id: string;
  chunk_index: number;
  chunk_text: string;
  metadata: Record<string, unknown>;
  embedding_model: string;
  embedding_dimensions: number;
  created_at: string;
};

export type TraditionalTable = {
  id: string;
  document_id: string;
  source_id: string;
  table_index: number;
  sheet_name: string;
  columns: Array<{ name: string; type: string; index: number; non_null_count: number }>;
  row_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type TraditionalTableQueryInput = {
  query?: string;
  operation?: "filter" | "sort" | "count" | "sum" | "average" | "min" | "max" | "group";
  aggregate?: "count" | "sum" | "average" | "min" | "max";
  table_id?: string;
  source_id?: string;
  document_id?: string;
  sheet_name?: string;
  column?: string;
  group_by?: string;
  sort_column?: string;
  sort_direction?: "asc" | "desc";
  filters?: Array<{ column: string; op: string; value: unknown }>;
  columns?: string[];
  limit?: number;
};

export type TraditionalTableQueryResponse = {
  table: TraditionalTable;
  result: {
    kind: "rows" | "scalar" | "groups";
    rows?: Array<{ row_index: number; values: Record<string, unknown> }>;
    value?: unknown;
    groups?: Array<{ group: string; value: unknown; row_count: number }>;
    total_matched?: number;
    returned?: number;
    total_groups?: number;
    matched_numeric_rows?: number;
    plan: Record<string, unknown>;
    references: { row_indices: number[]; columns: string[] };
  };
  generated_at: string;
};

export type TraditionalSearchInput = {
  query: string;
  limit?: number;
  source_id?: string;
  document_id?: string;
  file_types?: TraditionalDocument["file_type"][];
};

export type TraditionalSearchResult = {
  chunk: {
    id: string;
    document_id: string;
    source_id: string;
    chunk_index: number;
    text: string;
    snippet: string;
    metadata: Record<string, unknown>;
    embedding_model: string;
    embedding_dimensions: number;
    created_at: string;
  };
  score: number;
  match_types: string[];
  rank_details: Record<string, { rank: number; raw_score?: number }>;
  document: {
    id: string;
    filename: string;
    file_type: TraditionalDocument["file_type"];
    status: string;
    metadata: Record<string, unknown>;
    created_at: string;
  };
  source: {
    id: string;
    name: string;
    kind: "private" | "public";
    owner_user_id: string | null;
  };
  references: {
    segments: unknown[];
    segment_start: number | null;
    segment_end: number | null;
    tables: unknown[];
    images: string[];
    pages: unknown;
  };
};

export type TraditionalSearchResponse = {
  query: string;
  limit: number;
  results: TraditionalSearchResult[];
  diagnostics: Array<Record<string, unknown>>;
  filters: Record<string, unknown>;
  fusion: Record<string, unknown>;
};

export type GraphSource = {
  id: string;
  name: string;
  description: string;
  kind: "private" | "public";
  workspace: string;
  owner_user_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type GraphDocument = {
  id: string;
  source_id: string;
  original_filename: string;
  file_type: "markdown" | "txt" | "text" | string;
  status: "processing" | "ready" | "failed" | "archived" | string;
  content_hash: string | null;
  metadata: Record<string, unknown>;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  content_text?: string;
};

export type GraphSearchMode = "auto" | "local" | "global" | "hybrid" | "naive" | "mix";

export type GraphSearchInput = {
  query: string;
  limit?: number;
  source_id?: string;
  mode?: GraphSearchMode;
  chunk_top_k?: number;
  max_total_tokens?: number;
  enable_rerank?: boolean;
};

export type GraphSearchResult = {
  source_id: string;
  source_name: string;
  source_kind: "private" | "public";
  workspace: string;
  mode: GraphSearchMode | string;
  context: string;
};

export type GraphSearchResponse = {
  query: string;
  limit: number;
  mode: GraphSearchMode | string;
  results: GraphSearchResult[];
  degraded_sources?: string[];
};

export type GraphAskResponse = {
  query: string;
  answer: string;
  citations: unknown[];
  degraded_sources?: string[];
  note: string;
};

export type NanoPage = {
  id: string;
  source_id: string;
  slug: string;
  title: string;
  body: string;
  content_hash: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type NanoChunk = {
  id: string;
  page_id: string;
  source_id: string;
  slug: string;
  chunk_index: number;
  chunk_text: string;
  content_hash: string;
  embedding_model: string;
  embedding_dimensions: number;
  created_at: string;
  updated_at: string;
};

export type NanoSearchResult = {
  chunk_id: string;
  page_id: string;
  source_id: string;
  source_kind: "private" | "public";
  source_name: string;
  slug: string;
  title: string;
  chunk_index: number;
  snippet: string;
  score: number;
  match_types: string[];
};

export type NanoLink = {
  id: string;
  source_id: string;
  from_page_id: string;
  from_slug: string;
  to_source_id: string | null;
  to_slug: string;
  link_type: string;
  context: string | null;
  confidence: number;
  created_by: string;
  created_at: string;
};

export type FactSubmissionStatus = "pending_review" | "needs_changes" | "approved" | "rejected";

export type FactSubmission = {
  id: string;
  target_source_id: string;
  submitted_by: string;
  raw_claim: string;
  raw_evidence_text: string | null;
  raw_evidence_url: string | null;
  raw_context: string | null;
  warnings: unknown[];
  status: FactSubmissionStatus;
  normalized_candidates: unknown[];
  created_at: string;
  updated_at: string;
};

export type NanoFact = {
  id: string;
  source_id: string;
  submission_id: string;
  entity_slug: string | null;
  fact: string;
  kind: string;
  confidence: number;
  notability: string;
  context: string | null;
  valid_from: string | null;
  valid_until: string | null;
  claim_metric: string | null;
  claim_value: number | null;
  claim_unit: string | null;
  claim_period: string | null;
  evidence_url: string | null;
  evidence_quote: string | null;
  approved_by: string;
  approved_at: string;
  submitted_by?: string;
  submission_status?: string;
  created_at: string;
  updated_at: string;
};

export type FactCandidate = {
  entity_slug: string | null;
  fact: string;
  kind: string;
  confidence: number;
  notability: string;
  claim_metric?: string;
  claim_value?: number;
  claim_unit?: string;
  claim_period?: string;
  evidence_quote?: string;
  normalization_confidence: number;
  warnings: unknown[];
};

export type ApprovedFactInput = {
  entity_slug?: string | null;
  fact: string;
  kind: string;
  confidence: number;
  notability: string;
  context?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  claim_metric?: string | null;
  claim_value?: number | null;
  claim_unit?: string | null;
  claim_period?: string | null;
  evidence_url?: string | null;
  evidence_quote?: string | null;
};

export type FactReviewAction = "approve" | "reject" | "request_changes";

export type AuditLog = {
  id: string;
  actor_user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  previous_status: string | null;
  next_status: string | null;
  review_comment: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type FactReviewResult = {
  submission: FactSubmission;
  fact: NanoFact | null;
  audit_log: AuditLog;
};

export type DreamTargetType = "user_source" | "public_source" | "review_queue";

export type DreamTarget = {
  type: DreamTargetType;
  sourceId?: string;
  userId?: string;
  targetSourceId?: string;
};

export type DreamPhase = "extract_links" | "refresh_embeddings" | "health_check" | "review_queue_summary";

export type DreamRunStatus = "pending" | "running" | "clean" | "ok" | "partial" | "skipped" | "failed";

export type DreamPhaseStatus = "pending" | "running" | "clean" | "ok" | "skipped" | "failed";

export type DreamPhaseResult = {
  phase: string;
  status: DreamPhaseStatus | string;
  durationMs: number;
  summary: string;
  details?: Record<string, unknown>;
  error?: Record<string, unknown>;
};

export type DreamReport = {
  schema_version: string;
  run_id: string;
  target: DreamTarget;
  status: DreamRunStatus;
  dry_run: boolean;
  requested_phases: string[];
  started_at: string;
  finished_at: string;
  duration_ms: number;
  phases: DreamPhaseResult[];
  totals: Record<string, unknown>;
};

export type DreamRunSummary = {
  id: string;
  target: DreamTarget;
  triggered_by: string;
  triggered_by_user_id: string | null;
  dry_run: boolean;
  status: DreamRunStatus;
  requested_phases: string[];
  totals: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type DreamLock = {
  id: string;
  target_type: DreamTargetType;
  target_source_id: string | null;
  target_user_id: string | null;
  holder_id: string;
  holder_host: string | null;
  acquired_at: string;
  ttl_expires_at: string;
};

export type DreamStatus = {
  checked_at: string;
  active_locks: DreamLock[];
  recent_runs: DreamRunSummary[];
  recent_failures: DreamRunSummary[];
};

export type AgentModuleId = "nano-brain" | "traditional-rag" | "graph-rag";

export type AgentConversation = {
  id: string;
  user_id: string;
  username?: string;
  active_module: AgentModuleId | string;
  title: string;
  status: string;
  thread_id: string;
  latest_checkpoint_id: string | null;
  checkpoint_bootstrapped_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AgentCheckpointMessage = {
  id: string | null;
  type: string;
  role: "user" | "assistant" | "tool" | "system" | string;
  content: unknown;
  text: string;
  name: string | null;
  tool_call_id: string | null;
  tool_calls: unknown[];
  invalid_tool_calls: unknown[];
  usage_metadata: unknown;
  response_metadata: Record<string, unknown>;
  status: string | null;
  raw: Record<string, unknown>;
};

export type AgentRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type AgentRun = {
  id: string;
  conversation_id: string;
  user_id?: string;
  thread_id: string;
  status: AgentRunStatus;
  provider: string | null;
  model: string | null;
  active_module: string;
  input_message_id: string | null;
  output_message_id: string | null;
  langsmith_run_id: string | null;
  langsmith_trace_id: string | null;
  run_name: string | null;
  tags: unknown[];
  stream_protocol: string | null;
  stream_version: string | null;
  last_event_seq: number;
  latest_checkpoint_id: string | null;
  token_usage: Record<string, unknown>;
  error: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type AgentToolCall = {
  id: string;
  run_id: string;
  conversation_id: string;
  tool_name: string;
  arguments: unknown;
  result_summary: string | null;
  result: unknown;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | string;
  error: unknown;
  sequence: number;
  langchain_tool_call_id: string | null;
  node_name: string | null;
  namespace: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type AgentConversationDetails = {
  conversation: AgentConversation;
  messages: AgentCheckpointMessage[];
  message_source: string;
  checkpoint_id: string | null;
  runs: AgentRun[];
};

export type AgentRunDetails = {
  run: AgentRun;
  tool_calls: AgentToolCall[];
  events: unknown[];
};

export type AgentStreamEventName = "run_started" | "tool_call_started" | "tool_call_finished" | "message_delta" | "message_completed" | "run_completed" | "error";

export type AgentStreamEvent = {
  event: AgentStreamEventName | string;
  data: any;
  id?: string;
};

export type SystemSnapshot = {
  platform: Loadable<HealthResponse>;
  agentGateway: Loadable<HealthResponse>;
  modules: Loadable<PlatformModule[]>;
  moduleHealth: Loadable<ModuleHealth[]>;
};

export type Loadable<T> =
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const defaultPlatformBaseUrl = "/api/platform";
const defaultAgentBaseUrl = "/api/agent";

export const platformBaseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultPlatformBaseUrl);
export const agentGatewayBaseUrl = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_AGENT_GATEWAY_BASE_URL ?? defaultAgentBaseUrl,
);

const getRequestCacheTtlMs = 5_000;
const getRequestCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function getRequestCacheKey(baseUrl: string, path: string, token?: string | null): string {
  return `${baseUrl} ${path} ${token ?? ""}`;
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  input: {
    method?: string;
    token?: string | null;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const method = input.method ?? "GET";
  const isGet = method.toUpperCase() === "GET";

  if (isGet) {
    const key = getRequestCacheKey(baseUrl, path, input.token);
    const cached = getRequestCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.promise as Promise<T>;

    const promise = requestJsonUncached<T>(baseUrl, path, { ...input, method, signal: undefined });
    getRequestCache.set(key, { expiresAt: Date.now() + getRequestCacheTtlMs, promise });
    promise.catch(() => {
      if (getRequestCache.get(key)?.promise === promise) getRequestCache.delete(key);
    });
    return promise;
  }

  const result = await requestJsonUncached<T>(baseUrl, path, { ...input, method });
  getRequestCache.clear();
  return result;
}

async function requestJsonUncached<T>(
  baseUrl: string,
  path: string,
  input: {
    method?: string;
    token?: string | null;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: input.method ?? "GET",
    signal: input.signal,
    headers: {
      Accept: "application/json",
      ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const errorBody = data as (Partial<ApiErrorBody> & { detail?: string | Partial<ApiErrorBody> }) | null;
    const detail = errorBody?.detail;
    const detailObject = typeof detail === "object" && detail !== null ? detail : null;
    throw new ApiClientError(
      response.status,
      errorBody?.error ?? detailObject?.error ?? `http_${response.status}`,
      errorBody?.message ?? detailObject?.message ?? (typeof detail === "string" ? detail : `请求失败：HTTP ${response.status}`),
    );
  }

  return data as T;
}

async function requestFormData<T>(
  baseUrl: string,
  path: string,
  input: {
    token?: string | null;
    body: FormData;
    signal?: AbortSignal;
  },
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    signal: input.signal,
    headers: {
      Accept: "application/json",
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
    },
    body: input.body,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const errorBody = data as (Partial<ApiErrorBody> & { detail?: string | Partial<ApiErrorBody> }) | null;
    const detail = errorBody?.detail;
    const detailObject = typeof detail === "object" && detail !== null ? detail : null;
    throw new ApiClientError(
      response.status,
      errorBody?.error ?? detailObject?.error ?? `http_${response.status}`,
      errorBody?.message ?? detailObject?.message ?? (typeof detail === "string" ? detail : `请求失败：HTTP ${response.status}`),
    );
  }

  return data as T;
}

async function toLoadable<T>(fn: () => Promise<T>): Promise<Loadable<T>> {
  try {
    return { status: "ready", data: await fn() };
  } catch (error) {
    return { status: "error", message: describeApiError(error) };
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().startsWith("signal")))
  );
}

export function describeApiError(error: unknown): string {
  if (isAbortError(error)) return "请求已取消";
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof TypeError) return "无法连接服务，请确认本地进程已启动";
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

export const platformApi = {
  health(signal?: AbortSignal) {
    return requestJson<HealthResponse>(platformBaseUrl, "/health", { signal });
  },
  modules(signal?: AbortSignal) {
    return requestJson<{ modules: PlatformModule[] }>(platformBaseUrl, "/modules", { signal });
  },
  modulesHealth(signal?: AbortSignal) {
    return requestJson<{ modules: ModuleHealth[] }>(platformBaseUrl, "/modules/health", { signal });
  },
  registrationTeams(signal?: AbortSignal) {
    return requestJson<RegistrationTeamsResponse>(
      platformBaseUrl,
      "/auth/registration-teams",
      { signal },
    );
  },
  register(
    input: {
      username: string;
      password: string;
      displayName?: string;
      teamId?: string;
    },
    signal?: AbortSignal,
  ) {
    return requestJson<RegisterResponse>(platformBaseUrl, "/auth/register", {
      method: "POST",
      body: {
        username: input.username,
        password: input.password,
        display_name: input.displayName,
        ...(input.teamId ? { team_id: input.teamId } : {}),
      },
      signal,
    });
  },
  login(input: { username: string; password: string }, signal?: AbortSignal) {
    return requestJson<LoginResponse>(platformBaseUrl, "/auth/login", {
      method: "POST",
      body: input,
      signal,
    });
  },
  me(token?: string | null, signal?: AbortSignal) {
    return requestJson<{ user: User }>(platformBaseUrl, "/auth/me", { token, signal });
  },
  logout(token?: string | null, signal?: AbortSignal) {
    return requestJson<{ ok: boolean }>(platformBaseUrl, "/auth/logout", { method: "POST", token, signal });
  },
  nanoHealth(token: string, signal?: AbortSignal) {
    return requestJson<HealthResponse>(platformBaseUrl, "/nano/health", { token, signal });
  },
};

export const nanoApi = {
  listSources(token: string, signal?: AbortSignal) {
    return requestJson<{ sources: NanoSource[] }>(platformBaseUrl, "/nano/sources", { token, signal });
  },
  getSource(token: string, sourceId: string, signal?: AbortSignal) {
    return requestJson<{ source: NanoSource }>(platformBaseUrl, `/nano/sources/${encodeURIComponent(sourceId)}`, {
      token,
      signal,
    });
  },
  createPublicSource(token: string, input: { name: string }, signal?: AbortSignal) {
    return requestJson<{ source: NanoSource }>(platformBaseUrl, "/nano/sources", {
      method: "POST",
      token,
      body: input,
      signal,
    });
  },
  updateSource(token: string, sourceId: string, input: { name: string }, signal?: AbortSignal) {
    return requestJson<{ source: NanoSource }>(platformBaseUrl, `/nano/sources/${encodeURIComponent(sourceId)}`, {
      method: "PATCH",
      token,
      body: input,
      signal,
    });
  },
  createPage(
    token: string,
    input: { source_id: string; slug: string; title: string; body: string; content_type: "text/markdown" },
    signal?: AbortSignal,
  ) {
    return requestJson<{ page: NanoPage }>(platformBaseUrl, "/nano/pages", {
      method: "POST",
      token,
      body: input,
      signal,
    });
  },
  listPages(token: string, sourceId: string, signal?: AbortSignal) {
    return requestJson<{ pages: NanoPage[] }>(
      platformBaseUrl,
      `/nano/sources/${encodeURIComponent(sourceId)}/pages`,
      { token, signal },
    );
  },
  getPage(token: string, sourceId: string, slug: string, signal?: AbortSignal) {
    return requestJson<{ page: NanoPage }>(
      platformBaseUrl,
      `/nano/pages/${encodeURIComponent(sourceId)}/${encodeURIComponent(slug)}`,
      { token, signal },
    );
  },
  updatePage(
    token: string,
    sourceId: string,
    slug: string,
    input: { title: string; body: string; content_type: "text/markdown" },
    signal?: AbortSignal,
  ) {
    return requestJson<{ page: NanoPage }>(
      platformBaseUrl,
      `/nano/pages/${encodeURIComponent(sourceId)}/${encodeURIComponent(slug)}`,
      { method: "PUT", token, body: input, signal },
    );
  },
  archivePage(token: string, sourceId: string, slug: string, signal?: AbortSignal) {
    return requestJson<{ page: NanoPage; archived: true }>(
      platformBaseUrl,
      `/nano/pages/${encodeURIComponent(sourceId)}/${encodeURIComponent(slug)}`,
      { method: "DELETE", token, signal },
    );
  },
  listChunks(token: string, sourceId: string, slug: string, signal?: AbortSignal) {
    return requestJson<{ chunks: NanoChunk[] }>(
      platformBaseUrl,
      `/nano/pages/${encodeURIComponent(sourceId)}/${encodeURIComponent(slug)}/chunks`,
      { token, signal },
    );
  },
  capture(
    token: string,
    input: {
      text?: string;
      markdown?: string;
      title?: string;
      target: "private" | "public";
      source_id?: string;
      slug?: string;
      format: "text" | "markdown";
    },
    signal?: AbortSignal,
  ) {
    return requestJson<{ capture: { target: string; format: string }; source: NanoSource; page: NanoPage }>(
      platformBaseUrl,
      "/nano/capture",
      { method: "POST", token, body: input, signal },
    );
  },
  search(token: string, input: { query: string; limit?: number }, signal?: AbortSignal) {
    return requestJson<{ query: string; results: NanoSearchResult[] }>(platformBaseUrl, "/nano/search", {
      method: "POST",
      token,
      body: input,
      signal,
    });
  },
  ask(token: string, input: { query: string; limit?: number }, signal?: AbortSignal) {
    return requestJson<{ query: string; answer: string; citations: NanoSearchResult[] }>(platformBaseUrl, "/nano/ask", {
      method: "POST",
      token,
      body: input,
      signal,
    });
  },
  links(token: string, sourceId: string, slug: string, signal?: AbortSignal) {
    return requestJson<{ links: NanoLink[] }>(
      platformBaseUrl,
      `/nano/links/${encodeURIComponent(sourceId)}/${encodeURIComponent(slug)}`,
      { token, signal },
    );
  },
  backlinks(token: string, slug: string, signal?: AbortSignal) {
    return requestJson<{ links: NanoLink[] }>(platformBaseUrl, `/nano/backlinks/${encodeURIComponent(slug)}`, {
      token,
      signal,
    });
  },
  graphQuery(token: string, input: { slug: string; depth: number; direction: "out" | "in" | "both" }, signal?: AbortSignal) {
    return requestJson<{ root_slug: string; depth: number; direction: string; nodes: string[]; links: NanoLink[] }>(
      platformBaseUrl,
      "/nano/graph/query",
      { method: "POST", token, body: input, signal },
    );
  },
  submitFact(
    token: string,
    input: {
      target_source_id: string;
      raw_claim: string;
      raw_evidence_text?: string | null;
      raw_evidence_url?: string | null;
      raw_context?: string | null;
    },
    signal?: AbortSignal,
  ) {
    return requestJson<{ submission: FactSubmission }>(platformBaseUrl, "/nano/fact-submissions", {
      method: "POST",
      token,
      body: input,
      signal,
    });
  },
  listSubmissions(
    token: string,
    input: { status?: FactSubmissionStatus; target_source_id?: string; submitted_by?: string; limit?: number } = {},
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams();
    if (input.status) params.set("status", input.status);
    if (input.target_source_id) params.set("target_source_id", input.target_source_id);
    if (input.submitted_by) params.set("submitted_by", input.submitted_by);
    if (input.limit) params.set("limit", String(input.limit));
    const query = params.toString();
    return requestJson<{ submissions: FactSubmission[] }>(
      platformBaseUrl,
      `/nano/fact-submissions${query ? `?${query}` : ""}`,
      { token, signal },
    );
  },
  getSubmission(token: string, submissionId: string, signal?: AbortSignal) {
    return requestJson<{ submission: FactSubmission }>(
      platformBaseUrl,
      `/nano/fact-submissions/${encodeURIComponent(submissionId)}`,
      { token, signal },
    );
  },
  saveCandidates(
    token: string,
    submissionId: string,
    input: { candidates: unknown[]; generated_by?: string; generator?: string },
    signal?: AbortSignal,
  ) {
    return requestJson<{ submission: FactSubmission }>(
      platformBaseUrl,
      `/nano/fact-submissions/${encodeURIComponent(submissionId)}/candidates`,
      { method: "POST", token, body: input, signal },
    );
  },
  reviewSubmission(
    token: string,
    submissionId: string,
    input: { action: FactReviewAction; approved_fact?: ApprovedFactInput; review_comment?: string | null },
    signal?: AbortSignal,
  ) {
    return requestJson<FactReviewResult>(
      platformBaseUrl,
      `/nano/fact-submissions/${encodeURIComponent(submissionId)}/review`,
      { method: "POST", token, body: input, signal },
    );
  },
  listFacts(token: string, input: { entity_slug?: string; limit?: number } = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (input.entity_slug) params.set("entity_slug", input.entity_slug);
    if (input.limit) params.set("limit", String(input.limit));
    const query = params.toString();
    return requestJson<{ facts: NanoFact[] }>(platformBaseUrl, `/nano/facts${query ? `?${query}` : ""}`, {
      token,
      signal,
    });
  },
  getFact(token: string, factId: string, signal?: AbortSignal) {
    return requestJson<{ fact: NanoFact }>(platformBaseUrl, `/nano/facts/${encodeURIComponent(factId)}`, {
      token,
      signal,
    });
  },
  entityFacts(token: string, entitySlug: string, signal?: AbortSignal) {
    return requestJson<{ facts: NanoFact[] }>(
      platformBaseUrl,
      `/nano/entities/${encodeURIComponent(entitySlug)}/facts`,
      { token, signal },
    );
  },
  runDream(
    token: string,
    input: { target: { type: DreamTargetType; source_id?: string; user_id?: string; target_source_id?: string }; phases?: DreamPhase[]; dry_run?: boolean },
    signal?: AbortSignal,
  ) {
    // G1 后台化：POST 秒回 202 + run 概要（DreamRunSummary，status=running/skipped），非终态 DreamReport；轮询获取终态。
    return requestJson<{ run: DreamRunSummary }>(platformBaseUrl, "/nano/dream/runs", {
      method: "POST",
      token,
      body: input,
      signal,
    });
  },
  listDreamRuns(
    token: string,
    input: { target_type?: DreamTargetType; source_id?: string; status?: DreamRunStatus; limit?: number } = {},
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams();
    if (input.target_type) params.set("target_type", input.target_type);
    if (input.source_id) params.set("source_id", input.source_id);
    if (input.status) params.set("status", input.status);
    if (input.limit) params.set("limit", String(input.limit));
    const query = params.toString();
    return requestJson<{ runs: DreamRunSummary[] }>(
      platformBaseUrl,
      `/nano/dream/runs${query ? `?${query}` : ""}`,
      { token, signal },
    );
  },
  getDreamRun(token: string, runId: string, signal?: AbortSignal) {
    return requestJson<{ run: DreamReport }>(
      platformBaseUrl,
      `/nano/dream/runs/${encodeURIComponent(runId)}`,
      { token, signal },
    );
  },
  dreamStatus(token: string, signal?: AbortSignal) {
    return requestJson<{ status: DreamStatus }>(platformBaseUrl, "/nano/dream/status", { token, signal });
  },
};

export const traditionalApi = {
  listSources(token: string, signal?: AbortSignal) {
    return requestJson<{ sources: TraditionalSource[] }>(platformBaseUrl, "/traditional/sources", { token, signal });
  },
  getSource(token: string, sourceId: string, signal?: AbortSignal) {
    return requestJson<{ source: TraditionalSource }>(
      platformBaseUrl,
      `/traditional/sources/${encodeURIComponent(sourceId)}`,
      { token, signal },
    );
  },
  createSource(
    token: string,
    input: { name: string; kind: "private" | "public"; description?: string },
    signal?: AbortSignal,
  ) {
    return requestJson<{ source: TraditionalSource }>(platformBaseUrl, "/traditional/sources", {
      method: "POST",
      token,
      body: input,
      signal,
    });
  },
  updateSource(
    token: string,
    sourceId: string,
    input: { name?: string; description?: string },
    signal?: AbortSignal,
  ) {
    return requestJson<{ source: TraditionalSource }>(
      platformBaseUrl,
      `/traditional/sources/${encodeURIComponent(sourceId)}`,
      { method: "PATCH", token, body: input, signal },
    );
  },
  uploadDocument(token: string, input: { source_id: string; file: File }, signal?: AbortSignal) {
    const form = new FormData();
    form.set("source_id", input.source_id);
    form.set("file", input.file);
    return requestFormData<{ document: TraditionalDocument; job: TraditionalJob }>(platformBaseUrl, "/traditional/documents", {
      token,
      body: form,
      signal,
    });
  },
  listDocuments(token: string, input: { source_id?: string } = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (input.source_id) params.set("source_id", input.source_id);
    const query = params.toString();
    return requestJson<{ documents: TraditionalDocument[] }>(
      platformBaseUrl,
      `/traditional/documents${query ? `?${query}` : ""}`,
      { token, signal },
    );
  },
  getDocument(token: string, documentId: string, signal?: AbortSignal) {
    return requestJson<{ document: TraditionalDocument }>(
      platformBaseUrl,
      `/traditional/documents/${encodeURIComponent(documentId)}`,
      { token, signal },
    );
  },
  archiveDocument(token: string, documentId: string, signal?: AbortSignal) {
    return requestJson<{ document: TraditionalDocument; archived: true }>(
      platformBaseUrl,
      `/traditional/documents/${encodeURIComponent(documentId)}`,
      { method: "DELETE", token, signal },
    );
  },
  listJobs(token: string, input: { source_id?: string; document_id?: string } = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (input.source_id) params.set("source_id", input.source_id);
    if (input.document_id) params.set("document_id", input.document_id);
    const query = params.toString();
    return requestJson<{ jobs: TraditionalJob[] }>(platformBaseUrl, `/traditional/jobs${query ? `?${query}` : ""}`, {
      token,
      signal,
    });
  },
  getJob(token: string, jobId: string, signal?: AbortSignal) {
    return requestJson<{ job: TraditionalJob }>(platformBaseUrl, `/traditional/jobs/${encodeURIComponent(jobId)}`, {
      token,
      signal,
    });
  },
  listDocumentChunks(token: string, documentId: string, signal?: AbortSignal) {
    return requestJson<{ chunks: TraditionalChunk[] }>(
      platformBaseUrl,
      `/traditional/documents/${encodeURIComponent(documentId)}/chunks`,
      { token, signal },
    );
  },
  searchChunks(token: string, input: { q: string; limit?: number }, signal?: AbortSignal) {
    const params = new URLSearchParams({ q: input.q });
    if (input.limit) params.set("limit", String(input.limit));
    return requestJson<{ chunks: TraditionalChunk[] }>(platformBaseUrl, `/traditional/chunks/search?${params.toString()}`, {
      token,
      signal,
    });
  },
  listTables(token: string, input: { source_id?: string; document_id?: string } = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (input.source_id) params.set("source_id", input.source_id);
    if (input.document_id) params.set("document_id", input.document_id);
    const query = params.toString();
    return requestJson<{ tables: TraditionalTable[] }>(platformBaseUrl, `/traditional/tables${query ? `?${query}` : ""}`, {
      token,
      signal,
    });
  },
  listDocumentTables(token: string, documentId: string, signal?: AbortSignal) {
    return requestJson<{ tables: TraditionalTable[] }>(
      platformBaseUrl,
      `/traditional/documents/${encodeURIComponent(documentId)}/tables`,
      { token, signal },
    );
  },
  queryTables(token: string, input: TraditionalTableQueryInput, signal?: AbortSignal) {
    return requestJson<TraditionalTableQueryResponse>(platformBaseUrl, "/traditional/tables/query", {
      method: "POST",
      token,
      body: input,
      signal,
    });
  },
  search(token: string, input: TraditionalSearchInput, signal?: AbortSignal) {
    return requestJson<TraditionalSearchResponse>(platformBaseUrl, "/traditional/search", {
      method: "POST",
      token,
      body: input,
      signal,
    });
  },
};

export const graphApi = {
  listSources(token: string, signal?: AbortSignal) {
    return requestJson<{ sources: GraphSource[] }>(platformBaseUrl, "/graph/sources", { token, signal });
  },
  getSource(token: string, sourceId: string, signal?: AbortSignal) {
    return requestJson<{ source: GraphSource }>(
      platformBaseUrl,
      `/graph/sources/${encodeURIComponent(sourceId)}`,
      { token, signal },
    );
  },
  createSource(
    token: string,
    input: { name: string; kind: "private" | "public"; description?: string },
    signal?: AbortSignal,
  ) {
    return requestJson<{ source: GraphSource }>(platformBaseUrl, "/graph/sources", {
      method: "POST",
      token,
      body: input,
      signal,
    });
  },
  updateSource(
    token: string,
    sourceId: string,
    input: { name?: string; description?: string },
    signal?: AbortSignal,
  ) {
    return requestJson<{ source: GraphSource }>(
      platformBaseUrl,
      `/graph/sources/${encodeURIComponent(sourceId)}`,
      { method: "PATCH", token, body: input, signal },
    );
  },
  createTextDocument(
    token: string,
    input: { source_id: string; title?: string; text: string; metadata?: Record<string, unknown> },
    signal?: AbortSignal,
  ) {
    return requestJson<{ document: GraphDocument }>(platformBaseUrl, "/graph/documents/text", {
      method: "POST",
      token,
      body: input,
      signal,
    });
  },
  uploadDocument(token: string, input: { source_id: string; file: File }, signal?: AbortSignal) {
    const form = new FormData();
    form.set("source_id", input.source_id);
    form.set("file", input.file);
    return requestFormData<{ document: GraphDocument }>(platformBaseUrl, "/graph/documents/upload", {
      token,
      body: form,
      signal,
    });
  },
  listDocuments(token: string, input: { source_id?: string } = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (input.source_id) params.set("source_id", input.source_id);
    const query = params.toString();
    return requestJson<{ documents: GraphDocument[] }>(
      platformBaseUrl,
      `/graph/documents${query ? `?${query}` : ""}`,
      { token, signal },
    );
  },
  getDocument(token: string, documentId: string, signal?: AbortSignal) {
    return requestJson<{ document: GraphDocument }>(
      platformBaseUrl,
      `/graph/documents/${encodeURIComponent(documentId)}`,
      { token, signal },
    );
  },
  deleteDocument(token: string, documentId: string, signal?: AbortSignal) {
    return requestJson<{ document: GraphDocument; archived: true }>(
      platformBaseUrl,
      `/graph/documents/${encodeURIComponent(documentId)}`,
      { method: "DELETE", token, signal },
    );
  },
  search(token: string, input: GraphSearchInput, signal?: AbortSignal) {
    return requestJson<GraphSearchResponse>(platformBaseUrl, "/graph/search", {
      method: "POST",
      token,
      body: input,
      signal,
    });
  },
  ask(token: string, input: GraphSearchInput, signal?: AbortSignal) {
    return requestJson<GraphAskResponse>(platformBaseUrl, "/graph/ask", {
      method: "POST",
      token,
      body: input,
      signal,
    });
  },
};

export async function readSseStream(
  response: Response,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<void> {
  if (!response.body) throw new ApiClientError(response.status, "stream_unavailable", "SSE 响应没有可读取的 body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function flushBlock(block: string) {
    const lines = block.split(/\r?\n/);
    let event = "message";
    let id: string | undefined;
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim();
      else if (line.startsWith("id:")) id = line.slice("id:".length).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
    }
    if (dataLines.length === 0) return;
    const rawData = dataLines.join("\n");
    let data: unknown = rawData;
    try {
      data = JSON.parse(rawData);
    } catch {
      // keep raw text
    }
    onEvent({ event, id, data });
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\n\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) flushBlock(part);
  }
  buffer += decoder.decode();
  if (buffer.trim()) flushBlock(buffer);
}

export const agentApi = {
  health(signal?: AbortSignal) {
    return requestJson<HealthResponse>(agentGatewayBaseUrl, "/health", { signal });
  },
  createConversation(token: string, input: { active_module?: AgentModuleId; title?: string; metadata?: Record<string, unknown> }, signal?: AbortSignal) {
    return requestJson<{ conversation: AgentConversation }>(agentGatewayBaseUrl, "/agent/conversations", {
      method: "POST",
      token,
      body: { active_module: input.active_module ?? "nano-brain", title: input.title, metadata: input.metadata },
      signal,
    });
  },
  listConversations(token: string, input: { limit?: number } = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (input.limit) params.set("limit", String(input.limit));
    const query = params.toString();
    return requestJson<{ conversations: AgentConversation[] }>(
      agentGatewayBaseUrl,
      `/agent/conversations${query ? `?${query}` : ""}`,
      { token, signal },
    );
  },
  getConversation(token: string, conversationId: string, input: { message_limit?: number; run_limit?: number } = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (input.message_limit) params.set("message_limit", String(input.message_limit));
    if (input.run_limit) params.set("run_limit", String(input.run_limit));
    const query = params.toString();
    return requestJson<AgentConversationDetails>(
      agentGatewayBaseUrl,
      `/agent/conversations/${encodeURIComponent(conversationId)}${query ? `?${query}` : ""}`,
      { token, signal },
    );
  },
  getRun(token: string, conversationId: string, runId: string, signal?: AbortSignal) {
    return requestJson<AgentRunDetails>(
      agentGatewayBaseUrl,
      `/agent/conversations/${encodeURIComponent(conversationId)}/runs/${encodeURIComponent(runId)}`,
      { token, signal },
    );
  },
  async streamConversation(
    token: string,
    conversationId: string,
    input: { message: string; mode?: "default" | "admin_review" },
    onEvent: (event: AgentStreamEvent) => void,
    signal?: AbortSignal,
  ) {
    const response = await fetch(`${agentGatewayBaseUrl}/agent/conversations/${encodeURIComponent(conversationId)}/stream`, {
      method: "POST",
      signal,
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input.mode === "admin_review" ? input : { message: input.message }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const errorBody = data as Partial<ApiErrorBody> | null;
      throw new ApiClientError(
        response.status,
        errorBody?.error ?? `http_${response.status}`,
        errorBody?.message ?? `请求失败：HTTP ${response.status}`,
      );
    }

    await readSseStream(response, onEvent);
  },
};

export async function loadSystemSnapshot(token: string, signal?: AbortSignal): Promise<SystemSnapshot> {
  const [platform, agentGateway, modules, moduleHealth] = await Promise.all([
    toLoadable(() => platformApi.health(signal)),
    toLoadable(() => agentApi.health(signal)),
    toLoadable(async () => (await platformApi.modules(signal)).modules),
    toLoadable(async () => (await platformApi.modulesHealth(signal)).modules),
  ]);

  return { platform, agentGateway, modules, moduleHealth };
}
