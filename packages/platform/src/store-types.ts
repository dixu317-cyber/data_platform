/**
 * P12 Phase 0：平台 store 类型层
 * 自 platform-store.ts（本包） 的类型块 + 其依赖的 fixtures / scenario-product-surface 类型
 * 精确迁移而来（脚本抽取，保真、行为不变）。
 * 边界：本文件【不进】barrel（index.ts），以避免与 ./types 中同名类型
 *      （ProcessingTask / Visibility / ScenarioTemplate 等）冲突；由 ports 直接相对 import 使用。
 */
// P12 Phase 0：类型块自包含，无需外部类型 import。

export type TemplateState = "official" | "candidate" | "experimental" | "custom" | "paused" | "archived";
export type TemplateProductForm = "chat" | "embedded_assistant" | "knowledge_portal" | "document_review" | "report_generator" | "graph_explorer" | "task_workflow" | "hybrid";
export type Visibility = "private" | "team" | "company";
export type ProcessingStatus = "draft" | "submitted" | "waiting_review" | "processing" | "ready" | "failed";
export type TaskKind = "资料接入" | "管理员确认" | "知识入库" | "发布复核";
export type RagEngine = "知识百科" | "文档证据" | "关系图谱" | "混合处理";
export type TemplateDemoWalkthrough = {
  scenarioName: string;
  sampleInputs: Array<{ title: string; fileName: string; fileType: "md" | "pdf" | "csv" | "txt" | "json"; description: string }>;
  processingPreview: string[];
  sampleQuestion: string;
  sampleAnswer: string;
  citations: Array<{ label: string; source: string; excerpt: string }>;
  resultHighlights: string[];
};
export type ScenarioTemplate = {
  id: string;
  name: string;
  category: string;
  templateState: TemplateState;
  evidenceLevel: "validated" | "partial" | "internal_only";
  evidenceSources: string[];
  productForm: TemplateProductForm[];
  limitations: string[];
  headline: string;
  bestFor: string[];
  inputExamples: string[];
  acceptedFiles: string[];
  setupTime: string;
  reviewRequirement: "无需管理员确认" | "需要管理员确认" | "建议管理员确认";
  processingExplanation: string[];
  outputCapabilities: string[];
  demoWalkthrough: TemplateDemoWalkthrough;
  suggestedQuestions: string[];
};
export type ProcessingTask = {
  id: string;
  scenarioId: string;
  title: string;
  status: ProcessingStatus;
  kind: TaskKind;
  ragMode: RagEngine;
  visibility: Visibility;
  owner: string;
  submittedAt: string;
  updatedAt: string;
  files: string[];
  waitingFor: "用户补充资料" | "后台管理员" | "处理管线" | "场景负责人";
  progress: number;
  currentStep: string;
  userMessage: string;
  nextActions: string[];
  adminEntry: string;
};
export type ScenarioProductSurfaceKind = Exclude<TemplateProductForm, "chat" | "hybrid"> | "chat" | "hybrid";
export type ScenarioProductSurface = {
  kind: ScenarioProductSurfaceKind;
  label: string;
  headline: string;
  description: string;
  workspaceTitle: string;
  contextPanelTitle: string;
  rightRailMode: "sources" | "document" | "graph" | "widget" | "tasks" | "report";
  primaryAction: {
    label: string;
    prompt: string;
  };
  secondaryActions: Array<{
    label: string;
    prompt: string;
  }>;
  quickPrompts: string[];
  emptyState: string;
};
export type AdminRagEngine = "Gbrain" | "Naive RAG" | "GraphRAG";

export type StoreUser = {
  userId: string;
  name: string;
  role: "member" | "admin";
  organizationId?: string;
  teamIds?: string[];
};

export type StoreVisibility = Visibility;
export type AccessControlScope = StoreVisibility;
export type StoredAccessControl = {
  scope: AccessControlScope;
  ownerUserId: string;
  ownerName: string;
  organizationId: string;
  teamIds: string[];
};

export type OriginalFileState = "temporary" | "retained" | "deleted";
export type FileRetentionPolicy = "delete_after_ingest" | "retain_source";
export type ParsedArtifactKind = "markdown" | "document_text" | "table" | "structured_data" | "archive_manifest" | "text";
export type KnowledgeObjectKind = "knowledge_page" | "evidence_chunk" | "graph_object";
export type StoreModuleId = "nano-brain" | "traditional-rag" | "graph-rag";
export type StoredModuleReference = {
  id: string;
  scenarioId: string;
  sourceFileId: string;
  engine: AdminRagEngine;
  moduleId: StoreModuleId;
  sourceId: string;
  sourceName: string;
  sourceKind: "private" | "public";
  objectKind: "page" | "document" | "job";
  objectId: string;
  documentId?: string;
  jobId?: string;
  pageId?: string;
  status: "submitted" | "ready" | "failed";
  accessControl: StoredAccessControl;
  metadata: Record<string, unknown>;
  createdAt: string;
};
export type AdminKnowledgeAssetKind =
  | "wiki"
  | "fact"
  | "link"
  | "source"
  | "chunk"
  | "embedding"
  | "citation"
  | "eval"
  | "entity"
  | "relationship"
  | "graph"
  | "review";

export type StoredAdminTemplateState = "official" | "candidate" | "experimental" | "custom" | "paused" | "archived";
export type StoredAdminTemplate = {
  id: string;
  name: string;
  category: string;
  state: StoredAdminTemplateState;
  source: "official" | "custom";
  owner: string;
  headline: string;
  acceptedFiles: string[];
  inputExamples: string[];
  outputCapabilities: string[];
  productForm: TemplateProductForm[];
  reviewRequirement: ScenarioTemplate["reviewRequirement"];
  evidenceSources: string[];
  evidenceCoverage: number;
  demoReadiness: number;
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminIntegrationSettings = {
  checked_at: string;
  overall_status: "ready" | "degraded" | "blocked";
  providers: Array<{
    id: string;
    label: string;
    provider: string;
    base_url: string | null;
    model: string | null;
    dimensions?: number | null;
    optional?: boolean;
    secrets: Array<{ env_name: string; configured: boolean; fingerprint: string | null }>;
    controls: string[];
  }>;
  parsers: Array<{
    id: string;
    label: string;
    base_url: string | null;
    model_version: string | null;
    language: string | null;
    options: string[];
    secrets: Array<{ env_name: string; configured: boolean; fingerprint: string | null }>;
  }>;
  modules: Array<{
    id: StoreModuleId;
    label: string;
    base_url: string;
    status: "ok" | "error" | "unknown";
    service: string;
    required_env: string[];
    role: string;
  }>;
  databases: Array<{
    id: string;
    label: string;
    env_name: string;
    configured: boolean;
    host: string | null;
    port: string | null;
    database: string | null;
    username: string | null;
  }>;
  runtime_policies: Array<{
    label: string;
    value: string;
    impact: string;
    key?: "rerankTopN" | "rerankMinScore" | "perSourceTimeoutMs" | "sourceFanout" | "candidatePoolSize";
    source?: "db" | "env" | "default";
    numeric?: { value: number; min: number; max: number; step: number; unit?: string };
  }>;
  engine_retrieval: Array<{
    engine: AdminRagEngine;
    label: string;
    topK: number | null;
    source: "db" | "default";
    min: number;
    max: number;
    default_hint: string;
    minScore: number | null;
    minScoreSource: "db" | "default";
    minScoreMin: number;
    minScoreMax: number;
    supportsMinScore: boolean;
    mode: string | null;
    modeSource: "db" | "default";
    modeOptions: string[];
    chunkTopK: number | null;
    chunkTopKSource: "db" | "default";
    chunkTopKMin: number;
    chunkTopKMax: number;
    maxTotalTokens: number | null;
    maxTotalTokensSource: "db" | "default";
    maxTotalTokensMin: number;
    maxTotalTokensMax: number;
    enableRerank: boolean | null;
    enableRerankSource: "db" | "default";
    supportsGraphRetrieval: boolean;
    linkDepth: number | null;
    linkDepthSource: "db" | "default";
    linkDepthMin: number;
    linkDepthMax: number;
    supportsLinkDepth: boolean;
  }>;
};

export type StoredAdminAuditEvent = {
  id: string;
  actor: string;
  area: string;
  summary: string;
  impact: string;
  time: string;
  createdAt: string;
};

export type AdminStrategyParameters = Record<string, string>;

export type AdminTemplateMutationInput = {
  id?: string;
  name?: string;
  category?: string;
  state?: StoredAdminTemplateState;
  owner?: string;
  headline?: string;
  acceptedFiles?: string[];
  inputExamples?: string[];
  outputCapabilities?: string[];
  productForm?: TemplateProductForm[];
  reviewRequirement?: ScenarioTemplate["reviewRequirement"];
  evidenceSources?: string[];
};

export type StoreUploadFile = {
  name: string;
  type?: string;
  bytes: Uint8Array;
};

export type StoredScenario = {
  id: string;
  templateId: string;
  name: string;
  description: string;
  visibility: StoreVisibility;
  ownerUserId: string;
  ownerName: string;
  organizationId: string;
  teamIds: string[];
  accessControl: StoredAccessControl;
  status: "submitted" | "waiting_review" | "processing" | "ready" | "failed";
  sourceCount: number;
  processingGoal: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredScenarioWorkbench = {
  scenario: StoredScenario;
  template: StoredAdminTemplate;
  surface: ScenarioProductSurface;
  tasks: ProcessingTask[];
  knowledgeObjects: StoredKnowledgeObject[];
};

export type StoredFileRecord = {
  id: string;
  scenarioId: string;
  originalName: string;
  mimeType: string;
  size: number;
  relativePath: string;
  uploadedAt: string;
  originalState: OriginalFileState;
  originalAvailable: boolean;
  retentionPolicy: FileRetentionPolicy;
  retentionReason: string;
  accessControl: StoredAccessControl;
  deletedAt?: string;
  parsedArtifactIds: string[];
  knowledgeObjectIds: string[];
};

export type StoredParsedArtifact = {
  id: string;
  scenarioId: string;
  sourceFileId: string;
  title: string;
  kind: ParsedArtifactKind;
  content: string;
  visibility: StoreVisibility;
  ownerUserId: string;
  ownerName: string;
  organizationId: string;
  teamIds: string[];
  accessControl: StoredAccessControl;
  ragMode: RagEngine;
  ragEngine: AdminRagEngine;
  createdAt: string;
};

export type StoredKnowledgeObject = {
  id: string;
  scenarioId: string;
  sourceFileId: string;
  artifactId: string;
  title: string;
  kind: KnowledgeObjectKind;
  content: string;
  visibility: StoreVisibility;
  ownerUserId: string;
  ownerName: string;
  organizationId: string;
  teamIds: string[];
  accessControl: StoredAccessControl;
  ragMode: RagEngine;
  ragEngine: AdminRagEngine;
  sourceOriginalName: string;
  moduleReferences?: StoredModuleReference[];
  createdAt: string;
};

export type StoredKnowledgeAssetDetail = {
  id: string;
  kind: AdminKnowledgeAssetKind;
  engine: AdminRagEngine;
  title: string;
  metric: string;
  status: string;
  sourceOriginalName: string;
  scenarioName: string;
  visibility: StoreVisibility;
  visibilityLabel: StoredAdminIntakeRequest["visibility"];
  ownerName: string;
  createdAt: string;
  content: string;
  metadata: Array<{ label: string; value: string }>;
};

export type AdminServiceHealthStatus = "healthy" | "degraded" | "down";
export type AdminServiceHealth = {
  id: AdminRagEngine;
  status: AdminServiceHealthStatus;
  detail: string;
};
export type AdminDashboardSnapshot = {
  requests: {
    total: number;
    pending: number;
    processing: number;
    published: number;
    rejected: number;
  };
  assets: {
    total: number;
    gbrain: number;
    naive: number;
    graph: number;
  };
  healthCards: Array<{
    id: "platform-store" | AdminRagEngine;
    label: string;
    value: string;
    detail: string;
    status: AdminServiceHealthStatus;
    route: string;
  }>;
  dataOverview: Array<{
    scope: "个人" | "团队" | "公司";
    total: number;
    unit: string;
    module: string;
    owner: string;
    policy: string;
    health: AdminServiceHealthStatus;
  }>;
};

export type StoredScenarioAnswer = {
  scenarioId: string;
  query: string;
  answer: {
    text: string;
    engine: AdminRagEngine;
    citations: Array<{
      knowledgeObjectId: string;
      sourceOriginalName: string;
      scenarioName: string;
      engine: AdminRagEngine;
      excerpt: string;
    }>;
    nextActions: string[];
  };
};

export type GlobalChatScope = "company" | "team" | "private";
export type GlobalChatCitation = {
  knowledgeObjectId: string;
  sourceOriginalName: string;
  scenarioId: string;
  scenarioName: string;
  engine: AdminRagEngine;
  knowledgeType: "知识百科" | "文档证据" | "关系图谱";
  excerpt: string;
};
export type GlobalChatRetrievalTrack = {
  label: "文档证据" | "关系图谱" | "知识百科";
  count: number;
  description: string;
};
export type GlobalChatContextTrace = {
  layers: string[];
  scopeLabel: string;
  route: "direct" | "retrieve";
  routeReason: string;
  // P33/P36 合一（spec §2.3）：gateway 赋真义（真 transcript 轮数 / 真滚动摘要），保留；legacy 填最小空值。
  shortTermTurns: number;
  compressedContext: string;
  longTermMemoryHits: string[];
  retrievalTracks: GlobalChatRetrievalTrack[];
  // P52 §六阶段3：port 影子——与 platform-store.ts 逐字同步。
  routing?: RoutingDecision;
  retrievalAttempts?: RetrievalAttempt[];
};
export type StoredGlobalChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: GlobalChatCitation[];
  contextTrace?: GlobalChatContextTrace;
  traceId?: string;
};
export type StoredGlobalChatSession = {
  id: string;
  title: string;
  ownerUserId: string;
  ownerName: string;
  organizationId: string;
  teamIds: string[];
  scope: GlobalChatScope;
  createdAt: string;
  updatedAt: string;
  compressedContext: string;
  /** @deprecated P33 停用，仅容忍存量 JSONB 读入，运行逻辑不得读写 */
  memory?: {
    provider: "local";
    shortTermCount: number;
    longTermFacts: string[];
  };
  messages: StoredGlobalChatMessage[];
};
export type GlobalChatSessionSummary = {
  id: string;
  title: string;
  scope: GlobalChatScope;
  updatedAt: string;
  updatedAtText: string;
  messageCount: number;
  latestMessage: string;
};

export type StoredScenarioChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  engine?: AdminRagEngine;
  citations?: StoredScenarioAnswer["answer"]["citations"];
  nextActions?: string[];
  traceId?: string;
};

export type StoredScenarioChatSession = {
  id: string;
  scenarioId: string;
  title: string;
  ownerUserId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredScenarioChatMessage[];
};

export type ScenarioChatSessionSummary = {
  id: string;
  scenarioId: string;
  title: string;
  ownerName: string;
  updatedAt: string;
  updatedAtText: string;
  messageCount: number;
  latestMessage: string;
};

export type StoredFilePreview = {
  file: StoredFileRecord;
  bytes: Uint8Array;
};

export type StoredAdminIntakeRequest = {
  id: string;
  scenarioId: string;
  scenarioName: string;
  requester: string;
  visibility: "个人" | "团队" | "公司";
  submittedAt: string;
  status: "待管理员确认" | "处理中" | "等待复核" | "已发布" | "已退回";
  files: string[];
  storedFiles: StoredFileRecord[];
  requestedOutcome: string;
  recommendedModes: RagEngine[];
  recommendedEngines: AdminRagEngine[];
  selectedMode: "待选择" | RagEngine;
  selectedEngine: "待选择" | AdminRagEngine;
  frontstageMapping: string;
  permissionImpact: string;
  strategyParameters: AdminStrategyParameters;
  parsedArtifactCount: number;
  knowledgeObjectCount: number;
  actions: string[];
  createdAt: string;
};

type StoreTask = ProcessingTask & {
  ownerUserId: string;
  createdAt: string;
  updatedAtIso?: string;
  strategyParameters?: AdminStrategyParameters;
};

// ===== 监控 / 可观测 trace 模型(对标 Langfuse/Phoenix:一次问答=一个 trace,内部步骤=typed span) =====
export type TraceFormLabel = "文档型" | "图谱型" | "知识页型";
export type TraceSpanKind = "RETRIEVER" | "LLM" | "ROUTER";
export type TraceSpan = {
  kind: TraceSpanKind;
  label: string;
  engine?: AdminRagEngine;
  form?: TraceFormLabel;
  latencyMs: number;
  // RETRIEVER
  sourceName?: string;
  scenarioName?: string;
  hitCount?: number;
  hits?: Array<{ excerpt: string; score?: number }>;
  // LLM
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  // P37-T4b/T4c/T4d：与 platform-store.ts 真实 TraceSpan 同步的可观测扩展字段（port 影子类型）。
  provider?: "http" | "llm";
  inputCount?: number;
  keptCount?: number;
  mode?: string;
  modeSource?: string;
  intents?: string[];
  engines?: AdminRagEngine[];
  prunedEngines?: AdminRagEngine[];
  basis?: string;
  routeReason?: string;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  error?: string;
};
// P37-T4d（FR-452）：port 影子——与 platform-store.ts 的 RetrievalSourceStatus/RetrievalHealth 逐字同步。
export type RetrievalSourceStatus = "ok" | "error" | "timeout" | "skipped-by-router";
export type RetrievalHealth = { sources: Array<{ engine: AdminRagEngine; status: RetrievalSourceStatus }> };

// P52 §四：port 影子——与 platform-store.ts 的 RetrievalExecutionSpan/RoutingDecision/RetrievalAttempt/
// GlobalKnowledgeRetrievalResult 逐字同步（无 excerpt 可传输结构）。
export type RetrievalExecutionSpan = {
  engine: AdminRagEngine;
  attempted: boolean;
  sourceCount: number;
  hitCount: number;
  latencyMs: number;
  status: RetrievalSourceStatus;
};

export type RoutingDecision = {
  engines?: AdminRagEngine[];
  prunedEngines: AdminRagEngine[];
  basis: "rules" | "classifier" | "fail-open" | "routing-off";
  reason: string;
  latencyMs: number;
};

export type RetrievalAttempt = {
  routingDecision: RoutingDecision;
  executionSpans: RetrievalExecutionSpan[];
  toolInvoked: true;
  zeroHit: boolean;
};

export type GlobalKnowledgeRetrievalResult = {
  citations: GlobalChatCitation[];
  routingDecision: RoutingDecision;
  executionSpans: RetrievalExecutionSpan[];
  toolInvoked: true;
  zeroHit: boolean;
};

export type StoredChatTrace = {
  id: string;
  kind: "global_chat" | "scenario_chat";
  scenarioId?: string;
  scenarioName?: string;
  userId: string;
  userName: string;
  scope?: string;
  query: string;
  route: "direct" | "retrieve";
  answerExcerpt: string;
  success: boolean;
  citationCount: number;
  hitSourceCount: number;
  totalLatencyMs: number;
  totalTokens: number;
  engines: AdminRagEngine[];
  forms: TraceFormLabel[];
  spans: TraceSpan[];
  // P37-T4d（FR-452）：全域检索本次各引擎健康状态（仅 retrieve 路由且经过真实检索时存在）。
  retrievalHealth?: RetrievalHealth;
  feedback?: { vote: "up" | "down"; note?: string; ratedAt: string };
  createdAt: string;
};

export type MonitoringTelemetrySpan = Pick<TraceSpan, "kind" | "engine" | "form" | "latencyMs" | "hitCount" | "totalTokens"> & { status?: RetrievalSourceStatus };
export type MonitoringTelemetry = {
  id: string;
  kind: StoredChatTrace["kind"];
  scope?: string;
  route: StoredChatTrace["route"];
  success: boolean;
  citationCount: number;
  hitSourceCount: number;
  totalLatencyMs: number;
  totalTokens: number;
  engines: AdminRagEngine[];
  forms: TraceFormLabel[];
  retrievalHealth?: RetrievalHealth;
  feedback?: { vote: "up" | "down"; ratedAt: string };
  createdAt: string;
};
export type MonitoringTelemetryDetail = MonitoringTelemetry & { spans: MonitoringTelemetrySpan[] };

// ── P12 Phase 0：类型块外(函数区)散落的 store 类型，补齐迁移 ──
export type MonitoringOverview = {
  overall: {
    queries: number;
    successRate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    totalTokens: number;
    upvotes: number;
    downvotes: number;
    pendingReview: number;
    noAnswerRate: number;
  };
  forms: Array<{ form: TraceFormLabel; queries: number; hitRate: number; avgRetrievalMs: number; downvotes: number }>;
};
export type MonitoringTrendPoint = { date: string; queries: number; successRate: number; avgLatencyMs: number; downvotes: number; tokens: number };
export type MonitoringFormPanels = {
  文档型: { sources: Array<{ name: string; hits: number; queries: number }>; zeroHitSources: number };
  图谱型: { entities: number; relations: number; sources: number; duplicateCandidates: string[]; sampleEntities: string[]; available: boolean };
  知识页型: { traceableRate: number; knowledgePages: number; latestPageAgeHours: number | null };
};
export type StoredRuntimeConfig = {
  rerankTopN?: number;
  rerankMinScore?: number;
  perSourceTimeoutMs?: number;
  sourceFanout?: number;
  candidatePoolSize?: number;
};
export type StoredEngineRetrievalConfig = Partial<Record<AdminRagEngine, { topK?: number; minScore?: number; mode?: string; chunkTopK?: number; maxTotalTokens?: number; enableRerank?: boolean; linkDepth?: number }>>;
