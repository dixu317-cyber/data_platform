import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { officialTemplates } from "./frontstage";
import { buildScenarioProductSurface, type ScenarioProductSurface } from "./scenario-product-surface";
import type { ProcessingTask, RagEngine, ScenarioTemplate, TaskKind, TemplateProductForm, Visibility } from "./frontstage";
// P12 Phase 1 T1b-1：readDb/writeDb 后端由 JSON 文件切换为 PG（拆解/重组存储层）。
import { loadDbFromPg, saveDbToPg, truncateAllPg } from "./platform-pg-store";
// P12 Phase 1 T1b-2：逐行 SQL 读查询（绞杀式迁移，逐函数替换整库读）。
import {
  queryAuditEventsDesc,
  queryTraceById,
  queryAllTraces,
  queryGlobalSessionById,
  queryAllGlobalSessions,
  queryScenarioById,
  queryScenarioChatSession,
  queryScenarioChatSessionsByScenario,
} from "./platform-pg-queries";
// P50：typed 实体槽位窄规则（隐式关系题漏剪修复）依赖的静态 curated 实体表。
import { hasCompanyEntity, hasPersonEntity, matchedProduct, normalizeRouteQuery } from "./route-entities";

export type AdminRagEngine = "Gbrain" | "Naive RAG" | "GraphRAG";
const ALL_RAG_ENGINES: AdminRagEngine[] = ["Naive RAG", "Gbrain", "GraphRAG"];

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

// 018 · 源级描述卡(FR-460~470)：StoredScenario 的可选持久字段——缺失=无卡=017/feat 路由行为
// 逐字不变(AM-1806/1821)。generatedAt/sourceFingerprint/origin 均由生成钩子写入，纯函数
// (parseSourceCardOutput)只产出 summaryScope/typicalQuestions/entityHints 三个内容字段。
export type SourceCardOrigin = "auto" | "manual";
export type DescriptionCard = {
  summaryScope: string;
  typicalQuestions: string[]; // 3~5 条，AM-1801 无半卡红线
  entityHints?: string[]; // ≤8
  docTypeDistribution: Record<string, number>; // 文档名后缀机械派生(非 LLM，AM-1803)
  generatedAt: string;
  sourceFingerprint: string; // 排序后文档名 hash，顺序无关确定性(AM-1803)
  origin: SourceCardOrigin;
  // manual 卡遇文档漂移时置真，内容绝不被自动覆盖(AM-1815 硬红线)。
  staleHint?: boolean;
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
  // 026 · FR-582:入库旁路检测的场景级 PII 汇总(类型+计数;缺失=未检出/未检测,不虚标)。
  piiHints?: PiiHint[];
  // 018 · FR-460:源级描述卡，缺失=未生成/未生效(向后兼容，AM-1821)。
  descriptionCard?: DescriptionCard;
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
  // 018 T3 · 后台资产详情随行携带所属场景 id + 源级描述卡(缺失=未生成，禁假卡 AM-1818)，
  // 供 AdminKnowledgeBasesPage 详情区展示/编辑，不必为此另开一次前端请求。
  scenarioId: string;
  descriptionCard?: DescriptionCard;
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
  // P33/P36 合一（spec §2.3）：这三字段在 legacy 曾是伪填充（P33 欲删），但 agent-gateway 已赋真义
  // ——shortTermTurns=真 transcript 轮数、compressedContext=真滚动摘要 summaryText（见 context-trace.ts）。
  // 故保留；legacy 侧填空/最小，gateway 侧填真值。
  shortTermTurns: number;
  compressedContext: string;
  longTermMemoryHits: string[];
  retrievalTracks: GlobalChatRetrievalTrack[];
  // P52 §六阶段3（3B）：嵌入 JSONB、免 migration（§四）。routing=本轮共享路由决策（多工具共用同一份，
  // legacy/未调工具时缺省）；retrievalAttempts=每次工具调用一条(各含 executionSpans)，多工具全留不覆盖。
  // 均为无 excerpt 安全 DTO（excerpt 红线）。
  routing?: RoutingDecision;
  retrievalAttempts?: RetrievalAttempt[];
};
type LlmSpanInfo = { model: string; latencyMs: number; promptTokens?: number; completionTokens?: number; totalTokens?: number; promptCacheHitTokens?: number; promptCacheMissTokens?: number; error?: string };
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
  threadId?: string;
  architectureVersion?: "legacy" | "agent-gateway";
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
  threadId?: string;
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
  sourceIds?: string[];
  naiveReplicaStats?: { created: number; skipped: number; failed: number };
};

type StoreTask = ProcessingTask & {
  ownerUserId: string;
  createdAt: string;
  updatedAtIso?: string;
  strategyParameters?: AdminStrategyParameters;
};

// 022b · P46:持久摄取队列 job(状态转移绑证据——done 仅当 task/scenario 已落终态)。
export type IngestQueueJob = {
  id: string;
  taskId: string;
  scenarioId: string;
  selectedMode: RagEngine;
  selectedEngine: AdminRagEngine;
  strategyParameters?: AdminStrategyParameters;
  requestedBy: StoreUser;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  enqueuedAt: string;
  updatedAt: string;
  lastError?: string;
  // 外部摄取幂等锚点：hash(scenarioId+taskId+selectedEngine+涉及文件 id 集合)。当前未被任何
  // 引擎的 API 调用消费——Naive(documentId content-hash dedup)/Gbrain(UNIQUE(source_id,
  // external_ref)) 靠各自模块层唯一约束天然幂等，无需此键传参；此锚点仅作 job 身份标识 +
  // 未来跨进程 claim（BLOCK#3 lease）预留，随 job 落盘供诊断，不代表已接入去重调用。
  idempotencyKey: string;
  // BLOCK#4：GraphRAG 每次摄取直接 POST 无唯一约束，重跑（含崩溃恢复重放）可能产生重复产物，
  // 不像 Naive/Gbrain 有模块层唯一约束兜底。job 成功时显式标注 false，供运维/前端诊断该引擎
  // "可重复尝试但外部不保证去重"；Naive/Gbrain 走模块层去重，标 true。
  dedupGuaranteed?: boolean;
};

// 024 · 站内通知(FR-550~556)。语义:①旁路(写失败绝不阻断业务事件,fail-open)②终态才触达
// (重试中间态不通知,dedupeKey 持久幂等防刷屏)③M/N 一等(部分成功文案必含数字,禁坍缩"完成")
// ④权限正交(user 通知只见/只标自己的;admin-role 广播只对 admin 可见)。
export type StoredNotification = {
  id: string;
  audience: "user" | "admin-role"; // admin-role = 全体管理员广播(平台单管理员岗形态)
  userId: string; // audience=user 时收件人;admin-role 时为 ""
  kind: "approval-result" | "ingest-terminal" | "review-pending";
  title: string;
  body: string;
  scenarioId?: string;
  taskId?: string;
  dedupeKey?: string; // 持久幂等键(同 dedupeKey 已存在则跳过,防重复终态刷屏)
  read: boolean;
  createdAt: string;
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
  // P37-T4b：rerank 可观测（provider 顺序 http 优先、消灭 unconfigured 后落到 llm 裁判）
  provider?: "http" | "llm";
  inputCount?: number;
  keptCount?: number;
  // P37-T4c（FR-450）：GraphRAG 检索本次生效 mode + 来源（下游 mode router 返回，request/admin_fixed/rule/llm/fallback）。
  mode?: string;
  modeSource?: string;
  // P37-T4d（FR-451）：ROUTER span——路由决策本身（意图识别 + 引擎选择），先于检索发生。
  intents?: string[];
  engines?: AdminRagEngine[]; // 路由终值（direct 时 undefined）
  prunedEngines?: AdminRagEngine[]; // 被规则/分类器剪掉的引擎（全查时为空数组）
  basis?: string; // rules | classifier | fail-open | routing-off | direct
  routeReason?: string;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  error?: string;
};

// P37-T4d（FR-452）：全域回答检索健康契约——每个引擎本次参与状态，随 citations 一起返回，
// 不得在被过滤 refs 上局部标记后丢弃结果。
export type RetrievalSourceStatus = "ok" | "error" | "timeout" | "skipped-by-router";
export type RetrievalHealth = { sources: Array<{ engine: AdminRagEngine; status: RetrievalSourceStatus }> };

// P52 §四 冻结数据模型（禁复用底层 TraceSpan——其 hits[].excerpt 含内容，见上方 TraceSpan.hits）。
// 安全执行 DTO：只承载可观测统计（是否尝试/源数/命中数/耗时/状态），不带原文/摘录。
export type RetrievalExecutionSpan = {
  engine: AdminRagEngine;
  attempted: boolean; // 是否真对该引擎发起检索：非 skipped-by-router 且有 ready source 才 true（无 ready source 从未尝试=false）
  sourceCount: number; // 该引擎本轮可检索的 ready source 数
  hitCount: number; // 该引擎贡献的命中引用数
  latencyMs: number; // 该引擎检索耗时（可从现有 RETRIEVER span 归因；不可归因则 0，honest）
  status: RetrievalSourceStatus;
};

export type RoutingDecision = {
  engines?: AdminRagEngine[]; // 路由终值；undefined = 全查
  prunedEngines: AdminRagEngine[]; // 被剪掉的引擎（ALL_RAG_ENGINES - engines）；undefined/全查时为 []
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

// 管理端只消费这一投影，原始 StoredChatTrace 继续保留给内部聚合与落库。
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

export function engineToForm(engine: AdminRagEngine): TraceFormLabel {
  if (engine === "Naive RAG") return "文档型";
  if (engine === "GraphRAG") return "图谱型";
  return "知识页型";
}

// 把一次真实问答落成一条 trace 记录(成功口径:direct=成功;retrieve=命中真实引用>0)。
function recordChatTrace(
  db: PlatformDb,
  input: {
    id: string;
    kind: "global_chat" | "scenario_chat";
    user: StoreUser;
    scope?: string;
    scenarioId?: string;
    scenarioName?: string;
    query: string;
    route: "direct" | "retrieve";
    answerText: string;
    citations: Array<{ engine: AdminRagEngine }>;
    spans: TraceSpan[];
    totalLatencyMs: number;
    now: string;
    retrievalHealth?: RetrievalHealth;
  }
) {
  const engines = Array.from(new Set(input.citations.map((c) => c.engine)));
  const retrieverSpans = input.spans.filter((s) => s.kind === "RETRIEVER");
  const hitSourceCount = retrieverSpans.filter((s) => (s.hitCount ?? 0) > 0).length;
  const totalTokens = input.spans.reduce((sum, s) => sum + (s.totalTokens ?? 0), 0);
  const success = input.route === "direct" ? true : input.citations.length > 0;
  const trace: StoredChatTrace = {
    id: input.id,
    kind: input.kind,
    scenarioId: input.scenarioId,
    scenarioName: input.scenarioName,
    userId: input.user.userId,
    userName: input.user.name,
    scope: input.scope,
    query: input.query,
    route: input.route,
    answerExcerpt: excerpt(sanitizeKnowledgeExcerpt(input.answerText), 220),
    success,
    citationCount: input.citations.length,
    hitSourceCount,
    totalLatencyMs: input.totalLatencyMs,
    totalTokens,
    engines,
    forms: Array.from(new Set(engines.map((e) => engineToForm(e)))),
    spans: input.spans,
    retrievalHealth: input.retrievalHealth,
    createdAt: input.now
  };
  if (!Array.isArray(db.traces)) db.traces = [];
  db.traces.unshift(trace);
  // 防止 JSON 存储无界增长:只保留最近 2000 条 trace。
  if (db.traces.length > 2000) db.traces = db.traces.slice(0, 2000);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

// 终端用户对一次回答点赞/点踩 → 写入对应 trace 的 feedback(进而进待改进队列)。
export async function setTraceFeedback(
  user: StoreUser,
  input: { traceId: string; vote: "up" | "down"; note?: string }
): Promise<{ ok: boolean; message: string }> {
  const db = await readDb();
  const trace = (db.traces ?? []).find((t) => t.id === input.traceId);
  if (!trace) return { ok: false, message: "没有找到这条问答记录。" };
  if (trace.userId !== user.userId && user.role !== "admin") return { ok: false, message: "只能对自己的问答评价。" };
  trace.feedback = { vote: input.vote, note: input.note?.trim() || undefined, ratedAt: new Date().toISOString() };
  await writeDb(db);
  return { ok: true, message: input.vote === "up" ? "已记录好评，谢谢反馈。" : "已记录差评，已进入后台待改进队列。" };
}

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

// 监控总览(三形态健康层 + 总体一级指标),全部从真实 traces 聚合。
export async function getMonitoringOverview(user: StoreUser): Promise<MonitoringOverview> {
  const empty: MonitoringOverview = {
    overall: { queries: 0, successRate: 0, p50LatencyMs: 0, p95LatencyMs: 0, totalTokens: 0, upvotes: 0, downvotes: 0, pendingReview: 0, noAnswerRate: 0 },
    forms: (["文档型", "图谱型", "知识页型"] as TraceFormLabel[]).map((form) => ({ form, queries: 0, hitRate: 0, avgRetrievalMs: 0, downvotes: 0 }))
  };
  if (user.role !== "admin") return empty;
  const db = await readDb();
  const traces = db.traces ?? [];
  if (traces.length === 0) return empty;
  const latencies = traces.map((t) => t.totalLatencyMs);
  const successCount = traces.filter((t) => t.success).length;
  const retrieveTraces = traces.filter((t) => t.route === "retrieve");
  const noAnswer = retrieveTraces.filter((t) => t.citationCount === 0).length;
  const overall = {
    queries: traces.length,
    successRate: Math.round((successCount / traces.length) * 100),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    totalTokens: traces.reduce((s, t) => s + (t.totalTokens ?? 0), 0),
    upvotes: traces.filter((t) => t.feedback?.vote === "up").length,
    downvotes: traces.filter((t) => t.feedback?.vote === "down").length,
    pendingReview: traces.filter((t) => t.feedback?.vote === "down").length,
    noAnswerRate: retrieveTraces.length ? Math.round((noAnswer / retrieveTraces.length) * 100) : 0
  };
  const forms = (["文档型", "图谱型", "知识页型"] as TraceFormLabel[]).map((form) => {
    const formTraces = traces.filter((t) => t.forms.includes(form));
    const retrSpans = traces.flatMap((t) => t.spans).filter((s) => s.kind === "RETRIEVER" && s.form === form);
    const hitSpans = retrSpans.filter((s) => (s.hitCount ?? 0) > 0).length;
    return {
      form,
      queries: formTraces.length,
      hitRate: retrSpans.length ? Math.round((hitSpans / retrSpans.length) * 100) : 0,
      avgRetrievalMs: retrSpans.length ? Math.round(retrSpans.reduce((s, x) => s + x.latencyMs, 0) / retrSpans.length) : 0,
      downvotes: formTraces.filter((t) => t.feedback?.vote === "down").length
    };
  });
  return { overall, forms };
}

// 问答日志列表(可筛选:形态/成功/差评)。返回精简行,trace 详情另取。
export async function listMonitoringTraces(
  user: StoreUser,
  input: { form?: TraceFormLabel; onlyFailed?: boolean; onlyDownvoted?: boolean; limit?: number } = {}
): Promise<MonitoringTelemetry[]> {
  if (!isValidAdminCaller(user)) return [];
  // T1b-2：只加载 traces 集合（非整库），过滤/切片/去 spans 逻辑不变。
  let traces = ((await queryAllTraces()) as StoredChatTrace[]).map(toMonitoringTelemetry);
  if (input.form) traces = traces.filter((t) => t.forms.includes(input.form!));
  if (input.onlyFailed) traces = traces.filter((t) => !t.success);
  if (input.onlyDownvoted) traces = traces.filter((t) => t.feedback?.vote === "down");
  return traces.slice(0, input.limit ?? 100);
}

// 单条 trace 详情只返回内容无关的治理指标。
export async function getMonitoringTrace(user: StoreUser, traceId: string): Promise<MonitoringTelemetryDetail | null> {
  if (!isValidAdminCaller(user)) return null;
  // T1b-2：逐行 SQL 查（等价 db.traces.find(id)）。
  const trace = (await queryTraceById(traceId)) as StoredChatTrace | null;
  return trace ? toMonitoringTelemetryDetail(trace) : null;
}

const MONITORING_ENGINES = new Set<AdminRagEngine>(["Gbrain", "Naive RAG", "GraphRAG"]);
const MONITORING_FORMS = new Set<TraceFormLabel>(["文档型", "图谱型", "知识页型"]);
const MONITORING_SPAN_KINDS = new Set<TraceSpanKind>(["RETRIEVER", "LLM", "ROUTER"]);
const MONITORING_HEALTH_STATUSES = new Set<RetrievalSourceStatus>(["ok", "error", "timeout", "skipped-by-router"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMonitoringEngine(value: unknown): value is AdminRagEngine {
  return typeof value === "string" && MONITORING_ENGINES.has(value as AdminRagEngine);
}

function isMonitoringForm(value: unknown): value is TraceFormLabel {
  return typeof value === "string" && MONITORING_FORMS.has(value as TraceFormLabel);
}

function isMonitoringSpanKind(value: unknown): value is TraceSpanKind {
  return typeof value === "string" && MONITORING_SPAN_KINDS.has(value as TraceSpanKind);
}

function isMonitoringHealthStatus(value: unknown): value is RetrievalSourceStatus {
  return typeof value === "string" && MONITORING_HEALTH_STATUSES.has(value as RetrievalSourceStatus);
}

function safeMonitoringNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function safeOptionalMonitoringNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function safeMonitoringId(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : "invalid-trace";
}

function safeMonitoringTimestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return "1970-01-01T00:00:00.000Z";
  return Number.isFinite(Date.parse(value)) ? value : "1970-01-01T00:00:00.000Z";
}

function safeMonitoringRetrievalHealth(value: unknown): RetrievalHealth | undefined {
  if (!isRecord(value) || !Array.isArray(value.sources)) return undefined;
  const sources = value.sources.flatMap((source) => {
    if (!isRecord(source) || !isMonitoringEngine(source.engine) || !isMonitoringHealthStatus(source.status)) return [];
    return [{ engine: source.engine, status: source.status }];
  });
  return { sources };
}

function safeMonitoringFeedback(value: unknown): MonitoringTelemetry["feedback"] {
  if (!isRecord(value) || (value.vote !== "up" && value.vote !== "down")) return undefined;
  const ratedAt = safeMonitoringTimestamp(value.ratedAt);
  if (ratedAt === "1970-01-01T00:00:00.000Z") return undefined;
  return { vote: value.vote, ratedAt };
}

function safeMonitoringSpans(value: unknown): MonitoringTelemetrySpan[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((span) => {
    if (!isRecord(span) || !isMonitoringSpanKind(span.kind)) return [];
    return [{
      kind: span.kind,
      engine: isMonitoringEngine(span.engine) ? span.engine : undefined,
      form: isMonitoringForm(span.form) ? span.form : undefined,
      latencyMs: safeMonitoringNumber(span.latencyMs),
      hitCount: safeOptionalMonitoringNumber(span.hitCount),
      totalTokens: safeOptionalMonitoringNumber(span.totalTokens),
      status: isMonitoringHealthStatus(span.status) ? span.status : undefined
    }];
  });
}

function toMonitoringTelemetry(trace: StoredChatTrace): MonitoringTelemetry {
  const raw = trace as unknown as Record<string, unknown>;
  return {
    id: safeMonitoringId(raw.id),
    kind: raw.kind === "scenario_chat" ? "scenario_chat" : "global_chat",
    scope: raw.scope === "private" || raw.scope === "team" || raw.scope === "company" ? raw.scope : undefined,
    route: raw.route === "retrieve" ? "retrieve" : "direct",
    success: raw.success === true,
    citationCount: safeMonitoringNumber(raw.citationCount),
    hitSourceCount: safeMonitoringNumber(raw.hitSourceCount),
    totalLatencyMs: safeMonitoringNumber(raw.totalLatencyMs),
    totalTokens: safeMonitoringNumber(raw.totalTokens),
    engines: Array.isArray(raw.engines) ? raw.engines.filter(isMonitoringEngine) : [],
    forms: Array.isArray(raw.forms) ? raw.forms.filter(isMonitoringForm) : [],
    retrievalHealth: safeMonitoringRetrievalHealth(raw.retrievalHealth),
    feedback: safeMonitoringFeedback(raw.feedback),
    createdAt: safeMonitoringTimestamp(raw.createdAt)
  };
}

function toMonitoringTelemetryDetail(trace: StoredChatTrace): MonitoringTelemetryDetail {
  const raw = trace as unknown as Record<string, unknown>;
  return {
    ...toMonitoringTelemetry(trace),
    spans: safeMonitoringSpans(raw.spans)
  };
}

export type MonitoringTrendPoint = { date: string; queries: number; successRate: number; avgLatencyMs: number; downvotes: number; tokens: number };

// 趋势时序:按天聚合最近 14 天的问答量/成功率/延迟/差评/token(真 traces)。
export async function getMonitoringTrends(user: StoreUser): Promise<MonitoringTrendPoint[]> {
  if (user.role !== "admin") return [];
  // T1b-2：只加载 traces 集合（非整库），聚合逻辑不变。
  const traces = (await queryAllTraces()) as StoredChatTrace[];
  const byDay = new Map<string, StoredChatTrace[]>();
  for (const t of traces) {
    const day = (t.createdAt || "").slice(0, 10);
    if (!day) continue;
    const arr = byDay.get(day);
    if (arr) arr.push(t);
    else byDay.set(day, [t]);
  }
  const days = Array.from(byDay.keys()).sort().slice(-14);
  return days.map((date) => {
    const list = byDay.get(date) ?? [];
    const success = list.filter((t) => t.success).length;
    return {
      date,
      queries: list.length,
      successRate: list.length ? Math.round((success / list.length) * 100) : 0,
      avgLatencyMs: list.length ? Math.round(list.reduce((s, t) => s + t.totalLatencyMs, 0) / list.length) : 0,
      downvotes: list.filter((t) => t.feedback?.vote === "down").length,
      tokens: list.reduce((s, t) => s + (t.totalTokens ?? 0), 0)
    };
  });
}

// ─── 025 · 限流与成本护栏(FR-565~569)─────────────────────────────────────
// 语义:①入口闸先于一切 LLM 调用(被拒零 token,不落 chat trace,防污染评测分母,只 audit
// area=成本护栏)②配额/限流默认 0=不介入(可用性红线,公开部署前非零启用)③配额核算读失败
// → 放行 + console.warn(可用性优先的**显式决策**,生产环境可反转为 fail-closed——非静默)
// ④限流先于配额(便宜检查先行)。
export function dailyUsedTokens(traces: StoredChatTrace[], userId: string, now: Date): number {
  const day = now.toISOString().slice(0, 10); // UTC 日界
  return traces
    .filter((t) => t.userId === userId && String(t.createdAt ?? "").slice(0, 10) === day)
    .reduce((sum, t) => sum + (t.totalTokens ?? 0), 0);
}

// 用量聚合(admin-only;全量按用户 + 最近 14 天按天趋势,复用 getMonitoringTrends 的 byDay 模式)。
export async function aggregateLlmUsage(user: StoreUser): Promise<{
  totalTokens: number;
  byUser: Array<{ userId: string; userName: string; totalTokens: number; chats: number }>;
  byDay: Array<{ day: string; totalTokens: number; chats: number }>;
}> {
  if (user.role !== "admin") return { totalTokens: 0, byUser: [], byDay: [] };
  const db = await readDb();
  const traces = db.traces ?? [];
  const byUser = new Map<string, { userId: string; userName: string; totalTokens: number; chats: number }>();
  const byDay = new Map<string, { day: string; totalTokens: number; chats: number }>();
  let total = 0;
  const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  for (const t of traces) {
    const tokens = t.totalTokens ?? 0;
    total += tokens;
    const u = byUser.get(t.userId) ?? { userId: t.userId, userName: t.userName, totalTokens: 0, chats: 0 };
    u.totalTokens += tokens; u.chats += 1;
    byUser.set(t.userId, u);
    const day = String(t.createdAt ?? "").slice(0, 10);
    if (day && day >= cutoff) {
      const d = byDay.get(day) ?? { day, totalTokens: 0, chats: 0 };
      d.totalTokens += tokens; d.chats += 1;
      byDay.set(day, d);
    }
  }
  return {
    totalTokens: total,
    byUser: [...byUser.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    byDay: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1))
  };
}

export type ChatGuardResult =
  | { allowed: true }
  | { allowed: false; kind: "quota-exceeded" | "rate-limited"; message: string };

// 限流滑动窗(进程内 per-user;非持久,重启即清)。进程内 Map,不做历史 key TTL 清理;
// 跨进程/大规模限流见 025 spec §3.2(OUT,单进程教学形态不做)。
const chatRateWindow = new Map<string, number[]>();
export function __clearChatRateWindowForTest(): void {
  chatRateWindow.clear();
}

async function recordGuardRejection(user: StoreUser, kind: string, detail: string): Promise<void> {
  try {
    await withDbLock(async () => {
      const latest = await readDb();
      appendAuditEvent(latest, user, { area: "成本护栏", summary: `拒答(${kind}):${user.name}(${user.userId})`, impact: detail });
      await writeDb(latest);
    });
  } catch (error) {
    console.warn("[cost-guard] 拒绝审计写失败(旁路)", error);
  }
}

// 025 · FR-566/567:成本护栏入口闸(先于一切 LLM 调用——含多轮改写)。限流先(便宜检查)、配额后。
// opts.skipAudit:gateway 路径专用——该路径有 idempotencyKey 幂等短路(commitAgentChatGuardRejection)，
// audit 改延后到那里"确认是新拒答"才记，避免同 key 重发(网络重试)在这里先记一遍、幂等短路又记不到/漏记。
// legacy 路径无幂等 key，每次真实拒答就该当场记 audit，保持默认(不传 opts)行为不变。
export async function checkChatCostGuards(user: StoreUser, now?: Date, opts?: { skipAudit?: boolean }): Promise<ChatGuardResult> {
  const at = now ?? new Date();
  const rateLimit = Number(process.env.FF_CHAT_RATE_LIMIT ?? 0);
  if (rateLimit > 0) {
    const windowStart = at.getTime() - 60_000;
    const hits = (chatRateWindow.get(user.userId) ?? []).filter((ts) => ts > windowStart);
    if (hits.length >= rateLimit) {
      chatRateWindow.set(user.userId, hits);
      const message = `提问太频繁了:每分钟最多 ${rateLimit} 次,请稍等约一分钟后重试。`;
      if (!opts?.skipAudit) await recordGuardRejection(user, "rate-limited", `窗口内 ${hits.length}/${rateLimit} 次`);
      return { allowed: false, kind: "rate-limited", message };
    }
    chatRateWindow.set(user.userId, [...hits, at.getTime()]);
  }
  const quota = Number(process.env.FF_LLM_DAILY_TOKEN_QUOTA ?? 0);
  if (quota > 0) {
    try {
      const db = await readDb();
      const used = dailyUsedTokens(db.traces ?? [], user.userId, at);
      if (used >= quota) {
        const message = `今日 AI 用量已达上限(已用 ${used} / 配额 ${quota} tokens):明日自动恢复,或联系管理员调整配额。`;
        if (!opts?.skipAudit) await recordGuardRejection(user, "quota-exceeded", `已用 ${used}/${quota}`);
        return { allowed: false, kind: "quota-exceeded", message };
      }
    } catch (error) {
      // 显式决策:核算读失败 → 放行 + warn(可用性优先;生产可反转为 fail-closed)。
      console.warn("[cost-guard] 配额核算读失败,本次放行(可用性优先,生产可反转)", error);
    }
  }
  return { allowed: true };
}

// 测试造数缝(PG 版;替代 main 的 FF_PLATFORM_DATA_DIR 文件后门):直接覆盖 db.traces。
export async function __seedChatTracesForTest(traces: StoredChatTrace[]): Promise<void> {
  const db = await readDb();
  db.traces = traces;
  await writeDb(db);
}

export type GraphCurationSource = { sourceId: string; name: string; scenarioName: string; createdAt: string };
export type GraphCurationEntity = { id: string | null; name: string; type: string; description: string; source: string };
export type GraphCurationRelation = { id: string | null; source: string; target: string; description: string; weight: number | null };
export type GraphCurationDetail = {
  sourceId: string;
  sourceName: string;
  entities: GraphCurationEntity[];
  relations: GraphCurationRelation[];
  entityCount: number;
  relationCount: number;
  duplicateNames: string[];
};

async function recordCurationAudit(user: StoreUser, area: string, summary: string) {
  const db = await readDb();
  appendAuditEvent(db, user, { area, summary, impact: "图谱已更新" });
  await writeDb(db);
}

// 列出可 curate 的 GraphRAG 图谱源(来自真实入库的 moduleReferences)。
export async function listGraphCurationSources(user: StoreUser): Promise<GraphCurationSource[]> {
  if (user.role !== "admin") return [];
  const db = await readDb();
  const seen = new Map<string, GraphCurationSource>();
  const docCount = new Map<string, number>();
  for (const ref of db.moduleReferences ?? []) {
    if (ref.engine !== "GraphRAG" || !ref.sourceId) continue;
    docCount.set(ref.sourceId, (docCount.get(ref.sourceId) ?? 0) + 1);
    const existing = seen.get(ref.sourceId);
    if (!existing) {
      const scenario = db.scenarios.find((s) => s.id === ref.scenarioId);
      seen.set(ref.sourceId, {
        sourceId: ref.sourceId,
        name: String(ref.metadata.originalFileName ?? ref.sourceName),
        scenarioName: scenario?.name ?? "",
        createdAt: ref.createdAt
      });
    } else if (ref.createdAt > existing.createdAt) {
      existing.createdAt = ref.createdAt;
    }
  }
  // 场景级图谱可聚合多篇文档：多篇时标签改「首篇 等 N 篇」，避免只显首篇文件名让多文档源看着像单篇。
  for (const src of seen.values()) {
    const n = docCount.get(src.sourceId) ?? 1;
    if (n > 1) src.name = `${src.name} 等 ${n} 篇`;
  }
  return Array.from(seen.values());
}

// 拉取某图谱源的实体+关系(真调 graph-rag curation/detail)。
export async function getGraphCurationDetail(user: StoreUser, sourceId: string): Promise<GraphCurationDetail | null> {
  if (user.role !== "admin") return null;
  const admin: StoreUser = { ...user, role: "admin" };
  // 逐页拉全实体：后端 graph_detail 按 page/page_size 分页、has_more 显式，关系随全图全返。
  // 只取首页会让去重/合并/计数都不完整，故循环累加所有页（批2.5）。
  const entities: GraphCurationEntity[] = [];
  let sourceIdOut = sourceId;
  let sourceName = "";
  let relations: GraphCurationRelation[] = [];
  let relationCount = 0;
  let page = 0;
  for (;;) {
    const raw = await moduleJson<{
      source_id: string; source_name: string;
      entities: GraphCurationEntity[]; relations: GraphCurationRelation[];
      entity_count: number; relation_count: number;
      total_entities: number; has_more: boolean; page: number;
    }>("GraphRAG", `/graph/curation/detail?source_id=${encodeURIComponent(sourceId)}&page=${page}`, { method: "GET", user: admin });
    if (page === 0) {
      sourceIdOut = raw.source_id;
      sourceName = raw.source_name;
      relations = raw.relations;
      relationCount = raw.relation_count;
    }
    entities.push(...raw.entities);
    if (!raw.has_more || raw.entities.length === 0) break;
    page += 1;
  }
  const counts = new Map<string, number>();
  for (const e of entities) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  const duplicateNames = Array.from(counts.entries()).filter(([, c]) => c > 1).map(([n, c]) => `${n} ×${c}`);
  return {
    sourceId: sourceIdOut,
    sourceName,
    entities,
    relations,
    entityCount: entities.length,
    relationCount,
    duplicateNames
  };
}

export async function mergeGraphCurationEntities(user: StoreUser, input: { sourceId: string; sourceEntities: string[]; targetEntity: string }): Promise<{ ok: boolean; message?: string }> {
  if (user.role !== "admin") throw new Error("仅管理员可编辑图谱");
  await moduleJson("GraphRAG", "/graph/curation/entities/merge", { method: "POST", user, body: { source_id: input.sourceId, source_entities: input.sourceEntities, target_entity: input.targetEntity } });
  await recordCurationAudit(user, "图谱治理", `合并实体 ${input.sourceEntities.join("、")} → ${input.targetEntity}`);
  return { ok: true, message: `已合并为「${input.targetEntity}」` };
}

export async function editGraphCurationEntity(user: StoreUser, input: { sourceId: string; entityName: string; newName?: string; entityType?: string; description?: string }): Promise<{ ok: boolean; message?: string }> {
  if (user.role !== "admin") throw new Error("仅管理员可编辑图谱");
  const updated: Record<string, string> = {};
  if (input.newName && input.newName !== input.entityName) updated.entity_name = input.newName;
  if (input.entityType) updated.entity_type = input.entityType;
  if (typeof input.description === "string") updated.description = input.description;
  await moduleJson("GraphRAG", "/graph/curation/entities/edit", { method: "POST", user, body: { source_id: input.sourceId, entity_name: input.entityName, updated_data: updated } });
  await recordCurationAudit(user, "图谱治理", `编辑实体 ${input.entityName}`);
  return { ok: true, message: "已保存" };
}

export async function deleteGraphCurationEntity(user: StoreUser, input: { sourceId: string; entityName: string }): Promise<{ ok: boolean; message?: string }> {
  if (user.role !== "admin") throw new Error("仅管理员可编辑图谱");
  await moduleJson("GraphRAG", "/graph/curation/entities/delete", { method: "POST", user, body: { source_id: input.sourceId, entity_name: input.entityName } });
  await recordCurationAudit(user, "图谱治理", `删除实体 ${input.entityName}`);
  return { ok: true, message: `已删除「${input.entityName}」` };
}

export async function deleteGraphCurationRelation(user: StoreUser, input: { sourceId: string; sourceEntity: string; targetEntity: string }): Promise<{ ok: boolean; message?: string }> {
  if (user.role !== "admin") throw new Error("仅管理员可编辑图谱");
  await moduleJson("GraphRAG", "/graph/curation/relations/delete", { method: "POST", user, body: { source_id: input.sourceId, source_entity: input.sourceEntity, target_entity: input.targetEntity } });
  await recordCurationAudit(user, "图谱治理", `删除关系 ${input.sourceEntity}→${input.targetEntity}`);
  return { ok: true, message: "已删除关系" };
}

// P25 批2：治理台增删补齐（建实体 / 建关系 / 删源；后端 API 已存在，删源须同步清平台引用一致性）
export async function createGraphCurationEntity(user: StoreUser, input: { sourceId: string; entityName: string; entityType: string; description?: string }): Promise<{ ok: boolean; message?: string }> {
  if (user.role !== "admin") throw new Error("仅管理员可编辑图谱");
  await moduleJson("GraphRAG", "/graph/curation/entities/create", { method: "POST", user, body: { source_id: input.sourceId, entity_name: input.entityName, entity_type: input.entityType, description: input.description ?? "" } });
  await recordCurationAudit(user, "图谱治理", `新建实体 ${input.entityName}`);
  return { ok: true, message: "已保存" };
}

export async function createGraphCurationRelation(user: StoreUser, input: { sourceId: string; sourceEntity: string; targetEntity: string; description?: string; keywords?: string; weight?: number }): Promise<{ ok: boolean; message?: string }> {
  if (user.role !== "admin") throw new Error("仅管理员可编辑图谱");
  await moduleJson("GraphRAG", "/graph/curation/relations/create", { method: "POST", user, body: { source_id: input.sourceId, source_entity: input.sourceEntity, target_entity: input.targetEntity, description: input.description ?? "", keywords: input.keywords ?? "", weight: input.weight } });
  await recordCurationAudit(user, "图谱治理", `新建关系 ${input.sourceEntity} -> ${input.targetEntity}`);
  return { ok: true, message: "已保存" };
}

export async function deleteGraphCurationSource(user: StoreUser, input: { sourceId: string }): Promise<{ ok: boolean; message?: string }> {
  if (user.role !== "admin") throw new Error("仅管理员可编辑图谱");
  // 后端删源与平台引用清理是两件事：后端对已消失的源报 404、或临时 500 时，
  // 平台侧仍必须清掉 moduleReferences/knowledgeObjects，否则残留源永远挂在治理台列表（见 I131）。
  // 故后端删除失败降级为告警继续清引用；404/not_found 视为「已删」静默，其它失败在结果里诚实标注。
  let backendNote = "";
  try {
    await moduleJson("GraphRAG", `/graph/sources/${input.sourceId}`, { method: "DELETE", user });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    backendNote = /HTTP 404|not_found/i.test(msg)
      ? "（后端图谱源已不存在，按已删处理）"
      : `（后端删除未成功：${msg.slice(0, 120)}，已仅清理平台引用）`;
  }
  const db = await readDb();
  const deletedGraphFileIds = new Set(
    (db.moduleReferences ?? [])
      .filter((r) => r.engine === "GraphRAG" && r.sourceId === input.sourceId)
      .map((r) => r.sourceFileId)
  );

  // P40 §三【1】删除幂等（真缺陷修复）：GraphRAG 源删除后，其 P38 B Naive 兜底副本不随删会
  // 变成孤儿，继续被全域问答按 documentId 归因召回（脏数据）。这里连带清理——purge Naive
  // **document**（不删 source：Naive source 是场景级 `scene-…-naive` 多文件共享，删 source 会
  // 误删同场景其他文件，见 spec §三【1】）+ 清对应平台 ref/KO/artifact + file 双 ID。
  const naiveRefsToPurge = (db.moduleReferences ?? []).filter(
    (r) => r.engine === "Naive RAG" && deletedGraphFileIds.has(r.sourceFileId)
  );
  const naiveFailures: string[] = [];
  for (const ref of naiveRefsToPurge) {
    if (!ref.documentId) continue;
    try {
      await moduleJson("Naive RAG", `/traditional/documents/${encodeURIComponent(ref.documentId)}?purge=true`, { method: "DELETE", user });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/HTTP 404|not_found/i.test(msg)) naiveFailures.push(`${ref.sourceName}: ${msg.slice(0, 120)}`);
    }
  }
  const naiveNote =
    naiveRefsToPurge.length === 0
      ? ""
      : naiveFailures.length > 0
        ? `（Naive 兜底副本清理 ${naiveFailures.length}/${naiveRefsToPurge.length} 后端删除未成功，已仅清理平台引用：${naiveFailures.join("；").slice(0, 200)}）`
        : `（已同步清理 ${naiveRefsToPurge.length} 份 Naive 兜底副本）`;

  const naiveArtifactIdsToRemove = new Set(
    db.parsedArtifacts.filter((a) => a.ragEngine === "Naive RAG" && deletedGraphFileIds.has(a.sourceFileId)).map((a) => a.id)
  );
  const naiveKoIdsToRemove = new Set(
    db.knowledgeObjects.filter((k) => k.ragEngine === "Naive RAG" && deletedGraphFileIds.has(k.sourceFileId)).map((k) => k.id)
  );
  const naiveRefIdsToRemove = new Set(naiveRefsToPurge.map((r) => r.id));

  db.moduleReferences = (db.moduleReferences ?? []).filter(
    (r) => !(r.engine === "GraphRAG" && r.sourceId === input.sourceId) && !naiveRefIdsToRemove.has(r.id)
  );
  db.knowledgeObjects = db.knowledgeObjects.filter(
    (k) =>
      !(k.ragEngine === "GraphRAG" && (k.moduleReferences ?? []).some((r) => r.sourceId === input.sourceId)) &&
      !naiveKoIdsToRemove.has(k.id)
  );
  db.parsedArtifacts = db.parsedArtifacts.filter((a) => !naiveArtifactIdsToRemove.has(a.id));
  if (naiveArtifactIdsToRemove.size > 0 || naiveKoIdsToRemove.size > 0) {
    db.files = db.files.map((file) =>
      deletedGraphFileIds.has(file.id)
        ? {
            ...file,
            parsedArtifactIds: (file.parsedArtifactIds ?? []).filter((id) => !naiveArtifactIdsToRemove.has(id)),
            knowledgeObjectIds: (file.knowledgeObjectIds ?? []).filter((id) => !naiveKoIdsToRemove.has(id))
          }
        : file
    );
  }

  await writeDb(db);
  await recordCurationAudit(user, "图谱治理", `删除图谱源 ${input.sourceId}${backendNote}${naiveNote}`);
  return { ok: true, message: `已删除${backendNote}${naiveNote}` };
}

// ===== 文档型(Naive RAG)chunk 可编辑管理 =====
export type DocChunk = { id: string; chunkIndex: number; text: string; charCount: number };
export type NaiveDocument = { documentId: string; sourceId: string; name: string; scenarioName: string; createdAt: string };

export async function listNaiveDocuments(user: StoreUser): Promise<NaiveDocument[]> {
  if (user.role !== "admin") return [];
  const db = await readDb();
  const seen = new Map<string, NaiveDocument>();
  for (const ref of db.moduleReferences ?? []) {
    if (ref.engine !== "Naive RAG" || !ref.documentId) continue;
    const existing = seen.get(ref.documentId);
    if (!existing) {
      const scenario = db.scenarios.find((s) => s.id === ref.scenarioId);
      seen.set(ref.documentId, { documentId: ref.documentId, sourceId: ref.sourceId, name: String(ref.metadata.originalFileName ?? ref.sourceName), scenarioName: scenario?.name ?? "", createdAt: ref.createdAt });
    } else if (ref.createdAt > existing.createdAt) {
      existing.createdAt = ref.createdAt;
    }
  }
  return Array.from(seen.values());
}

export async function getDocumentChunks(user: StoreUser, documentId: string): Promise<DocChunk[]> {
  if (user.role !== "admin") return [];
  const admin: StoreUser = { ...user, role: "admin" };
  let raw: { chunks: Array<{ id: string; chunk_index: number; chunk_text?: string; text?: string }> };
  try {
    raw = await moduleJson<{ chunks: Array<{ id: string; chunk_index: number; chunk_text?: string; text?: string }> }>("Naive RAG", `/traditional/documents/${encodeURIComponent(documentId)}/chunks`, { method: "GET", user: admin });
  } catch (error) {
    // 文档已在模块侧删除/归档（404 not_found）时优雅返回空 chunk，避免管理页整页 500；
    // 平台引用与模块数据不一致（如直删 DB 造成的孤儿引用）时页面仍可用，显示「暂无 chunk」。
    // 窄匹配 moduleCall 抛错格式「…{path}: HTTP 404 {body}」的状态段，避免误匹配响应 body 里的 "HTTP 404"（codex NIT）。
    if (error instanceof Error && /: HTTP 404\b/.test(error.message)) return [];
    throw error;
  }
  return (raw.chunks ?? []).map((c) => {
    const text = c.chunk_text ?? c.text ?? "";
    return { id: c.id, chunkIndex: c.chunk_index, text, charCount: text.length };
  });
}

export async function deleteDocumentChunk(user: StoreUser, input: { documentId: string; chunkId: string }): Promise<{ ok: boolean; message?: string }> {
  if (user.role !== "admin") throw new Error("仅管理员可编辑文档 chunk");
  const res = await moduleJson<{ deleted: boolean }>("Naive RAG", `/traditional/documents/${encodeURIComponent(input.documentId)}/chunks/${encodeURIComponent(input.chunkId)}`, { method: "DELETE", user });
  await recordCurationAudit(user, "文档治理", `删除文档 ${input.documentId.slice(0, 8)} 的 chunk ${input.chunkId.slice(0, 8)}`);
  return { ok: res.deleted, message: res.deleted ? "已删除该 chunk" : "未找到该 chunk" };
}

// ===== 知识页型(Gbrain/Nano)页面可编辑管理 =====
// scenarioName：该页所属场景名（P18 补充，供右列渲染"场景 · xxx"次行）；无匹配 ref 时为 ""。
export type KnowledgePageItem = { sourceId: string; pageId?: string; slug: string; title: string; body: string; contentType?: string; scenarioName?: string; updatedAt: string };
// P20：Gbrain 左列是展示层知识空间桶。pageCount 沿用 P18 ref 近似统计，权威计数以右列模块返回为准。
export type GbrainPageSource = { bucketId: string; name: string; scenarioName: string; ownerName: string; pageCount: number };

function normalizeGbrainBucketRef(ref: StoredModuleReference, scenario?: StoredScenario) {
  const sourceKind = ref.sourceKind ?? (scenario ? sourceKindForScenario(scenario) : "private");
  const ownerUserId = ref.accessControl?.ownerUserId ?? scenario?.ownerUserId ?? "unknown";
  const ownerName = ref.accessControl?.ownerName ?? scenario?.ownerName ?? "未知归属";
  const organizationId = ref.accessControl?.organizationId ?? scenario?.organizationId ?? "";
  const bucketId = sourceKind === "public" ? `pub:${organizationId || "_"}` : `pri:${ownerUserId}`;
  const name = sourceKind === "public" ? "公司公共知识空间" : `${ownerName}的知识空间`;
  return { bucketId, name, ownerName, scenarioName: scenario?.name ?? "" };
}

export async function listGbrainPageSources(user: StoreUser): Promise<GbrainPageSource[]> {
  if (user.role !== "admin") return [];
  const db = await readDb();
  const seen = new Map<string, GbrainPageSource & { scenarioNames: Set<string> }>();
  for (const ref of db.moduleReferences ?? []) {
    if (ref.engine !== "Gbrain" || !ref.sourceId) continue;
    const scenario = db.scenarios.find((s) => s.id === ref.scenarioId);
    const bucket = normalizeGbrainBucketRef(ref, scenario);
    const existing = seen.get(bucket.bucketId);
    if (existing) {
      existing.pageCount += 1;
      if (bucket.scenarioName) existing.scenarioNames.add(bucket.scenarioName);
      continue;
    }
    seen.set(bucket.bucketId, { bucketId: bucket.bucketId, name: bucket.name, scenarioName: bucket.scenarioName, ownerName: bucket.ownerName, pageCount: 1, scenarioNames: new Set(bucket.scenarioName ? [bucket.scenarioName] : []) });
  }
  return Array.from(seen.values())
    .map(({ scenarioNames, ...bucket }) => ({ ...bucket, scenarioName: scenarioNames.size > 1 ? `${scenarioNames.size} 个场景` : (scenarioNames.values().next().value ?? "") }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN") || a.bucketId.localeCompare(b.bucketId));
}

export async function listGbrainPages(user: StoreUser, bucketId: string): Promise<KnowledgePageItem[]> {
  if (user.role !== "admin") return [];
  if (!bucketId) return [];
  const admin: StoreUser = { ...user, role: "admin" };
  const db = await readDb();
  const sourceIds = new Set<string>();
  const scenarioNameByPageId = new Map<string, string>();
  const scenarioNameBySlug = new Map<string, string>();
  const updatedAtByPageId = new Map<string, string>();
  const updatedAtBySlug = new Map<string, string>();
  for (const ref of db.moduleReferences ?? []) {
    if (ref.engine !== "Gbrain" || !ref.sourceId) continue;
    const scenario = db.scenarios.find((s) => s.id === ref.scenarioId);
    const bucket = normalizeGbrainBucketRef(ref, scenario);
    if (bucket.bucketId !== bucketId) continue;
    sourceIds.add(ref.sourceId);
    // P21：createdAt 填充独立于 scenarioName（在 continue 之前），同 key 取 max，防漏无场景名的页。
    if (ref.pageId) {
      const key = `${ref.sourceId}::${ref.pageId}`;
      const prev = updatedAtByPageId.get(key);
      if (!prev || ref.createdAt > prev) updatedAtByPageId.set(key, ref.createdAt);
    }
    const metaSlug = typeof ref.metadata?.slug === "string" ? ref.metadata.slug : undefined;
    if (metaSlug) {
      const key = `${ref.sourceId}::${metaSlug}`;
      const prev = updatedAtBySlug.get(key);
      if (!prev || ref.createdAt > prev) updatedAtBySlug.set(key, ref.createdAt);
    }
    const scenarioName = scenario?.name ?? "";
    if (!scenarioName) continue;
    if (ref.pageId) scenarioNameByPageId.set(`${ref.sourceId}::${ref.pageId}`, scenarioName);
    if (metaSlug) scenarioNameBySlug.set(`${ref.sourceId}::${metaSlug}`, scenarioName);
  }
  const pages: KnowledgePageItem[] = [];
  const seen = new Set<string>();
  for (const sourceId of Array.from(sourceIds).sort()) {
    try {
      const raw = await moduleJson<{ pages: Array<{ id?: string; slug: string; title: string; body?: string; content?: string; content_type?: string }> }>("Gbrain", `/nano/sources/${encodeURIComponent(sourceId)}/pages`, { method: "GET", user: admin });
      for (const p of raw.pages ?? []) {
        const key = `${sourceId}::${p.slug}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pages.push({
          sourceId,
          pageId: p.id,
          slug: p.slug,
          title: p.title,
          body: p.body ?? p.content ?? "",
          contentType: p.content_type,
          scenarioName: (p.id ? scenarioNameByPageId.get(`${sourceId}::${p.id}`) : undefined) ?? scenarioNameBySlug.get(`${sourceId}::${p.slug}`) ?? "",
          updatedAt: (p.id ? updatedAtByPageId.get(`${sourceId}::${p.id}`) : undefined) ?? updatedAtBySlug.get(`${sourceId}::${p.slug}`) ?? ""
        });
      }
    } catch {
      continue;
    }
  }
  return pages.sort((a, b) => (a.scenarioName ?? "").localeCompare(b.scenarioName ?? "", "zh-Hans-CN") || a.title.localeCompare(b.title, "zh-Hans-CN") || a.sourceId.localeCompare(b.sourceId) || a.slug.localeCompare(b.slug));
}

export async function editGbrainPage(user: StoreUser, input: { sourceId: string; slug: string; title: string; body: string }): Promise<{ ok: boolean; message?: string }> {
  if (user.role !== "admin") throw new Error("仅管理员可编辑知识页");
  await moduleJson("Gbrain", `/nano/pages/${encodeURIComponent(input.sourceId)}/${encodeURIComponent(input.slug)}`, { method: "PUT", user, body: { title: input.title, body: input.body, content_type: "text/markdown" } });
  await recordCurationAudit(user, "知识页治理", `编辑知识页 ${input.title}`);
  return { ok: true, message: "已保存并重新索引" };
}

export type MonitoringFormPanels = {
  文档型: { sources: Array<{ name: string; hits: number; queries: number }>; zeroHitSources: number };
  图谱型: { entities: number; relations: number; sources: number; duplicateCandidates: string[]; sampleEntities: string[]; available: boolean };
  知识页型: { traceableRate: number; knowledgePages: number; latestPageAgeHours: number | null };
};

// 三形态差异化深度监控面板(各自原生指标,全部真数据)。
export async function getMonitoringFormPanels(user: StoreUser): Promise<MonitoringFormPanels> {
  const empty: MonitoringFormPanels = {
    文档型: { sources: [], zeroHitSources: 0 },
    图谱型: { entities: 0, relations: 0, sources: 0, duplicateCandidates: [], sampleEntities: [], available: false },
    知识页型: { traceableRate: 0, knowledgePages: 0, latestPageAgeHours: null }
  };
  if (user.role !== "admin") return empty;
  const db = await readDb();
  const traces = db.traces ?? [];

  // 文档型:Naive RETRIEVER span 的来源命中分布
  const naiveSpans = traces.flatMap((t) => t.spans).filter((s) => s.kind === "RETRIEVER" && s.engine === "Naive RAG");
  const sourceMap = new Map<string, { hits: number; queries: number }>();
  for (const s of naiveSpans) {
    const name = s.sourceName ?? "未知来源";
    const cur = sourceMap.get(name) ?? { hits: 0, queries: 0 };
    cur.queries += 1;
    cur.hits += s.hitCount ?? 0;
    sourceMap.set(name, cur);
  }
  const docSources = Array.from(sourceMap.entries()).map(([name, v]) => ({ name, hits: v.hits, queries: v.queries })).sort((a, b) => b.queries - a.queries);
  const 文档型 = { sources: docSources.slice(0, 12), zeroHitSources: docSources.filter((s) => s.hits === 0).length };

  // 图谱型:调用真 graph-rag /graph/graph-stats
  let 图谱型: MonitoringFormPanels["图谱型"] = { entities: 0, relations: 0, sources: 0, duplicateCandidates: [], sampleEntities: [], available: false };
  try {
    const stats = await moduleJson<{ entities: number; relations: number; sources: number; duplicate_candidates: string[]; sample_entities: string[] }>(
      "GraphRAG",
      "/graph/graph-stats",
      { method: "GET", user: { ...user, role: "admin" } }
    );
    图谱型 = {
      entities: stats.entities ?? 0,
      relations: stats.relations ?? 0,
      sources: stats.sources ?? 0,
      duplicateCandidates: stats.duplicate_candidates ?? [],
      sampleEntities: stats.sample_entities ?? [],
      available: true
    };
  } catch {
    图谱型.available = false;
  }

  // 知识页型:Gbrain 引用可追溯率 + 知识页规模/新鲜度
  const gbrainTraces = traces.filter((t) => t.forms.includes("知识页型"));
  const gbrainTraceable = gbrainTraces.filter((t) => t.spans.some((s) => s.kind === "RETRIEVER" && s.engine === "Gbrain" && (s.hitCount ?? 0) > 0)).length;
  const knowledgePages = db.knowledgeObjects.filter((k) => k.ragEngine === "Gbrain").length;
  const latestGbrain = db.knowledgeObjects.filter((k) => k.ragEngine === "Gbrain").map((k) => new Date(k.createdAt).getTime()).sort((a, b) => b - a)[0];
  const 知识页型 = {
    traceableRate: gbrainTraces.length ? Math.round((gbrainTraceable / gbrainTraces.length) * 100) : 0,
    knowledgePages,
    latestPageAgeHours: latestGbrain ? Math.round((Date.now() - latestGbrain) / 3600000) : null
  };

  return { 文档型, 图谱型, 知识页型 };
}

export type StoredRuntimeConfig = {
  rerankTopN?: number;
  rerankMinScore?: number;
  perSourceTimeoutMs?: number;
  sourceFanout?: number;
  candidatePoolSize?: number;
};

export type StoredEngineRetrievalConfig = Partial<Record<AdminRagEngine, { topK?: number; minScore?: number; mode?: string; chunkTopK?: number; maxTotalTokens?: number; enableRerank?: boolean; linkDepth?: number }>>;

type PlatformDb = {
  scenarios: StoredScenario[];
  tasks: StoreTask[];
  files: StoredFileRecord[];
  parsedArtifacts: StoredParsedArtifact[];
  knowledgeObjects: StoredKnowledgeObject[];
  moduleReferences: StoredModuleReference[];
  chatSessions: StoredGlobalChatSession[];
  scenarioChatSessions: StoredScenarioChatSession[];
  templates: StoredAdminTemplate[];
  auditEvents: StoredAdminAuditEvent[];
  traces: StoredChatTrace[];
  runtimeConfig?: StoredRuntimeConfig;
  engineRetrievalConfig?: StoredEngineRetrievalConfig;
  ingestQueue?: IngestQueueJob[];
  notifications?: StoredNotification[];
};

const emptyDb = (): PlatformDb => ({
  scenarios: [],
  tasks: [],
  files: [],
  parsedArtifacts: [],
  knowledgeObjects: [],
  moduleReferences: [],
  chatSessions: [],
  scenarioChatSessions: [],
  templates: [],
  auditEvents: [],
  traces: [],
  ingestQueue: [],
  notifications: []
});

export async function resetPlatformStore() {
  await truncateAllPg();
  // 文件字节仍存 FS（T1b-1 未迁 PG），一并清空。
  await rm(dataRoot(), { recursive: true, force: true });
  // 025：限流滑动窗是进程内 Map，非 PG 持久态，整库 truncate 顺带复位，防跨测试状态污染。
  chatRateWindow.clear();
  // 022b：并发 gate/claim 防重入 Set 同样是进程内运行时态，非 PG 持久态，一并复位。
  __resetIngestRuntimeStateForTest();
  // 018：卡生成器覆盖/调用计数/reservation 同样是进程内运行时态，一并复位防跨测试污染。
  __resetSourceCardRuntimeStateForTest();
  // 024：通知写失败注入开关同样是进程内运行时态，一并复位防跨测试污染(AM-2407)。
  __notifyFailureInjectedForTest = false;
}

type ScenarioCreateInput = {
  templateId: string;
  name: string;
  description: string;
  visibility: StoreVisibility;
  processingGoal: string;
  files: StoreUploadFile[];
};

export async function createStoredScenario(actor: StoreUser, input: ScenarioCreateInput): Promise<{ scenario: StoredScenario; task: ProcessingTask; files: StoredFileRecord[] }> {
  if (!hasValidCallerIdentity(actor)) throw new Error("invalid actor");
  if ((input.visibility === "team" || input.visibility === "company") && !hasExplicitOrganization(actor)) throw new Error("invalid actor organization");
  if (input.visibility === "team" && !hasExplicitTeam(actor)) throw new Error("invalid actor team");
  const db = await readDb();
  const now = new Date().toISOString();
  const scenarioId = `scene_${randomUUID()}`;
  const taskId = `task_${randomUUID()}`;
  const uploadDir = join(dataRoot(), "uploads", scenarioId);
  await mkdir(uploadDir, { recursive: true });
  const accessControl = accessControlFor(input.visibility, actor);

  const fileRecords: StoredFileRecord[] = [];
  for (const file of input.files) {
    const fileId = `file_${randomUUID()}`;
    const storedName = `${fileId}_${safeFileName(file.name)}`;
    const relativePath = join("uploads", scenarioId, storedName);
    await writeFile(join(dataRoot(), relativePath), file.bytes);
    fileRecords.push({
      id: fileId,
      scenarioId,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.bytes.byteLength,
      relativePath,
      uploadedAt: now,
      originalState: "temporary",
      originalAvailable: true,
      retentionPolicy: retentionPolicyForFile(file.name, file.type),
      retentionReason: retentionReasonForPolicy(retentionPolicyForFile(file.name, file.type)),
      accessControl,
      parsedArtifactIds: [],
      knowledgeObjectIds: []
    });
  }

  const scenario: StoredScenario = {
    id: scenarioId,
    templateId: input.templateId,
    name: input.name,
    description: input.description,
    visibility: input.visibility,
    ownerUserId: actor.userId,
    ownerName: actor.name,
    organizationId: accessControl.organizationId,
    teamIds: accessControl.teamIds,
    accessControl,
    status: "submitted",
    sourceCount: fileRecords.length,
    processingGoal: input.processingGoal,
    createdAt: now,
    updatedAt: now
  };

  const task: StoreTask = {
    id: taskId,
    scenarioId,
    title: `创建${input.name}`,
    status: "submitted",
    kind: "管理员确认",
    ragMode: ragModeForTemplate(input.templateId),
    visibility: input.visibility,
    owner: actor.name,
    ownerUserId: actor.userId,
    submittedAt: "刚刚",
    updatedAt: "刚刚",
    files: fileRecords.map((file) => file.originalName),
    waitingFor: fileRecords.length > 0 ? "后台管理员" : "用户补充资料",
    progress: fileRecords.length > 0 ? 18 : 6,
    currentStep: fileRecords.length > 0 ? "等待后台配置引擎策略" : "等待补充资料",
    userMessage: fileRecords.length > 0
      ? `场景资料包已提交，后台将确认资料质量并配置入库检索策略。处理诉求：${input.processingGoal}`
      : "场景已创建，但还需要补充资料包后才能进入后台处理。",
    nextActions: fileRecords.length > 0 ? ["查看任务中心", "补充资料", "等待后台确认"] : ["继续上传资料"],
    adminEntry: fileRecords.length > 0 ? "待管理员配置 RAG 引擎策略并确认入库" : "等待用户补充资料",
    createdAt: now
  };

  db.scenarios.unshift(scenario);
  db.tasks.unshift(task);
  db.files.unshift(...fileRecords);
  await writeDb(db);
  return { scenario, task: stripInternalTask(task), files: fileRecords };
}

export async function listStoredTasks(user: StoreUser): Promise<ProcessingTask[]> {
  const db = await readDb();
  const allowedScenarioIds = new Set(db.scenarios.filter((scenario) => canReadScenario(user, scenario)).map((scenario) => scenario.id));
  return db.tasks
    .filter((task) => allowedScenarioIds.has(task.scenarioId))
    .map((task) => stripInternalTask(toDisplayTask(task)));
}

export async function listStoredScenarios(user: StoreUser): Promise<StoredScenario[]> {
  const db = await readDb();
  return db.scenarios.filter((scenario) => canReadScenario(user, scenario));
}

export async function getStoredScenarioWorkbench(user: StoreUser, scenarioId: string): Promise<StoredScenarioWorkbench | null> {
  const db = await readDb();
  const scenario = db.scenarios.find((item) => item.id === scenarioId);
  if (!scenario || !canReadScenario(user, scenario)) return null;
  const tasks = db.tasks
    .filter((task) => task.scenarioId === scenario.id)
    .map((task) => stripInternalTask(toDisplayTask(task)));
  const knowledgeObjects = db.knowledgeObjects.filter((item) => item.scenarioId === scenario.id && canReadKnowledgeObject(user, item));
  const template = adminTemplateForScenario(db, scenario.templateId);
  return {
    scenario,
    template,
    surface: buildScenarioProductSurface(template.id, { productForm: template.productForm } as Pick<ScenarioTemplate, "productForm">),
    tasks,
    knowledgeObjects
  };
}

export async function listStoredKnowledgeObjects(user: StoreUser): Promise<StoredKnowledgeObject[]> {
  const db = await readDb();
  return db.knowledgeObjects.filter((item) => canReadKnowledgeObject(user, item));
}

export async function getStoredPlatformSnapshot(user: StoreUser) {
  const db = await readDb();
  const scenarios = db.scenarios.filter((scenario) => canReadScenario(user, scenario));
  const allowedScenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  const tasks = db.tasks
    .filter((task) => allowedScenarioIds.has(task.scenarioId))
    .map((task) => stripInternalTask(toDisplayTask(task)));
  const knowledgeObjects = db.knowledgeObjects.filter((item) => canReadKnowledgeObject(user, item));
  return {
    scenarios,
    tasks,
    knowledge: knowledgeObjects
  };
}

export async function getStoredFilePreview(user: StoreUser, fileId: string): Promise<StoredFilePreview | null> {
  if (user.role !== "admin") return null;
  const db = await readDb();
  const file = db.files.map(normalizeFileRecord).find((item) => item.id === fileId);
  if (!file || !file.originalAvailable || file.originalState === "deleted") return null;
  try {
    const bytes = await readFile(join(dataRoot(), file.relativePath));
    return { file, bytes };
  } catch {
    return null;
  }
}

export async function listAdminIntakeRequests(user: StoreUser): Promise<StoredAdminIntakeRequest[]> {
  if (user.role !== "admin") return [];
  const db = await readDb();
  return db.tasks.map((task) => toAdminIntakeRequest(task, db));
}

export async function listAdminAuditEvents(user: StoreUser): Promise<StoredAdminAuditEvent[]> {
  if (user.role !== "admin") return [];
  // T1b-2：逐行 SQL 读，等价 [...auditEvents].sort(b.createdAt.localeCompare)。不再整库加载。
  return (await queryAuditEventsDesc()) as StoredAdminAuditEvent[];
}

export type IngestQueueSummary = {
  counts: { queued: number; running: number; done: number; failed: number };
  jobs: Array<Pick<IngestQueueJob, "id" | "taskId" | "scenarioId" | "selectedEngine" | "status" | "attempts" | "enqueuedAt" | "updatedAt" | "lastError" | "dedupGuaranteed">>;
};

// 022b T2 · 可观测（AM-2210）：各态计数 + 逐 job attempts/lastError，供后台管线页/诊断使用。
export async function listIngestQueue(user: StoreUser): Promise<IngestQueueSummary> {
  if (user.role !== "admin") return { counts: { queued: 0, running: 0, done: 0, failed: 0 }, jobs: [] };
  const db = await readDb();
  const jobs = db.ingestQueue ?? [];
  const counts = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const job of jobs) counts[job.status] += 1;
  return {
    counts,
    jobs: jobs.map((job) => ({
      id: job.id,
      taskId: job.taskId,
      scenarioId: job.scenarioId,
      selectedEngine: job.selectedEngine,
      status: job.status,
      attempts: job.attempts,
      enqueuedAt: job.enqueuedAt,
      updatedAt: job.updatedAt,
      lastError: job.lastError,
      dedupGuaranteed: job.dedupGuaranteed
    }))
  };
}

type RuntimeConfigField = {
  key: keyof StoredRuntimeConfig;
  label: string;
  impact: string;
  envName: string;
  defaultValue: number;
  min: number;
  max: number;
  integer: boolean;
  step: number;
  unit?: string;
};

// 运行策略可编辑配置的单一真相源：label/impact 与 UI 展示一致，校验范围与默认值集中于此。
const RUNTIME_CONFIG_FIELDS: RuntimeConfigField[] = [
  {
    key: "rerankTopN",
    label: "本轮来源 TopK",
    impact: "全域问答最终展示的来源条数（rerank 取 top-k）",
    envName: "RERANK_TOP_N",
    defaultValue: 5,
    min: 1,
    max: 20,
    integer: true,
    step: 1
  },
  {
    key: "rerankMinScore",
    label: "相关性阈值",
    impact: "rerank 相关度低于此分的来源被剔除",
    envName: "RERANK_MIN_SCORE",
    defaultValue: 0.4,
    min: 0,
    max: 1,
    integer: false,
    step: 0.01
  },
  {
    key: "perSourceTimeoutMs",
    label: "每源检索超时",
    impact: "限速环境下给慢源更多时间，避免相关源超时漏召回",
    envName: "FF_GLOBAL_RETRIEVAL_TIMEOUT_MS",
    defaultValue: 20000,
    min: 1000,
    max: 120000,
    integer: true,
    step: 1000,
    unit: "ms"
  },
  {
    key: "sourceFanout",
    label: "检索来源数上限",
    impact: "全域问答一次最多检索几个逐源引擎来源（Gbrain/GraphRAG，去重后）；Naive 走全量单次全局检索，不受此限",
    envName: "FF_GLOBAL_SOURCE_FANOUT",
    defaultValue: 8,
    min: 1,
    max: 20,
    integer: true,
    step: 1
  },
  {
    key: "candidatePoolSize",
    label: "重排候选池",
    impact: "送入 rerank 前的跨来源候选条数上限（须 ≥ 本轮来源 TopK）",
    envName: "FF_GLOBAL_CANDIDATE_POOL",
    defaultValue: 8,
    min: 1,
    max: 50,
    integer: true,
    step: 1
  }
];

type ResolvedRuntimeField = { value: number; source: "db" | "env" | "default" };

type ResolvedRuntimeConfig = {
  rerankTopN: ResolvedRuntimeField;
  rerankMinScore: ResolvedRuntimeField;
  perSourceTimeoutMs: ResolvedRuntimeField;
  sourceFanout: ResolvedRuntimeField;
  candidatePoolSize: ResolvedRuntimeField;
};

// 数值合法性：有限 + 满足整数/范围约束。读取端(env/db)与写入端共用，避免手误的 .env 值绕过约束生效。
function isValidRuntimeValue(field: RuntimeConfigField, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (field.integer && !Number.isInteger(value)) return false;
  return value >= field.min && value <= field.max;
}

// 生效优先级：DB 覆盖 → .env → 硬编码默认；任一层非法则跌落下一层；同时回传来源供前端标注。
async function resolveRuntimeConfig(db?: PlatformDb): Promise<ResolvedRuntimeConfig> {
  const current = db ?? (await readDb());
  const result = {} as ResolvedRuntimeConfig;
  for (const field of RUNTIME_CONFIG_FIELDS) {
    const dbValue = current.runtimeConfig?.[field.key];
    if (typeof dbValue === "number" && isValidRuntimeValue(field, dbValue)) {
      result[field.key] = { value: dbValue, source: "db" };
      continue;
    }
    const envRaw = await readIntegrationEnv(field.envName);
    const envNum = envRaw !== undefined && envRaw !== "" ? Number(envRaw) : Number.NaN;
    if (isValidRuntimeValue(field, envNum)) {
      result[field.key] = { value: envNum, source: "env" };
      continue;
    }
    result[field.key] = { value: field.defaultValue, source: "default" };
  }
  return result;
}

async function getRuntimeConfig(db?: PlatformDb): Promise<{
  rerankTopN: number;
  rerankMinScore: number;
  perSourceTimeoutMs: number;
  sourceFanout: number;
  candidatePoolSize: number;
}> {
  const resolved = await resolveRuntimeConfig(db);
  return {
    rerankTopN: resolved.rerankTopN.value,
    rerankMinScore: resolved.rerankMinScore.value,
    perSourceTimeoutMs: resolved.perSourceTimeoutMs.value,
    sourceFanout: resolved.sourceFanout.value,
    candidatePoolSize: resolved.candidatePoolSize.value
  };
}

const ENGINE_TOPK_MIN = 1;
const ENGINE_TOPK_MAX = 30;
// per-engine 检索 topK：admin 设了该引擎的覆盖值则三处检索统一生效，否则跌落各调用点的历史默认(全域4/验证3/场景5)。
// 无 env 层——这是纯后台 UI 设置，与全局 runtimeConfig 的运维 env 旋钮区别开；模块 search 支持 1-30。
function getEngineTopK(db: PlatformDb, engine: AdminRagEngine, fallback: number): number {
  const v = db.engineRetrievalConfig?.[engine]?.topK;
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= ENGINE_TOPK_MIN && v <= ENGINE_TOPK_MAX) {
    return v;
  }
  return fallback;
}

const ENGINE_MINSCORE_MIN = 0;
const ENGINE_MINSCORE_MAX = 1;
// P22-P2: GraphRAG 检索旋钮 per-engine 范围(与 graph-rag QueryRequest 约束对齐)。
const ENGINE_CHUNK_TOPK_MIN = 1;
const ENGINE_CHUNK_TOPK_MAX = 200;
const ENGINE_MAX_TOTAL_TOKENS_MIN = 1;
const ENGINE_MAX_TOTAL_TOKENS_MAX = 100000;
// P34 T-LINKDEPTH: GBrain 互链深度是问答时沿 wiki 链扩展的邻域跳数（检索参数，非入库参数）。
// 后端 graphQuery 只支持 1-2（nano-brain links.ts 的邻域深度范围），与 UI 旧写的 1-4 不同。
const ENGINE_LINK_DEPTH_MIN = 1;
const ENGINE_LINK_DEPTH_MAX = 2;
const GRAPH_QUERY_MODES = ["auto", "local", "global", "hybrid", "naive", "mix"] as const;
// per-engine 引用相对强度阈值（归一化 RRF 的 min_score，0-1）：仅 Naive RAG 生效（只它有三路 RRF 融合层）。
// 设了则 Naive 检索透传到模块按 normalized_score 过滤弱引用，未设回落 fallback（默认 0=不过滤，存量行为零变化）。
function getEngineMinScore(db: PlatformDb, engine: AdminRagEngine, fallback: number): number {
  const v = db.engineRetrievalConfig?.[engine]?.minScore;
  if (typeof v === "number" && Number.isFinite(v) && v >= ENGINE_MINSCORE_MIN && v <= ENGINE_MINSCORE_MAX) {
    return v;
  }
  return fallback;
}

// P22-P2: GraphRAG 检索旋钮 reader(仿 getEngineTopK)。mode 有 fallback;其余未配返回 undefined,由层3 决定不传(走模块 settings/库默认)。
function getEngineMode(db: PlatformDb, engine: AdminRagEngine, fallback: string): string {
  const v = db.engineRetrievalConfig?.[engine]?.mode;
  if (typeof v === "string" && (GRAPH_QUERY_MODES as readonly string[]).includes(v)) {
    return v;
  }
  return fallback;
}

function getEngineChunkTopK(db: PlatformDb, engine: AdminRagEngine): number | undefined {
  const v = db.engineRetrievalConfig?.[engine]?.chunkTopK;
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= ENGINE_CHUNK_TOPK_MIN && v <= ENGINE_CHUNK_TOPK_MAX) {
    return v;
  }
  return undefined;
}

function getEngineMaxTotalTokens(db: PlatformDb, engine: AdminRagEngine): number | undefined {
  const v = db.engineRetrievalConfig?.[engine]?.maxTotalTokens;
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= ENGINE_MAX_TOTAL_TOKENS_MIN && v <= ENGINE_MAX_TOTAL_TOKENS_MAX) {
    return v;
  }
  return undefined;
}

function getEngineEnableRerank(db: PlatformDb, engine: AdminRagEngine): boolean | undefined {
  const v = db.engineRetrievalConfig?.[engine]?.enableRerank;
  if (typeof v === "boolean") {
    return v;
  }
  return undefined;
}

// P34 T-LINKDEPTH: GBrain 互链邻域深度 reader（仿 getEngineTopK）。设了合法值则问答邻域扩展用它，
// 否则回落 fallback（graphQuery 缺省 1）。无 env 层——纯后台 UI 设置。
function getEngineLinkDepth(db: PlatformDb, engine: AdminRagEngine, fallback: number): number {
  const v = db.engineRetrievalConfig?.[engine]?.linkDepth;
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= ENGINE_LINK_DEPTH_MIN && v <= ENGINE_LINK_DEPTH_MAX) {
    return v;
  }
  return fallback;
}

// P22-P2: 组装 GraphRAG per-engine 检索参数(供 /graph/search + /graph/ask 两处复用,避免漂移)。
// mode 恒有(未配落 auto,P37-T4c FR-449：交由下游 mode router 按问题自路由,替代原写死 mix);
// chunk_top_k/max_total_tokens/enable_rerank 未配则不带(走模块 settings/库默认)。
// 优先级 = DB admin 覆盖(合法值域内) > auto；不引入 env 覆盖层(spec §八 Q4③)。
function getGraphRetrievalParams(db: PlatformDb): { mode: string; chunk_top_k?: number; max_total_tokens?: number; enable_rerank?: boolean } {
  const params: { mode: string; chunk_top_k?: number; max_total_tokens?: number; enable_rerank?: boolean } = {
    mode: getEngineMode(db, "GraphRAG", "auto"),
  };
  const chunkTopK = getEngineChunkTopK(db, "GraphRAG");
  if (chunkTopK !== undefined) params.chunk_top_k = chunkTopK;
  const maxTotalTokens = getEngineMaxTotalTokens(db, "GraphRAG");
  if (maxTotalTokens !== undefined) params.max_total_tokens = maxTotalTokens;
  const enableRerank = getEngineEnableRerank(db, "GraphRAG");
  if (enableRerank !== undefined) params.enable_rerank = enableRerank;
  return params;
}

// P37-T4c 测试专用出口：getGraphRetrievalParams 未导出，无法在测试里直接构造 PlatformDb 验证 mode 解析。
// 仅接收 engineRetrievalConfig 转发调用（绕开真实入库流程），不改变函数本身任何行为。
export function __getGraphRetrievalParamsForTest(
  engineRetrievalConfig?: StoredEngineRetrievalConfig
): { mode: string; chunk_top_k?: number; max_total_tokens?: number; enable_rerank?: boolean } {
  return getGraphRetrievalParams({ ...emptyDb(), engineRetrievalConfig });
}

// 仅 admin 可改；null = 删除该字段 DB 覆盖回落 env/默认；越界/类型错误抛 Error 由路由映射 400。
export async function updateRuntimeConfig(
  user: StoreUser,
  input: Record<string, unknown>
): Promise<AdminIntegrationSettings> {
  if (user.role !== "admin") {
    throw new Error("forbidden");
  }
  const db = await readDb();
  const next: StoredRuntimeConfig = { ...(db.runtimeConfig ?? {}) };
  const changes: string[] = [];
  for (const field of RUNTIME_CONFIG_FIELDS) {
    if (!(field.key in input)) continue;
    const raw = input[field.key];
    if (raw === null) {
      if (field.key in next) {
        delete next[field.key];
        changes.push(`${field.label} 恢复默认`);
      }
      continue;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error(`${field.label} 必须是数字`);
    }
    if (field.integer && !Number.isInteger(raw)) {
      throw new Error(`${field.label} 必须是整数`);
    }
    if (raw < field.min || raw > field.max) {
      throw new Error(`${field.label} 需在 ${field.min}~${field.max} 之间`);
    }
    next[field.key] = raw;
    const display = field.unit ? `${raw}${field.unit}` : `${raw}`;
    changes.push(`${field.label} 设为 ${display}`);
  }
  // 联动校验：候选池须 ≥ 本轮来源 TopK，否则 rerank 喂不满候选。用最终生效值（DB→env→默认）比对。
  // 在临时对象上解析后才写入 db.runtimeConfig，避免校验失败时污染内存 db 对象（半写入）。
  const finalConfig = await getRuntimeConfig({ ...db, runtimeConfig: next });
  if (finalConfig.candidatePoolSize < finalConfig.rerankTopN) {
    throw new Error(`重排候选池（${finalConfig.candidatePoolSize}）须 ≥ 本轮来源 TopK（${finalConfig.rerankTopN}）`);
  }
  db.runtimeConfig = next;
  appendAuditEvent(db, user, {
    area: "系统接入",
    summary: "更新运行策略配置",
    impact: changes.length > 0 ? changes.join("；") : "无变更"
  });
  await writeDb(db);
  return (await getAdminIntegrationSettings(user))!;
}

// per-engine 检索 topK 配置：仅 admin 可改；topK=null 删除该引擎覆盖回落各调用点默认；越界/类型错误抛 Error 由路由映射 400。
export async function updateEngineRetrievalConfig(
  user: StoreUser,
  input: Record<string, unknown>
): Promise<AdminIntegrationSettings> {
  if (user.role !== "admin") {
    throw new Error("forbidden");
  }
  const db = await readDb();
  const next: StoredEngineRetrievalConfig = { ...(db.engineRetrievalConfig ?? {}) };
  const changes: string[] = [];
  const engines: AdminRagEngine[] = ["Gbrain", "Naive RAG", "GraphRAG"];
  for (const engine of engines) {
    if (!(engine in input)) continue;
    const entry = input[engine];
    if (entry === null || typeof entry !== "object") continue;
    const entryObj = entry as Record<string, unknown>;
    // topK 与 minScore 独立合并：只传其一不抹另一，两者皆空才删该引擎覆盖。
    const current = { ...(next[engine] ?? {}) };
    if ("topK" in entryObj) {
      const topK = entryObj.topK;
      if (topK === null) {
        if (current.topK !== undefined) {
          delete current.topK;
          changes.push(`${engine} topK 恢复默认`);
        }
      } else {
        if (typeof topK !== "number" || !Number.isFinite(topK)) {
          throw new Error(`${engine} topK 必须是数字`);
        }
        if (!Number.isInteger(topK)) {
          throw new Error(`${engine} topK 必须是整数`);
        }
        if (topK < ENGINE_TOPK_MIN || topK > ENGINE_TOPK_MAX) {
          throw new Error(`${engine} topK 需在 ${ENGINE_TOPK_MIN}~${ENGINE_TOPK_MAX} 之间`);
        }
        current.topK = topK;
        changes.push(`${engine} topK 设为 ${topK}`);
      }
    }
    if ("minScore" in entryObj) {
      const minScore = entryObj.minScore;
      // 引用强度阈值仅 Naive RAG 有 RRF 融合层可消费；拒非 Naive 的非空设置，避免存下不可见的死配置。
      if (minScore !== null && engine !== "Naive RAG") {
        throw new Error(`${engine} 不支持引用强度阈值（仅 Naive RAG 有 RRF 融合层）`);
      }
      if (minScore === null) {
        if (current.minScore !== undefined) {
          delete current.minScore;
          changes.push(`${engine} 引用强度阈值 恢复默认`);
        }
      } else {
        if (typeof minScore !== "number" || !Number.isFinite(minScore)) {
          throw new Error(`${engine} 引用强度阈值 必须是数字`);
        }
        if (minScore < ENGINE_MINSCORE_MIN || minScore > ENGINE_MINSCORE_MAX) {
          throw new Error(`${engine} 引用强度阈值 需在 ${ENGINE_MINSCORE_MIN}~${ENGINE_MINSCORE_MAX} 之间`);
        }
        current.minScore = minScore;
        changes.push(`${engine} 引用强度阈值 设为 ${minScore}`);
      }
    }
    // P22-P2: GraphRAG 检索旋钮校验写入(仅 GraphRAG 接受,非 GraphRAG 非空抛错,类比 minScore 仅 Naive)。
    if ("mode" in entryObj) {
      const mode = entryObj.mode;
      if (mode !== null && engine !== "GraphRAG") {
        throw new Error(`${engine} 不支持检索 mode（仅 GraphRAG）`);
      }
      if (mode === null) {
        if (current.mode !== undefined) {
          delete current.mode;
          changes.push(`${engine} mode 清除`);
        }
      } else {
        if (typeof mode !== "string" || !(GRAPH_QUERY_MODES as readonly string[]).includes(mode)) {
          throw new Error(`${engine} mode 非法`);
        }
        current.mode = mode;
        changes.push(`${engine} mode=${mode}`);
      }
    }
    if ("chunkTopK" in entryObj) {
      const chunkTopK = entryObj.chunkTopK;
      if (chunkTopK !== null && engine !== "GraphRAG") {
        throw new Error(`${engine} 不支持 chunkTopK（仅 GraphRAG）`);
      }
      if (chunkTopK === null) {
        if (current.chunkTopK !== undefined) {
          delete current.chunkTopK;
          changes.push(`${engine} chunkTopK 清除`);
        }
      } else {
        if (typeof chunkTopK !== "number" || !Number.isInteger(chunkTopK) || chunkTopK < ENGINE_CHUNK_TOPK_MIN || chunkTopK > ENGINE_CHUNK_TOPK_MAX) {
          throw new Error(`${engine} chunkTopK 须为 ${ENGINE_CHUNK_TOPK_MIN}-${ENGINE_CHUNK_TOPK_MAX} 的正整数`);
        }
        current.chunkTopK = chunkTopK;
        changes.push(`${engine} chunkTopK=${chunkTopK}`);
      }
    }
    if ("maxTotalTokens" in entryObj) {
      const maxTotalTokens = entryObj.maxTotalTokens;
      if (maxTotalTokens !== null && engine !== "GraphRAG") {
        throw new Error(`${engine} 不支持 maxTotalTokens（仅 GraphRAG）`);
      }
      if (maxTotalTokens === null) {
        if (current.maxTotalTokens !== undefined) {
          delete current.maxTotalTokens;
          changes.push(`${engine} maxTotalTokens 清除`);
        }
      } else {
        if (typeof maxTotalTokens !== "number" || !Number.isInteger(maxTotalTokens) || maxTotalTokens < ENGINE_MAX_TOTAL_TOKENS_MIN || maxTotalTokens > ENGINE_MAX_TOTAL_TOKENS_MAX) {
          throw new Error(`${engine} maxTotalTokens 须为 ${ENGINE_MAX_TOTAL_TOKENS_MIN}-${ENGINE_MAX_TOTAL_TOKENS_MAX} 的正整数`);
        }
        current.maxTotalTokens = maxTotalTokens;
        changes.push(`${engine} maxTotalTokens=${maxTotalTokens}`);
      }
    }
    if ("enableRerank" in entryObj) {
      const enableRerank = entryObj.enableRerank;
      if (enableRerank !== null && engine !== "GraphRAG") {
        throw new Error(`${engine} 不支持 enableRerank（仅 GraphRAG）`);
      }
      if (enableRerank === null) {
        if (current.enableRerank !== undefined) {
          delete current.enableRerank;
          changes.push(`${engine} enableRerank 清除`);
        }
      } else {
        if (typeof enableRerank !== "boolean") {
          throw new Error(`${engine} enableRerank 必须是布尔`);
        }
        current.enableRerank = enableRerank;
        changes.push(`${engine} enableRerank=${enableRerank}`);
      }
    }
    // P34 T-LINKDEPTH: 互链深度仅 GBrain 有 wiki 链邻域可扩展；拒非 GBrain 的非空设置（类比 minScore 仅 Naive）。
    if ("linkDepth" in entryObj) {
      const linkDepth = entryObj.linkDepth;
      if (linkDepth !== null && engine !== "Gbrain") {
        throw new Error(`${engine} 不支持互链深度（仅 GBrain 有互链邻域）`);
      }
      if (linkDepth === null) {
        if (current.linkDepth !== undefined) {
          delete current.linkDepth;
          changes.push(`${engine} 互链深度 恢复默认`);
        }
      } else {
        if (typeof linkDepth !== "number" || !Number.isInteger(linkDepth) || linkDepth < ENGINE_LINK_DEPTH_MIN || linkDepth > ENGINE_LINK_DEPTH_MAX) {
          throw new Error(`${engine} 互链深度 须为 ${ENGINE_LINK_DEPTH_MIN}-${ENGINE_LINK_DEPTH_MAX} 的整数`);
        }
        current.linkDepth = linkDepth;
        changes.push(`${engine} 互链深度=${linkDepth}`);
      }
    }
    if (Object.keys(current).length === 0) {
      delete next[engine];
    } else {
      next[engine] = current;
    }
  }
  db.engineRetrievalConfig = next;
  appendAuditEvent(db, user, {
    area: "系统接入",
    summary: "更新引擎检索配置",
    impact: changes.length > 0 ? changes.join("；") : "无变更"
  });
  await writeDb(db);
  return (await getAdminIntegrationSettings(user))!;
}

export async function getAdminIntegrationSettings(user: StoreUser): Promise<AdminIntegrationSettings | null> {
  if (!isValidAdminCaller(user)) return null;
  const now = new Date().toISOString();
  const moduleHealth = await Promise.all((["Gbrain", "Naive RAG", "GraphRAG"] as AdminRagEngine[]).map(async (engine) => {
        try {
          return await defaultCheckAdminModuleHealth(engine);
        } catch {
          return { id: engine, status: "down" as const, detail: `${engine} 服务不可用` };
        }
      }));
  const modules: AdminIntegrationSettings["modules"] = [
    {
      id: "nano-brain",
      label: "Gbrain 服务",
      base_url: moduleBaseUrl("Gbrain"),
      status: serviceStatus(moduleHealth.find((item) => item.id === "Gbrain")?.status),
      service: "nano-brain",
      required_env: ["RAG_INTERNAL_TOKEN", "NANO_BRAIN_HTTP_URL"],
      role: "编译式知识组织、知识页导航、事实沉淀"
    },
    {
      id: "traditional-rag",
      label: "Naive RAG 服务",
      base_url: moduleBaseUrl("Naive RAG"),
      status: serviceStatus(moduleHealth.find((item) => item.id === "Naive RAG")?.status),
      service: "traditional-rag",
      required_env: ["RAG_INTERNAL_TOKEN", "TRADITIONAL_RAG_HTTP_URL"],
      role: "文档切片、向量检索、证据型问答"
    },
    {
      id: "graph-rag",
      label: "GraphRAG 服务",
      base_url: moduleBaseUrl("GraphRAG"),
      status: serviceStatus(moduleHealth.find((item) => item.id === "GraphRAG")?.status),
      service: "graph-rag",
      required_env: ["RAG_INTERNAL_TOKEN", "GRAPH_RAG_HTTP_URL"],
      role: "实体关系、风险链路、多跳图谱检索"
    }
  ];
  const providers: AdminIntegrationSettings["providers"] = [
    {
      id: "agent",
      label: "回答模型",
      provider: "openai-compatible",
      base_url: envValue("AGENT_BASE_URL") ?? "",
      model: envValue("AGENT_MODEL") ?? "",
      secrets: [secretState("AGENT_API_KEY")],
      controls: ["用于公司大脑、Agentic RAG 路由和答案生成"]
    },
    {
      id: "embedding",
      label: "向量模型",
      provider: "openai-compatible",
      base_url: envValue("EMBEDDING_BASE_URL") ?? envValue("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1",
      model: envValue("EMBEDDING_MODEL") ?? "qwen/qwen3-embedding-8b",
      dimensions: Number(envValue("EMBEDDING_DIMENSIONS") ?? 4096),
      secrets: [secretState("EMBEDDING_API_KEY", "OPENROUTER_API_KEY")],
      controls: ["用于文档切片、图谱检索和公司大脑召回"]
    },
    {
      id: "rerank",
      label: "重排序模型",
      provider: "dashscope",
      base_url: envValue("RERANK_BASE_URL"),
      model: envValue("RERANK_MODEL") ?? "qwen3-rerank",
      optional: true,
      secrets: [secretState("DASHSCOPE_API_KEY")],
      controls: ["全域问答检索后相关性精排（阈值过滤 + 取 top-k）"]
    }
  ];
  const parsers: AdminIntegrationSettings["parsers"] = [
    {
      id: "mineru",
      label: "PDF 解析服务",
      base_url: envValue("MINERU_BASE_URL") ?? "https://mineru.net",
      model_version: envValue("MINERU_MODEL_VERSION") ?? "vlm",
      language: envValue("MINERU_LANGUAGE") ?? "ch",
      options: ["抽取表格", "抽取公式", "按文档文本优先"],
      secrets: [secretState("MINERU_API_KEY")]
    }
  ];
  const databases: AdminIntegrationSettings["databases"] = [
    databaseState("identity", "账号与权限库", "IDENTITY_DATABASE_URL"),
    databaseState("traditional-rag", "Naive RAG 文档库", "TRADITIONAL_RAG_DATABASE_URL"),
    databaseState("graph-rag", "GraphRAG 图谱库", "GRAPH_RAG_DATABASE_URL")
  ];
  // 可选 provider（如 rerank）未配置不应拉高 blocked 等级
  const blocked = providers.filter((p) => !p.optional).some((item) => item.secrets.some((secret) => !secret.configured))
    || parsers.some((item) => item.secrets.some((secret) => !secret.configured))
    || !envValue("RAG_INTERNAL_TOKEN");
  const degraded = modules.some((item) => item.status !== "ok");
  const db = await readDb();
  const resolvedRuntime = await resolveRuntimeConfig(db);
  return {
    checked_at: now,
    overall_status: blocked ? "blocked" : degraded ? "degraded" : "ready",
    providers,
    parsers,
    modules,
    databases,
    runtime_policies: [
      {
        label: "内部调用令牌",
        value: envValue("RAG_INTERNAL_TOKEN") ? "已配置" : "未配置",
        impact: "统一接口调用知识处理模块时必须携带"
      },
      {
        label: "真实入库模式",
        value: shouldUseRealRagModules() ? "真实模块" : "本地回放",
        impact: "决定后台确认入库时是否调用 Gbrain / Naive RAG / GraphRAG 服务"
      },
      {
        label: "文档存储目录",
        value: dataRoot(),
        impact: "保存上传文件、解析产物、入库状态和审计记录"
      },
      ...RUNTIME_CONFIG_FIELDS.map((field) => {
        const resolved = resolvedRuntime[field.key];
        return {
          label: field.label,
          value: field.unit ? `${resolved.value} ${field.unit}` : String(resolved.value),
          impact: field.impact,
          key: field.key,
          source: resolved.source,
          numeric: { value: resolved.value, min: field.min, max: field.max, step: field.step, unit: field.unit }
        };
      })
    ],
    engine_retrieval: (["Gbrain", "Naive RAG", "GraphRAG"] as const).map((engine) => {
      const rawTopK = db.engineRetrievalConfig?.[engine]?.topK;
      const hasOverride =
        typeof rawTopK === "number" &&
        Number.isFinite(rawTopK) &&
        Number.isInteger(rawTopK) &&
        rawTopK >= ENGINE_TOPK_MIN &&
        rawTopK <= ENGINE_TOPK_MAX;
      const rawMinScore = db.engineRetrievalConfig?.[engine]?.minScore;
      const hasMinScore =
        typeof rawMinScore === "number" &&
        Number.isFinite(rawMinScore) &&
        rawMinScore >= ENGINE_MINSCORE_MIN &&
        rawMinScore <= ENGINE_MINSCORE_MAX;
      // 引用强度阈值仅 Naive RAG 有 RRF 层 → 仅它 supportsMinScore，前端只对它显示该输入。
      const supportsMinScore = engine === "Naive RAG";
      // P22-P2: GraphRAG 检索旋钮——仅 GraphRAG 从 config 读原始值判 db/default,非 GraphRAG 一律 null/default。
      const supportsGraphRetrieval = engine === "GraphRAG";
      const rawMode = supportsGraphRetrieval ? db.engineRetrievalConfig?.[engine]?.mode : undefined;
      const hasMode = rawMode !== undefined && (GRAPH_QUERY_MODES as readonly string[]).includes(rawMode);
      // 复用 reader 的类型+范围校验判 db/default(codex P2 审#3:防手工污染 DB 把非法值标成 DB 覆盖)。
      const chunkTopKVal = supportsGraphRetrieval ? getEngineChunkTopK(db, engine) : undefined;
      const hasChunkTopK = chunkTopKVal !== undefined;
      const maxTotalTokensVal = supportsGraphRetrieval ? getEngineMaxTotalTokens(db, engine) : undefined;
      const hasMaxTotalTokens = maxTotalTokensVal !== undefined;
      const enableRerankVal = supportsGraphRetrieval ? getEngineEnableRerank(db, engine) : undefined;
      const hasEnableRerank = enableRerankVal !== undefined;
      // P34 T-LINKDEPTH: 互链深度仅 GBrain 有邻域可扩展 → 仅它 supportsLinkDepth，前端只对它显示该输入。
      const supportsLinkDepth = engine === "Gbrain";
      const rawLinkDepth = supportsLinkDepth ? db.engineRetrievalConfig?.[engine]?.linkDepth : undefined;
      const hasLinkDepth =
        typeof rawLinkDepth === "number" &&
        Number.isFinite(rawLinkDepth) &&
        Number.isInteger(rawLinkDepth) &&
        rawLinkDepth >= ENGINE_LINK_DEPTH_MIN &&
        rawLinkDepth <= ENGINE_LINK_DEPTH_MAX;
      return {
        engine,
        label: engine,
        topK: hasOverride ? rawTopK : null,
        source: hasOverride ? ("db" as const) : ("default" as const),
        min: ENGINE_TOPK_MIN,
        max: ENGINE_TOPK_MAX,
        default_hint: "未设置时各检索路径用各自默认：全域召回 4 / 召回验证 3 / 场景问答 5",
        minScore: supportsMinScore && hasMinScore ? rawMinScore : null,
        minScoreSource: supportsMinScore && hasMinScore ? ("db" as const) : ("default" as const),
        minScoreMin: ENGINE_MINSCORE_MIN,
        minScoreMax: ENGINE_MINSCORE_MAX,
        supportsMinScore,
        mode: supportsGraphRetrieval && hasMode ? (rawMode as string) : null,
        modeSource: supportsGraphRetrieval && hasMode ? ("db" as const) : ("default" as const),
        modeOptions: [...GRAPH_QUERY_MODES],
        chunkTopK: supportsGraphRetrieval && hasChunkTopK ? chunkTopKVal : null,
        chunkTopKSource: supportsGraphRetrieval && hasChunkTopK ? ("db" as const) : ("default" as const),
        chunkTopKMin: ENGINE_CHUNK_TOPK_MIN,
        chunkTopKMax: ENGINE_CHUNK_TOPK_MAX,
        maxTotalTokens: supportsGraphRetrieval && hasMaxTotalTokens ? maxTotalTokensVal : null,
        maxTotalTokensSource: supportsGraphRetrieval && hasMaxTotalTokens ? ("db" as const) : ("default" as const),
        maxTotalTokensMin: ENGINE_MAX_TOTAL_TOKENS_MIN,
        maxTotalTokensMax: ENGINE_MAX_TOTAL_TOKENS_MAX,
        enableRerank: supportsGraphRetrieval && hasEnableRerank ? enableRerankVal : null,
        enableRerankSource: supportsGraphRetrieval && hasEnableRerank ? ("db" as const) : ("default" as const),
        supportsGraphRetrieval,
        linkDepth: supportsLinkDepth && hasLinkDepth ? (rawLinkDepth as number) : null,
        linkDepthSource: supportsLinkDepth && hasLinkDepth ? ("db" as const) : ("default" as const),
        linkDepthMin: ENGINE_LINK_DEPTH_MIN,
        linkDepthMax: ENGINE_LINK_DEPTH_MAX,
        supportsLinkDepth
      };
    })
  };
}

export async function probeIntegration(
  user: StoreUser,
  target: string
): Promise<{ ok: boolean; latencyMs: number; detail?: string; error?: string }> {
  const start = Date.now();
  if (!isValidAdminCaller(user)) return { ok: false, latencyMs: Date.now() - start, error: "forbidden" };

  if (target === "agent") {
    const agentKey = await readAgentEnv("AGENT_API_KEY");
    const baseUrl = ((await readAgentEnv("AGENT_BASE_URL")) ?? "").replace(/\/+$/, "");
    const model = await readAgentEnv("AGENT_MODEL");
    if (!agentKey || !baseUrl || !model) {
      return { ok: false, latencyMs: Date.now() - start, error: "未配置" };
    }
    try {
      // 直接最小 fetch（与 embedding/rerank 探活一致），只判可达+鉴权+返回 choices 数组。
      // 不经 callAgentChatModel：其要求 content.trim() 非空 + 失败重试 3 次（25s×3），
      // 对探活会假失败/拖慢——多轮实测坐实（短 prompt 偶发空 content 被判失败）。
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${agentKey}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
        signal: AbortSignal.timeout(10000)
      });
      if (resp.status === 401) {
        return { ok: false, latencyMs: Date.now() - start, error: "鉴权失败(401)" };
      }
      if (!resp.ok) {
        return { ok: false, latencyMs: Date.now() - start, error: "响应异常" };
      }
      const data = await resp.json().catch(() => null) as any;
      if (Array.isArray(data?.choices) && data.choices.length > 0) {
        return { ok: true, latencyMs: Date.now() - start, detail: "agent 响应正常" };
      }
      return { ok: false, latencyMs: Date.now() - start, error: "响应异常" };
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name ?? "";
      if (name === "TimeoutError" || name === "AbortError") {
        return { ok: false, latencyMs: Date.now() - start, error: "超时" };
      }
      return { ok: false, latencyMs: Date.now() - start, error: "连接失败" };
    }
  }

  if (target === "embedding") {
    // 回退规则与 getAdminIntegrationSettings 一致（EMBEDDING_BASE_URL → OPENROUTER_BASE_URL → 默认），
    // 避免只配 OPENROUTER_BASE_URL 时 settings 显示已配置、探活却误报"未配置"。
    const baseUrl = (await readIntegrationEnv("EMBEDDING_BASE_URL")) ?? (await readIntegrationEnv("OPENROUTER_BASE_URL")) ?? "https://openrouter.ai/api/v1";
    const apiKey = (await readIntegrationEnv("EMBEDDING_API_KEY")) ?? (await readIntegrationEnv("OPENROUTER_API_KEY"));
    const model = (await readIntegrationEnv("EMBEDDING_MODEL")) ?? "qwen/qwen3-embedding-8b";
    if (!baseUrl || !apiKey) {
      return { ok: false, latencyMs: Date.now() - start, error: "未配置" };
    }
    try {
      const resp = await fetch(`${baseUrl.replace(/\/+$/, "")}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: "ping" }),
        signal: AbortSignal.timeout(10000)
      });
      if (resp.status === 401) {
        return { ok: false, latencyMs: Date.now() - start, error: "鉴权失败(401)" };
      }
      if (!resp.ok) {
        return { ok: false, latencyMs: Date.now() - start, error: "响应异常" };
      }
      const data = await resp.json().catch(() => null) as any;
      if (Array.isArray(data?.data?.[0]?.embedding)) {
        return { ok: true, latencyMs: Date.now() - start, detail: "embedding 响应正常" };
      }
      return { ok: false, latencyMs: Date.now() - start, error: "响应异常" };
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name ?? "";
      if (name === "TimeoutError" || name === "AbortError") {
        return { ok: false, latencyMs: Date.now() - start, error: "超时" };
      }
      return { ok: false, latencyMs: Date.now() - start, error: "连接失败" };
    }
  }

  if (target === "rerank") {
    const apiKey = await readIntegrationEnv("DASHSCOPE_API_KEY");
    const baseUrl = await readIntegrationEnv("RERANK_BASE_URL");
    const model = (await readIntegrationEnv("RERANK_MODEL")) ?? "qwen3-rerank";
    if (!apiKey || !baseUrl) {
      return { ok: false, latencyMs: Date.now() - start, error: "未配置" };
    }
    try {
      const resp = await fetch(baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: { query: "ping", documents: ["ping"] }, parameters: { top_n: 1 } }),
        signal: AbortSignal.timeout(10000)
      });
      if (resp.status === 401) {
        return { ok: false, latencyMs: Date.now() - start, error: "鉴权失败(401)" };
      }
      if (!resp.ok) {
        return { ok: false, latencyMs: Date.now() - start, error: "响应异常" };
      }
      const data = await resp.json().catch(() => null) as any;
      if (typeof data?.output?.results?.[0]?.relevance_score === "number") {
        return { ok: true, latencyMs: Date.now() - start, detail: "rerank 响应正常" };
      }
      return { ok: false, latencyMs: Date.now() - start, error: "响应异常" };
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name ?? "";
      if (name === "TimeoutError" || name === "AbortError") {
        return { ok: false, latencyMs: Date.now() - start, error: "超时" };
      }
      return { ok: false, latencyMs: Date.now() - start, error: "连接失败" };
    }
  }

  if (target === "nano-brain") {
    try {
      const health = await defaultCheckAdminModuleHealth("Gbrain");
      return {
        ok: health.status === "healthy",
        latencyMs: Date.now() - start,
        detail: health.status === "healthy" ? "Gbrain 服务可用" : undefined,
        error: health.status !== "healthy" ? "响应异常" : undefined
      };
    } catch {
      return { ok: false, latencyMs: Date.now() - start, error: "连接失败" };
    }
  }

  if (target === "traditional-rag") {
    try {
      const health = await defaultCheckAdminModuleHealth("Naive RAG");
      return {
        ok: health.status === "healthy",
        latencyMs: Date.now() - start,
        detail: health.status === "healthy" ? "Naive RAG 服务可用" : undefined,
        error: health.status !== "healthy" ? "响应异常" : undefined
      };
    } catch {
      return { ok: false, latencyMs: Date.now() - start, error: "连接失败" };
    }
  }

  if (target === "graph-rag") {
    try {
      const health = await defaultCheckAdminModuleHealth("GraphRAG");
      return {
        ok: health.status === "healthy",
        latencyMs: Date.now() - start,
        detail: health.status === "healthy" ? "GraphRAG 服务可用" : undefined,
        error: health.status !== "healthy" ? "响应异常" : undefined
      };
    } catch {
      return { ok: false, latencyMs: Date.now() - start, error: "连接失败" };
    }
  }

  return { ok: false, latencyMs: Date.now() - start, error: "未知目标" };
}

export async function listAdminScenarioTemplates(user: StoreUser): Promise<StoredAdminTemplate[]> {
  if (user.role !== "admin") return [];
  const db = await readDb();
  return activeAdminTemplates(db.templates);
}

export async function createAdminScenarioTemplate(
  user: StoreUser,
  input: AdminTemplateMutationInput
): Promise<StoredAdminTemplate | null> {
  if (user.role !== "admin") return null;
  const db = await readDb();
  const now = new Date().toISOString();
  const name = cleanText(input.name);
  if (!name) throw new Error("模板名称不能为空。");
  const id = uniqueTemplateId(db.templates, input.id || `template-${slugify(name)}`);
  const template: StoredAdminTemplate = {
    id,
    name,
    category: cleanText(input.category) || "自定义",
    state: input.state && input.state !== "official" ? input.state : "candidate",
    source: "custom",
    owner: cleanText(input.owner) || user.name,
    headline: cleanText(input.headline) || "由管理员创建的业务场景模板。",
    acceptedFiles: cleanStringArray(input.acceptedFiles, ["PDF", "Word", "Markdown", "表格资料"]),
    inputExamples: cleanStringArray(input.inputExamples, ["业务说明", "资料文件"]),
    outputCapabilities: cleanStringArray(input.outputCapabilities, ["可追问答案", "引用依据", "业务成品"]),
    productForm: cleanProductForms(input.productForm),
    reviewRequirement: cleanReviewRequirement(input.reviewRequirement),
    evidenceSources: cleanStringArray(input.evidenceSources, ["管理员创建"]),
    evidenceCoverage: 50,
    demoReadiness: 30,
    canEdit: true,
    canDelete: true,
    createdAt: now,
    updatedAt: now
  };
  db.templates = mergeAdminTemplates(db.templates);
  db.templates.unshift(template);
  appendAuditEvent(db, user, {
    area: "模板治理",
    summary: `创建模板：${template.name}`,
    impact: `${template.category} · ${template.reviewRequirement}`
  });
  await writeDb(db);
  return template;
}

export async function updateAdminScenarioTemplate(
  user: StoreUser,
  templateId: string,
  input: AdminTemplateMutationInput
): Promise<StoredAdminTemplate | null> {
  if (user.role !== "admin") return null;
  const db = await readDb();
  const templates = mergeAdminTemplates(db.templates);
  const index = templates.findIndex((item) => item.id === templateId);
  if (index < 0) return null;
  const current = templates[index];
  const updated: StoredAdminTemplate = {
    ...current,
    name: current.source === "official" ? current.name : cleanText(input.name) || current.name,
    category: cleanText(input.category) || current.category,
    state: input.state ?? current.state,
    owner: cleanText(input.owner) || current.owner,
    headline: cleanText(input.headline) || current.headline,
    acceptedFiles: input.acceptedFiles ? cleanStringArray(input.acceptedFiles, current.acceptedFiles) : current.acceptedFiles,
    inputExamples: input.inputExamples ? cleanStringArray(input.inputExamples, current.inputExamples) : current.inputExamples,
    outputCapabilities: input.outputCapabilities ? cleanStringArray(input.outputCapabilities, current.outputCapabilities) : current.outputCapabilities,
    productForm: input.productForm ? cleanProductForms(input.productForm) : current.productForm,
    reviewRequirement: input.reviewRequirement ? cleanReviewRequirement(input.reviewRequirement) : current.reviewRequirement,
    evidenceSources: input.evidenceSources ? cleanStringArray(input.evidenceSources, current.evidenceSources) : current.evidenceSources,
    canDelete: current.source === "custom",
    updatedAt: new Date().toISOString()
  };
  templates[index] = updated;
  db.templates = templates;
  appendAuditEvent(db, user, {
    area: "模板治理",
    summary: `更新模板：${updated.name}`,
    impact: `${updated.state} · ${updated.reviewRequirement}`
  });
  await writeDb(db);
  return updated;
}

export async function deleteAdminScenarioTemplate(
  user: StoreUser,
  templateId: string
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "official_locked" | "forbidden" }> {
  if (user.role !== "admin") return { ok: false, reason: "forbidden" };
  const db = await readDb();
  const templates = mergeAdminTemplates(db.templates);
  const target = templates.find((item) => item.id === templateId);
  if (!target) return { ok: false, reason: "not_found" };
  if (target.source === "official") return { ok: false, reason: "official_locked" };
  db.templates = templates.filter((item) => item.id !== templateId);
  appendAuditEvent(db, user, {
    area: "模板治理",
    summary: `删除模板：${target.name}`,
    impact: `${target.category} · 自定义模板`
  });
  await writeDb(db);
  return { ok: true };
}

export async function listAdminKnowledgeAssetDetails(
  user: StoreUser,
  input: { engine?: AdminRagEngine; kind?: AdminKnowledgeAssetKind } = {}
): Promise<StoredKnowledgeAssetDetail[]> {
  if (user.role !== "admin") return [];
  const db = await readDb();
  return db.knowledgeObjects.flatMap((item) => {
    if (input.engine && item.ragEngine !== input.engine) return [];
    const scenario = db.scenarios.find((entry) => entry.id === item.scenarioId);
    const file = db.files.map(normalizeFileRecord).find((entry) => entry.id === item.sourceFileId);
    const artifact = db.parsedArtifacts.find((entry) => entry.id === item.artifactId);
    return buildAssetDetailsForKnowledgeObject(item, scenario, file, artifact).filter((asset) => !input.kind || asset.kind === input.kind);
  });
}

// 018 T3 · 后台人工编辑源级描述卡(FR-465/466)：origin 强制置 "manual"(人工优先，AM-1815 硬红线——
// 此后自动生成/漂移检测绝不覆盖)、清 staleHint(人工已确认为最新)、记 curation audit(AM-1817)。
// 校验沿用 parseSourceCardOutput 同一条"无半卡"红线(AM-1801)：summaryScope 非空 + 3~5 条典型问题，
// 否则拒绝写入(返回 null)，不落半卡。docTypeDistribution/sourceFingerprint 是机械派生量，人工编辑
// 不改写，沿用已有卡的值(无已有卡则空/占位，等下次自动生成回填)。
export async function updateScenarioDescriptionCard(
  user: StoreUser,
  input: { scenarioId: string; summaryScope: string; typicalQuestions: string[]; entityHints?: string[] }
): Promise<StoredScenario | null> {
  if (user.role !== "admin") return null;
  const summaryScope = input.summaryScope.trim();
  const typicalQuestions = input.typicalQuestions.map((q) => q.trim()).filter(Boolean);
  if (!summaryScope || typicalQuestions.length < 3 || typicalQuestions.length > 5) return null;
  const entityHints = (input.entityHints ?? []).map((v) => v.trim()).filter(Boolean).slice(0, 8);

  const updated = await withDbLock(async () => {
    const db = await readDb();
    const idx = db.scenarios.findIndex((s) => s.id === input.scenarioId);
    if (idx < 0) return null;
    const scenario = db.scenarios[idx];
    const card: DescriptionCard = {
      summaryScope,
      typicalQuestions,
      entityHints: entityHints.length ? entityHints : undefined,
      docTypeDistribution: scenario.descriptionCard?.docTypeDistribution ?? {},
      generatedAt: new Date().toISOString(),
      sourceFingerprint: scenario.descriptionCard?.sourceFingerprint ?? "",
      origin: "manual",
      staleHint: false
    };
    db.scenarios[idx] = { ...scenario, descriptionCard: card };
    await writeDb(db);
    return db.scenarios[idx];
  });
  if (!updated) return null;
  await recordCurationAudit(user, "知识资产治理", `编辑源级描述卡：${updated.name}`);
  return updated;
}

// ===== 真后端治理操作（接真模块/真数据，替代前端占位按钮） =====

// 召回验证 / 运行检索 / 运行路径查询 / 图谱复核 / 关系复核 / 引用抽检 / 发布复核：
// 对指定引擎的真实来源跑一次真实检索，返回命中的真实 chunk/证据。
export async function adminEngineRecallVerify(
  user: StoreUser,
  input: { engine: AdminRagEngine; query?: string }
): Promise<{ engine: AdminRagEngine; query: string; hits: Array<{ source: string; scenario: string; excerpt: string }>; checkedSources: number }> {
  if (user.role !== "admin") return { engine: input.engine, query: input.query ?? "", hits: [], checkedSources: 0 };
  const db = await readDb();
  const query = (input.query ?? "").trim() || "请概述这份资料的关键信息";
  const refs = (db.moduleReferences ?? [])
    .filter((ref) => ref.engine === input.engine && ref.status === "ready")
    .filter((ref) => canAccess(user, ref.accessControl));
  const seen = new Set<string>();
  const uniqueRefs = refs.filter((ref) => {
    const key = `${ref.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const hits: Array<{ source: string; scenario: string; excerpt: string }> = [];

  if (input.engine === "Naive RAG") {
    // 全局检索（修 I60）：所有可访问 Naive 源一次检索，TopK = 最终返回 chunk 数（默认 8）；
    // 命中按 documentId 映射回对应 ref 回填来源/场景（修 I95：归因用未按 sourceId 去重的全部 refs，
    // 保留同 source 多 document；检索仍用 uniqueRefs 控制来源数，searchNaiveGlobal 内按 source 一次查）。
    const refByDocument = new Map(refs.map((ref) => [ref.documentId, ref]));
    try {
      const results = await Promise.race([
        searchNaiveGlobal(user, query, uniqueRefs, getEngineTopK(db, "Naive RAG", 8), getEngineMinScore(db, "Naive RAG", 0)),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 25000))
      ]);
      for (const r of results ?? []) {
        if (!r.text || !r.text.trim()) continue;
        const ref = refByDocument.get(r.documentId);
        if (!ref) continue; // 按 documentId 归因(多文件同 source 各 document 独立，修 I95)，找不到对应 ref 则跳过，三处行为一致
        hits.push({
          source: String(ref.metadata.originalFileName ?? ref.sourceName),
          scenario: String(ref.metadata.scenarioName ?? ref.scenarioId),
          excerpt: excerpt(sanitizeKnowledgeExcerpt(r.text), 300)
        });
      }
    } catch {
      // 全局检索失败不阻断。
    }
    return { engine: input.engine, query, hits: hits.slice(0, 8), checkedSources: uniqueRefs.length };
  }

  // Gbrain / GraphRAG：保持逐源检索（本次重构仅 Naive）。
  for (const ref of uniqueRefs.slice(0, 6)) {
    try {
      const result = await Promise.race([
        searchModuleForReference(user, ref, query, getEngineTopK(db, ref.engine, 3), getEngineMinScore(db, ref.engine, 0)),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 25000))
      ]);
      for (const item of result?.excerpts ?? []) {
        if (!item.text || !item.text.trim()) continue;
        hits.push({
          source: String(ref.metadata.originalFileName ?? ref.sourceName),
          scenario: String(ref.metadata.scenarioName ?? ref.scenarioId),
          excerpt: excerpt(sanitizeKnowledgeExcerpt(item.text), 300)
        });
      }
    } catch {
      // 单源失败不阻断整体验证。
    }
  }
  return { engine: input.engine, query, hits: hits.slice(0, 8), checkedSources: Math.min(uniqueRefs.length, 6) };
}

// 导出资产表：从真实知识对象生成 CSV（真实数据，非占位）。
export async function adminExportKnowledgeAssetsCsv(
  user: StoreUser,
  input: { engine?: AdminRagEngine } = {}
): Promise<string> {
  if (user.role !== "admin") return "";
  const db = await readDb();
  const rows = db.knowledgeObjects.filter((item) => !input.engine || item.ragEngine === input.engine);
  const header = ["知识对象ID", "标题", "引擎", "来源文件", "权限范围", "负责人", "创建时间"];
  const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [header.map(csvCell).join(",")];
  for (const item of rows) {
    lines.push([
      item.id,
      item.title,
      item.ragEngine,
      item.sourceOriginalName,
      item.accessControl?.scope ?? item.visibility,
      item.ownerName,
      item.createdAt
    ].map(csvCell).join(","));
  }
  return lines.join("\n");
}

// 批量复核：把指定引擎下所有待确认的资料请求一次性真实入库发布（循环真实审批）。
export async function adminBatchReviewRequests(
  user: StoreUser,
  input: { engine?: AdminRagEngine } = {}
): Promise<{ approved: number; failed: number; engine?: AdminRagEngine }> {
  if (user.role !== "admin") return { approved: 0, failed: 0 };
  const requests = await listAdminIntakeRequests(user);
  const pending = requests.filter((request) => request.status === "待管理员确认");
  let approved = 0;
  let failed = 0;
  for (const request of pending) {
    const engine = input.engine ?? (request.recommendedEngines?.[0] as AdminRagEngine | undefined) ?? "Naive RAG";
    try {
      const result = await decideAdminIntakeRequest(user, {
        requestId: request.id,
        action: "approve",
        selectedEngine: engine
      });
      if (result) approved += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { approved, failed, engine: input.engine };
}

// 场景资料变更请求（申请更新 / 申请删除）：在真实 platform-db 创建一条真实任务，进入后台处理管线。
export async function createScenarioDataRequest(
  user: StoreUser,
  input: { scenarioId: string; action: "update" | "delete" }
): Promise<{ ok: boolean; taskId?: string; message: string }> {
  const db = await readDb();
  const scenario = db.scenarios.find((item) => item.id === input.scenarioId);
  if (!scenario || !canManageScenario(user, scenario)) return { ok: false, message: "没有找到这个场景或没有访问权限。" };
  const now = new Date().toISOString();
  const actionLabel = input.action === "delete" ? "资料删除" : "资料更新";
  const task: StoreTask = {
    id: `task_${randomUUID()}`,
    scenarioId: scenario.id,
    title: `${actionLabel}申请：${scenario.name}`,
    kind: "资料接入",
    status: "submitted",
    visibility: scenario.visibility,
    ragMode: ragModeForTemplate(scenario.templateId),
    owner: scenario.ownerName,
    ownerUserId: scenario.ownerUserId,
    submittedAt: "刚刚",
    updatedAt: "刚刚",
    files: [],
    waitingFor: "后台管理员",
    progress: 8,
    currentStep: `已提交${actionLabel}申请`,
    userMessage: `已提交「${scenario.name}」的${actionLabel}申请，管理员确认后会更新场景资料。`,
    nextActions: ["查看任务中心", "等待后台确认"],
    adminEntry: `用户提交了${actionLabel}申请，等待管理员处理。`,
    createdAt: now,
    updatedAtIso: now
  };
  db.tasks.unshift(task);
  appendAuditEvent(db, user, { area: "处理管线", summary: `${actionLabel}申请：${scenario.name}`, impact: visibilityText(scenario.visibility) });
  await writeDb(db);
  return { ok: true, taskId: task.id, message: task.userMessage as string };
}

// 检索策略：从真实检索配置（.env 模型/维度）+ 真实已接来源数派生，而非 fixture。
export async function getAdminStrategies(
  user: StoreUser
): Promise<Array<{ id: string; name: string; scope: string; impact: string; controls: string[] }>> {
  if (user.role !== "admin") return [];
  const db = await readDb();
  const model = process.env.EMBEDDING_MODEL ?? "embedding";
  const dims = process.env.EMBEDDING_DIMENSIONS ?? "";
  const count = (engine: AdminRagEngine) => (db.moduleReferences ?? []).filter((r) => r.engine === engine && r.status === "ready").length;
  return [
    { id: "strategy-naive", name: "文档证据检索策略", scope: "文档证据", impact: `Naive RAG · 全文 + 向量 RRF 混合 · ${model}`, controls: ["TopK=5", `${dims} 维向量`, `已接 ${count("Naive RAG")} 个真实来源`] },
    { id: "strategy-gbrain", name: "知识百科检索策略", scope: "知识百科", impact: `Gbrain · 关键词 + 向量 RRF · ${model}`, controls: ["TopK=5", "RRF 融合排序", `已接 ${count("Gbrain")} 个真实来源`] },
    { id: "strategy-graph", name: "关系图谱检索策略", scope: "关系图谱", impact: "GraphRAG · LightRAG mix（local/global/hybrid）", controls: ["多跳路径", "图谱 + 向量", `已接 ${count("GraphRAG")} 个真实来源`] }
  ];
}

// 评估集：从真实知识资产规模派生指标，而非 fixture。
export async function getAdminEvaluations(
  user: StoreUser
): Promise<Array<{ profile: string; evidence: number; score: string; latency: string }>> {
  if (user.role !== "admin") return [];
  const db = await readDb();
  const ko = db.knowledgeObjects;
  const refs = db.moduleReferences ?? [];
  const mk = (profile: string, engine: AdminRagEngine) => {
    const objs = ko.filter((o) => o.ragEngine === engine);
    const ready = refs.filter((r) => r.engine === engine && r.status === "ready").length;
    return { profile, evidence: objs.length, score: objs.length > 0 ? `${ready} 个就绪来源` : "待入库", latency: "实时模块检索" };
  };
  return [mk("文档证据检索策略", "Naive RAG"), mk("知识百科检索策略", "Gbrain"), mk("关系图谱检索策略", "GraphRAG")];
}

export async function getAdminDashboardSnapshot(
  user: StoreUser,
  options: { checkHealth?: (engine: AdminRagEngine) => Promise<AdminServiceHealth> } = {}
): Promise<AdminDashboardSnapshot> {
  if (user.role !== "admin") {
    return emptyAdminDashboardSnapshot();
  }

  const requests = await listAdminIntakeRequests(user);
  const assets = await listAdminKnowledgeAssetDetails(user);
  const pending = requests.filter((request) => request.status === "待管理员确认" || request.status === "等待复核").length;
  const processing = requests.filter((request) => request.status === "处理中").length;
  const published = requests.filter((request) => request.status === "已发布").length;
  const rejected = requests.filter((request) => request.status === "已退回").length;
  const healthCheck = options.checkHealth ?? defaultCheckAdminModuleHealth;
  const moduleHealth = await Promise.all((["Gbrain", "Naive RAG", "GraphRAG"] as AdminRagEngine[]).map((engine) => healthCheck(engine)));
  const healthCards: AdminDashboardSnapshot["healthCards"] = [
    {
      id: "platform-store",
      label: "平台状态库",
      value: "可用",
      detail: `${requests.length} 个资料请求，${assets.length} 条资产记录`,
      status: "healthy",
      route: "/admin/pipelines"
    },
    ...moduleHealth.map((item) => ({
      id: item.id,
      label: item.id,
      value: healthValue(item.status),
      detail: item.detail,
      status: item.status,
      route: engineHealthRoute(item.id)
    }))
  ];

  return {
    requests: {
      total: requests.length,
      pending,
      processing,
      published,
      rejected
    },
    assets: {
      total: assets.length,
      gbrain: assets.filter((asset) => asset.engine === "Gbrain").length,
      naive: assets.filter((asset) => asset.engine === "Naive RAG").length,
      graph: assets.filter((asset) => asset.engine === "GraphRAG").length
    },
    healthCards,
    dataOverview: buildAdminDataOverview(assets)
  };
}

export async function askStoredScenarioKnowledge(
  user: StoreUser,
  input: { scenarioId: string; query: string },
  spans?: TraceSpan[]
): Promise<StoredScenarioAnswer | null> {
  const query = input.query.trim();
  if (!query) return null;
  const db = await readDb();
  const scenario = db.scenarios.find((item) => item.id === input.scenarioId);
  if (!scenario || !canReadScenario(user, scenario)) return null;
  const moduleReferences = (db.moduleReferences ?? [])
    .filter((reference) => reference.scenarioId === scenario.id && canAccess(user, reference.accessControl));
  if (moduleReferences.length > 0) {
    // 已真实入库的场景：始终走真实 RAG 模块检索，不回退到本地 fixture 答案。
    return await askRealScenarioKnowledge(user, scenario, query, moduleReferences, spans);
  }
  // 尚未完成真实入库：诚实告知，不用本地 fixture 伪造答案。
  return {
    scenarioId: scenario.id,
    query,
    answer: {
      text: `「${scenario.name}」还没有完成真实入库，暂时无法基于真实证据回答。请在后台完成资料确认与入库后再提问。`,
      engine: adminEngineForRagMode(defaultSelectedMode(ragModeForTemplate(scenario.templateId))),
      citations: [],
      nextActions: ["查看任务中心", "在后台确认入库", "补充资料"]
    }
  };
}

function buildLocalScenarioKnowledgeAnswer(
  db: PlatformDb,
  user: StoreUser,
  scenario: StoredScenario,
  query: string,
  options: { realModuleError?: string } = {}
): StoredScenarioAnswer {
  const candidates = db.knowledgeObjects
    .filter((item) => item.scenarioId === scenario.id && canReadKnowledgeObject(user, item))
    .map((item) => ({ item, score: relevanceScore(query, item) }))
    .sort((a, b) => b.score - a.score);
  const selected = candidates.filter((entry) => entry.score > 0).slice(0, 3);
  const citations = (selected.length > 0 ? selected : candidates.slice(0, 3)).map(({ item }) => ({
    knowledgeObjectId: item.id,
    sourceOriginalName: item.sourceOriginalName,
    scenarioName: scenario.name,
    engine: item.ragEngine,
    excerpt: scenarioCitationExcerpt(item.content, 260)
  }));
  if (citations.length === 0) {
    return {
      scenarioId: scenario.id,
      query,
      answer: {
        text: `「${scenario.name}」还没有完成可召回的知识入库，请先等待后台处理完成后再提问。`,
        engine: adminEngineForRagMode(defaultSelectedMode(ragModeForTemplate(scenario.templateId))),
        citations: [],
        nextActions: options.realModuleError ? ["后台检查真实模块连接", "查看任务中心", "补充资料"] : ["查看任务中心", "补充资料", "等待后台确认"]
      }
    };
  }

  const engine = citations[0].engine;
  const evidence = citations.map((citation) => citation.excerpt).join("\n");
  return {
    scenarioId: scenario.id,
    query,
    answer: {
      text: buildScenarioAnswerText(scenario.name, query, engine, evidence),
      engine,
      citations,
      nextActions: options.realModuleError ? ["继续追问", "查看引用资料", "后台检查真实模块连接"] : ["继续追问", "查看引用资料", "生成业务成品"]
    }
  };
}

export async function listGlobalChatSessions(user: StoreUser): Promise<GlobalChatSessionSummary[]> {
  // T1b-2：只加载 chatSessions 集合（非整库），权限过滤/排序/映射不变。
  return ((await queryAllGlobalSessions()) as StoredGlobalChatSession[])
    .filter((session) => canReadGlobalChatSessionDetail(user, session))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toGlobalChatSummary);
}

export async function getGlobalChatSession(user: StoreUser, sessionId: string): Promise<StoredGlobalChatSession | null> {
  // T1b-2：逐行 SQL 查（等价 db.chatSessions.find(id)）；权限/清洗仍在 JS。
  const session = (await queryGlobalSessionById(sessionId)) as StoredGlobalChatSession | null;
  if (!session || !canReadGlobalChatSessionDetail(user, session)) return null;
  return sanitizeGlobalChatSessionForDisplay(session);
}

export async function createGlobalChatSession(
  user: StoreUser,
  input: {
    query?: string;
    scope?: GlobalChatScope;
    threadId?: string;
    architectureVersion?: "legacy" | "agent-gateway";
  } = {}
): Promise<StoredGlobalChatSession> {
  const scope = input.scope ?? "company";
  if (!hasValidCallerIdentity(user)) throw new Error("invalid actor");
  if ((scope === "team" || scope === "company") && !hasExplicitOrganization(user)) throw new Error("invalid actor organization");
  if (scope === "team" && !hasExplicitTeam(user)) throw new Error("invalid actor team");
  const db = await readDb();
  const now = new Date().toISOString();
  const query = input.query?.trim() ?? "";
  const session: StoredGlobalChatSession = {
    id: `chat_${randomUUID()}`,
    title: query ? chatTitleFromQuery(query) : "新的全域问答",
    ownerUserId: user.userId,
    ownerName: user.name,
    organizationId: normalizeOrganizationId(user.organizationId),
    teamIds: normalizeTeamIds(user.teamIds),
    scope,
    threadId: input.threadId?.trim() || undefined,
    architectureVersion: input.architectureVersion ?? "legacy",
    createdAt: now,
    updatedAt: now,
    compressedContext: "",
    messages: []
  };

  const tracesBefore = db.traces.length;
  // P36d 阶段3a-i：agent-gateway 会话首轮**不**走 legacy 手写答案管线——首轮与追问统一由 web relay
  // 转发 agent-gateway（前端 SSE 消费），保架构自洽 + 首轮也进 agent 记忆 state。title 仍由 query 生成
  // （见上 :2551），只跳过 appendUserAndAssistantTurn，会话以空 messages 建好后由 relay 补首轮。
  if (query && session.architectureVersion !== "agent-gateway") {
    await appendUserAndAssistantTurn(db, user, session, query, now);
  }
  const newTraces = db.traces.slice(0, Math.max(0, db.traces.length - tracesBefore));

  // #7 并发安全：上方检索在锁外并发；持久化临界区串行 + 重读最新 db，避免整库覆盖丢并发写的 session。
  return withDbLock(async () => {
    const latestDb = await readDb();
    // trace 回归修复：本轮新增 trace 带入锁内 latestDb（否则被整库写回覆盖丢失，codex 审）。
    if (newTraces.length > 0) {
      latestDb.traces.unshift(...newTraces);
      if (latestDb.traces.length > 2000) latestDb.traces = latestDb.traces.slice(0, 2000);
    }
    latestDb.chatSessions.unshift(session);
    await writeDb(latestDb);
    return sanitizeGlobalChatSessionForDisplay(session);
  });
}

export async function appendGlobalChatMessage(
  user: StoreUser,
  // P33/P36 合一（spec §2.5，输出形式已定"创建后固定"）：删 P33 休眠的覆盖支路，恢复 {sessionId, query}。
  input: { sessionId: string; query: string }
): Promise<StoredGlobalChatSession | null> {
  const query = input.query.trim();
  if (!query) return null;
  const db = await readDb();
  const sessionIndex = db.chatSessions.findIndex((item) => item.id === input.sessionId);
  if (sessionIndex < 0) return null;
  const session = db.chatSessions[sessionIndex];
  if (!canManageGlobalChatSession(user, session)) return null;
  const tracesBefore = db.traces.length;
  await appendUserAndAssistantTurn(db, user, session, query, new Date().toISOString());
  const newTraces = db.traces.slice(0, Math.max(0, db.traces.length - tracesBefore));
  // #7 并发安全：持久化临界区串行 + 重读最新 db 后按 id 放回，避免整库覆盖。
  return withDbLock(async () => {
    const latestDb = await readDb();
    const idx = latestDb.chatSessions.findIndex((item) => item.id === input.sessionId);
    if (idx < 0) return null; // #4（codex 审）：锁内找不到不 unshift 复活已删 session
    // trace 回归修复：本轮新增 trace 带入锁内。
    if (newTraces.length > 0) {
      latestDb.traces.unshift(...newTraces);
      if (latestDb.traces.length > 2000) latestDb.traces = latestDb.traces.slice(0, 2000);
    }
    latestDb.chatSessions[idx] = session;
    await writeDb(latestDb);
    return sanitizeGlobalChatSessionForDisplay(session);
  });
}

export async function listScenarioChatSessions(user: StoreUser, scenarioId: string): Promise<ScenarioChatSessionSummary[]> {
  // T1b-2：SQL 预过滤 scenarioId（非整库）；权限/排序/映射不变。
  const scenario = (await queryScenarioById(scenarioId)) as StoredScenario | null;
  if (!scenario || !canReadScenario(user, scenario)) return [];
  return ((await queryScenarioChatSessionsByScenario(scenarioId)) as StoredScenarioChatSession[])
    .filter((session) => canReadScenarioChatSessionDetail(user, session))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toScenarioChatSummary);
}

export async function getScenarioChatSession(
  user: StoreUser,
  input: { scenarioId: string; sessionId: string }
): Promise<StoredScenarioChatSession | null> {
  // T1b-2：逐行 SQL 查场景 + 会话（无元素变换的集合）；权限/清洗仍在 JS。
  const scenario = (await queryScenarioById(input.scenarioId)) as StoredScenario | null;
  if (!scenario || !canReadScenario(user, scenario)) return null;
  const session = (await queryScenarioChatSession(input.scenarioId, input.sessionId)) as StoredScenarioChatSession | null;
  if (!session || !canReadScenarioChatSessionDetail(user, session)) return null;
  return sanitizeScenarioChatSessionForDisplay(session);
}

export async function createScenarioChatSession(
  user: StoreUser,
  input: { scenarioId: string; query?: string }
): Promise<StoredScenarioChatSession | null> {
  const db = await readDb();
  const scenario = db.scenarios.find((item) => item.id === input.scenarioId);
  if (!scenario || !canReadScenario(user, scenario)) return null;
  const now = new Date().toISOString();
  const query = input.query?.trim() ?? "";
  const session: StoredScenarioChatSession = {
    id: `scenario_chat_${randomUUID()}`,
    scenarioId: scenario.id,
    title: query ? chatTitleFromQuery(query) : `${scenario.name}的业务会话`,
    ownerUserId: user.userId,
    ownerName: user.name,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  const tracesBefore = db.traces.length;
  if (query) await appendScenarioChatTurn(db, user, session, query, now);
  const newTraces = db.traces.slice(0, Math.max(0, db.traces.length - tracesBefore));
  // #7 并发安全：持久化临界区串行 + 重读最新 db，避免整库覆盖丢并发写的 session。
  return withDbLock(async () => {
    const latestDb = await readDb();
    if (newTraces.length > 0) {
      latestDb.traces.unshift(...newTraces);
      if (latestDb.traces.length > 2000) latestDb.traces = latestDb.traces.slice(0, 2000);
    }
    latestDb.scenarioChatSessions.unshift(session);
    await writeDb(latestDb);
    return sanitizeScenarioChatSessionForDisplay(session);
  });
}

export async function appendScenarioChatMessage(
  user: StoreUser,
  input: { scenarioId: string; sessionId: string; query: string }
): Promise<StoredScenarioChatSession | null> {
  const query = input.query.trim();
  if (!query) return null;
  const db = await readDb();
  const scenario = db.scenarios.find((item) => item.id === input.scenarioId);
  if (!scenario || !canReadScenario(user, scenario)) return null;
  const sessionIndex = db.scenarioChatSessions.findIndex((item) => item.id === input.sessionId && item.scenarioId === input.scenarioId);
  if (sessionIndex < 0) return null;
  const session = db.scenarioChatSessions[sessionIndex];
  if (!canManageScenarioChatSession(user, session)) return null;
  const tracesBefore = db.traces.length;
  await appendScenarioChatTurn(db, user, session, query, new Date().toISOString());
  const newTraces = db.traces.slice(0, Math.max(0, db.traces.length - tracesBefore));
  // #7 并发安全：持久化临界区串行 + 重读最新 db 后按 id 放回。
  return withDbLock(async () => {
    const latestDb = await readDb();
    const idx = latestDb.scenarioChatSessions.findIndex((item) => item.id === input.sessionId && item.scenarioId === input.scenarioId);
    if (idx < 0) return null; // #4（codex 审）：锁内找不到不复活已删 session
    if (newTraces.length > 0) {
      latestDb.traces.unshift(...newTraces);
      if (latestDb.traces.length > 2000) latestDb.traces = latestDb.traces.slice(0, 2000);
    }
    latestDb.scenarioChatSessions[idx] = session;
    await writeDb(latestDb);
    return sanitizeScenarioChatSessionForDisplay(session);
  });
}

// ─── 024 · 站内通知(FR-550~556)────────────────────────────────────────────
const NOTIFICATION_LIST_CAP = 100;

// 旁路写:独立 withDbLock(自己的事务，不与业务 writeDb 共享),异常全吞只留日志——通知失败
// ≠ 业务失败(FR-556 fail-open 红线)。调用方必须在业务事务/withDbLock 之外调用(不可嵌套，
// withDbLock 非重入会死锁)。dedupeKey 命中已存在通知则跳过(单进程 withDbLock 读-判-写足够，
// AM-2406；跨进程 OUT 同 022b 单进程约束)。
// AM-2407 测试缝：注入通知写失败，验证 fail-open(业务事件不受连坐)——同 __setDetectPiiForTest
// 先例，生产恒 false。
let __notifyFailureInjectedForTest = false;
export function __setNotifyFailureForTest(fail: boolean): void {
  __notifyFailureInjectedForTest = fail;
}

async function notifyQuietly(input: Omit<StoredNotification, "id" | "read" | "createdAt">): Promise<void> {
  try {
    if (__notifyFailureInjectedForTest) throw new Error("注入测试:通知写失败");
    await withDbLock(async () => {
      const latest = await readDb();
      const list = latest.notifications ?? [];
      if (input.dedupeKey && list.some((n) => n.dedupeKey === input.dedupeKey)) return; // 持久幂等
      latest.notifications = [
        ...list,
        { ...input, id: `nt_${randomUUID()}`, read: false, createdAt: new Date().toISOString() }
      ];
      await writeDb(latest);
    });
  } catch (error) {
    console.warn("[notifyQuietly] 通知写失败(旁路不阻断业务)", error);
  }
}

// 测试专用出口：直接验证 dedupeKey 幂等，不必绕经真实触发路径(先例 __triggerSourceCardGenerationForTest)。
export async function __notifyQuietlyForTest(input: Omit<StoredNotification, "id" | "read" | "createdAt">): Promise<void> {
  await notifyQuietly(input);
}

function notificationVisible(user: StoreUser, n: StoredNotification): boolean {
  if (n.audience === "admin-role") return user.role === "admin";
  return n.userId === user.userId;
}

export async function listNotifications(user: StoreUser): Promise<StoredNotification[]> {
  const db = await readDb();
  return (db.notifications ?? [])
    .filter((n) => notificationVisible(user, n))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, NOTIFICATION_LIST_CAP);
}

export async function unreadNotificationCount(user: StoreUser): Promise<number> {
  const db = await readDb();
  return (db.notifications ?? []).filter((n) => notificationVisible(user, n) && !n.read).length;
}

export async function markNotificationsRead(user: StoreUser, input: { ids?: string[]; all?: boolean }): Promise<number> {
  let marked = 0;
  await withDbLock(async () => {
    const latest = await readDb();
    latest.notifications = (latest.notifications ?? []).map((n) => {
      if (n.read) return n;
      if (!notificationVisible(user, n)) return n; // 权限正交:只能标自己可见的,越权标他人 0 生效
      if (!input.all && !(input.ids ?? []).includes(n.id)) return n;
      marked += 1;
      return { ...n, read: true };
    });
    await writeDb(latest);
  });
  return marked;
}

// ─── 022b · 持久摄取队列(P46,B 方案:同步摄取外包持久 job 生命周期)──────────────
// 语义:①同步 UX 不变——decideAdminIntakeRequest 仍 await 到底,返回 ready/failed,不改
// 52+ 依赖测试(B 红线)②job done 仅当 task/scenario 已落终态,同一 withDbLock→readDb(latest)
// →单次 writeDb 原子提交(禁两次 writeDb,防崩溃留 task=ready/job=running 的悬空态)③并发 gate
// (FF_INGEST_CONCURRENCY,默认 2)限执行并发——审批不在锁内跑 ingest,并发 HTTP 可同时进摄取,
// 非"天然串行"④runningJobIds 运行时 Set + withDbLock 内重读原子 claim,区分"本进程执行中"
// vs"崩溃僵尸"⑤重试有界(attempts>3 落 failed 终态,不无限重试)。
// ⚠ BLOCK#3·单进程部署约束：runningJobIds 是进程内内存 Set，withDbLock 只保证同进程互斥，
// PG 无 lease/owner 字段。多副本部署时，进程 B 的 recoverPendingIngestTasks 无法区分"进程 A
// 正在正常执行的 running"与"崩溃僵尸 running"，会把前者当僵尸重跑（产物双写风险）。P46 spec
// §〇/主 spec §3.2 已明确 OUT 跨进程分布式队列——此为已知限制，非本轮范围；生产多副本需 PG
// 行级 lease/owner_id（未实现）。
const INGEST_RETRY_CAP = 3;
const runningJobIds = new Set<string>();

function computeIngestIdempotencyKey(scenarioId: string, taskId: string, selectedEngine: AdminRagEngine, sourceFileIds: string[]): string {
  const basis = `${scenarioId}:${taskId}:${selectedEngine}:${[...sourceFileIds].sort().join(",")}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

// 全局 ingest 执行 gate：限并发【执行】数（非入列数），超出 cap 的审批在此排队，不丢单、不假发布。
let ingestGateActive = 0;
let ingestGatePeakForTest = 0;
const ingestGateWaiters: Array<() => void> = [];
function ingestGateCap(): number {
  const raw = Number(process.env.FF_INGEST_CONCURRENCY ?? 2);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
}
async function acquireIngestGate(): Promise<void> {
  if (ingestGateActive >= ingestGateCap()) {
    // 满槽：入等待队列。被唤醒 = releaseIngestGate 把槽位「直接移交」（active 计数由 releaser 保留、
    // 不减也不加），故此处**不再自增**——否则被唤醒 waiter 与新 acquirer 对同一次 release 双重计数，
    // ingestGateActive 跨调用累积上漂，最终永久 ≥cap → 所有 acquire 永久阻塞（死锁）。
    await new Promise<void>((resolve) => ingestGateWaiters.push(resolve));
    if (ingestGateActive > ingestGatePeakForTest) ingestGatePeakForTest = ingestGateActive;
    return;
  }
  ingestGateActive += 1;
  if (ingestGateActive > ingestGatePeakForTest) ingestGatePeakForTest = ingestGateActive;
}
function releaseIngestGate(): void {
  const next = ingestGateWaiters.shift();
  if (next) {
    next(); // 有等待者：槽位直接移交，active 不减（等待者继承该槽，避免双重计数）。
  } else {
    ingestGateActive -= 1; // 无等待者：真正释放槽位。
  }
}
// AM-2202 测试观测口：并发峰值（不重复对外暴露真实计数，仅供测试断言 ≤ cap）。
export function __ingestGatePeakForTest(): number {
  return ingestGatePeakForTest;
}
export function __resetIngestRuntimeStateForTest(): void {
  runningJobIds.clear();
  ingestGateActive = 0;
  ingestGatePeakForTest = 0;
  ingestGateWaiters.length = 0;
}
// 造 job 数据的测试缝（同 __seedChatTracesForTest 先例）：直接覆盖 db.ingestQueue。
export async function __seedIngestQueueForTest(jobs: IngestQueueJob[]): Promise<void> {
  const db = await readDb();
  db.ingestQueue = jobs;
  await writeDb(db);
}

// AM-2207 测试缝：把某 job 标记为"本进程正在执行中"，不实际跑 ingest——用来构造
// claimIngestQueueJob 的"running 且在 runningJobIds"分支（原子 claim 幂等，恢复应跳过）。
export function __markIngestJobRunningForTest(jobId: string): void {
  runningJobIds.add(jobId);
}

// claim（queued/running-僵尸 → running）：withDbLock 内重读最新 db 并原子改状态，
// 一次性裁决三种非"可执行"归宿——本进程已在跑（AM-2207 幂等跳过）、关联 task/scenario 已删
// （AM-2205 落 failed 可诊断）、重试超上限（AM-2204 落 failed 终态）——否则 claim 成功。
// 024 · FR-552③：重试超限（"retry-exhausted"）是一条独立的终态落定路径（易漏，codex BLOCK#1）——
// 与"claimed"/"skip"分开返回，供调用方在锁外补发入库失败通知（此函数本身在 withDbLock 内，
// 不可在此直接 notifyQuietly，否则嵌套 withDbLock 死锁）。
async function claimIngestQueueJob(jobId: string): Promise<
  | { outcome: "claimed"; job: IngestQueueJob; task: StoreTask; scenario: StoredScenario }
  | { outcome: "retry-exhausted"; job: IngestQueueJob; scenario: StoredScenario }
  | { outcome: "skip" }
> {
  return withDbLock(async () => {
    const db = await readDb();
    const jobs = db.ingestQueue ?? [];
    const idx = jobs.findIndex((j) => j.id === jobId);
    if (idx < 0) return { outcome: "skip" };
    const job = jobs[idx];
    if (job.status === "done" || job.status === "failed") return { outcome: "skip" };
    if (job.status === "running" && runningJobIds.has(job.id)) return { outcome: "skip" }; // AM-2207
    const now = new Date().toISOString();
    const taskIdx = db.tasks.findIndex((t) => t.id === job.taskId);
    const scenarioIdx = db.scenarios.findIndex((s) => s.id === job.scenarioId);
    if (taskIdx < 0 || scenarioIdx < 0) {
      // AM-2205:恢复时关联 task/scenario 已删除 → 直接 failed，可诊断，不卡队列。无场景可取
      // ownerUserId，无收件人，不通知（同 claimed.scenario 缺失时的既有沉默约定）。
      jobs[idx] = { ...job, status: "failed", attempts: job.attempts + 1, lastError: "关联的任务或场景已被删除，无法恢复入库", updatedAt: now };
      db.ingestQueue = jobs;
      await writeDb(db);
      return { outcome: "skip" };
    }
    const nextAttempts = job.attempts + 1;
    if (nextAttempts > INGEST_RETRY_CAP) {
      // AM-2204:重试有界——超过上限直接落终态 failed，绝不无限重试。
      // ★ BLOCK#1：job=failed 是终态（恢复永久跳过），task/scenario 必须同一 writeDb 事务落
      // failed 终态——否则永久卡在"队列已终态失败但业务仍停在审批前非终态"，无人再来审批。
      const lastError = `入库多次重试（第 ${nextAttempts} 次）仍未成功，已放弃，请重新提交审批`;
      const failedJob: IngestQueueJob = { ...job, status: "failed", attempts: nextAttempts, lastError, updatedAt: now };
      jobs[idx] = failedJob;
      db.ingestQueue = jobs;
      const t = db.tasks[taskIdx];
      db.tasks[taskIdx] = {
        ...t,
        status: "failed",
        waitingFor: "用户补充资料",
        currentStep: "入库多次重试仍未成功",
        userMessage: `后台入库多次重试仍未成功：${lastError}`,
        nextActions: ["补充资料", "重新提交后台处理"],
        updatedAt: "刚刚",
        updatedAtIso: now
      };
      const failedScenario = { ...db.scenarios[scenarioIdx], status: "failed" as const, updatedAt: now };
      db.scenarios[scenarioIdx] = failedScenario;
      await writeDb(db);
      return { outcome: "retry-exhausted", job: failedJob, scenario: failedScenario };
    }
    const claimed: IngestQueueJob = { ...job, status: "running", attempts: nextAttempts, updatedAt: now };
    jobs[idx] = claimed;
    db.ingestQueue = jobs;
    runningJobIds.add(job.id);
    await writeDb(db);
    return { outcome: "claimed", job: claimed, task: db.tasks[taskIdx], scenario: db.scenarios[scenarioIdx] };
  });
}

// 执行一个 job：gate 排队 → claim running → 锁外跑同步 ingestScenarioSources（慢操作不占锁）
// → 终态原子提交（★ BLOCK#1：done/failed 与 task/scenario 终态同一 withDbLock→单次 writeDb）。
// 成功返回 ingest 结果；ingest 失败则记 job failed 后原样向上抛（保持 decideAdminIntakeRequest
// 既有"审批失败即 rejects"语义，AM-2209：单 job 失败不影响其它 job 独立成败）。
async function executeIngestQueueJob(
  jobId: string
): Promise<{ sourceIds: string[]; naiveReplicaStats: { created: number; skipped: number; failed: number } } | null> {
  await acquireIngestGate();
  // 018 T1(★ BLOCK#1/#3)：终态提交只含 ingest，不含卡生成 LLM——先记下"是否需要触发+目标场景"，
  // 不在 try 内直接 return/throw，等 finally 释放 gate 之后再触发源卡生成钩子(锁外、不占 gate)。
  let scenarioIdForCardGen: string | null = null;
  let terminalError: unknown;
  let terminalResult: { sourceIds: string[]; naiveReplicaStats: { created: number; skipped: number; failed: number } } | null = null;
  // 024 · FR-552：入库终态通知载荷——终态提交（或 claim 阶段重试超限）落定后，锁外/gate 外
  // 统一发送（旁路，不占锁/gate，fail-open）。覆盖 022b 全部终态路径（★ codex BLOCK#1）：
  // ①claim 阶段 attempts>3 直接落 failed（易漏，见下方 retry-exhausted 分支）；
  // ②本函数 ingestScenarioSources 抛错落 failed；③本函数成功提交 ready/partial。
  let pendingNotify: (() => Promise<void>) | null = null;
  try {
    const claimed = await claimIngestQueueJob(jobId);
    if (claimed.outcome === "skip") return null;
    if (claimed.outcome === "retry-exhausted") {
      const { scenario, job } = claimed;
      // ★ codex BLOCK#1 修复：此前在此直接 return null，跳过了 finally 之后 line ~3511 的
      // pendingNotify 统一派发点，导致 claim 阶段重试超限这条终态路径永远发不出通知。改为落
      // else 分支包裹原有主处理逻辑，让本分支也走到 finally 释放 gate/lock 之后再统一发送
      // （旁路 fail-open，与 ingestScenarioSources 执行失败/成功提交两条终态路径统一）。
      pendingNotify = () =>
        notifyQuietly({
          audience: "user",
          userId: scenario.ownerUserId,
          kind: "ingest-terminal",
          title: "入库失败",
          body: `「${scenario.name}」入库多次重试仍未成功，请检查资料后重新提交。`,
          scenarioId: scenario.id,
          taskId: job.taskId,
          dedupeKey: `ingest-terminal:${job.taskId}:failed`
        });
    } else {
    const { job, task, scenario } = claimed;
    let ingestOutcome: Awaited<ReturnType<typeof ingestScenarioSources>> | undefined;
    let ingestError: unknown;
    let newAuditEvents: StoredAdminAuditEvent[] = [];
    // 024 · FR-552②：partial M/N 真值锚点——与 ingestScenarioSources 内部 scenarioFiles.length
    // 取同一快照口径（本次声明入库的文件数），用于失败分支的通知文案（成功分支改用 ingestOutcome
    // 自身返回的 declaredN，避免依赖调用方与被调用方各自计算是否漂移）。
    let declaredN = 0;
    try {
      const workingDb = await readDb();
      declaredN = workingDb.files.filter((f) => f.scenarioId === scenario.id).length;
      // ingestScenarioSources / triggerGbrainAutoLink / triggerGbrainThemeCompile 会在执行途中
      // 直接 appendAuditEvent(workingDb, ...)（如 theme_deferred/lock_contention 诊断事件）；
      // 这份快照本身不会被写回，先记下"执行前已有的事件 id"，供终态提交时把执行期间新增的
      // 事件 diff 出来 replay 到最新快照（同下面 parsedArtifacts 等的 replay 手法）。
      const auditEventIdsBefore = new Set((workingDb.auditEvents ?? []).map((e) => e.id));
      ingestOutcome = await ingestScenarioSources(workingDb, scenario, job.selectedMode, job.selectedEngine, job.updatedAt, job.requestedBy, job.strategyParameters);
      newAuditEvents = (workingDb.auditEvents ?? []).filter((e) => !auditEventIdsBefore.has(e.id));
    } catch (error) {
      ingestError = error;
      console.error("[ingestScenarioSources] FAILED", job.selectedEngine, scenario.name, error);
    }
    await withDbLock(async () => {
      const latest = await readDb();
      const jobs = latest.ingestQueue ?? [];
      const jIdx = jobs.findIndex((j) => j.id === jobId);
      const now = new Date().toISOString();
      if (newAuditEvents.length) latest.auditEvents = [...newAuditEvents, ...(latest.auditEvents ?? [])];
      if (ingestError) {
        // ★ BLOCK#1：job=failed 是终态（恢复永久跳过该 job，不再重试——同步审批"失败即抛"的
        // 既有语义不变，单次执行失败不回 queued），task/scenario 必须同一 writeDb 事务落 failed
        // 终态，否则永久卡在"队列已终态失败但业务停在审批前非终态"，无人再来审批。
        const lastError = ingestError instanceof Error ? ingestError.message : String(ingestError);
        if (jIdx >= 0) jobs[jIdx] = { ...jobs[jIdx], status: "failed", lastError, updatedAt: now };
        latest.ingestQueue = jobs;
        const failTaskIdx = latest.tasks.findIndex((t) => t.id === job.taskId);
        const failScenarioIdx = latest.scenarios.findIndex((s) => s.id === job.scenarioId);
        if (failTaskIdx >= 0) {
          const t = latest.tasks[failTaskIdx];
          latest.tasks[failTaskIdx] = {
            ...t,
            status: "failed",
            waitingFor: "用户补充资料",
            currentStep: "入库失败",
            userMessage: `后台入库失败：${lastError}`,
            nextActions: ["补充资料", "重新提交后台处理"],
            updatedAt: "刚刚",
            updatedAtIso: now
          };
        }
        if (failScenarioIdx >= 0) {
          latest.scenarios[failScenarioIdx] = { ...latest.scenarios[failScenarioIdx], status: "failed", updatedAt: now };
        }
        await writeDb(latest);
        return;
      }
      const taskIdx = latest.tasks.findIndex((t) => t.id === job.taskId);
      const scenarioIdx = latest.scenarios.findIndex((s) => s.id === job.scenarioId);
      if (taskIdx >= 0) {
        const t = latest.tasks[taskIdx];
        latest.tasks[taskIdx] = {
          ...t,
          status: "ready",
          kind: "发布复核",
          ragMode: job.selectedMode,
          strategyParameters: job.strategyParameters,
          waitingFor: "场景负责人",
          progress: 100,
          currentStep: "后台已确认入库并发布",
          userMessage: "后台已确认入库，并生成可使用的业务场景。",
          nextActions: ["打开场景", "继续问答", "更新资料"],
          adminEntry: "后台已确认资料、权限和处理方式，场景已经发布到前台。",
          updatedAt: "刚刚",
          updatedAtIso: now
        };
      }
      if (scenarioIdx >= 0) {
        const s = latest.scenarios[scenarioIdx];
        latest.scenarios[scenarioIdx] = {
          ...s,
          status: "ready",
          updatedAt: now,
          // 026 · FR-582:本轮入库检出的场景级 piiHints(未检出/未检测则缺省,不虚标)。
          ...(ingestOutcome?.piiHints ? { piiHints: ingestOutcome.piiHints } : {})
        };
      }
      if (ingestOutcome) {
        // 把 ingestScenarioSources 在(锁外、可能已过期的)workingDb 快照上算出的新记录 replay 到
        // 最新快照：先清掉该场景的旧记录(同 ingestScenarioSources 内部"先删后加"语义)，再接入
        // 本次新记录；只动这一个场景的切片，不影响 latest 中其它场景在 ingest 执行期间的并发写入。
        const scenarioId = job.scenarioId;
        latest.parsedArtifacts = latest.parsedArtifacts.filter((a) => a.scenarioId !== scenarioId);
        latest.knowledgeObjects = latest.knowledgeObjects.filter((k) => k.scenarioId !== scenarioId);
        latest.moduleReferences = (latest.moduleReferences ?? []).filter((m) => m.scenarioId !== scenarioId);
        latest.parsedArtifacts.unshift(...ingestOutcome.nextArtifacts);
        latest.knowledgeObjects.unshift(...ingestOutcome.nextKnowledgeObjects);
        latest.moduleReferences.unshift(...ingestOutcome.nextModuleReferences);
        const updatedFileById = new Map(ingestOutcome.updatedFiles.map((f) => [f.id, f]));
        latest.files = latest.files.map((f) => updatedFileById.get(f.id) ?? f);
      }
      appendAuditEvent(latest, job.requestedBy, {
        area: "处理管线",
        summary: `确认入库：${scenario.name}`,
        impact: `${job.selectedEngine} · ${visibilityText(scenario.visibility)}`
      });
      // ★ BLOCK#4：GraphRAG 无唯一约束兜底，标注 dedupGuaranteed:false（Naive/Gbrain 走模块层
      // 唯一约束天然幂等，标 true）——job 成功不代表"重跑也不会重复"，供运维/前端诊断。
      if (jIdx >= 0) jobs[jIdx] = { ...jobs[jIdx], status: "done", dedupGuaranteed: job.selectedEngine !== "GraphRAG", updatedAt: now };
      latest.ingestQueue = jobs;
      await writeDb(latest);
    });
    if (ingestError) {
      terminalError = ingestError;
      // 024 · FR-552②：全失败(M==0) → ingest-terminal failed 通知(构造于 withDbLock 之外，
      // 避免闭包内重赋值造成外层变量类型收窄问题；同 scenarioIdForCardGen 先例的"锁外再决定")。
      const lastError = ingestError instanceof Error ? ingestError.message : String(ingestError);
      pendingNotify = () =>
        notifyQuietly({
          audience: "user",
          userId: scenario.ownerUserId,
          kind: "ingest-terminal",
          title: "入库失败",
          body: `「${scenario.name}」入库失败(0/${declaredN})：${lastError.slice(0, 120)}，请检查资料后重试。`,
          scenarioId: scenario.id,
          taskId: task.id,
          dedupeKey: `ingest-terminal:${task.id}:failed`
        });
    } else {
      scenarioIdForCardGen = job.scenarioId;
      terminalResult = { sourceIds: ingestOutcome!.sourceIds, naiveReplicaStats: ingestOutcome!.naiveReplicaStats };
      // 024 · FR-552②：partial M/N 真值取 ingestOutcome 自身返回的 declaredN/succeededM/failedM
      // （★ codex BLOCK#2：禁用 naiveReplicaStats——那是 Naive 副本失败数，非主入库 M/N，会把
      // "主入库全成+副本失败"误报 partial）；feat 无 partially_ready，scenario/task 字面仍写
      // "ready"（errata），partial 只体现在通知文案，不坍缩"完成"。
      const outcomeDeclaredN = ingestOutcome!.declaredN;
      const succeededM = ingestOutcome!.succeededM;
      const failedM = ingestOutcome!.failedM;
      const partial = outcomeDeclaredN > 0 && succeededM > 0 && succeededM < outcomeDeclaredN;
      pendingNotify = () =>
        notifyQuietly({
          audience: "user",
          userId: scenario.ownerUserId,
          kind: "ingest-terminal",
          title: partial ? "部分就绪" : "入库完成",
          body: partial
            ? `「${scenario.name}」部分就绪:${succeededM}/${outcomeDeclaredN} 篇已入库,${failedM} 篇失败,可对失败篇重试。`
            : `「${scenario.name}」已入库并发布,可以开始问答。`,
          scenarioId: scenario.id,
          taskId: task.id,
          dedupeKey: `ingest-terminal:${task.id}:${partial ? "partial" : "ready"}`
        });
    }
    }
  } finally {
    runningJobIds.delete(jobId); // 幂等：本次未 claim 成功(skip/retry-exhausted)时 delete 是安全 no-op
    releaseIngestGate();
  }
  // 024 · FR-552：gate/锁均已释放，入库终态通知在此锁外发送(旁路，fail-open；notifyQuietly
  // 内部已吞异常，await 只为让"settle 后通知立即可见"确定性成立，不改变既有返回/抛出语义)。
  if (pendingNotify) await pendingNotify();
  // 018 T1：gate 已释放，卡生成 LLM 在此锁外触发。maybeGenerateSourceCard 内部已 fail-open(吞
  // 异常，不阻断终态)——这里 await 只为让"settle 后 descriptionCard 立即可见"确定性成立
  // (AM-1810/1811/1813~1816)，不改变本函数对调用方的既有返回/抛出语义。
  if (scenarioIdForCardGen) await maybeGenerateSourceCard(scenarioIdForCardGen);
  if (terminalError) throw terminalError;
  return terminalResult;
}

// T0：入列（queued）即持久——写失败向上抛（fail-loud，AM-2206），不静默丢单——再交执行引擎跑到终态。
async function runIngestApproval(
  user: StoreUser,
  task: StoreTask,
  scenario: StoredScenario,
  selectedMode: RagEngine,
  selectedEngine: AdminRagEngine,
  strategyParameters: AdminStrategyParameters
): Promise<{ sourceIds: string[]; naiveReplicaStats: { created: number; skipped: number; failed: number } }> {
  const jobId = `ingest_${randomUUID()}`;
  const enqueuedAt = new Date().toISOString();
  let duplicateActiveJobId: string | null = null;
  await withDbLock(async () => {
    const latest = await readDb();
    // ★ BLOCK#2b：终态提交按 scenarioId 清空 latest 的 parsedArtifacts/knowledgeObjects/
    // moduleReferences 再写本 job 结果——同一 scenario 两个并发 job 会互相覆盖产物。入列前
    // 原子查重：该 scenario 已有非终态（queued/running）job 在跑，则不重复创建，直接拒绝，
    // 避免同 scenario 并发摄取。
    const existingActive = (latest.ingestQueue ?? []).find(
      (j) => j.scenarioId === scenario.id && (j.status === "queued" || j.status === "running")
    );
    if (existingActive) {
      duplicateActiveJobId = existingActive.id;
      return;
    }
    const sourceFileIds = latest.files.filter((f) => f.scenarioId === scenario.id).map((f) => f.id);
    const job: IngestQueueJob = {
      id: jobId,
      taskId: task.id,
      scenarioId: scenario.id,
      selectedMode,
      selectedEngine,
      strategyParameters,
      requestedBy: user,
      status: "queued",
      attempts: 0,
      enqueuedAt,
      updatedAt: enqueuedAt,
      idempotencyKey: computeIngestIdempotencyKey(scenario.id, task.id, selectedEngine, sourceFileIds)
    };
    latest.ingestQueue = [...(latest.ingestQueue ?? []), job];
    await writeDb(latest);
  });
  if (duplicateActiveJobId) {
    throw new Error(`场景「${scenario.name}」已有入库任务（${duplicateActiveJobId}）在处理中，请稍后重试`);
  }
  const outcome = await executeIngestQueueJob(jobId);
  if (!outcome) {
    throw new Error(`入库任务 ${jobId} 未能进入执行（可能已被并发恢复流程接管）`);
  }
  return outcome;
}

// T1 恢复钩子（启动/CLI/测试可调用）：扫 queued/running 非终态 job——本进程正在执行的
// running（runningJobIds 命中）原样跳过（AM-2207 claim 幂等）；其余（含刚 enqueue 未及 claim
// 的 queued、崩溃遗留的僵尸 running）交给 claimIngestQueueJob 统一裁决（AM-2205/2204/2208）。
export async function recoverPendingIngestTasks(): Promise<{ recovered: number; failed: number; skipped: number }> {
  const db = await readDb();
  const pending = (db.ingestQueue ?? []).filter((j) => j.status === "queued" || j.status === "running");
  const jobIds = pending.map((j) => j.id);
  let skipped = 0;
  for (const job of pending) {
    if (job.status === "running" && runningJobIds.has(job.id)) {
      skipped += 1;
      continue;
    }
    await executeIngestQueueJob(job.id).catch(() => undefined); // 终态已在 claim/终态提交内落盘，这里只关心副作用
  }
  const after = await readDb();
  const afterMap = new Map((after.ingestQueue ?? []).map((j) => [j.id, j.status]));
  let recovered = 0;
  let failedCount = 0;
  for (const id of jobIds) {
    if (afterMap.get(id) === "done") recovered += 1;
    else if (afterMap.get(id) === "failed") failedCount += 1;
  }
  return { recovered, failed: failedCount, skipped };
}

// ─── 018 · 源级描述卡：schema 纯函数 + 生成钩子 + 幂等/漂移/并发(PKP/specs/
// P47-018描述卡迁移-执行spec.md)。挂在 executeIngestQueueJob 终态提交、ingest gate 释放之后
// (★ BLOCK#1/#3)，LLM 全程锁外；manual 卡绝不被自动覆盖(AM-1815)；生成失败/local/关闭开关一律
// fail-open，不阻断已落定的 ingest 终态(AM-1807/1812)。────────────────────────────────

export type SourceCardDocInput = { name: string; sample: string };

// AM-1801·无半卡·五态解析：非法 JSON / 缺(或空) summaryScope / typicalQuestions 为空 /
// typicalQuestions 不足 3 条(或超过 5 条) → null；只有完整合法才返回内容字段，绝不落半卡。
// origin 固定 "auto"：本函数只解析 LLM 生成内容(自动生成路径)，manual 卡走独立的人工写路径(T3)。
export function parseSourceCardOutput(
  content: string
): { summaryScope: string; typicalQuestions: string[]; entityHints?: string[]; origin: SourceCardOrigin } | null {
  const parsed = parseJsonObject(content);
  if (!parsed) return null;
  const summaryScope = typeof parsed.summaryScope === "string" ? parsed.summaryScope.trim() : "";
  if (!summaryScope) return null;
  const typicalQuestions = Array.isArray(parsed.typicalQuestions)
    ? parsed.typicalQuestions.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  if (typicalQuestions.length < 3 || typicalQuestions.length > 5) return null;
  const entityHints = (Array.isArray(parsed.entityHints)
    ? parsed.entityHints.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : []
  ).slice(0, 8);
  return { summaryScope, typicalQuestions, entityHints: entityHints.length ? entityHints : undefined, origin: "auto" };
}

// AM-1802·输入 cap 4000：场景名/说明/处理目标 + 文档名列表 + 每篇正文样本截断 300 字；
// 组装后整体再截 4000 兜底，防止 N 篇大正文文档把 prompt 撑爆。
export function buildSourceCardPrompt(
  scenario: Pick<StoredScenario, "name" | "description" | "processingGoal">,
  docs: SourceCardDocInput[]
): string {
  const lines = [
    `场景名称：${scenario.name}`,
    `场景说明：${scenario.description}`,
    `处理目标：${scenario.processingGoal}`,
    `文档列表（共 ${docs.length} 篇）：${docs.map((d) => d.name).join("、")}`,
    "",
    "文档样本："
  ];
  for (const doc of docs) {
    lines.push(`【${doc.name}】\n${excerpt(doc.sample, 300)}`);
  }
  return excerpt(lines.join("\n"), 4000);
}

// AM-1803·顺序无关确定性指纹：排序去重后的文档名拼接取 sha256——同一组文档名不同顺序 →
// 指纹相同；文档集变更(增/删/替换任一篇) → 指纹变。
export function sourceFingerprint(docNames: string[]): string {
  const sorted = [...new Set(docNames)].sort();
  return createHash("sha256").update(sorted.join(" ")).digest("hex");
}

// AM-1803·后缀机械派生(非 LLM)：按文档名后缀统计分布。
export function docTypeDistribution(docNames: string[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const name of new Set(docNames)) {
    const match = /\.([A-Za-z0-9]+)$/.exec(name);
    const ext = match ? match[1].toLowerCase() : "unknown";
    dist[ext] = (dist[ext] ?? 0) + 1;
  }
  return dist;
}

export type SourceCardRoutingEntry = {
  scenarioId: string;
  scenarioName: string;
  engines: AdminRagEngine[];
  card: DescriptionCard;
};

// AM-1804·cap 8 取最近：按 generatedAt 降序取前 8 张，超出部分(最旧)裁掉；≤8 张全输出。
export function formatSourceCardsForRouting(entries: SourceCardRoutingEntry[]): string {
  const top = [...entries].sort((a, b) => b.card.generatedAt.localeCompare(a.card.generatedAt)).slice(0, 8);
  return top
    .map((entry) => {
      const engineLabel = entry.engines.length ? entry.engines.join("/") : "未知引擎";
      const question = entry.card.typicalQuestions[0] ?? "";
      return `【${entry.scenarioName}】(${engineLabel}) ${excerpt(entry.card.summaryScope, 80)}；典型问题：${question}`;
    })
    .join("\n");
}

// AM-1811·成功篇集合：一个场景当前"入库成功"的文档名(去重)——knowledgeObjects 在本地/真实
// 两种 ingest 模式下都会为每篇成功入库的文件各建一条(single-篇失败在 ingestScenarioSources 内
// 逐篇 try/catch 跳过、不产生该篇 KO)，比 moduleReferences(仅真实模式下才写)更通用，卡生成输入
// 因此天然只覆盖成功篇、失败篇名不入内容(AM-1811)。
function successfulSourceDocs(db: PlatformDb, scenarioId: string): SourceCardDocInput[] {
  const artifactsById = new Map(db.parsedArtifacts.filter((a) => a.scenarioId === scenarioId).map((a) => [a.id, a]));
  const byName = new Map<string, string>();
  for (const ko of db.knowledgeObjects) {
    if (ko.scenarioId !== scenarioId || byName.has(ko.sourceOriginalName)) continue;
    byName.set(ko.sourceOriginalName, artifactsById.get(ko.artifactId)?.content ?? ko.content);
  }
  return [...byName.entries()].map(([name, sample]) => ({ name, sample }));
}

// 一个场景当前已入库覆盖的引擎集合(去重)，用于路由消费展示"所在引擎"。
function scenarioEngines(db: PlatformDb, scenarioId: string): AdminRagEngine[] {
  return [...new Set(db.knowledgeObjects.filter((ko) => ko.scenarioId === scenarioId).map((ko) => ko.ragEngine))];
}

let sourceCardSystemPromptCache: string | null = null;
async function loadSourceCardSystemPrompt(): Promise<string | null> {
  if (sourceCardSystemPromptCache !== null) return sourceCardSystemPromptCache;
  try {
    sourceCardSystemPromptCache = await readFile(new URL("./prompts/source-card.system.txt", import.meta.url), "utf8");
    return sourceCardSystemPromptCache;
  } catch {
    return null; // 资产缺失 → 卡生成 fail-open 跳过，不写缓存(下次可重试)
  }
}

// 测试专用出口：注入受控生成器(AM-1810/1813 等 happy 态)，绕开真实 callAgentChatModel 网络调用；
// 传 null 恢复走真实网关(供 AM-1820 门控真网关黄金集使用)。
type SourceCardGenerator = (
  scenario: Pick<StoredScenario, "name" | "description" | "processingGoal">,
  docs: SourceCardDocInput[]
) => Promise<string | null>;
let sourceCardGeneratorOverride: SourceCardGenerator | null = null;
export function __setSourceCardGeneratorForTest(fn: SourceCardGenerator | null): void {
  sourceCardGeneratorOverride = fn;
}
let sourceCardGeneratorCallCount = 0;
export function __sourceCardGeneratorCallCountForTest(): number {
  return sourceCardGeneratorCallCount;
}
export function __resetSourceCardRuntimeStateForTest(): void {
  sourceCardGeneratorOverride = null;
  sourceCardGeneratorCallCount = 0;
  sourceCardReservations.clear();
}

// 卡生成 LLM 调用点(锁外)。local/off/未配置 → callAgentChatModel 内部已返回 null，此处不重复判断，
// 统一交给调用方按 fail-open 处理。
export async function generateSourceCardContent(
  scenario: Pick<StoredScenario, "name" | "description" | "processingGoal">,
  docs: SourceCardDocInput[],
  onLlm?: (info: LlmSpanInfo) => void
): Promise<string | null> {
  sourceCardGeneratorCallCount += 1;
  if (sourceCardGeneratorOverride) return sourceCardGeneratorOverride(scenario, docs);
  const systemPrompt = await loadSourceCardSystemPrompt();
  if (!systemPrompt) return null;
  const userPrompt = buildSourceCardPrompt(scenario, docs);
  return callAgentChatModel(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { temperature: 0.2, maxTokens: 700 },
    onLlm
  );
}

// ★ BLOCK#3·生成 reservation：scenarioId:fingerprint 原子占位，防同场景并发 settle 触发两次
// 锁外 LLM(AM-1816)。manual 优先(AM-1815 硬红线，绝不自动覆盖，漂移仅置 staleHint)/同 fingerprint
// 幂等(AM-1813，零 LLM 调用)/已有同批生成在途，三者任一 → 不生成(不占用 reservation)。
const sourceCardReservations = new Set<string>(); // key = `${scenarioId}:${fingerprint}`
// 024 · FR-553②：manual 卡漂移分支需要在锁外通知 admin 复核——与"同指纹幂等"/"同批生成在途"
// 两个纯跳过分支分开返回，供调用方(maybeGenerateSourceCard)判定是否补发 review-pending。
async function claimSourceCardGeneration(
  scenarioId: string,
  fingerprint: string
): Promise<{ outcome: "claimed"; scenario: StoredScenario } | { outcome: "manual-stale"; scenario: StoredScenario } | { outcome: "skip" }> {
  return withDbLock(async () => {
    const db = await readDb();
    const idx = db.scenarios.findIndex((s) => s.id === scenarioId);
    if (idx < 0) return { outcome: "skip" };
    const scenario = db.scenarios[idx];
    const card = scenario.descriptionCard;
    if (card?.origin === "manual") {
      // AM-1815：漂移(指纹变化)只标记 staleHint 提示人工复核，内容/origin 绝不改，且不消耗 LLM。
      if (card.sourceFingerprint !== fingerprint && !card.staleHint) {
        db.scenarios[idx] = { ...scenario, descriptionCard: { ...card, staleHint: true } };
        await writeDb(db);
      }
      return { outcome: "manual-stale", scenario: db.scenarios[idx] };
    }
    if (card?.sourceFingerprint === fingerprint) return { outcome: "skip" }; // AM-1813：同指纹幂等，0 LLM 调用
    const key = `${scenarioId}:${fingerprint}`;
    if (sourceCardReservations.has(key)) return { outcome: "skip" }; // AM-1816：同批生成已在途，跳过
    sourceCardReservations.add(key);
    return { outcome: "claimed", scenario };
  });
}
function releaseSourceCardReservation(scenarioId: string, fingerprint: string): void {
  sourceCardReservations.delete(`${scenarioId}:${fingerprint}`);
}

// ★ BLOCK#1·compare-and-commit：锁外 LLM 生成完成后重入锁，仅当"当前指纹仍匹配生成时的目标
// 指纹" + "非 manual" + "reservation 仍归本次" 才落卡，否则丢弃(防漂移期间写入陈旧卡/防 manual
// 抢写窗口)。
async function commitSourceCardIfFresh(scenarioId: string, fingerprint: string, card: DescriptionCard): Promise<void> {
  await withDbLock(async () => {
    const db = await readDb();
    const idx = db.scenarios.findIndex((s) => s.id === scenarioId);
    if (idx < 0) return;
    const scenario = db.scenarios[idx];
    if (scenario.descriptionCard?.origin === "manual") return;
    const currentDocNames = successfulSourceDocs(db, scenarioId).map((d) => d.name);
    if (sourceFingerprint(currentDocNames) !== fingerprint) return; // 生成期间又漂移，结果过期，丢弃
    if (!sourceCardReservations.has(`${scenarioId}:${fingerprint}`)) return; // reservation 已不归本次
    db.scenarios[idx] = { ...scenario, descriptionCard: card };
    await writeDb(db);
  });
}

// T1 settle 钩子入口：executeIngestQueueJob 终态提交 + gate 释放之后调用(★ BLOCK#1/#3)。
// 内部整体 fail-open——任何异常都吞掉不上抛，绝不让卡生成失败影响已经落定的 ingest 终态
// (AM-1807/1812)。FF_SOURCE_CARD=off 可整体关闭(默认 on)。
async function maybeGenerateSourceCard(scenarioId: string): Promise<void> {
  try {
    if ((process.env.FF_SOURCE_CARD ?? "on").toLowerCase() === "off") return;
    const db = await readDb();
    const scenario = db.scenarios.find((s) => s.id === scenarioId);
    if (!scenario || scenario.status !== "ready") return;
    const docs = successfulSourceDocs(db, scenarioId);
    if (docs.length === 0) return; // 无成功入库文档，无输入，不生成
    const docNames = docs.map((d) => d.name);
    const fingerprint = sourceFingerprint(docNames);
    const claimed = await claimSourceCardGeneration(scenarioId, fingerprint);
    if (claimed.outcome === "manual-stale") {
      // 024 · FR-553②：人工卡资料漂移 → admin 广播复核(旁路;dedupeKey 每场景一次，同 018 先例)。
      await notifyQuietly({
        audience: "admin-role",
        userId: "",
        kind: "review-pending",
        title: "知识库描述卡待复核",
        body: `「${claimed.scenario.name}」资料已变化,人工维护的描述卡建议复核更新。`,
        scenarioId: claimed.scenario.id,
        dedupeKey: `review-pending:card-stale:${scenarioId}`
      });
      return;
    }
    if (claimed.outcome === "skip") return;
    try {
      const content = await generateSourceCardContent(
        { name: claimed.scenario.name, description: claimed.scenario.description, processingGoal: claimed.scenario.processingGoal },
        docs
      );
      if (!content) {
        console.info(`[sourceCard] 场景 ${scenarioId} 卡生成跳过或失败(local/未配置/网关无输出)，fail-open 不落卡`);
        return;
      }
      const parsed = parseSourceCardOutput(content);
      if (!parsed) {
        console.info(`[sourceCard] 场景 ${scenarioId} 生成内容不合法(半卡)，按 AM-1801 拒收`);
        return;
      }
      const card: DescriptionCard = {
        ...parsed,
        docTypeDistribution: docTypeDistribution(docNames),
        generatedAt: new Date().toISOString(),
        sourceFingerprint: fingerprint,
        origin: "auto"
      };
      await commitSourceCardIfFresh(scenarioId, fingerprint, card);
    } finally {
      releaseSourceCardReservation(scenarioId, fingerprint);
    }
  } catch (error) {
    console.error("[maybeGenerateSourceCard] 卡生成流程异常，按 fail-open 跳过(不阻断 ingest 终态)", scenarioId, error);
  }
}

// 测试专用出口：直接触发一次 settle 钩子(不经完整 ingest 审批流程)，供并发 settle 场景
// (AM-1816：022b 的活跃 job 查重会挡住经 decideAdminIntakeRequest 的真并发)直接构造并发调用。
export async function __triggerSourceCardGenerationForTest(scenarioId: string): Promise<void> {
  await maybeGenerateSourceCard(scenarioId);
}

export async function decideAdminIntakeRequest(
  user: StoreUser,
  input: {
    requestId: string;
    action: "approve" | "reject";
    selectedMode?: RagEngine;
    selectedEngine?: AdminRagEngine;
    strategyParameters?: AdminStrategyParameters;
    reason?: string;
  }
): Promise<StoredAdminIntakeRequest | null> {
  if (user.role !== "admin") return null;
  const db = await readDb();
  const taskIndex = db.tasks.findIndex((task) => requestMatchesTask(input.requestId, task));
  if (taskIndex < 0) return null;

  const now = new Date().toISOString();
  const task = db.tasks[taskIndex];
  const scenarioIndex = db.scenarios.findIndex((scenario) => scenario.id === task.scenarioId);
  const scenario = scenarioIndex >= 0 ? db.scenarios[scenarioIndex] : null;
  const selectedMode = input.selectedMode ?? (input.selectedEngine ? ragModeForAdminEngine(input.selectedEngine) : defaultSelectedMode(task.ragMode));
  const selectedEngine = input.selectedEngine ?? adminEngineForRagMode(selectedMode);
  const strategyParameters = sanitizeStrategyParameters(input.strategyParameters);

  if (input.action === "approve" && scenario) {
    // 024 · FR-551：审批批准通知场景 owner(非审批者自己)——独立于 ingest 终态(kind 不同)，
    // 此处未持任何锁/事务，可安全调用旁路 notifyQuietly。先于同步 ingest 发送，与 main 时序一致。
    if (scenario.ownerUserId !== user.userId) {
      await notifyQuietly({
        audience: "user",
        userId: scenario.ownerUserId,
        kind: "approval-result",
        title: "场景已批准",
        body: `「${scenario.name}」已通过审批,正在入库处理。`,
        scenarioId: scenario.id,
        taskId: task.id,
        dedupeKey: `approval-result:${task.id}:approve`
      });
    }
    // 022b · B 方案：同步摄取外包一层持久 job 生命周期（queued→running→done/failed），
    // 崩溃可恢复（recoverPendingIngestTasks），不改本函数"同步返回 ready"的 UX 语义（B 红线）。
    const { sourceIds, naiveReplicaStats } = await runIngestApproval(user, task, scenario, selectedMode, selectedEngine, strategyParameters);
    const latest = await readDb();
    const latestTaskIndex = latest.tasks.findIndex((t) => t.id === task.id);
    const result = toAdminIntakeRequest(latest.tasks[latestTaskIndex], latest);
    return { ...result, sourceIds, naiveReplicaStats };
  }

  if (input.action === "approve") {
    // scenario 已不存在（异常态）：无可摄取内容，无 job 承载对象，直接落终态。
    db.tasks[taskIndex] = {
      ...task,
      status: "ready",
      kind: "发布复核",
      ragMode: selectedMode,
      strategyParameters,
      waitingFor: "场景负责人",
      progress: 100,
      currentStep: "后台已确认入库并发布",
      userMessage: "后台已确认入库，并生成可使用的业务场景。",
      nextActions: ["打开场景", "继续问答", "更新资料"],
      adminEntry: "后台已确认资料、权限和处理方式，场景已经发布到前台。",
      updatedAt: "刚刚",
      updatedAtIso: now
    };
    appendAuditEvent(db, user, {
      area: "处理管线",
      summary: `确认入库：${task.title.replace(/^创建/, "")}`,
      impact: `${selectedEngine} · ${visibilityText(task.visibility)}`
    });
    await writeDb(db);
    const result = toAdminIntakeRequest(db.tasks[taskIndex], db);
    return { ...result, sourceIds: [], naiveReplicaStats: undefined };
  }

  const reason = input.reason?.trim();
  db.tasks[taskIndex] = {
    ...task,
    status: "failed",
    kind: "资料接入",
    strategyParameters,
    waitingFor: "用户补充资料",
    progress: 12,
    currentStep: "后台已退回，等待补充资料",
    userMessage: reason ? `后台退回了这次资料处理请求：${reason}` : "后台退回了这次资料处理请求，需要补充资料后重新提交。",
    nextActions: ["补充资料", "重新提交后台处理"],
    adminEntry: "管理员已退回，等待用户补充资料。",
    updatedAt: "刚刚",
    updatedAtIso: now
  };
  if (scenario) {
    db.scenarios[scenarioIndex] = { ...scenario, status: "failed", updatedAt: now };
  }
  appendAuditEvent(db, user, {
    area: "处理管线",
    summary: `退回资料：${scenario?.name ?? task.title.replace(/^创建/, "")}`,
    impact: reason || "等待用户补充资料"
  });
  await writeDb(db);
  // 024 · FR-551：驳回通知场景 owner(非审批者自己)；无场景(纯任务)不通知，同 approve 分支口径。
  if (scenario && scenario.ownerUserId !== user.userId) {
    await notifyQuietly({
      audience: "user",
      userId: scenario.ownerUserId,
      kind: "approval-result",
      title: "场景被驳回",
      body: `「${scenario.name}」未通过审批${reason ? `:${reason}` : ",请补充资料后重新提交。"}`,
      scenarioId: scenario.id,
      taskId: task.id,
      dedupeKey: `approval-result:${task.id}:reject`
    });
  }
  return toAdminIntakeRequest(db.tasks[taskIndex], db);
}

function canReadScenario(user: StoreUser, scenario: StoredScenario) {
  return canAccess(user, accessControlFromScenario(scenario));
}

function canManageScenario(user: StoreUser, scenario: StoredScenario) {
  return isValidAdminCaller(user) || (hasValidCallerIdentity(user) && scenario.ownerUserId === user.userId);
}

function canReadKnowledgeObject(user: StoreUser, item: StoredKnowledgeObject) {
  return canAccess(user, accessControlFromKnowledgeObject(item));
}

function canReadGlobalChatSession(user: StoreUser, session: StoredGlobalChatSession) {
  return hasValidCallerIdentity(user) && session.ownerUserId === user.userId;
}

function canManageGlobalChatSession(user: StoreUser, session: StoredGlobalChatSession) {
  return hasValidCallerIdentity(user) && session.ownerUserId === user.userId;
}

function canReadGlobalChatSessionDetail(user: StoreUser, session: StoredGlobalChatSession) {
  return hasValidCallerIdentity(user) && session.ownerUserId === user.userId;
}

export async function renameGlobalChatSession(
  user: StoreUser,
  input: { sessionId: string; title: string }
): Promise<GlobalChatSessionSummary | null> {
  const title = input.title.trim();
  if (!title) return null;
  return withDbLock(async () => {
    const latestDb = await readDb();
    const idx = latestDb.chatSessions.findIndex((item) => item.id === input.sessionId);
    if (idx < 0) return null;
    if (!canManageGlobalChatSession(user, latestDb.chatSessions[idx])) return null;
    latestDb.chatSessions[idx] = { ...latestDb.chatSessions[idx], title: title.slice(0, 120) };
    await writeDb(latestDb);
    return toGlobalChatSummary(latestDb.chatSessions[idx]);
  });
}

export async function deleteGlobalChatSession(
  user: StoreUser,
  sessionId: string
): Promise<{ ok: boolean; threadId?: string; architectureVersion?: "legacy" | "agent-gateway" }> {
  return withDbLock(async () => {
    const latestDb = await readDb();
    const idx = latestDb.chatSessions.findIndex((item) => item.id === sessionId);
    if (idx < 0) return { ok: false };
    const session = latestDb.chatSessions[idx];
    if (!canManageGlobalChatSession(user, session)) return { ok: false };
    latestDb.chatSessions.splice(idx, 1);
    await writeDb(latestDb);
    return { ok: true, threadId: session.threadId, architectureVersion: session.architectureVersion };
  });
}

function canReadScenarioChatSession(user: StoreUser, session: StoredScenarioChatSession) {
  return hasValidCallerIdentity(user) && session.ownerUserId === user.userId;
}

function canManageScenarioChatSession(user: StoreUser, session: StoredScenarioChatSession) {
  return hasValidCallerIdentity(user) && session.ownerUserId === user.userId;
}

function canReadScenarioChatSessionDetail(user: StoreUser, session: StoredScenarioChatSession) {
  return hasValidCallerIdentity(user) && session.ownerUserId === user.userId;
}

function sanitizeGlobalChatSessionForDisplay(session: StoredGlobalChatSession): StoredGlobalChatSession {
  const { memory: _deprecatedMemory, ...rest } = session;
  return {
    ...rest,
    compressedContext: "",
    messages: session.messages.map(sanitizeGlobalChatMessageForDisplay)
  };
}

function sanitizeGlobalChatMessageForDisplay(message: StoredGlobalChatMessage): StoredGlobalChatMessage {
  if (message.role !== "assistant") return message;
  // P33/P36 合一（spec §2.3）：三字段在 gateway 已是真值（真 transcript 轮数 / 真滚动摘要），予以保留透传；
  // 存量 JSONB 可能缺这三字段 → 给安全默认（legacy 侧本就填最小空值）。
  const contextTrace: GlobalChatContextTrace | undefined = message.contextTrace
    ? {
        layers: message.contextTrace.layers,
        scopeLabel: message.contextTrace.scopeLabel,
        route: message.contextTrace.route,
        routeReason: message.contextTrace.routeReason,
        shortTermTurns: message.contextTrace.shortTermTurns ?? 0,
        compressedContext: message.contextTrace.compressedContext ?? "",
        longTermMemoryHits: message.contextTrace.longTermMemoryHits ?? [],
        retrievalTracks: message.contextTrace.retrievalTracks,
        // P52 §六阶段5 回归修复：Phase3 新增字段（无 excerpt 安全 DTO）漏加进这个逐字段白名单重建，
        // 导致 session 展示层（前端 platform.tsx 实际读路径）静默丢弃路由可观测数据。
        ...(message.contextTrace.routing ? { routing: message.contextTrace.routing } : {}),
        ...(message.contextTrace.retrievalAttempts ? { retrievalAttempts: message.contextTrace.retrievalAttempts } : {})
      }
    : undefined;
  return {
    ...message,
    content: sanitizeGlobalAssistantContent(message.content),
    contextTrace,
    citations: message.citations?.map((citation) => ({
      ...citation,
      excerpt: excerpt(sanitizeKnowledgeExcerpt(citation.excerpt), 260)
    }))
  };
}

function sanitizeScenarioChatSessionForDisplay(session: StoredScenarioChatSession): StoredScenarioChatSession {
  return {
    ...session,
    messages: session.messages.map(sanitizeScenarioChatMessageForDisplay)
  };
}

function sanitizeScenarioChatMessageForDisplay(message: StoredScenarioChatMessage): StoredScenarioChatMessage {
  if (message.role !== "assistant") return message;
  return {
    ...message,
    content: sanitizeGlobalAssistantContent(message.content),
    citations: message.citations?.map((citation) => ({
      ...citation,
      excerpt: excerpt(sanitizeKnowledgeExcerpt(citation.excerpt), 260)
    }))
  };
}

function sanitizeGlobalAssistantContent(content: string) {
  const withoutInlineEvidence = content.replace(
    /\n{0,2}可追溯依据[:：][\s\S]*$/u,
    "\n\n可追溯依据已在右侧按来源类型展示。"
  );
  if (!containsRawParserPayload(withoutInlineEvidence)) return withoutInlineEvidence.trim();
  const cleaned = stripRawParserPayload(withoutInlineEvidence);
  return cleaned || "当前回答包含未完成解析的资料片段，已隐藏原始解析内容；请查看右侧来源卡片或在后台重新解析该资料。";
}

function toScenarioChatSummary(session: StoredScenarioChatSession): ScenarioChatSessionSummary {
  const latestMessage = [...session.messages].reverse().find((message) => message.role === "user") ?? session.messages.at(-1);
  const latestContent = latestMessage?.role === "assistant"
    ? sanitizeGlobalAssistantContent(latestMessage.content)
    : latestMessage?.content;
  return {
    id: session.id,
    scenarioId: session.scenarioId,
    title: session.title,
    ownerName: session.ownerName,
    updatedAt: session.updatedAt,
    updatedAtText: displayRelativeTime(session.updatedAt),
    messageCount: session.messages.length,
    latestMessage: latestContent ? excerpt(latestContent, 80) : "还没有开始提问"
  };
}

function toGlobalChatSummary(session: StoredGlobalChatSession): GlobalChatSessionSummary {
  const latestMessage = [...session.messages].reverse().find((message) => message.role === "user") ?? session.messages.at(-1);
  const latestContent = latestMessage?.role === "assistant"
    ? sanitizeGlobalAssistantContent(latestMessage.content)
    : latestMessage?.content;
  return {
    id: session.id,
    title: session.title,
    scope: session.scope,
    threadId: session.threadId,
    updatedAt: session.updatedAt,
    updatedAtText: displayRelativeTime(session.updatedAt),
    messageCount: session.messages.length,
    latestMessage: latestContent ? excerpt(latestContent, 80) : "还没有开始提问"
  };
}

async function appendScenarioChatTurn(
  db: PlatformDb,
  user: StoreUser,
  session: StoredScenarioChatSession,
  query: string,
  now: string
) {
  session.messages.push({
    id: `msg_${randomUUID()}`,
    role: "user",
    content: query,
    createdAt: now
  });
  const traceStart = Date.now();
  const spans: TraceSpan[] = [];
  const result = await askStoredScenarioKnowledge(user, { scenarioId: session.scenarioId, query }, spans);
  const answer = result?.answer ?? {
    text: "当前场景还没有返回可用答案，请确认后台已经完成入库并发布。",
    engine: "Gbrain" as AdminRagEngine,
    citations: [],
    nextActions: ["查看任务中心", "补充资料", "等待后台确认"]
  };
  const traceId = `trace_${randomUUID()}`;
  session.messages.push(sanitizeScenarioChatMessageForDisplay({
    id: `msg_${randomUUID()}`,
    role: "assistant",
    content: answer.text,
    createdAt: now,
    engine: answer.engine,
    citations: answer.citations,
    nextActions: answer.nextActions,
    traceId
  }));
  recordChatTrace(db, {
    id: traceId,
    kind: "scenario_chat",
    user,
    scenarioId: session.scenarioId,
    scenarioName: session.title,
    query,
    route: "retrieve",
    answerText: answer.text,
    citations: (answer.citations ?? []).map((c) => ({ engine: c.engine })),
    spans,
    totalLatencyMs: Date.now() - traceStart,
    now
  });
  session.updatedAt = now;
  if (session.title.endsWith("的业务会话")) session.title = chatTitleFromQuery(query);
}

async function appendUserAndAssistantTurn(
  db: PlatformDb,
  user: StoreUser,
  session: StoredGlobalChatSession,
  query: string,
  now: string
) {
  const userMessage: StoredGlobalChatMessage = {
    id: `msg_${randomUUID()}`,
    role: "user",
    content: query,
    createdAt: now
  };
  session.messages.push(userMessage);
  // 025 · 成本护栏入口闸:先于一切 LLM 调用(改写/路由/生成全跳过),拒答零 token 且不落 chat trace
  // (下方 recordChatTrace 提前 return 跳过——防污染评测分母)。
  const guard = await checkChatCostGuards(user);
  if (!guard.allowed) {
    session.messages.push(sanitizeGlobalChatMessageForDisplay({
      id: `msg_${randomUUID()}`,
      role: "assistant",
      content: guard.message,
      createdAt: now,
      citations: [],
      contextTrace: {
        layers: ["系统边界", `成本护栏:${guard.kind}`],
        scopeLabel: globalScopeLabel(session.scope),
        route: "direct",
        routeReason: guard.message,
        shortTermTurns: 0,
        compressedContext: "",
        longTermMemoryHits: [],
        retrievalTracks: []
      }
    }));
    session.updatedAt = now;
    session.title = session.title === "新的全域问答" ? chatTitleFromQuery(query) : session.title;
    return;
  }
  const globalAnswer = await buildGlobalChatAnswer(db, user, session, query);
  const traceId = `trace_${randomUUID()}`;
  session.messages.push(sanitizeGlobalChatMessageForDisplay({
    id: `msg_${randomUUID()}`,
    role: "assistant",
    content: globalAnswer.text,
    createdAt: now,
    citations: globalAnswer.citations,
    contextTrace: globalAnswer.contextTrace,
    traceId
  }));
  recordChatTrace(db, {
    id: traceId,
    kind: "global_chat",
    user,
    scope: globalScopeLabel(session.scope),
    query,
    route: globalAnswer.route,
    answerText: globalAnswer.text,
    citations: globalAnswer.citations.map((c) => ({ engine: c.engine })),
    spans: globalAnswer.spans,
    totalLatencyMs: globalAnswer.totalLatencyMs,
    retrievalHealth: globalAnswer.retrievalHealth,
    now
  });
  session.updatedAt = now;
  session.title = session.title === "新的全域问答" ? chatTitleFromQuery(query) : session.title;
}

// P52 §五.6/§六阶段3（3C）：从 contextTrace 嵌入的安全 DTO（retrievalAttempts，无 excerpt）构建
// monitoring spans——禁透传底层含 excerpt 的 TraceSpan（platform-store.ts 内 retrieveRealGlobalCitations
// 内部 spans 才有 hits[].excerpt），这里全部新建、只含标量。多工具共享同一 routingDecision（§四 v0.3
// 决策缓存冻结）→ 只落 1 条 ROUTER span；每个 executionSpan（每次工具调用 × 每引擎）落 1 条 RETRIEVER span。
function buildSafeSpansFromContextTrace(contextTrace: GlobalChatContextTrace): TraceSpan[] {
  const attempts = contextTrace.retrievalAttempts ?? [];
  if (attempts.length === 0) return [];
  const spans: TraceSpan[] = [];
  const routing = contextTrace.routing;
  if (routing) {
    spans.push({
      kind: "ROUTER",
      label: "路由决策",
      latencyMs: routing.latencyMs,
      engines: routing.engines,
      prunedEngines: routing.prunedEngines,
      basis: routing.basis,
      routeReason: routing.reason
    });
  }
  for (const attempt of attempts) {
    for (const span of attempt.executionSpans) {
      spans.push({
        kind: "RETRIEVER",
        label: `${span.engine} 检索`,
        engine: span.engine,
        latencyMs: span.latencyMs,
        hitCount: span.hitCount
        // 无 hits：安全 DTO 只含标量（attempted/sourceCount/hitCount/latencyMs/status），绝不透传原文。
      });
    }
  }
  return spans;
}

// 多工具场景：同引擎跨多次调用取"最坏"状态（error > timeout > skipped-by-router > ok），
// 与 retrieveRealGlobalCitations 内部 markEngineOutcome 的优先级判定同构（同引擎多源取最坏）。
const RETRIEVAL_STATUS_RANK: Record<RetrievalSourceStatus, number> = { ok: 0, "skipped-by-router": 1, timeout: 2, error: 3 };
function buildRetrievalHealthFromContextTrace(contextTrace: GlobalChatContextTrace): RetrievalHealth | undefined {
  const attempts = contextTrace.retrievalAttempts ?? [];
  if (attempts.length === 0) return undefined;
  const worst = new Map<AdminRagEngine, RetrievalSourceStatus>();
  for (const attempt of attempts) {
    for (const span of attempt.executionSpans) {
      const prev = worst.get(span.engine);
      if (!prev || RETRIEVAL_STATUS_RANK[span.status] > RETRIEVAL_STATUS_RANK[prev]) worst.set(span.engine, span.status);
    }
  }
  return { sources: ALL_RAG_ENGINES.map((engine) => ({ engine, status: worst.get(engine) ?? "ok" })) };
}

// P36d 阶段1b-1：agent-gateway 已算好答案时的窄口写入（相对 appendGlobalChatMessage：答案是入参，非内部再算）。
// 结构硬约束（阶段0.5 冻结 #2 #3）：去重判定 + push 消息 + recordChatTrace + writeDb 全在同一个 withDbLock 临界区内，
// 锁内 readDb 取最新库、锁内重查 assistant msg id，防止两个并发请求各读到「不存在」而重复落两条同 id 消息/同 traceId。
export async function commitAgentChatTurn(
  user: StoreUser,
  input: {
    sessionId: string;
    idempotencyKey: string;
    query: string;
    answerText: string;
    citations: GlobalChatCitation[];
    contextTrace: GlobalChatContextTrace;
    route: "direct" | "retrieve";
    totalLatencyMs: number;
    traceId: string;
  }
): Promise<StoredGlobalChatSession | null> {
  const query = input.query.trim();
  if (!query) return null;
  // 阶段0.5 冻结 #5：idempotencyKey 边界校验（受限长度 + 安全字符，防超长/异常串进 JSONB 标识与 msg id）
  const key = input.idempotencyKey.trim();
  if (!key || key.length > 200 || !/^[A-Za-z0-9_-]+$/.test(key)) return null;
  const traceId = input.traceId.trim();
  if (!traceId) return null;
  const now = new Date().toISOString();
  const assistantId = `msg_${key}`;
  return withDbLock(async () => {
    const db = await readDb();                                   // 锁内取最新库
    const idx = db.chatSessions.findIndex((s) => s.id === input.sessionId);
    if (idx < 0) return null;                                    // 会话不存在（可能已删），不复活
    const session = db.chatSessions[idx];
    if (!canManageGlobalChatSession(user, session)) return null;
    // 锁内去重（冻结 #3）：projection 已落 → 直接返回既有，不重复写
    if (session.messages.some((m) => m.id === assistantId)) {
      return sanitizeGlobalChatSessionForDisplay(session);
    }
    // 一次原子写：push user + assistant（assistant id 确定性）+ recordChatTrace（id 显式）
    session.messages.push({ id: `msg_${randomUUID()}`, role: "user", content: query, createdAt: now });
    session.messages.push(sanitizeGlobalChatMessageForDisplay({
      id: assistantId,
      role: "assistant",
      content: input.answerText,
      createdAt: now,
      citations: input.citations,
      contextTrace: input.contextTrace,
      traceId
    }));
    recordChatTrace(db, {
      id: traceId,                                               // 显式指定（非内部 randomUUID）
      kind: "global_chat",
      user,
      scope: globalScopeLabel(session.scope),
      query,
      route: input.route,
      answerText: input.answerText,
      citations: input.citations.map((c) => ({ engine: c.engine })),
      // P52 §五.6/§六阶段3（3C）：从 contextTrace 嵌入的安全 DTO 建 ROUTER/RETRIEVER spans（无 hits/excerpt）。
      spans: buildSafeSpansFromContextTrace(input.contextTrace),
      totalLatencyMs: input.totalLatencyMs,
      retrievalHealth: buildRetrievalHealthFromContextTrace(input.contextTrace),
      now
    });
    session.updatedAt = now;
    session.title = session.title === "新的全域问答" ? chatTitleFromQuery(query) : session.title;
    session.architectureVersion = "agent-gateway";              // 见 §二：类型新增字段
    // P33/P36 合一（spec §2.2）：删伪记忆写入——agent-gateway 会话的短期/压缩记忆由 gateway 侧
    // transcript + 滚动摘要 middleware 承载，platform 侧 session.memory/compressedContext 已停用。
    await writeDb(db);                                           // 整库覆盖写（锁内，安全）
    return sanitizeGlobalChatSessionForDisplay(session);
  });
}

// 025 T1：agent-gateway 拒答窄口——仿 commitAgentChatTurn 结构(幂等 key + 锁内原子写 user+assistant)，
// 但拒答分支不记 trace(护栏拒答证据只落 audit，不进 db.traces / route-golden 分母，同 legacy 拒答分支)。
// 幂等：assistant id 用确定性 `msg_${idempotencyKey}`(同 commitAgentChatTurn 先例)，锁内命中已存在
// → 直接返回既有 session，不重复 push 消息、不重复记 audit(同 key 重发/网络重试的正确语义)。
export async function commitAgentChatGuardRejection(
  user: StoreUser,
  input: { sessionId: string; query: string; message: string; kind: "quota-exceeded" | "rate-limited"; idempotencyKey: string }
): Promise<StoredGlobalChatSession | null> {
  const query = input.query.trim();
  if (!query) return null;
  const key = input.idempotencyKey.trim();
  if (!key || key.length > 200 || !/^[A-Za-z0-9_-]+$/.test(key)) return null;
  const assistantId = `msg_${key}`;
  const now = new Date().toISOString();
  return withDbLock(async () => {
    const db = await readDb();
    const idx = db.chatSessions.findIndex((s) => s.id === input.sessionId);
    if (idx < 0) return null;
    const session = db.chatSessions[idx];
    if (!canManageGlobalChatSession(user, session)) return null;
    // 幂等短路：同 key 已落过 → 直接返回既有，不重复写、不重复 audit。
    if (session.messages.some((m) => m.id === assistantId)) {
      return sanitizeGlobalChatSessionForDisplay(session);
    }
    session.messages.push({ id: `msg_${randomUUID()}`, role: "user", content: query, createdAt: now });
    session.messages.push(sanitizeGlobalChatMessageForDisplay({
      id: assistantId,
      role: "assistant",
      content: input.message,
      createdAt: now,
      citations: [],
      contextTrace: {
        layers: ["系统边界", `成本护栏:${input.kind}`],
        scopeLabel: globalScopeLabel(session.scope),
        route: "direct",
        routeReason: input.message,
        shortTermTurns: 0,
        compressedContext: "",
        longTermMemoryHits: [],
        retrievalTracks: []
      }
    }));
    session.updatedAt = now;
    // audit 放在幂等短路之后、且与消息写入同一事务(同一 db/writeDb)：确认是"新拒答"才记一次，
    // 同 key 重发不会重复记(checkChatCostGuards 调用处传 skipAudit 把审计责任移到这里)。
    appendAuditEvent(db, user, {
      area: "成本护栏",
      summary: `拒答(${input.kind}):${user.name}(${user.userId})`,
      impact: input.message
    });
    await writeDb(db);
    return sanitizeGlobalChatSessionForDisplay(session);
  });
}

// 多轮指代消解（I46）：把含「它/这个」等指代的追问，结合历史改写成自包含检索 query，避免漏召回。
async function rewriteGlobalQueryWithHistory(query: string, session: StoredGlobalChatSession, onLlm?: (info: LlmSpanInfo) => void): Promise<string> {
  // 调用方已先把本轮 user 消息 push 进 session.messages，故历史 = 除最后一条外的消息。
  const history = session.messages.slice(0, -1);
  if (history.length === 0) return query; // 首轮无历史，跳过改写省一次 LLM 调用
  try {
    const recentHistory = history.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    const content = await callAgentChatModel(
      [
        {
          role: "system",
          content:
            "你是检索查询改写器。结合对话历史，把用户最新问题改写成一个不依赖上下文、可独立检索的完整问题，把「它/这个/上述/该」等指代替换成具体实体名。只输出改写后的问题本身，不要解释、不要加引号、不要加前缀。若问题本身已自包含就原样返回。"
        },
        ...recentHistory,
        { role: "user", content: query }
      ],
      { temperature: 0, maxTokens: 200 },
      onLlm
    );
    if (!content) return query; // 模型失败/无 key → 回退原 query，绝不阻断
    const rewritten = content.trim();
    return rewritten || query;
  } catch {
    return query; // 任何异常(含 callAgentChatModel 潜在 reject)都回退原 query，绝不让问答主流程 5xx
  }
}

async function buildGlobalChatAnswer(
  db: PlatformDb,
  user: StoreUser,
  session: StoredGlobalChatSession,
  query: string
): Promise<{ text: string; citations: GlobalChatCitation[]; contextTrace: GlobalChatContextTrace; spans: TraceSpan[]; route: "direct" | "retrieve"; totalLatencyMs: number; retrievalHealth?: RetrievalHealth }> {
  const traceStart = Date.now();
  const spans: TraceSpan[] = [];
  const pushLlmSpan = (info: LlmSpanInfo) => {
    spans.push({
      kind: "LLM",
      label: "答案生成",
      latencyMs: info.latencyMs,
      model: info.model,
      promptTokens: info.promptTokens,
      completionTokens: info.completionTokens,
      totalTokens: info.totalTokens,
      promptCacheHitTokens: info.promptCacheHitTokens,
      promptCacheMissTokens: info.promptCacheMissTokens,
      error: info.error
    });
  };
  const recordLlmError = (info: LlmSpanInfo) => { if (info.error) pushLlmSpan(info); };
  const retrievalQuery = await rewriteGlobalQueryWithHistory(query, session, recordLlmError);
  const routeStart = Date.now();
  // 018 T2(AM-1805/1807/1808/1809)：按 session.scope 收集用户可访问且 ready 的场景描述卡，
  // 无卡/收集为空 → sourceCards 传 undefined，逐字回退 017/feat 基线(AM-1806)。
  const sourceCardEntries = collectRoutableSourceCards(db, user, session.scope);
  const sourceCardsText = sourceCardEntries.length ? formatSourceCardsForRouting(sourceCardEntries) : undefined;
  const route = await routeGlobalChatQuery(retrievalQuery, recordLlmError, sourceCardsText ? { sourceCards: sourceCardsText } : undefined);
  const routeLatencyMs = Date.now() - routeStart;
  // P37-T4d（FR-451）：ROUTER span——先路由再检索，direct/retrieve 两分支都要落一条。
  const prunedEngines: AdminRagEngine[] | undefined =
    route.mode === "retrieve"
      ? route.engines
        ? ALL_RAG_ENGINES.filter((engine) => !route.engines!.includes(engine))
        : []
      : undefined;
  spans.push({
    kind: "ROUTER",
    label: "路由决策",
    latencyMs: routeLatencyMs,
    intents: route.intents,
    engines: route.engines,
    prunedEngines,
    basis: route.basis,
    routeReason: route.reason
  });
  if (route.mode === "direct") {
    const contextTrace: GlobalChatContextTrace = {
      layers: ["系统边界", "直接回答"],
      scopeLabel: globalScopeLabel(session.scope),
      route: "direct",
      routeReason: route.reason,
      // legacy 无 gateway 的 transcript/滚动摘要层，三字段填最小空值（spec §2.3）
      shortTermTurns: 0,
      compressedContext: "",
      longTermMemoryHits: [],
      retrievalTracks: buildGlobalRetrievalTracks([])
    };
    return {
      text: await generateDirectGlobalReply(query, pushLlmSpan),
      citations: [],
      contextTrace,
      spans,
      route: "direct",
      totalLatencyMs: Date.now() - traceStart
    };
  }

  const { citations, retrievalHealth } = await retrieveRealGlobalCitations(db, user, retrievalQuery, session.scope, spans, route.engines);
  const contextTrace: GlobalChatContextTrace = {
    layers: ["系统边界", "权限过滤", "外部知识", "相关性精排"],
    scopeLabel: globalScopeLabel(session.scope),
    route: "retrieve",
    routeReason: route.reason,
    // legacy 无 gateway 的 transcript/滚动摘要层，三字段填最小空值（spec §2.3）
    shortTermTurns: 0,
    compressedContext: "",
    longTermMemoryHits: [],
    retrievalTracks: buildGlobalRetrievalTracks(citations)
  };

  // 零引用路径（召回 0）会直接返回模板、不触发答案生成 LLM 调用；缺配置时此处补记 error span，
  // 保证任何缺配置问答（即便本轮未实际调用任何 LLM）在监控可见。已配置则不落 span。
  if (citations.length === 0 && await agentConfigMissing()) {
    recordLlmError({ model: "未配置", latencyMs: 0, error: "AGENT_* 未配置（需 AGENT_API_KEY/AGENT_BASE_URL/AGENT_MODEL），答案生成降级为模板" });
  }
  const text = await buildGlobalChatAnswerText(retrievalQuery, citations, pushLlmSpan);
  return {
    text,
    citations,
    contextTrace,
    spans,
    route: "retrieve",
    totalLatencyMs: Date.now() - traceStart,
    retrievalHealth
  };
}

function moduleReferenceAllowedByChatScope(user: StoreUser, ref: StoredModuleReference, scope: GlobalChatScope) {
  const accessControl = ref.accessControl;
  if (scope === "private") return accessControl.ownerUserId === user.userId;
  if (accessControl.ownerUserId === user.userId) return true;
  if (scope === "company") return true;
  if (accessControl.scope === "company") return true;
  if (accessControl.scope !== "team") return false;
  if (accessControl.organizationId !== normalizeOrganizationId(user.organizationId)) return false;
  return accessControl.teamIds.some((teamId) => normalizeTeamIds(user.teamIds).includes(teamId));
}

// 018 T2(AM-1809)：与 moduleReferenceAllowedByChatScope 同构，narrowing 由 chat scope 决定；
// 基础权限门(canReadScenario/canAccess)在调用点单独过一遍，本函数只做 scope 的额外收窄。
function scenarioAllowedByChatScope(user: StoreUser, scenario: StoredScenario, scope: GlobalChatScope) {
  const accessControl = accessControlFromScenario(scenario);
  if (scope === "private") return accessControl.ownerUserId === user.userId;
  if (accessControl.ownerUserId === user.userId) return true;
  if (scope === "company") return true;
  if (accessControl.scope === "company") return true;
  if (accessControl.scope !== "team") return false;
  if (accessControl.organizationId !== normalizeOrganizationId(user.organizationId)) return false;
  return accessControl.teamIds.some((teamId) => normalizeTeamIds(user.teamIds).includes(teamId));
}

// 018 T2(AM-1805/1807/1808/1809)：按 scope 收集用户可访问且 ready 的场景描述卡——先
// canReadScenario(基础权限，AM-1809 越权场景命中=0)，再 scenarioAllowedByChatScope(scope 收窄)，
// 再过滤 status==="ready"(feat 无 partially_ready，errata AM-1808)且 descriptionCard 存在
// (AM-1807 无卡不注入)。cap 8 由 formatSourceCardsForRouting 统一收口，此处不重复裁剪。
function collectRoutableSourceCards(db: PlatformDb, user: StoreUser, scope: GlobalChatScope): SourceCardRoutingEntry[] {
  return db.scenarios
    .filter((scenario) => scenario.status === "ready" && scenario.descriptionCard)
    .filter((scenario) => canReadScenario(user, scenario))
    .filter((scenario) => scenarioAllowedByChatScope(user, scenario, scope))
    .map((scenario) => ({
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      engines: scenarioEngines(db, scenario.id),
      card: scenario.descriptionCard!
    }));
}

// 测试专用出口：collectRoutableSourceCards 未导出——读当前真实 DB(与 buildGlobalChatAnswer 同源)
// 转发调用，供 AM-1807/1808/1809 直接断言"按 scope 收集用户可访问且 ready 场景卡"的聚合结果。
export async function __collectRoutableSourceCardsForTest(user: StoreUser, scope: GlobalChatScope): Promise<SourceCardRoutingEntry[]> {
  const db = await readDb();
  return collectRoutableSourceCards(db, user, scope);
}

// 检索后相关性评分：用 LLM 判断每条候选引用与用户问题的相关性，过滤明显无关的来源。
// fallback 语义：调用/解析失败 → 降级返回原 citations；合法解析出 [] → 诚实返回空。
// 检索后相关性精排：用 qwen3-rerank（阿里云百炼 DashScope）对候选片段按真实相关度打校准分，
// 按阈值卡掉不相关 + 取 top-N。比 LLM 评分更准（实测相关0.94 vs 噪声0.2断层清晰）、更快(~2s)、确定。
// 返回的 citations 同时驱动 本轮来源面板 / 引用计数 / 答案证据（单一数据源）。
// P37-T4b：provider 顺序 ① HTTP DashScope（保持优先，现状不动）→ ② 未配置时 fallback 到 LLM 裁判
// （rerankCitationsWithLlmJudge，消灭 unconfigured）。HTTP 自身调用失败/超时/结构异常仍保持现状
// 降级返回全部，不 fallback 到 LLM（"现状不动，保持优先"）。
async function rerankCitations(
  query: string,
  citations: GlobalChatCitation[],
  spans?: TraceSpan[]
): Promise<GlobalChatCitation[]> {
  if (citations.length <= 1) return citations;

  const apiKey = await readIntegrationEnv("DASHSCOPE_API_KEY");
  const baseUrl = await readIntegrationEnv("RERANK_BASE_URL");
  // 未配置 HTTP rerank → fallback 到 LLM 裁判（不再直接返回全部，消灭 unconfigured）
  if (!apiKey || !baseUrl) return rerankCitationsWithLlmJudge(query, citations, spans);
  const model = (await readIntegrationEnv("RERANK_MODEL")) ?? "qwen3-rerank";
  const runtimeConfig = await getRuntimeConfig();
  const minScore = runtimeConfig.rerankMinScore;
  const topN = Math.max(1, runtimeConfig.rerankTopN);
  const timeoutMs = Number((await readIntegrationEnv("RERANK_TIMEOUT_MS")) ?? 15000);

  // 单条上限 4k token，截到 1500 字足够覆盖 chunk 正文且不超限。
  const documents = citations.map((c) => excerpt(sanitizeKnowledgeExcerpt(c.excerpt), 1500));
  const startedAt = Date.now();
  let body: any = null;
  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: { query, documents },
        parameters: { top_n: documents.length, return_documents: false }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return citations;              // 非 2xx → 降级保留全部
    body = await response.json().catch(() => null);
  } catch {
    return citations;                                 // 网络/超时异常 → 降级保留全部
  }

  const results = body?.output?.results;
  if (!Array.isArray(results)) return citations;      // 响应结构异常 → 降级保留全部
  // HTTP 调用+解析耗时在本地过滤/排序前捕获，保持 latencyMs 语义与 T4b 前一致（span 挪到 kept 后仅为填 keptCount，不改延迟口径）。
  const httpLatencyMs = Date.now() - startedAt;

  // 成功拿到 results（即使过滤后为空）→ 信任 rerank：按 relevance_score 阈值过滤 + 降序 + 取 top-N。
  // 空=诚实清空（如"报销"问到蓝鲸，分数全 <阈值），与失败降级严格区分。
  const kept = (results as Array<{ index?: unknown; relevance_score?: unknown }>)
    .filter((r) =>
      typeof r?.index === "number" && Number.isInteger(r.index) &&
      (r.index as number) >= 0 && (r.index as number) < citations.length &&
      typeof r?.relevance_score === "number" && (r.relevance_score as number) >= minScore
    )
    .sort((a, b) => (b.relevance_score as number) - (a.relevance_score as number))
    .slice(0, topN);

  spans?.push({
    kind: "LLM",
    label: "相关性精排(qwen3-rerank)",
    latencyMs: httpLatencyMs,
    model,
    provider: "http",
    inputCount: citations.length,
    keptCount: kept.length,
    totalTokens: typeof body?.usage?.total_tokens === "number" ? body.usage.total_tokens : undefined
  });

  return kept.map((r) => citations[r.index as number]);
}

// P37-T4b：HTTP rerank 未配置时的 LLM 裁判 fallback。复用 callAgentChatModel 对候选资料批量打分，
// 按同一 rerankMinScore/rerankTopN 阈值过滤，与 HTTP 路径同一降级红线：调用失败/解析失败/结构
// 异常 → 保留全部真实来源，绝不因 rerank 抖动清空；成功拿到结果（即使过滤后为空）→ 信任裁判。
async function rerankCitationsWithLlmJudge(
  query: string,
  citations: GlobalChatCitation[],
  spans?: TraceSpan[]
): Promise<GlobalChatCitation[]> {
  const runtimeConfig = await getRuntimeConfig();
  const minScore = runtimeConfig.rerankMinScore;
  const topN = Math.max(1, runtimeConfig.rerankTopN);

  // 单条上限 4k token，截到 1500 字足够覆盖 chunk 正文且不超限（与 HTTP 路径同款脱敏截断）。
  const documents = citations.map((c) => excerpt(sanitizeKnowledgeExcerpt(c.excerpt), 1500));
  const documentsPrompt = documents.map((doc, index) => `[${index}] ${doc}`).join("\n\n");

  let llmInfo: { model: string; latencyMs: number } | null = null;
  const content = await callAgentChatModel(
    [
      {
        role: "system",
        content: [
          "你是企业知识中台的检索结果裁判，为每条候选资料与用户问题的相关性打分（0~1，越相关越高，与问题无关给低分）。",
          "只返回 JSON：{\"results\":[{\"index\":0,\"score\":0.8},...]}，index 对应资料编号，不要输出其他任何内容。"
        ].join("\n")
      },
      { role: "user", content: `问题：${query}\n\n候选资料：\n${documentsPrompt}` }
    ],
    { temperature: 0, maxTokens: 800 },
    (info) => { llmInfo = { model: info.model, latencyMs: info.latencyMs }; }
  );
  if (!content) return citations;                     // LLM 调用失败/未配置 → 降级保留全部

  const parsed = parseJsonObject(content);
  const results = parsed?.results;
  if (!Array.isArray(results)) return citations;       // 解析失败/结构异常 → 降级保留全部

  // fail-open 红线：LLM 输出损坏（非对象项 / index 非范围内整数 / index 重复 / score 非 [0,1] 有限数）
  // 一律视为不可信 → 保留全部真实 citations，绝不基于损坏结果剪裁（越界项静默过滤后 kept 可能变空→误清空真实来源）。
  // 仅"全部项合法"才信任其裁决；合法空数组=LLM 诚实判定全部低相关，与 HTTP 路径诚实清空同语义、允许。
  const seenIndices = new Set<number>();
  for (const r of results as unknown[]) {
    if (typeof r !== "object" || r === null) return citations;
    const idx = (r as { index?: unknown }).index;
    const score = (r as { score?: unknown }).score;
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= citations.length) return citations;
    if (seenIndices.has(idx)) return citations;        // 重复 index → 不可信
    seenIndices.add(idx);
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) return citations;
  }

  const kept = (results as Array<{ index: number; score: number }>)
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  if (llmInfo) {
    // TS 对"仅在嵌套回调里赋值的 let 变量"存在控制流窄化到 never 的已知限制，此处显式断言取回声明类型。
    const resolvedLlmInfo = llmInfo as { model: string; latencyMs: number };
    spans?.push({
      kind: "LLM",
      label: "相关性精排(LLM 裁判)",
      latencyMs: resolvedLlmInfo.latencyMs,
      model: resolvedLlmInfo.model,
      provider: "llm",
      inputCount: citations.length,
      keptCount: kept.length
    });
  }

  return kept.map((r) => citations[r.index as number]);
}

// 026 必修2·测试专用出口:rerankCitations 未导出，无法在测试里直接打 fetch spy 验证送到
// DashScope 的 body.input.documents 是否已脱敏。仅转发调用，不改变函数本身的任何行为。
export async function __rerankCitationsForTest(
  query: string,
  citations: GlobalChatCitation[],
  spans?: TraceSpan[]
): Promise<GlobalChatCitation[]> {
  return rerankCitations(query, citations, spans);
}

// 检索并发解析（P43 codex 审）：FF_GLOBAL_RETRIEVAL_CONCURRENCY 误配防护——非有限（未设/NaN/Infinity）
// 回退默认，再 clamp 到 [1, 上限]。防两类退化：Infinity 恢复全量并发打爆 embedding 端点（P8 教训）；
// NaN 让分批循环 `i += n` 静默跳过全部 batch（structured 召回被无声丢弃）。逐源 batch（otherRefs）与
// Naive structured 分批共用此解析，口径一致。
const RETRIEVAL_CONCURRENCY_CAP = 16;
function resolveRetrievalConcurrency(fallback = 4): number {
  const raw = Number(process.env.FF_GLOBAL_RETRIEVAL_CONCURRENCY);
  const n = Number.isFinite(raw) ? Math.floor(raw) : fallback;
  return Math.min(RETRIEVAL_CONCURRENCY_CAP, Math.max(1, n));
}

// Naive structured 补召回独立超时预算（P44）：structured 每源一次、单请求秒级，多源场景累积
// 可达数十秒；若被外层 perSourceTimeoutMs 整体 race 超时，会连正确的 chunk 主召回一起丢弃
// （实测 40 源 structured≈28s+ 撞 45s 超时→Naive hitCount=0）。故 structured 独立限时，超时只
// 返回已累积部分，chunk 主召回保底不受影响。
const NAIVE_STRUCTURED_BUDGET_MS = 12000;

// 真实全域检索：遍历当前用户可访问、已就绪的模块来源引用，逐源调用对应 RAG 模块的检索端点，
// 用真实召回的 chunk 构建引用。不再读本地 fixtures / 关联度评分。
async function retrieveRealGlobalCitations(
  db: PlatformDb,
  user: StoreUser,
  query: string,
  scope: GlobalChatScope,
  spans?: TraceSpan[],
  engines?: AdminRagEngine[]
): Promise<{ citations: GlobalChatCitation[]; retrievalHealth: RetrievalHealth; executionSpans: RetrievalExecutionSpan[] }> {
  // P52 §四（codex 异源审修复）：调用方传入的 spans 可能已含本函数调用前的旧 RETRIEVER span
  // （Phase 3 多工具累加 spans 场景会真触发）。记录进入时的基线下标，构建 executionSpans.latencyMs
  // 时只统计本轮新增的 span，避免把旧轮耗时也算进来虚增。
  const spanBaseline = spans?.length ?? 0;
  // P37-T4d（FR-452）：每个引擎本次真实参与状态。skipped-by-router 只由 engines 参数（路由终值）
  // 决定；error/timeout 由下面 searchOne/Naive 全局检索块的真实执行结果标注；未标注（无该引擎来源
  // 可检索）且未被路由剪掉 → ok（既没失败，也没被跳过）。优先级 error > timeout > ok（同引擎多源时取最坏）。
  const engineOutcome = new Map<AdminRagEngine, "ok" | "error" | "timeout">();
  const outcomeRank: Record<"ok" | "error" | "timeout", number> = { ok: 0, timeout: 1, error: 2 };
  const markEngineOutcome = (engine: AdminRagEngine, outcome: "ok" | "error" | "timeout") => {
    const prev = engineOutcome.get(engine);
    if (!prev || outcomeRank[outcome] > outcomeRank[prev]) engineOutcome.set(engine, outcome);
  };

  const refs = (db.moduleReferences ?? [])
    .filter((ref) => ref.status === "ready")
    .filter((ref) => canAccess(user, ref.accessControl))
    .filter((ref) => moduleReferenceAllowedByChatScope(user, ref, scope))
    .filter((ref) => !engines || engines.includes(ref.engine));

  // 同一来源去重，限制检索的来源数量，避免一次问答打爆所有模块
  const seen = new Set<string>();
  const uniqueRefs: StoredModuleReference[] = [];
  for (const ref of refs) {
    const key = `${ref.engine}::${ref.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRefs.push(ref);
  }
  const runtimeConfig = await getRuntimeConfig(db);
  // 修 P43：sourceFanout 只约束「逐源检索」的慢引擎（Gbrain/GraphRAG，每源一次 HTTP，GraphRAG 单源
  // 可 1-2 分钟），不再约束 Naive。Naive 走 searchNaiveGlobal 单次批量全局检索（一次 HTTP 内按
  // source_ids IN(...) 跨全部 Naive 源做向量+全文+字面 RRF），不存在逐源开销，却因被算进 fanout 名额
  // 而只能拿到前 ~3 个源——当 Naive 源数远超 fanout（如 evalset 40 篇=40 源）时，靠后的个人简历源
  // 永远不进检索，人物 query 只能召回排在最前的公司概况源（P41 ①c 召回 0/11 真因）。故此处 round-robin
  // 只在非 Naive 引擎间分配 fanout 名额；Naive 全量源在下方独立传给 searchNaiveGlobal。
  // 修 I96：按引擎 round-robin 取源（与下游候选池 round-robin 对称），保证 sourceFanout 名额内
  // 每个（逐源）引擎都有源进入检索，避免某引擎源靠前把其它引擎在检索前砍光。
  const refsByEngine = new Map<string, StoredModuleReference[]>();
  for (const ref of uniqueRefs) {
    if (ref.engine === "Naive RAG") continue; // Naive 不占逐源扇出名额（走下方全量单次全局检索）
    const q = refsByEngine.get(ref.engine) ?? [];
    q.push(ref);
    refsByEngine.set(ref.engine, q);
  }
  const refEngineQueues = [...refsByEngine.values()];
  const limitedRefs: StoredModuleReference[] = [];
  for (let i = 0; limitedRefs.length < runtimeConfig.sourceFanout && refEngineQueues.some((q) => q.length); i++) {
    const next = refEngineQueues[i % refEngineQueues.length].shift();
    if (next) limitedRefs.push(next);
  }
  // 各来源并行检索 + 每源超时：慢引擎（如 GraphRAG/LightRAG 可能 1-2 分钟）超时即跳过，
  // 不阻塞整体回答；其它来源照常实时召回。
  const perSourceTimeoutMs = runtimeConfig.perSourceTimeoutMs;
  // 快引擎（文档证据 / 知识百科）优先，慢引擎（关系图谱 / LightRAG）靠后。
  const enginePriority: Record<string, number> = { "Naive RAG": 0, Gbrain: 1, GraphRAG: 2 };
  const orderedRefs = [...limitedRefs].sort(
    (a, b) => (enginePriority[a.engine] ?? 9) - (enginePriority[b.engine] ?? 9)
  );

  const searchOne = async (ref: StoredModuleReference): Promise<{ citations: GlobalChatCitation[]; excerpts: ModuleExcerpt[] }> => {
    const startedAt = Date.now();
    try {
      const result = await Promise.race([
        searchModuleForReference(user, ref, query, getEngineTopK(db, ref.engine, 4), getEngineMinScore(db, ref.engine, 0)),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), perSourceTimeoutMs))
      ]);
      // searchModuleForReference 本身不会 resolve 为 null，result===null 只可能来自超时 race。
      markEngineOutcome(ref.engine, result === null ? "timeout" : "ok");
      const excerpts = result?.excerpts;
      const cleanExcerpts = (excerpts ?? []).filter((e) => e.text && e.text.trim());
      // 记录该来源的真实 RETRIEVER span(引擎/来源/延迟/命中片段),供 trace 详情逐步钻取。
      // P37-T4c（FR-450）：GraphRAG 来源额外带上本次生效 mode/modeSource（下游 mode router 返回）。
      spans?.push({
        kind: "RETRIEVER",
        label: `${ref.engine} 检索`,
        engine: ref.engine,
        form: engineToForm(ref.engine),
        latencyMs: Date.now() - startedAt,
        sourceName: String(ref.metadata.originalFileName ?? ref.sourceName),
        scenarioName: String(ref.metadata.scenarioName ?? ref.scenarioId),
        hitCount: cleanExcerpts.length,
        hits: cleanExcerpts.slice(0, 3).map((e) => ({ excerpt: excerpt(sanitizeKnowledgeExcerpt(e.text), 300) })),
        ...(ref.engine === "GraphRAG" ? { mode: result?.mode, modeSource: result?.modeSource } : {})
      });
      if (!excerpts) return { citations: [], excerpts: [] };
      const citations = cleanExcerpts
        .map((e) => {
          // 改造2 后 public Gbrain 多页同 source：按结构化命中的 e.pageId/e.slug 回查真实页 ref，
          // 否则同 source 内命中 B 页会被错标成 A 文件/场景（I95 族归因回归）。Naive/Graph 逐源单 ref、无此问题。
          const hitRef = ref.engine === "Gbrain"
            ? ((db.moduleReferences ?? []).find((r) =>
                r.engine === "Gbrain" && r.sourceId === ref.sourceId &&
                ((e.pageId && r.pageId === e.pageId) || (e.slug && typeof r.metadata?.slug === "string" && r.metadata.slug === e.slug))
              ) ?? ref)
            : ref;
          return {
            knowledgeObjectId: hitRef.objectId,
            sourceOriginalName: String(hitRef.metadata.originalFileName ?? hitRef.sourceName),
            scenarioId: hitRef.scenarioId,
            scenarioName: String(hitRef.metadata.scenarioName ?? hitRef.scenarioId),
            engine: ref.engine,
            knowledgeType: storeKnowledgeTypeLabel(ref.engine),
            // 召回片段保留较完整正文喂给生成模型，避免短文档关键信息（如末尾条款）被截断丢失。
            excerpt: excerpt(sanitizeKnowledgeExcerpt(e.text), 1200)
          } as GlobalChatCitation;
        });
      return { citations, excerpts: cleanExcerpts };
    } catch {
      markEngineOutcome(ref.engine, "error");
      return { citations: [], excerpts: [] };
    }
  };

  // Naive 走一次全局检索（修 I60）；Gbrain/GraphRAG 保持逐源。合并后统一截断 candidatePoolSize 再 rerank（M3）。
  // 修 P43：检索用「全部去重后的 Naive 源」（uniqueRefs.filter，非扇出后的 orderedRefs——它已不含
  // Naive），searchNaiveGlobal 内部一次 HTTP 按 source_ids IN(...) 跨全部源查，不逐源、无扇出饥饿。
  const naiveRefs = uniqueRefs.filter((ref) => ref.engine === "Naive RAG");
  // I95：归因用未按 sourceId 去重的全部 Naive refs（保留同 source 多 document 各自文件名）；
  // 检索仍用去重后的 naiveRefs（searchNaiveGlobal 内再按 source 一次查）。
  const naiveRefsForAttribution = refs.filter((ref) => ref.engine === "Naive RAG");
  const otherRefs = orderedRefs.filter((ref) => ref.engine !== "Naive RAG");

  const naiveCitations: GlobalChatCitation[] = [];
  if (naiveRefs.length > 0) {
    const startedAt = Date.now();
    const refByDocument = new Map(naiveRefsForAttribution.map((ref) => [ref.documentId, ref]));
    try {
      const results = await Promise.race([
        searchNaiveGlobal(user, query, naiveRefs, getEngineTopK(db, "Naive RAG", 8), getEngineMinScore(db, "Naive RAG", 0)),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), perSourceTimeoutMs))
      ]);
      // searchNaiveGlobal 本身不会 resolve 为 null，results===null 只可能来自超时 race。
      markEngineOutcome("Naive RAG", results === null ? "timeout" : "ok");
      const clean = (results ?? []).filter((r) => r.text && r.text.trim());
      // Naive 单次全局 RETRIEVER span（命中按源回填见下；source 数计入可观测）。
      spans?.push({
        kind: "RETRIEVER",
        label: "Naive RAG 全局检索",
        engine: "Naive RAG",
        form: engineToForm("Naive RAG"),
        latencyMs: Date.now() - startedAt,
        sourceName: `${naiveRefs.length} 个来源`,
        scenarioName: "全局检索",
        hitCount: clean.length,
        hits: clean.slice(0, 3).map((r) => ({ excerpt: excerpt(sanitizeKnowledgeExcerpt(r.text), 300) }))
      });
      for (const r of clean) {
        const ref = refByDocument.get(r.documentId);
        if (!ref) continue; // 按 documentId 归因(多文件同 source 各 document 独立，修 I95)，找不到对应 ref 则跳过，不错套第一个 ref
        naiveCitations.push({
          knowledgeObjectId: ref.objectId,
          sourceOriginalName: String(ref.metadata.originalFileName ?? ref.sourceName),
          scenarioId: ref.scenarioId,
          scenarioName: String(ref.metadata.scenarioName ?? ref.scenarioId),
          engine: ref.engine,
          knowledgeType: storeKnowledgeTypeLabel(ref.engine),
          excerpt: excerpt(sanitizeKnowledgeExcerpt(r.text), 1200)
        } as GlobalChatCitation);
      }
    } catch {
      markEngineOutcome("Naive RAG", "error");
      // Naive 全局检索失败不阻断其它引擎。
    }
  }

  // 其它引擎并发逐源（原 searchOne）。并发上限避免对 embedding 端点限流丢源。
  // 默认 4：非 Naive 源（Gbrain+GraphRAG）通常 ≤4，一批并发拉平多源检索延迟（I74 #8 实证 graph 3 源串行占 15s）；不设更高防 embedding 端点并发限流（P8 教训）。
  const concurrency = resolveRetrievalConcurrency();
  const otherPairs: { ref: StoredModuleReference; citations: GlobalChatCitation[]; excerpts: ModuleExcerpt[] }[] = [];
  for (let i = 0; i < otherRefs.length; i += concurrency) {
    const slice = otherRefs.slice(i, i + concurrency);
    const batch = await Promise.all(slice.map(searchOne));
    slice.forEach((ref, j) => otherPairs.push({ ref, citations: batch[j].citations, excerpts: batch[j].excerpts }));
  }
  const otherPerRef = otherPairs.map((p) => p.citations);
  // 按引擎分组 round-robin 填充候选池（修 I85/I96，spec P13 C-A）：原 [...naive, ...others].slice()
  // 让 Naive 塞满候选池，GraphRAG/Gbrain 在 rerank 看到之前就被截断（默认 candidatePoolSize=8 +
  // Naive topK=8 → GraphRAG 归零）。轮询保证每个有证据的引擎都进入 rerank 评判；rerank（qwen3-rerank）
  // 仍是唯一相关性裁判，此处只修「谁有资格被评判」，保留 candidatePoolSize 上限（保护 rerank payload）。
  const byEngine = new Map<string, GlobalChatCitation[]>();
  for (const c of [...naiveCitations, ...otherPerRef.flat()]) {
    const q = byEngine.get(c.engine) ?? [];
    q.push(c);
    byEngine.set(c.engine, q);
  }
  const engineQueues = [...byEngine.values()];
  const candidates: GlobalChatCitation[] = [];
  for (let i = 0; candidates.length < runtimeConfig.candidatePoolSize && engineQueues.some((q) => q.length); i++) {
    const next = engineQueues[i % engineQueues.length].shift();
    if (next) candidates.push(next);
  }
  const neighborhoodCitations = await expandGbrainNeighborhood(user, db, otherPairs.filter((p) => p.ref.engine === "Gbrain"), spans);
  const reranked = await rerankCitations(query, candidates, spans);

  // 每个引擎最终状态：engines 参数命中的剪枝优先于执行结果（router 层面的“未参与”），
  // 未被剪且有执行记录的取 engineOutcome，未被剪且从未尝试（该引擎没有可检索来源）→ ok。
  const retrievalHealth: RetrievalHealth = {
    sources: ALL_RAG_ENGINES.map((engine) => ({
      engine,
      status: engines && !engines.includes(engine) ? "skipped-by-router" : (engineOutcome.get(engine) ?? "ok")
    }))
  };

  // 邻域候选独立保底名额：不进 rerank 池（不受语义分误杀），去重后追加。
  const seenObj = new Set(reranked.map((c) => c.knowledgeObjectId));
  const extra: GlobalChatCitation[] = [];
  for (const c of neighborhoodCitations) {
    if (seenObj.has(c.knowledgeObjectId)) continue;
    seenObj.add(c.knowledgeObjectId);
    extra.push(c);
  }
  const finalCitations = [...reranked, ...extra];

  // P52 §四：数据源处构建安全执行 DTO（禁 excerpt/hits/原文）——逐引擎归因
  // attempted/sourceCount/hitCount/latencyMs/status。sourceCount 用 refs（已过滤 ready+权限+scope+
  // engines），status 复用上面 retrievalHealth 同一 map（勿重算歧义）。latencyMs best-effort：从本轮
  // 推入 spans 的同引擎 RETRIEVER span 累加耗时归因，不可归因（spans 未传入）则诚实置 0。
  const statusByEngine = new Map(retrievalHealth.sources.map((s) => [s.engine, s.status]));
  const executionSpans: RetrievalExecutionSpan[] = ALL_RAG_ENGINES.map((engine) => {
    const status = statusByEngine.get(engine)!;
    const sourceCount = refs.filter((ref) => ref.engine === engine).length;
    const hitCount = finalCitations.filter((c) => c.engine === engine).length;
    const attempted = status !== "skipped-by-router" && sourceCount > 0;
    const latencyMs = (spans ?? [])
      .slice(spanBaseline)
      .filter((s) => s.kind === "RETRIEVER" && s.engine === engine)
      .reduce((sum, s) => sum + s.latencyMs, 0);
    return { engine, attempted, sourceCount, hitCount, latencyMs, status };
  });

  return { citations: finalCitations, retrievalHealth, executionSpans };
}

// P37-T4a 测试专用出口：retrieveRealGlobalCitations 未导出，无法在测试里直接注入 moduleReferences
// 验证 engines 过滤。仅转发调用（绕开真实入库流程注入 fixture），不改变函数本身的任何行为。
// P37-T4c：新增可选 spans 转发，供测试断言 GraphRAG RETRIEVER span 上的 mode/modeSource（FR-450）。
export async function __retrieveRealGlobalCitationsForTest(
  user: StoreUser,
  query: string,
  scope: GlobalChatScope,
  moduleReferences: StoredModuleReference[],
  engines?: AdminRagEngine[],
  spans?: TraceSpan[]
): Promise<{ citations: GlobalChatCitation[]; retrievalHealth: RetrievalHealth; executionSpans: RetrievalExecutionSpan[] }> {
  const db: PlatformDb = { ...emptyDb(), moduleReferences };
  return retrieveRealGlobalCitations(db, user, query, scope, spans, engines);
}

// P36b T2：给 agent-gateway 复合检索工具用的窄口 port——只暴露 StoreUser + 检索输入，
// 不泄露 PlatformDb（readDb 只在窄口内部调用一次）。内部复用 retrieveRealGlobalCitations
// 的权限过滤（canAccess/moduleReferenceAllowedByChatScope）+ rerank（qwen3-rerank）成果。
// 如实描述例外：Gbrain 邻域结果（expandGbrainNeighborhood）是 rerank 后独立追加的保底名额，
// 并非全部结果都经过 rerank——这是 retrieveRealGlobalCitations 既有行为，本 port 原样透传。
// P52 §四/§0：返回结构由 GlobalChatCitation[] 升级为 GlobalKnowledgeRetrievalResult（无 excerpt 可传输
// 执行 DTO）。P52 §六阶段3（3A）：调用方（gateway 工具层）可下传已算好的 routingDecision——本函数
// 仍不自算路由（保持无状态，多工具决策缓存冻结在 stream 层），只把 routingDecision.engines 转发给
// retrieveRealGlobalCitations 的第 6 参做真实剪枝；未传时退回 Phase1 占位常量（routing-off 全查）。
export async function retrieveGlobalKnowledge(
  user: StoreUser,
  input: { query: string; scope: GlobalChatScope; spans?: TraceSpan[]; routingDecision?: RoutingDecision }
): Promise<GlobalKnowledgeRetrievalResult> {
  const db = await readDb();
  const { citations, executionSpans } = await retrieveRealGlobalCitations(
    db, user, input.query, input.scope, input.spans ?? [], input.routingDecision?.engines
  );
  const routingDecision: RoutingDecision = input.routingDecision ?? {
    engines: undefined,
    prunedEngines: [],
    basis: "routing-off",
    reason: "phase1-contract-placeholder",
    latencyMs: 0
  };
  return { citations, routingDecision, executionSpans, toolInvoked: true, zeroHit: citations.length === 0 };
}

// P36c 阶段3 T2：给 agent-gateway provenance 撤权重校验用的窄口——不泄露 PlatformDb，只读一次 db
// 后按 citation 的 **canonical ref 身份**（engine + objectId）批量判定"当前用户在给定 chat scope
// 下是否仍可读"，返回可读 canonical key 集合（`${engine}::${objectId}`）。
//
// 为什么用 engine+objectId 而不是裸 objectId（codex 阶段3 审 MEDIUM）：GlobalChatCitation 的
// knowledgeObjectId 字段实际赋值是 `hitRef.objectId`（StoredModuleReference.objectId，模块侧原生
// id，如 Gbrain page.id / Naive job.id），跨引擎的 objectId 属于各自独立的 id 空间、理论上可能
// 碰撞；只按裸 objectId 匹配会"任一同 objectId 的 ref 可读即判可读"，跨模块碰撞时可能误放行。
// 叠加 engine（≈moduleId，storeKnowledgeTypeLabel/moduleIdForEngine 一一对应）后，Naive 的
// job.id 不会误配到 Gbrain 的 ref，canonical 身份收敛到"哪个引擎的哪个对象"。
//
// 权限口径与 retrieveRealGlobalCitations 检索时完全一致（status==="ready" + canAccess +
// moduleReferenceAllowedByChatScope 三重过滤，见 3197-3200），保证"检索时能看到的来源，撤权重校验
// 时用同一逻辑判断是否仍能看到"。找不到匹配 moduleReference（已被删除、status 非 ready、或 Gbrain
// 邻域回退的合成 id 从未对应真实 ref）一律判不可读——fail-closed，宁可多剔除一条边缘引用，不放过
// 一条已撤权来源。
export type CitationRefDescriptor = { engine: string; objectId: string };

export function citationRefKey(engine: string, objectId: string): string {
  return `${engine}::${objectId}`;
}

export async function filterReadableCitationRefs(
  user: StoreUser,
  refs: CitationRefDescriptor[],
  scope: GlobalChatScope
): Promise<Set<string>> {
  const allowed = new Set<string>();
  if (refs.length === 0) return allowed;
  const wanted = new Set(refs.map((r) => citationRefKey(r.engine, r.objectId)));
  const db = await readDb();
  for (const ref of db.moduleReferences ?? []) {
    if (ref.status !== "ready") continue; // 与检索路径一致：failed/submitted 的源检索看不到，重校验也不算可读
    const key = citationRefKey(ref.engine, ref.objectId);
    if (!wanted.has(key) || allowed.has(key)) continue;
    if (!canAccess(user, ref.accessControl)) continue;
    if (!moduleReferenceAllowedByChatScope(user, ref, scope)) continue;
    allowed.add(key);
  }
  return allowed;
}

const GBRAIN_NEIGHBORHOOD_HITS = 3;
const GBRAIN_NEIGHBORS_PER_HIT = 3;
const GBRAIN_NEIGHBORHOOD_TOTAL = 5;

// Round-4 复审修复①(codex 抓出的真 bug，最关键):/nano/graph/query 返回的是**整段 BFS 子图**的边集合——
//   depth=2 时对 root→A→B，links 含 root-A、A-B 两条边。旧代码把每条边都当"是否直接命中 hitSlug"的一跳
//   判据：处理 A-B 这条边时，两端都不是 hitSlug(root)，就误落到 else 分支把 neighbor 算成 from_slug=A
//   （重复，丢 B）。改为对(按 source_id 过滤后的)边集合做真 BFS，按到 hitSlug 的图距离(1..depth)收集节点，
//   多跳边才能真正把 depth=2 的第二跳节点(B)带进来。exclude 用于跨 hitSlug 去重（不重复占用总名额）。
export function bfsGbrainNeighborSlugs(
  links: Array<{ source_id?: string; from_slug?: string; to_slug?: string }>,
  sourceId: string,
  rootSlug: string,
  depth: number,
  limit: number,
  exclude?: Set<string>
): string[] {
  const adjacency = new Map<string, Set<string>>();
  for (const link of links) {
    if (link.source_id !== sourceId) continue;
    const a = link.from_slug;
    const b = link.to_slug;
    if (!a || !b || a === b) continue;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }
  // exclude 只影响是否**收进结果**(已被更近的 hitSlug 占过名额,跨 hitSlug 去重)，不影响是否可作为
  // 中转节点被 BFS 继续穿越——否则被排除的一跳节点会挡住经它才能到达的更远节点(真 BFS 必须能穿过它)。
  const visited = new Set<string>([rootSlug]);
  const order: string[] = [];
  let frontier = [rootSlug];
  for (let level = 0; level < depth && frontier.length > 0 && order.length < limit; level += 1) {
    const next: string[] = [];
    for (const slug of frontier) {
      for (const neighbor of adjacency.get(slug) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.push(neighbor);
        if (exclude?.has(neighbor)) continue;
        order.push(neighbor);
        if (order.length >= limit) break;
      }
      if (order.length >= limit) break;
    }
    frontier = next;
  }
  return order;
}

// 改造3：沿 Gbrain wiki 链取 1 跳邻域，把关联页（出链/反链）带进候选，即使语义不相似。
// 独立保底名额：邻域不进 rerank 池、不占候选池 round-robin，rerank 后去重追加（防语义分误杀）。
async function expandGbrainNeighborhood(
  user: StoreUser,
  db: PlatformDb,
  gbrainPairs: { ref: StoredModuleReference; excerpts: ModuleExcerpt[] }[],
  spans?: TraceSpan[]
): Promise<GlobalChatCitation[]> {
  const out: GlobalChatCitation[] = [];
  const addedSlugs = new Set<string>();
  for (const { ref, excerpts } of gbrainPairs) {
    if (out.length >= GBRAIN_NEIGHBORHOOD_TOTAL) break;
    const reader = moduleReaderForReference(user, ref);
    const hitSlugs: string[] = [];
    const hitTitleBySlug = new Map<string, string>();
    for (const e of excerpts) {
      if (!e.slug) continue;
      if (e.title && !hitTitleBySlug.has(e.slug)) hitTitleBySlug.set(e.slug, e.title);
      if (!hitSlugs.includes(e.slug)) hitSlugs.push(e.slug);
      if (hitSlugs.length >= GBRAIN_NEIGHBORHOOD_HITS) break;
    }
    for (const hitSlug of hitSlugs) {
      if (out.length >= GBRAIN_NEIGHBORHOOD_TOTAL) break;
      const linkDepth = getEngineLinkDepth(db, "Gbrain", 1);
      let graph: { links?: any[] } | null = null;
      try {
        // P34 T-LINKDEPTH: 邻域跳数读 GBrain per-engine 检索配置（缺省回落 1）。越界配置被 reader 夹回默认。
        graph = await moduleJson<{ links?: any[] }>("Gbrain", "/nano/graph/query", { method: "POST", user: reader, body: { slug: hitSlug, depth: linkDepth, direction: "both" } });
      } catch { continue; }
      // 串源兜底（codex 审②）：/nano/graph/query 无 source_id 入参，只按 slug 过滤 →
      //   platform 侧只接受 source_id === ref.sourceId 的 link，防同名跨源邻域串源。
      // Round-4 修复①：graph.links 是整段 BFS 子图的边集合，不能按"是否直接命中 hitSlug"逐边判邻居
      //   （depth=2 时 root→A→B 的 A-B 边两端都不是 root，会被误判丢弃）；改真 BFS 按图距离收集节点。
      const neighborSlugs = bfsGbrainNeighborSlugs(graph?.links ?? [], ref.sourceId, hitSlug, linkDepth, GBRAIN_NEIGHBORS_PER_HIT, addedSlugs);
      for (const neighborSlug of neighborSlugs) {
        if (out.length >= GBRAIN_NEIGHBORHOOD_TOTAL) break;
        const neighborStartedAt = Date.now();
        let page: { id?: string; slug?: string; title?: string; body?: string } | null = null;
        try {
          page = (await moduleJson<{ page: { id?: string; slug?: string; title?: string; body?: string } }>("Gbrain", `/nano/pages/${encodeURIComponent(ref.sourceId)}/${encodeURIComponent(neighborSlug)}`, { method: "GET", user: reader })).page;
        } catch { continue; }
        if (!page?.body || !page.body.trim()) continue;
        addedSlugs.add(neighborSlug);
        const neighborRef = (db.moduleReferences ?? []).find((r) => r.engine === "Gbrain" && r.sourceId === ref.sourceId && (r.pageId === page!.id || (typeof r.metadata?.slug === "string" && r.metadata.slug === neighborSlug)));
        const linkContext = `〖命中页「${hitTitleBySlug.get(hitSlug) ?? hitSlug}」通过 wiki 链关联到本页〗\n`;
        out.push({
          knowledgeObjectId: neighborRef?.objectId ?? `gbrain-neighbor:${ref.sourceId}:${neighborSlug}`,
          sourceOriginalName: String(neighborRef?.metadata.originalFileName ?? page.title ?? neighborSlug),
          scenarioId: neighborRef?.scenarioId ?? ref.scenarioId,
          scenarioName: String(neighborRef?.metadata.scenarioName ?? neighborRef?.scenarioId ?? ref.metadata?.scenarioName ?? ref.scenarioId),
          engine: "Gbrain",
          knowledgeType: storeKnowledgeTypeLabel("Gbrain"),
          excerpt: excerpt(sanitizeKnowledgeExcerpt(linkContext + page.body), 1200)
        } as GlobalChatCitation);
        spans?.push({ kind: "RETRIEVER", label: "Gbrain wiki 邻域", engine: "Gbrain", form: engineToForm("Gbrain"), latencyMs: Date.now() - neighborStartedAt, sourceName: String(page.title ?? neighborSlug), scenarioName: "来源=wiki邻域", hitCount: 1, hits: [{ excerpt: excerpt(sanitizeKnowledgeExcerpt(page.body), 300) }] });
      }
    }
  }
  return out;
}

// 全局 Naive 检索（修架构债 I60）：对一组已授权的源做一次全局检索 → 模块内全局 RRF + 全局 TopK + 全局归一化阈值。
// 权限边界：sourceIds 必须是平台已用 canAccess / moduleReferenceAllowedByChatScope 预授权的源；
// 模块自身权限只有 admin/public/owner（无 team/company），故这里用 elevated reader(role=admin) 让模块放行，
// 由 sourceIds 充当唯一权限边界（等价于旧逐源 moduleReaderForReference 的 owner 模拟，但一次覆盖多源）。
// 安全闭环（codex 审）：参数收**已授权的 refs**（调用方均传 canAccess/scope 过滤后的 StoredModuleReference[]），
// 函数内派生 sourceIds —— 杜绝外部传裸 sourceIds 绕过授权。
async function searchNaiveGlobal(
  user: StoreUser,
  query: string,
  refs: StoredModuleReference[],
  limit: number,
  minScore?: number
): Promise<Array<{ text: string; sourceId: string; documentId: string }>> {
  // I95：source 去重——归因侧可能传入未按 sourceId 去重的 refs（同 source 多 document），
  // 这里对检索 source 去重，保证 chunk /search 与 structured 补召回都按每 source 一次查、不重复请求。
  const sourceIds = [...new Set(refs.map((ref) => ref.sourceId))];
  if (sourceIds.length === 0) return [];
  const reader: StoreUser = { ...user, role: "admin" };
  const body = await moduleJson<{ results?: any[] }>("Naive RAG", "/traditional/search", {
    method: "POST",
    user: reader,
    body: { query, limit, source_ids: sourceIds, ...(typeof minScore === "number" && minScore > 0 ? { min_score: minScore } : {}) }
  });
  const chunkResults = (body.results ?? []).map((result) => ({
    text: result.chunk?.text ?? result.chunk?.chunk_text ?? result.chunk?.snippet ?? "",
    sourceId: String(result.chunk?.source_id ?? result.source?.id ?? ""),
    documentId: String(result.chunk?.document_id ?? result.document?.id ?? "")
  }));
  // 表格资料（CSV/XLSX）数据在 traditional_structured_rows，chunk /search 查不到（I83 根治）。
  // structured/search 仅单源 → 按源并行检索，单源失败隔离，表格结果并到 chunk 之后。
  // 修 P43：structured 逐源请求限并发（对齐下方 otherRefs 分批模式）。Naive 解除 fanout 后
  // source_ids 可达全量（evalset 40 源），原 Promise.all 会一次并发发起 N 个重型 structured 请求
  // （每个含词表派生+字面+向量查询），打爆模块线程/DB 且 20s 超时后请求不取消（codex 审 BLOCK）。
  // 分批并发把峰值压到 concurrency，chunk 批量检索（单次 HTTP）不受影响。
  const structuredConcurrency = resolveRetrievalConcurrency();
  const structuredResults: Array<{ text: string; sourceId: string; documentId: string }> = [];
  // structured 独立超时预算：超时只丢未完成的 structured 批次，已累积的保留；chunk 主召回始终保底。
  const runStructured = async () => {
    for (let i = 0; i < sourceIds.length; i += structuredConcurrency) {
      const slice = sourceIds.slice(i, i + structuredConcurrency);
      const batch = await Promise.all(slice.map((sourceId) => searchNaiveStructured(reader, query, sourceId, limit)));
      structuredResults.push(...batch.flat());
    }
  };
  await Promise.race([
    runStructured(),
    new Promise<void>((resolve) => setTimeout(resolve, NAIVE_STRUCTURED_BUDGET_MS))
  ]);
  return [...chunkResults, ...structuredResults];
}

// 表格单源检索 helper（I83 根治）：CSV/XLSX 入库走 traditional_structured_rows，chunk 端点
// /traditional/search 不覆盖它；此函数调 /traditional/structured/search，把命中行 semantic_text
// 映射为与 chunk 同构的召回文本。structured/search 仅支持单 source_id；失败隔离兜底空数组，绝不拖垮 chunk 召回。
async function searchNaiveStructured(
  reader: StoreUser,
  query: string,
  sourceId: string,
  limit: number
): Promise<Array<{ text: string; sourceId: string; documentId: string }>> {
  if (!sourceId) return [];
  // structured/search 失败隔离：.catch 兜底空数组，绝不拖垮已拿到的 chunk 召回。
  // 注：内层超时保护本轮移除——硬编码(8s/20s)会误杀限速网络下的正常查询(I38/P6 教训)；
  // 而跟随外层 perSourceTimeoutMs 又因 chunk→structured 串行致时序层叠、structured 慢时反把 chunk 一起丢(codex 审 BLOCK)。
  // structured 超时的正确设计（chunk/structured 并发保底 / 动态剩余预算 / 对齐 verify 外层）单独立项处理（台账 I90）。
  return moduleJson<{ results?: Array<{ semantic_text?: string; source_id?: string; document_id?: string }> }>(
    "Naive RAG",
    "/traditional/structured/search",
    { method: "POST", user: reader, body: { query, limit, source_id: sourceId } }
  )
    .then((body) =>
      (body.results ?? [])
        .map((row) => ({
          text: String(row.semantic_text ?? ""),
          sourceId: String(row.source_id ?? ""),
          documentId: String(row.document_id ?? "")
        }))
        .filter((row) => row.text !== "" && row.sourceId !== "")
    )
    .catch(() => [] as Array<{ text: string; sourceId: string; documentId: string }>);
}

// 改造3a：结构化召回片段（携带 slug/sourceId/pageId/title），供邻域扩展（改造3）定位命中页在图谱中的位置。
type ModuleExcerpt = { text: string; slug?: string; sourceId?: string; pageId?: string; title?: string };

// 针对单个模块来源引用，调用对应引擎的真实检索端点，返回召回到的结构化片段列表。
// P37-T4c（FR-450）：GraphRAG 分支额外返回本次生效 mode/modeSource（下游 mode router 返回），
// 供调用方（searchOne）标注到 RETRIEVER span；Gbrain/Naive 分支不涉及 mode，字段留空。
async function searchModuleForReference(
  user: StoreUser,
  ref: StoredModuleReference,
  query: string,
  limit: number,
  minScore?: number
): Promise<{ excerpts: ModuleExcerpt[]; mode?: string; modeSource?: string }> {
  const reader = moduleReaderForReference(user, ref);
  if (ref.engine === "Gbrain") {
    const body = await moduleJson<{ citations?: any[] }>("Gbrain", "/nano/ask", {
      method: "POST",
      user: reader,
      body: { query, limit, source_id: ref.sourceId }
    });
    return {
      excerpts: (body.citations ?? [])
        .filter((citation) => citationMatchesReference(citation, ref))
        // 优先完整 chunk 正文，snippet 只是高亮片段、可能裁掉关键句（如末尾条款）。
        .map((citation) => ({
          text: citation.chunk_text ?? citation.text ?? citation.snippet ?? "",
          slug: citation.slug ?? citation.locator?.slug,
          sourceId: citation.source_id ?? citation.locator?.source_id ?? ref.sourceId,
          pageId: citation.page_id ?? citation.locator?.page_id,
          title: citation.title
        }))
    };
  }
  if (ref.engine === "Naive RAG") {
    const body = await moduleJson<{ results?: any[] }>("Naive RAG", "/traditional/search", {
      method: "POST",
      user: reader,
      // min_score 仅在显式设了正阈值时透传，未设/0 不传 → 模块不过滤（存量行为零变化）。
      body: { query, limit, source_id: ref.sourceId, ...(typeof minScore === "number" && minScore > 0 ? { min_score: minScore } : {}) }
    });
    const chunkTexts = (body.results ?? []).map((result) => result.chunk?.text ?? result.chunk?.chunk_text ?? result.chunk?.snippet ?? "");
    // 表格资料（CSV/XLSX）走 structured/search 补召回（I83 根治），失败隔离，并到 chunk 之后。
    const structuredTexts = (await searchNaiveStructured(reader, query, ref.sourceId, limit)).map((row) => row.text);
    return { excerpts: [...chunkTexts, ...structuredTexts].map((text) => ({ text })) };
  }
  // 用 /graph/search（纯检索 ~1.2s）而非 /graph/ask（含 LLM 生成 answer，延迟 1-18s 波动、抖到 >20s 被 perSourceTimeout 超时跳过）。
  // 全域检索本身会用证据自行生成答案，无需 graph 模块再生成一次（重复且是超时元凶）。
  const body = await moduleJson<{ results?: any[]; mode?: string; mode_source?: string }>("GraphRAG", "/graph/search", {
    method: "POST",
    user: reader,
    body: { query, limit, source_id: ref.sourceId, ...getGraphRetrievalParams(await readDb()) }
  });
  return {
    excerpts: (body.results ?? []).map(
      (item) => ({ text: item.context ?? item.text ?? item.chunk_text ?? item.snippet ?? "" })
    ),
    mode: body.mode,
    modeSource: body.mode_source
  };
}

// P37-T4a：六类意图 taxonomy（照搬 main 017），供 classifyQueryWithModel 标注 intents。
const ROUTE_INTENTS = ["事实查找", "关系多跳", "聚合统计", "比较", "摘要综述", "闲聊直答"] as const;
// 关系类关键词：命中则保留 GraphRAG（否则默认剪掉，GraphRAG 延迟高且对纯文档题白付代价）。
const GRAPH_RELATION_KEYWORDS = ["关系", "汇报", "合作", "供应商", "上下游", "组织架构", "谁向谁", "所有权", "依赖", "链条", "投资", "领投", "客户", "采用", "股东", "隶属", "谁是谁"];

let engineCapabilityCardsCache: string | null = null; // null=尚未成功加载（可重试）
// P52 Phase 2 测试缝：强制覆盖能力卡返回值（含强制 null 模拟"资产缺失"fail-open），不经磁盘/缓存。
// undefined = 无覆盖（走真实缓存/磁盘逻辑，不影响既有测试）；null/string = 强制指定返回值。
let engineCapabilityCardsOverrideForTest: string | null | undefined = undefined;
export function __setEngineCapabilityCardsForTest(value: string | null | undefined) {
  engineCapabilityCardsOverrideForTest = value;
}
async function loadEngineCapabilityCards(): Promise<string | null> {
  if (engineCapabilityCardsOverrideForTest !== undefined) return engineCapabilityCardsOverrideForTest;
  if (engineCapabilityCardsCache !== null) return engineCapabilityCardsCache;
  try {
    engineCapabilityCardsCache = await readFile(new URL("./prompts/engine-capability-cards.md", import.meta.url), "utf8");
    return engineCapabilityCardsCache;
  } catch {
    return null; // 资产缺失/读取失败 → 不写缓存，下次可重试；由调用方决定回退为全查
  }
}

// 测试专用出口：清空能力卡缓存，供覆盖"失败→重试""资产变更"断言。
export function __resetEngineCapabilityCardsCacheForTest() {
  engineCapabilityCardsCache = null;
}

// P50：客户-产品关系谓词/宾语词表（typed 实体槽位窄规则用，"用的是"≠"用了"，禁裸子串误配文档题）。
// fix-2：object 词表删「产品」「方案」（过宽，"选择方案"这类无关搭配也会命中）；
// 模式1/3 均加槽位顺序约束（谓词须先于宾语出现），防"平台...选择"这类宾语在谓词前的误命中。
const ROUTE_CUSTOMER_PRODUCT_PREDICATES = ["选择", "采用", "使用", "用的是"];
const ROUTE_CUSTOMER_PRODUCT_OBJECTS = ["平台", "知识平台", "供应链平台"];
const ROUTE_PERSON_ORG_PATTERN = /的?(cfo|ceo|cto|创始人|高管).{0,2}是谁/;
const ROUTE_PERSON_PRODUCT_PREDICATES = ["主导", "负责", "带"];
const ROUTE_PERSON_PRODUCT_OBJECTS = ["什么产品", "哪个项目"];

// 谓词在前、宾语在后：找到首个命中谓词/宾语各自在 query 中的 indexOf，要求宾语位置严格晚于谓词位置。
function matchesOrderedSlotPattern(query: string, predicates: readonly string[], objects: readonly string[]): boolean {
  const matchedPredicate = predicates.find((predicate) => query.includes(predicate));
  const matchedObject = objects.find((object) => query.includes(object));
  if (!matchedPredicate || !matchedObject) return false;
  const predicateIdx = query.indexOf(matchedPredicate);
  const objectIdx = query.indexOf(matchedObject);
  return predicateIdx >= 0 && objectIdx > predicateIdx;
}

// P50：typed 实体槽位 + 关系谓词窄模式——只有命中 allowlist typed 实体（company/person/product）
// 且同现关系谓词/宾语才判隐式关系题，裸词面子串（如"用了什么"）不参与，防误保文档题的 GraphRAG。
function matchesTypedRelationPattern(query: string): boolean {
  // 模式1·客户-产品：如"米粒电商用的是什么平台""中安保险为什么选择司脑平台"。
  if (hasCompanyEntity(query) && matchesOrderedSlotPattern(query, ROUTE_CUSTOMER_PRODUCT_PREDICATES, ROUTE_CUSTOMER_PRODUCT_OBJECTS)) {
    return true;
  }
  // 模式2·人-组织：如"启明星科技的CFO是谁"。fix-2：正则跑 normalizeRouteQuery 后的文本，
  // 识别全角ＣＦＯ/全角空格（hasCompanyEntity 内部已归一，此处正则必须同口径）。
  if (hasCompanyEntity(query) && ROUTE_PERSON_ORG_PATTERN.test(normalizeRouteQuery(query))) {
    return true;
  }
  // 模式3·人-产品：如"陈立主导什么产品"。同样加槽位顺序约束。
  if (hasPersonEntity(query) && matchesOrderedSlotPattern(query, ROUTE_PERSON_PRODUCT_PREDICATES, ROUTE_PERSON_PRODUCT_OBJECTS)) {
    return true;
  }
  // 模式4·实体-实体：如"拓普汽车用智枢做什么"。fix-2：删裸 includes("用")（会命中"使用手册"这类无关搭配），
  // 改为"用"紧邻命中的产品名（用[了的]?<product>），且仍要求含"做什么"。
  const product = matchedProduct(query);
  if (hasCompanyEntity(query) && product !== null && new RegExp(`用[了的]?${product}`).test(query) && query.includes("做什么")) {
    return true;
  }
  return false;
}

// 纯函数、减法语义：基集恒含 Naive RAG + Gbrain（文档/知识默认保留），命中关系类关键词才追加 GraphRAG。
// 恒非空，供 T4e route_engine_probe 复用。
export function routeEnginesByRules(query: string): AdminRagEngine[] {
  const engines: AdminRagEngine[] = ["Naive RAG", "Gbrain"];
  if (GRAPH_RELATION_KEYWORDS.some((keyword) => query.includes(keyword)) || matchesTypedRelationPattern(query)) {
    engines.push("GraphRAG");
  }
  return [...new Set(engines)];
}

// FF_ENGINE_ROUTING 关闭时 engines 恒 undefined（全查，不过滤）；资产缺失/规则异常/并集为空同样 fail-open 到全查。
// business-rule 命中的 retrieve（未经 classifier）仍至少跑一次 rules，basis 相应标 "rules"。
function resolveRetrieveEngines(
  query: string,
  classifierEngines: AdminRagEngine[] | undefined,
  cards: string | null,
  routingOn: boolean
): { engines?: AdminRagEngine[]; basis: "rules" | "classifier" | "fail-open" | "routing-off" } {
  if (!routingOn) return { engines: undefined, basis: "routing-off" };
  if (!cards) return { engines: undefined, basis: "fail-open" };
  try {
    const rules = routeEnginesByRules(query); // 恒非空
    const merged = [...new Set([...rules, ...(classifierEngines ?? [])])];
    if (merged.length === 0) return { engines: undefined, basis: "fail-open" };
    return { engines: merged, basis: classifierEngines && classifierEngines.length ? "classifier" : "rules" };
  } catch {
    return { engines: undefined, basis: "fail-open" };
  }
}

// ===== P52 §三 D-3 / §六 阶段2：agent-gateway 全域问答专用路由窄口（与上面 legacy 三件套并存，不改它们）=====

// engine-only classifier 独立 system prompt：只判"该查哪些引擎"，不含 mode/intents/direct-retrieve 判断、
// 不含 source-cards——刻意与 buildClassifierSystemPrompt 分离（后者耦合 mode/intents，Phase 2 禁复用）。
function buildEngineOnlyClassifierPrompt(cards: string | null): string {
  const lines = [
    "你是企业知识中台的检索引擎选择器。问题已被判定为需要检索企业知识库，你只需判断应该查询哪些检索引擎，不判断是否需要检索。",
    "引擎取值须逐字使用 \"Naive RAG\" / \"Gbrain\" / \"GraphRAG\" 之一或多个。"
  ];
  if (cards) {
    lines.push(
      "以下是三条检索引擎的能力卡，请依据能力卡为问题选择合适的引擎组合：",
      cards,
      "引擎选择补充：当问题问的是【本企业实体之间的关系】——如「X用的是什么平台/产品」「X为什么选择Y」「X的CFO/CEO是谁」「X主导/负责什么产品」「X投了谁」这类隐式关系问题，engines 必须包含 \"GraphRAG\"（这类问题要靠图谱多跳，不能只给文档引擎）；若只是问某个实体/产品「是什么/怎么样/总体架构/某模块用了什么技术」这类介绍或文档型问题，engines 不含 GraphRAG。但『某人是谁』（如「李明远是谁」）这类纯人物身份/介绍题属文档型，engines 不含 GraphRAG；只有明确问『X的CFO/CEO是谁』这种职务—组织关系才含 GraphRAG。"
    );
  }
  lines.push("只返回 JSON：{\"engines\":[\"...\"]}。");
  return lines.join("\n");
}

// 专用短超时 HTTP，单次调用无重试（与 callAgentChatModel 的 3×25s 重试策略刻意区分——路由决策
// 不能因重试拖慢整轮问答，超时/失败直接 fail-open 全查即可，宁可多查不可让路由本身变成瓶颈）。
// 支持外部传入 AbortSignal（如 Phase 3 gateway relay 请求级取消）与内部短超时并存传播。
async function callEngineClassifierModel(
  messages: Array<{ role: "system" | "user"; content: string }>,
  options: { signal?: AbortSignal } = {}
): Promise<{ content: string } | { errorKind: "timeout" | "error" }> {
  if (process.env.FF_PLATFORM_AGENT_MODE === "local" || process.env.FF_PLATFORM_AGENT_MODE === "off") {
    return { errorKind: "error" };
  }
  const apiKey = await readAgentEnv("AGENT_API_KEY");
  const baseUrl = (await readAgentEnv("AGENT_BASE_URL") ?? "").replace(/\/+$/, "");
  const model = await readAgentEnv("AGENT_MODEL");
  if (!apiKey || !baseUrl || !model) return { errorKind: "error" };
  // resolver 契约是"永不抛必 fail-open"：畸形超时配置（非数字/非正数）会让 AbortSignal.timeout
  // 直接抛出，必须先校验兜底默认值，不能让配置错误升级为未捕获异常（codex 异源审 BLOCK #2a）。
  const rawTimeoutMs = Number(process.env.FF_ROUTER_CLASSIFIER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0 ? rawTimeoutMs : 8000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      // max_tokens 需给推理模型（如 deepseek-v4-flash，答案在 content、思考在 reasoning_content）留足
      // headroom——reasoning 会先吃 token 预算，过小（曾 120）会让 content 空 → classifier-error → 静默
      // fail-open 不剪枝（真跑 probe 逮到：多数题因此不剪）。engine-only JSON 本体仅 ~15 token，512 足够。
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 512 }),
      signal
    });
    if (!response.ok) return { errorKind: "error" };
    const body = await response.json().catch(() => null) as any;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) return { content: content.trim() };
    return { errorKind: "error" };
  } catch {
    // AbortSignal.any 合成信号本身不暴露"谁触发了 abort"，单独持有 timeoutSignal 引用、查它自己
    // 的 aborted 状态即可精确区分是内部超时还是外部信号/网络异常（不受组合方式影响，已 probe 验证）。
    return { errorKind: timeoutSignal.aborted ? "timeout" : "error" };
  }
}

// 只选引擎，不判 direct/retrieve、不标 intents。成功（合法且非空）返回引擎数组；失败/超时/非法JSON/
// 空/越界统一返回 null，供上层 fail-open——onReason 可选透出具体失败原因，供 resolveGlobalRetrieveRouting
// 填充 RoutingDecision.reason（与 callAgentChatModel(messages, options, onLlm) 的可观测回调风格一致）。
async function classifyEnginesOnly(
  routingQuery: string,
  cards: string | null,
  onReason?: (reason: "timeout" | "invalid" | "empty" | "error") => void
): Promise<AdminRagEngine[] | null> {
  const result = await callEngineClassifierModel([
    { role: "system", content: buildEngineOnlyClassifierPrompt(cards) },
    { role: "user", content: routingQuery }
  ]);
  if ("errorKind" in result) {
    onReason?.(result.errorKind);
    return null;
  }
  const parsed = parseJsonObject(result.content);
  if (!parsed) {
    onReason?.("invalid");
    return null;
  }
  if (!Array.isArray(parsed.engines)) {
    onReason?.("invalid");
    return null;
  }
  const validEngines = parsed.engines.filter(
    (v): v is AdminRagEngine => v === "Naive RAG" || v === "Gbrain" || v === "GraphRAG"
  );
  // codex 异源审 BLOCK #1：任一越界/非法值（如 typo 出的引擎名）→ 整体 fail-open，不能只丢弃越界值、
  // 保留合法子集继续剪枝——分类器把 GraphRAG typo 成别的值时，图谱题的 GraphRAG 会被静默误剪（违 AC-召回零丢失）。
  if (validEngines.length !== parsed.engines.length) {
    onReason?.("invalid");
    return null;
  }
  if (validEngines.length === 0) {
    onReason?.("empty");
    return null;
  }
  return [...new Set(validEngines)];
}

// P52 §四：gateway 全域问答专用路由窄口——返回 §四冻结的 RoutingDecision（Phase 1 已定义类型）。
// 三种有效出口：classifier(剪枝) / fail-open(全查) / routing-off(全查)；不存在"只用 rules 剪枝"的
// 成功路径（与 legacy resolveRetrieveEngines 的关键区别——那边 classifier 缺失时保留 rules 剪枝，
// 本函数 classifier 失败/超时/非法/空一律全查，绝不退回 rules-only 剪枝，避免"看似剪了枝但其实
// 只是分类器抖动"的静默误剪）。
export async function resolveGlobalRetrieveRouting(routingQuery: string): Promise<RoutingDecision> {
  const startedAt = Date.now();
  if (process.env.FF_ENGINE_ROUTING !== "on") {
    return { engines: undefined, prunedEngines: [], basis: "routing-off", reason: "routing-off", latencyMs: Date.now() - startedAt };
  }
  // resolver 契约是"永不抛必 fail-open"：cards/rules/classifier 任一环节意外抛出（如未来 routeEnginesByRules
  // 演进出新异常路径），都不能让整个路由决策 reject——兜底 fail-open，绝不让路由本身变成问答链路的单点故障
  // （codex 异源审 BLOCK #2b）。
  try {
    const cards = await loadEngineCapabilityCards();
    if (cards === null) {
      return { engines: undefined, prunedEngines: [], basis: "fail-open", reason: "capability-cards-missing", latencyMs: Date.now() - startedAt };
    }
    const rules = routeEnginesByRules(routingQuery); // 恒非空
    let classifierFailReason: "timeout" | "invalid" | "empty" | "error" = "error";
    const classifierEngines = await classifyEnginesOnly(routingQuery, cards, (reason) => { classifierFailReason = reason; });
    if (!classifierEngines) {
      return {
        engines: undefined,
        prunedEngines: [],
        basis: "fail-open",
        reason: `classifier-${classifierFailReason}`,
        latencyMs: Date.now() - startedAt
      };
    }
    const engines = [...new Set([...rules, ...classifierEngines])];
    const prunedEngines = ALL_RAG_ENGINES.filter((engine) => !engines.includes(engine));
    return { engines, prunedEngines, basis: "classifier", reason: "engine-classifier", latencyMs: Date.now() - startedAt };
  } catch {
    return { engines: undefined, prunedEngines: [], basis: "fail-open", reason: "classifier-error", latencyMs: Date.now() - startedAt };
  }
}

export async function routeGlobalChatQuery(
  query: string,
  onLlm?: (info: LlmSpanInfo) => void,
  // 018 T2：可选源级描述卡文本(已格式化，formatSourceCardsForRouting 产出)，未传/空 → 分类器
  // system prompt 逐字 === 无卡基线(AM-1806)，纯拼接不改变既有 direct/retrieve 判断路径。
  promptContext?: { sourceCards?: string }
): Promise<{
  mode: "direct" | "retrieve";
  intents?: string[];
  engines?: AdminRagEngine[];
  reason: string;
  basis: "direct" | "rules" | "classifier" | "fail-open" | "routing-off";
}> {
  const normalized = query.trim();
  if (!normalized) return { mode: "direct", reason: "空问题不检索知识库", basis: "direct" };
  if (isSmallTalkQuery(normalized)) return { mode: "direct", reason: "寒暄和通用对话直接由模型回答", basis: "direct" };

  const routingOn = process.env.FF_ENGINE_ROUTING === "on";
  const cards = routingOn ? await loadEngineCapabilityCards() : null;

  if (isBusinessKnowledgeQuery(normalized)) {
    const { engines, basis } = resolveRetrieveEngines(normalized, undefined, cards, routingOn);
    return { mode: "retrieve", engines, reason: "问题包含业务实体、资料或分析诉求，需要检索企业知识", basis };
  }

  const llmRoute = await classifyQueryWithModel(normalized, cards, onLlm, promptContext?.sourceCards);
  if (llmRoute) {
    if (llmRoute.mode === "direct") return { mode: "direct", intents: llmRoute.intents, reason: llmRoute.reason, basis: "direct" };
    const { engines, basis } = resolveRetrieveEngines(normalized, llmRoute.engines, cards, routingOn);
    return { mode: "retrieve", intents: llmRoute.intents, engines, reason: llmRoute.reason, basis };
  }
  // 分类器失败/超时（限速网络下常见）→ 企业级默认检索：宁可检索后由相关性评分诚实拒答，
  // 也绝不因路由器抖动静默跳过检索、给出空泛非答案。engines 恒 undefined（全查）。
  return { mode: "retrieve", reason: "路由判断不确定，默认检索企业知识（避免漏检）", basis: "fail-open" };
}

// P37-T4e·019B adapter（spec §五1）：唯一生产路由函数 routeGlobalChatQuery 的薄序列化包装，
// 供跨语言 probe（scripts/route_engine_probe.ts → eval/route-optimization run_probe）调用。
// 不含任何路由逻辑副本；异常捕获为 error 字段不抛出，保证 probe 批处理不中断。
export async function routeEnginesForProbe(
  query: string
): Promise<{ query: string; mode: string; engines: AdminRagEngine[] | null; error?: string }> {
  try {
    const route = await routeGlobalChatQuery(query);
    return { query, mode: route.mode, engines: route.engines ?? null };
  } catch (error) {
    return { query, mode: "", engines: null, error: String(error) };
  }
}

function isSmallTalkQuery(query: string) {
  const normalized = query.replace(/\s+/g, "").toLowerCase();
  const exactGreetings = ["你好", "您好", "hi", "hello", "hey", "在吗", "早上好", "下午好", "晚上好", "谢谢", "感谢"];
  if (exactGreetings.includes(normalized)) return true;
  if (normalized.length <= 8 && /^(你好|您好|hi|hello|hey|在吗|谢谢|感谢)/i.test(normalized)) return true;
  return false;
}

function isBusinessKnowledgeQuery(query: string) {
  // 新增（I74 #8 提速）：错误码模式（ERR-4096 / ERR_KG_1042 / E1234 等）直接命中→retrieve，跳过慢且不稳的 LLM 路由。
  if (/[A-Za-z]{1,}[-_]?\d{3,}/.test(query)) return true;
  const normalized = query.toLowerCase();
  const businessTerms = [
    "风险", "机会", "制度", "政策", "合同", "报销", "销售", "季度", "资料", "文档", "报告",
    "分析", "总结", "依据", "来源", "公司", "团队", "项目", "订单", "发票", "预算", "流程", "客户画像", "知识库",
    // HR / 差旅 / 行政等常见企业知识诉求，避免漏匹配后落到不稳定的 LLM 分类器
    "差旅", "出差", "住宿", "交通", "餐补", "补贴", "福利", "年假", "假期", "请假", "考勤", "加班", "调休",
    "薪资", "工资", "绩效", "提成", "社保", "公积金", "入职", "转正", "离职", "审批", "标准", "上限", "额度",
    "规定", "申请", "设备", "采购", "权限", "岗位", "职级", "考核", "培训",
    "pdf", "word", "markdown", "csv", "graph", "wiki",
    // 新增（I74 #8 提速）：运维/故障排查类高频求助词，命中→retrieve（召回0会硬拒答，不会幻觉，安全）
    "故障", "报错", "错误码", "异常", "排查", "事故", "复盘", "运维", "日志", "部署", "配置", "解决"
  ];
  return businessTerms.some((term) => normalized.includes(term));
}

function knowledgeAllowedByChatScope(user: StoreUser, item: StoredKnowledgeObject, scope: GlobalChatScope) {
  const accessControl = accessControlFromKnowledgeObject(item);
  if (scope === "company") return true;
  if (scope === "private") return accessControl.ownerUserId === user.userId;
  if (accessControl.ownerUserId === user.userId) return true;
  if (accessControl.scope !== "team") return false;
  if (accessControl.organizationId !== normalizeOrganizationId(user.organizationId)) return false;
  return accessControl.teamIds.some((teamId) => normalizeTeamIds(user.teamIds).includes(teamId));
}

// P36d 阶段1a：gateway 侧生成 contextTrace 需复用同一推导算法，导出窄口纯函数（不依赖 legacy
// session 状态，只依赖 citations 数组），延续 P36b「gateway 从 @ff/platform 导入纯函数/类型」先例。
export function buildGlobalRetrievalTracks(citations: GlobalChatCitation[]): GlobalChatRetrievalTrack[] {
  return [
    {
      label: "文档证据",
      count: citations.filter((item) => item.engine === "Naive RAG").length,
      description: "制度、合同、PDF、Word、表格等原始证据切片。"
    },
    {
      label: "关系图谱",
      count: citations.filter((item) => item.engine === "GraphRAG").length,
      description: "客户、人员、供应商、事件和风险之间的关系。"
    },
    {
      label: "知识百科",
      count: citations.filter((item) => item.engine === "Gbrain").length,
      description: "沉淀后的 Wiki、手册、事实卡和可复用结论。"
    }
  ];
}

async function buildGlobalChatAnswerText(
  query: string,
  citations: GlobalChatCitation[],
  onLlm?: (info: LlmSpanInfo) => void
) {
  if (citations.length === 0) {
    return `我没有在当前账号可访问的知识资产中找到足够依据回答「${query}」。你可以先选择一个场景模板上传资料，或把问题保存为待构建的业务场景。`;
  }
  const grouped = buildEngineSummary(citations);
  const evidence = citations.slice(0, 3).map((citation, index) => `${index + 1}. ${citation.scenarioName}：${citation.excerpt}`).join("\n");
  const generated = await synthesizeGlobalAnswerWithModel(query, citations, onLlm);
  if (generated) return generated;
  return `针对「${query}」，我同时检索了当前账号可访问的文档证据、关系图谱和知识百科。${grouped}。\n\n可追溯依据：\n${evidence}`;
}

// 018 T2(★ BLOCK#2)：从 classifyQueryWithModel 原内联组装逐字抽出的纯函数。抽取纪律
// (AM-1806)：不传 sourceCards(或传空) 时输出必须与抽取前的内联版本逐字相同——engines 分支/
// 意图标注/JSON 契约一律不变；sourceCards 非空时才在能力卡之后纯拼接追加一段，零增行以外的
// 唯一变化。
export function buildClassifierSystemPrompt(cards: string | null, sourceCards?: string): string {
  const systemLines = [
    "你是企业知识中台的 Agentic RAG 路由器，判断用户问题是否需要检索企业知识库。",
    "【direct】不需检索、直接回答，包括：① 寒暄闲聊、通用生活/职场问题（如「怎么缓解工作压力」）；② 通用常识（天气、日期等）；③ 公开的通用技术/学术概念与方法论（如「什么是向量数据库」「RAG 和微调有什么区别」——行业公开知识，不是本企业产品或内部资料）；④ 通用文本生成（翻译/写诗/写通用模板邮件，如「帮我写一封续约提醒邮件」——只要不需查具体企业的客户/合同/内部数据）。",
    "【retrieve】需要本企业内部资料才能准确回答，即任何指向本企业内部实体的问题。",
    "**特别注意（最易误判）**：企业人物姓名（X是谁/X负责什么/X向谁汇报/X的背景）、本企业产品名（X是什么/X怎么样/X做什么）、投资机构（X投了谁/X和谁合作）、公司名（X总部在哪/X何时成立/X的CFO是谁），即使字面像通用词或通用问法，只要指向本企业内部实体，一律判 retrieve——误走 direct 会让模型编造企业事实。",
    "**区分关键**：通用技术名词/公开概念/通用文书 ≠ 本企业内部实体。问题若是公开知识、闲聊、通用生成，判 direct；只有涉及本企业特定的人/产品/机构/合作/数据时才 retrieve。",
    "判断不确定且问题可能指向本企业内部实体时默认 retrieve；但问题明显是通用知识/闲聊/通用生成时判 direct（不要把公开技术概念或通用文书误当企业实体）。",
    "只返回 JSON：{\"mode\":\"direct|retrieve\",\"reason\":\"简短中文原因\"}。"
    // 路由 prompt 经 DSPy 评测集（60 条含 25 边界例）优化：原 zero-shot 边界 65%→强化后 100%，总 86%→98%（台账 I74 #9）。
  ];
  // P37-T4a 追加：意图 taxonomy 标注 + （仅当能力卡加载成功时）引擎选择。
  systemLines.push(
    `请额外为问题标注一个或多个意图（intents，取自以下六类）：${ROUTE_INTENTS.join("、")}。`
  );
  if (cards) {
    systemLines.push(
      "以下是三条检索引擎的能力卡，判断为 retrieve 时请依据能力卡为问题选择合适的引擎组合（engines，取值须逐字使用 \"Naive RAG\" / \"Gbrain\" / \"GraphRAG\" 之一或多个）：",
      cards
    );
    // P50 T3：修分类器对"实体间关系问题"engines 选择的系统性漏判，只在 engines 选择段追加，不动上面 direct/retrieve mode 判定文本。
    systemLines.push(
      "引擎选择补充：当问题问的是【本企业实体之间的关系】——如「X用的是什么平台/产品」「X为什么选择Y」「X的CFO/CEO是谁」「X主导/负责什么产品」「X投了谁」这类隐式关系问题，engines 必须包含 \"GraphRAG\"（这类问题要靠图谱多跳，不能只给文档引擎）；若只是问某个实体/产品「是什么/怎么样/总体架构/某模块用了什么技术」这类介绍或文档型问题，engines 不含 GraphRAG。但『某人是谁』（如「李明远是谁」「某员工是谁」）这类纯人物身份/介绍题属文档型，engines 不含 GraphRAG；只有明确问『X的CFO/CEO是谁』这种职务—组织关系才含 GraphRAG。"
    );
    systemLines.push(
      "只返回 JSON：{\"mode\":\"direct|retrieve\",\"intents\":[\"...\"],\"engines\":[\"...\"],\"reason\":\"简短中文原因\"}。"
    );
  } else {
    systemLines.push(
      "只返回 JSON：{\"mode\":\"direct|retrieve\",\"intents\":[\"...\"],\"reason\":\"简短中文原因\"}。"
    );
  }
  // 018 T2：源级描述卡——仅当非空才追加，拼在能力卡之后，无卡时零增行(AM-1806 逐字基线)。
  if (sourceCards && sourceCards.trim()) {
    systemLines.push(
      "以下是相关知识库的源级描述卡，可作为判断问题该去哪个知识库检索的补充线索(不改变上面 direct/retrieve 的判断标准)：",
      sourceCards
    );
  }
  return systemLines.join("\n");
}

async function classifyQueryWithModel(
  query: string,
  cards: string | null,
  onLlm?: (info: LlmSpanInfo) => void,
  sourceCards?: string
): Promise<{ mode: "direct" | "retrieve"; intents?: string[]; engines?: AdminRagEngine[]; reason: string } | null> {
  const content = await callAgentChatModel([
    { role: "system", content: buildClassifierSystemPrompt(cards, sourceCards) },
    { role: "user", content: query }
  ], { temperature: 0, maxTokens: 320 }, onLlm);
  if (!content) return null;
  const parsed = parseJsonObject(content);
  if (!parsed) return null;
  const mode = parsed.mode === "retrieve" ? "retrieve" : parsed.mode === "direct" ? "direct" : null;
  if (!mode) return null;
  const intents = Array.isArray(parsed.intents)
    ? parsed.intents.filter((v): v is string => typeof v === "string" && (ROUTE_INTENTS as readonly string[]).includes(v))
    : [];
  const engines = Array.isArray(parsed.engines)
    ? parsed.engines.filter((v): v is AdminRagEngine => v === "Naive RAG" || v === "Gbrain" || v === "GraphRAG")
    : [];
  return {
    mode,
    intents: intents.length ? intents : undefined,
    engines: engines.length ? engines : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason : "模型路由判断"
  };
}

async function generateDirectGlobalReply(
  query: string,
  onLlm?: (info: LlmSpanInfo) => void
) {
  const content = await callAgentChatModel([
    {
      role: "system",
      content: "你是企业知识中台的公司大脑。当前问题被判定为不需要检索知识库，请自然、简洁地直接回答。严禁编造任何企业内部事实（人物职务、产品细节、公司数据、合同、融资等）；若问题其实涉及具体企业专有名词（人名/产品名/公司名/机构名等），不要凭空作答，应说明该问题需要检索企业知识、请对方补充范围或改问，而不是给出确定结论。不要提及已检索资料。"
    },
    { role: "user", content: query }
  ], { temperature: 0.3, maxTokens: 320 }, onLlm);
  if (content) return content;
  if (isSmallTalkQuery(query)) return "你好，我在。你可以直接问业务问题，也可以上传资料后让我结合企业知识分析。";
  return "我在。这个问题不需要检索企业知识库，可以直接继续问；如果需要结合内部资料，请说明具体客户、制度、合同或数据范围。";
}

async function synthesizeGlobalAnswerWithModel(
  query: string,
  citations: GlobalChatCitation[],
  onLlm?: (info: LlmSpanInfo) => void
) {
  if (citations.length === 0) return null;
  const evidence = citations.map((citation, index) => [
    `资料 ${index + 1}`,
    `知识类型：${citation.knowledgeType}`,
    `场景：${citation.scenarioName}`,
    `来源：${citation.sourceOriginalName}`,
    `内容：${citation.excerpt}`
  ].join("\n")).join("\n\n");
  return callAgentChatModel([
    {
      role: "system",
      content: [
        "你是企业知识中台的 Agentic RAG 答案生成器。",
        "只能基于提供的资料依据回答，不要加入资料外的企业事实。",
        "如果依据不足，要明确说明不足，并给出下一步建议。",
        "回答要面向业务用户，避免暴露 RAG、embedding、上下文压缩等技术细节。",
        "输出为简洁业务答案。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `问题：${query}`,
        "资料依据：",
        evidence
      ].filter(Boolean).join("\n\n")
    }
  ], { temperature: 0.2, maxTokens: 900 }, onLlm);
}

// 缺配置预检（与 callAgentChatModel 判定同源）：仅用于零 LLM 调用路径补记 error span。
// local/off 是正常降级，不算缺失。
async function agentConfigMissing(): Promise<boolean> {
  if (process.env.FF_PLATFORM_AGENT_MODE === "local" || process.env.FF_PLATFORM_AGENT_MODE === "off") return false;
  const apiKey = await readAgentEnv("AGENT_API_KEY");
  const baseUrl = await readAgentEnv("AGENT_BASE_URL");
  const model = await readAgentEnv("AGENT_MODEL");
  return !apiKey || !baseUrl || !model;
}

async function callAgentChatModel(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: { temperature: number; maxTokens: number },
  onLlm?: (info: LlmSpanInfo) => void
): Promise<string | null> {
  if (process.env.FF_PLATFORM_AGENT_MODE === "local" || process.env.FF_PLATFORM_AGENT_MODE === "off") return null;
  const apiKey = await readAgentEnv("AGENT_API_KEY");
  const baseUrl = (await readAgentEnv("AGENT_BASE_URL") ?? "").replace(/\/+$/, "");
  const model = await readAgentEnv("AGENT_MODEL");
  if (!apiKey || !baseUrl || !model) {
    onLlm?.({ model: model ?? "未配置", latencyMs: 0, error: "AGENT_* 未配置（需 AGENT_API_KEY/AGENT_BASE_URL/AGENT_MODEL），答案生成降级为模板" });
    return null;
  }
  const timeoutMs = Number(await readAgentEnv("AGENT_TIMEOUT_MS") ?? 25000);
  // 官方直连 DeepSeek；偶发挂起/抖动多次重试，避免在真实证据已召回时回退模板答案。
  const attempts = 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature,
          max_tokens: options.maxTokens
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const body = await response.json().catch(() => null) as any;
      if (!response.ok) {
        if (attempt < attempts - 1) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        onLlm?.({ model, latencyMs: Date.now() - startedAt, error: "answer LLM 调用失败（HTTP 非 200 或空响应，重试耗尽）" });
        return null;
      }
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim()) {
        const usage = body?.usage ?? {};
        onLlm?.({
          model,
          latencyMs: Date.now() - startedAt,
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          promptCacheHitTokens: Number.isFinite(usage.prompt_cache_hit_tokens) && usage.prompt_cache_hit_tokens >= 0 ? usage.prompt_cache_hit_tokens : undefined,
          promptCacheMissTokens: Number.isFinite(usage.prompt_cache_miss_tokens) && usage.prompt_cache_miss_tokens >= 0 ? usage.prompt_cache_miss_tokens : undefined
        });
        return content.trim();
      }
      if (attempt < attempts - 1) { await new Promise((r) => setTimeout(r, 1200)); continue; }
      onLlm?.({ model, latencyMs: Date.now() - startedAt, error: "answer LLM 调用失败（HTTP 非 200 或空响应，重试耗尽）" });
      return null;
    } catch {
      if (attempt < attempts - 1) { await new Promise((r) => setTimeout(r, 1200)); continue; }
      onLlm?.({ model, latencyMs: Date.now() - startedAt, error: "answer LLM 调用异常（网络/超时，重试耗尽）" });
      return null;
    }
  }
  return null;
}

let cachedAgentEnv: Record<string, string> | null = null;

// P37-T4b 测试专用：readAgentEnv/readIntegrationEnv 的磁盘 .env 缓存一旦从真实仓库根 .env
// 命中过一次（含 DASHSCOPE_API_KEY/RERANK_BASE_URL 等真实值），单纯 delete process.env.KEY
// 无法让其"未配置"——缓存会在下一次读取时重新从磁盘文件加载出真实值。测试需要直接控制/清空
// 该缓存，才能确定性模拟"未配置"场景，而不是意外打真实网络请求。传 null 恢复为下次重新读盘。
export function __setIntegrationEnvCacheForTest(overrides: Record<string, string> | null) {
  cachedAgentEnv = overrides;
}

async function readAgentEnv(name: string): Promise<string | undefined> {
  if (process.env[name]) return process.env[name];
  if (!cachedAgentEnv) cachedAgentEnv = await readAgentEnvFile();
  return cachedAgentEnv[name];
}

async function readIntegrationEnv(name: string): Promise<string | undefined> {
  if (process.env[name]) return process.env[name];
  if (!cachedAgentEnv) cachedAgentEnv = await readAgentEnvFile();
  return cachedAgentEnv[name];
}

async function readAgentEnvFile(): Promise<Record<string, string>> {
  const candidates = [
    join(process.cwd(), ".env"),
    join(process.cwd(), "..", "..", ".env")
  ];
  for (const filePath of candidates) {
    try {
      const raw = await readFile(filePath, "utf8");
      return parseEnvFile(raw);
    } catch {
      // Continue to the next likely project root.
    }
  }
  return {};
}

function parseEnvFile(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function globalCitationExcerpt(item: StoredKnowledgeObject) {
  const indexedText = item.moduleReferences
    ?.map((reference) => reference.metadata?.indexedText)
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return scenarioCitationExcerpt(indexedText ?? item.content, 260);
}

// ===== 026 · PII 脱敏(FR-580~585)=====
// 红线:脱敏是展示层动作——库内 content 原文保真(检索/回溯需要原文),只在出口 sanitizeKnowledgeExcerpt 尾接遮蔽。
// 默认 on(FF_PII_MASK 不设=遮);FF_PII_MASK_KINDS 缩集(未设=四类全开,显式空=全不遮);参数 enabledKinds 优先于 env。
export type PiiKind = "id-card" | "phone" | "bank-card" | "email";
export type PiiHint = { kind: PiiKind; count: number };
const ALLOWED_PII_KINDS: PiiKind[] = ["id-card", "phone", "bank-card", "email"];

// 检测顺序即消费顺序:id-card(18 位含生日段)先于 bank-card 遮,防 3-6 开头的纯数字身份证被重复计为银行卡;
// bank-card 限首位 3-6(卡 BIN 段),2 开头的订单号/时间戳类长数字不误标;手机/银行卡两侧数字环视防嵌入长数字串误触。
const PII_PATTERNS: Array<{ kind: PiiKind; pattern: RegExp; mask: (hit: string) => string }> = [
  {
    kind: "id-card",
    pattern: /(?<!\d)\d{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\dXx])/g,
    mask: (hit) => hit.slice(0, 3) + "*".repeat(13) + hit.slice(16)
  },
  {
    kind: "bank-card",
    pattern: /(?<!\d)[3-6]\d{12,18}(?!\d)/g,
    mask: (hit) => hit.slice(0, 4) + "*".repeat(hit.length - 8) + hit.slice(-4)
  },
  {
    kind: "phone",
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    mask: (hit) => hit.slice(0, 3) + "****" + hit.slice(7)
  },
  {
    kind: "email",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    mask: (hit) => {
      const at = hit.indexOf("@");
      return hit[0] + "*".repeat(Math.max(1, at - 1)) + hit.slice(at);
    }
  }
];

// 逐类渐进遮蔽计数:前一类命中先遮掉,后一类不会对同一串重复计数(id/bank 重叠形状由顺序消解)。
export function detectPii(text: string): PiiHint[] {
  if (!text) return [];
  let current = text;
  const hits: PiiHint[] = [];
  for (const { kind, pattern, mask } of PII_PATTERNS) {
    let count = 0;
    current = current.replace(pattern, (hit) => {
      count += 1;
      return mask(hit);
    });
    if (count > 0) hits.push({ kind, count });
  }
  return hits;
}

export function maskPii(text: string, enabledKinds?: PiiKind[]): string {
  if (!text) return text;
  if ((process.env.FF_PII_MASK ?? "on").toLowerCase() === "off") return text;
  const envKinds = process.env.FF_PII_MASK_KINDS;
  const kinds = enabledKinds ?? (envKinds === undefined ? null : parseMaskKindsEnv(envKinds));
  if (kinds !== null && kinds.length === 0) return text; // 显式空集=全不遮(区别于未设=全开)
  let current = text;
  for (const { kind, pattern, mask } of PII_PATTERNS) {
    if (kinds !== null && !kinds.includes(kind)) continue;
    current = current.replace(pattern, mask);
  }
  return current;
}

// 026 必修3:FF_PII_MASK_KINDS 拼错(如 "phones")解析后是非空但四类全不匹配的"未知集合"——
// 若原样透传会让 maskPii 的 kinds.includes(kind) 恒 false = 全不遮,拼写错误静默关闭默认保护。
// fail-closed:全部 token 都是未知值 → 回退 null(=未设=全类遮蔽)；混合有效/未知值只丢弃未知部分，保留有效子集。
// 大小写/首尾空白不敏感（人工敲 env 值容错）。
function parseMaskKindsEnv(raw: string): PiiKind[] | null {
  const tokens = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (tokens.length === 0) return []; // 显式空集(如 "" 或纯逗号)=全不遮，语义不变
  const valid: PiiKind[] = [];
  const unknown: string[] = [];
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if ((ALLOWED_PII_KINDS as string[]).includes(normalized)) valid.push(normalized as PiiKind);
    else unknown.push(token);
  }
  if (unknown.length > 0) {
    console.warn(`[maskPii] FF_PII_MASK_KINDS 含未知取值(${unknown.join(",")}),已忽略;允许值:${ALLOWED_PII_KINDS.join("/")}`);
  }
  if (valid.length === 0) return null; // 全部未知 → fail-closed 回退全类遮蔽
  return valid;
}

const PII_KIND_LABELS: Record<PiiKind, string> = {
  "id-card": "身份证号",
  phone: "手机号",
  "bank-card": "银行卡号",
  email: "邮箱"
};

export function piiHintsNoticeText(hints: PiiHint[]): string {
  return "含 " + hints.map((h) => h.count + " 处" + PII_KIND_LABELS[h.kind]).join("、") + ",展示已脱敏";
}

// FR-582 检测注入缝:ingest 侧检测(旁路)可注入抛错替身;maskPii/detectPii 导出面不受影响。
let detectPiiOverride: ((text: string) => PiiHint[]) | null = null;
export function __setDetectPiiForTest(fn: ((text: string) => PiiHint[]) | null) {
  detectPiiOverride = fn;
}
function detectPiiForIngest(text: string): PiiHint[] {
  return (detectPiiOverride ?? detectPii)(text);
}

// 026 · FR-585:入库清洗核心——库内 content 原文保真,只清格式**不遮 PII**(检索/回溯要能对上原件)。
// 出口遮蔽在 sanitizeKnowledgeExcerpt;parse/入库路径只许用本函数,禁止复用出口函数(否则库内被改写=违反红线)。
function sanitizeKnowledgeContentForStore(value: string) {
  const afterContent = extractKnowledgeContentPayload(value);
  const readablePdfText = extractPdfReadableText(afterContent);
  const candidate = readablePdfText || afterContent;
  const cleaned = containsRawParserPayload(candidate)
    ? stripRawParserPayload(candidate)
    : cleanKnowledgeDisplayText(candidate);
  if (!cleaned || cleaned.length < 12 || containsRawParserPayload(cleaned)) {
    return "该资料已入库，但当前可展示的文本片段不足，请在后台查看原始文件或解析结果。";
  }
  return formatStructuredExcerpt(cleaned);
}

export function sanitizeKnowledgeExcerpt(value: string) {
  // 026 · FR-583:出口最后一道遮蔽(唯一 choke point,多处展示消费者共享;开关在 maskPii 内部按 env 决定)。
  return maskPii(sanitizeKnowledgeContentForStore(value));
}

function scenarioCitationExcerpt(value: string, maxLength: number) {
  return excerpt(sanitizeKnowledgeExcerpt(value), maxLength);
}

function extractKnowledgeContentPayload(value: string) {
  const match = value.match(/内容[:：]([\s\S]*)/u);
  return match ? match[1] : value;
}

function cleanKnowledgeDisplayText(value: string) {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatStructuredExcerpt(value: string) {
  const table = formatDelimitedTableExcerpt(value);
  return table ?? value.replace(/\s+/g, " ").trim();
}

function formatDelimitedTableExcerpt(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const separator = lines[0].includes("\t") ? "\t" : ",";
  if (!lines[0].includes(separator)) return null;
  const headers = splitDelimitedLine(lines[0], separator).map(cleanCellText).filter(Boolean);
  if (headers.length < 2) return null;
  const rows = lines.slice(1, 4)
    .map((line) => splitDelimitedLine(line, separator).map(cleanCellText))
    .filter((row) => row.length >= 2);
  if (rows.length === 0) return null;
  return rows.map((row) => headers.slice(0, 5)
    .map((header, index) => row[index] ? `${header}：${row[index]}` : "")
    .filter(Boolean)
    .join("，"))
    .join("；");
}

function splitDelimitedLine(line: string, separator: "," | "\t") {
  if (separator === "\t") return line.split("\t");
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function cleanCellText(value: string) {
  return value.replace(/^["'“”]+|["'“”]+$/g, "").replace(/\s+/g, " ").trim();
}

function containsRawParserPayload(value: string) {
  return /%PDF|%%EOF|\bendobj\b|\b\d+\s+\d+\s+obj\b|\/(?:Type|Catalog|Pages|Page|Parent|MediaBox|Resources|Contents|Font|Subtype|Length|Filter)/i.test(value);
}

function extractPdfReadableText(value: string) {
  const matches = Array.from(value.matchAll(/\(([^()]{6,})\)\s*Tj/gi))
    .map((match) => decodePdfLiteralText(match[1]))
    .filter(Boolean);
  return matches.join(" ");
}

function decodePdfLiteralText(value: string) {
  return value
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .trim();
}

function stripRawParserPayload(value: string) {
  return value
    .replace(/%PDF-[^\s。！？\n]*/gi, " ")
    .replace(/%%EOF|\bxref\b|\bstartxref\b|\btrailer\b|\bstream\b|\bendstream\b/gi, " ")
    .replace(/\b\d+\s+\d+\s+obj\b|\bendobj\b/gi, " ")
    .replace(/<<[\s\S]*?>>/g, " ")
    .replace(/\/[A-Za-z0-9#_.-]+/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .replace(/[<>{}[\]]/g, " ")
    .replace(/\b0{4,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEngineSummary(citations: GlobalChatCitation[]) {
  const tracks = buildGlobalRetrievalTracks(citations).filter((track) => track.count > 0);
  return tracks.map((track) => `${track.label} ${track.count} 条`).join("，") || "没有命中可引用知识";
}

function chatTitleFromQuery(query: string) {
  return excerpt(query.replace(/\s+/g, " ").trim(), 28) || "新的全域问答";
}

function globalScopeLabel(scope: GlobalChatScope) {
  if (scope === "private") return "个人资料";
  if (scope === "team") return "团队知识";
  return "全公司知识";
}

function storeKnowledgeTypeLabel(engine: AdminRagEngine): GlobalChatCitation["knowledgeType"] {
  if (engine === "Naive RAG") return "文档证据";
  if (engine === "GraphRAG") return "关系图谱";
  return "知识百科";
}

function canAccess(user: StoreUser, accessControl: StoredAccessControl) {
  if (!hasValidCallerIdentity(user)) return false;
  if (user.role === "admin") return true;
  if (accessControl.scope === "private") return accessControl.ownerUserId === user.userId;

  const userOrganizationId = user.organizationId?.trim();
  if (!userOrganizationId) return false;
  const userTeamIds = normalizeTeamIds(user.teamIds);
  if (accessControl.scope === "team" && userTeamIds.length === 0) return false;
  if (accessControl.ownerUserId === user.userId) return true;
  if (accessControl.organizationId !== userOrganizationId) return false;
  if (accessControl.scope === "company") return true;

  return accessControl.teamIds.some((teamId) => userTeamIds.includes(teamId));
}

function hasValidCallerIdentity(user: StoreUser | null | undefined): boolean {
  return Boolean(user?.userId?.trim());
}

function hasExplicitOrganization(user: StoreUser | null | undefined): boolean {
  return Boolean(user?.organizationId?.trim());
}

function hasExplicitTeam(user: StoreUser | null | undefined): boolean {
  return normalizeTeamIds(user?.teamIds).length > 0;
}

function isValidAdminCaller(user: StoreUser): boolean {
  return user.role === "admin" && hasValidCallerIdentity(user);
}

function accessControlFor(scope: StoreVisibility, owner: StoreUser): StoredAccessControl {
  return {
    scope,
    ownerUserId: owner.userId,
    ownerName: owner.name,
    organizationId: normalizeOrganizationId(owner.organizationId),
    teamIds: normalizeTeamIds(owner.teamIds)
  };
}

function accessControlFromScenario(scenario: StoredScenario): StoredAccessControl {
  return normalizeAccessControl(scenario.accessControl, {
    scope: scenario.visibility,
    ownerUserId: scenario.ownerUserId,
    ownerName: scenario.ownerName,
    organizationId: scenario.organizationId,
    teamIds: scenario.teamIds
  });
}

function accessControlFromKnowledgeObject(item: StoredKnowledgeObject): StoredAccessControl {
  return normalizeAccessControl(item.accessControl, {
    scope: item.visibility,
    ownerUserId: item.ownerUserId,
    ownerName: item.ownerName,
    organizationId: item.organizationId,
    teamIds: item.teamIds
  });
}

function normalizeAccessControl(
  accessControl: StoredAccessControl | undefined,
  fallback: {
    scope: StoreVisibility;
    ownerUserId: string;
    ownerName: string;
    organizationId?: string;
    teamIds?: string[];
  }
): StoredAccessControl {
  return {
    scope: accessControl?.scope ?? fallback.scope,
    ownerUserId: accessControl?.ownerUserId ?? fallback.ownerUserId,
    ownerName: accessControl?.ownerName ?? fallback.ownerName,
    organizationId: normalizeOrganizationId(accessControl?.organizationId ?? fallback.organizationId),
    teamIds: normalizeTeamIds(accessControl?.teamIds ?? fallback.teamIds)
  };
}

function normalizeOrganizationId(value?: string) {
  return value?.trim() || "org_companybrain";
}

function normalizeTeamIds(value?: string[]) {
  return Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean)));
}

function dataRoot() {
  return process.env.FF_PLATFORM_DATA_DIR || join(process.cwd(), ".platform-data");
}

async function readDb(): Promise<PlatformDb> {
  // P12 T1b-1：从 PG 重组回 PlatformDb。空库（表存在但无行）自然得到 emptyDb 等价；
  // 连接失败/表未迁移则抛出（真实基础设施错误应暴露，不静默返回空丢数据）。
  // T1b-1 不做进程内缓存（correctness-first，每次 readDb 反映最新 PG 状态）；缓存/逐行读优化留 T1b-2。
  const loaded = await loadDbFromPg();
  return normalizeDb({ ...emptyDb(), ...loaded });
}

async function writeDb(db: PlatformDb) {
  // P12 T1b-1：整库拆解写入 PG（事务、整表覆盖，语义等同旧整 JSON 覆盖写；配合 withDbLock 串行）。
  const normalized = normalizeDb(db);
  await saveDbToPg(normalized);
}

// #7 持久化临界区串行 mutex：把"重读最新 db → 改 → writeDb"串行化，
// 避免并发 read-modify-write 因 writeDb 整库覆盖而互相丢数据（检索/LLM 仍在锁外并发）。
let dbLockChain: Promise<unknown> = Promise.resolve();
function withDbLock<T>(fn: () => Promise<T>): Promise<T> {
  const p = dbLockChain.then(() => fn());
  dbLockChain = p.then(() => undefined, () => undefined);
  return p;
}

function normalizeDb(db: PlatformDb): PlatformDb {
  return {
    ...emptyDb(),
    ...db,
    templates: mergeAdminTemplates(db.templates ?? []),
    auditEvents: db.auditEvents ?? [],
    traces: db.traces ?? [],
    runtimeConfig: db.runtimeConfig ?? {},
    // 022b：防 load 后 undefined（PG-CONTRACT §二）。
    ingestQueue: db.ingestQueue ?? [],
    // 024：同 022b 先例，防 load 后 undefined（PG-CONTRACT §二，readDb 依赖此兜底）。
    notifications: db.notifications ?? []
  };
}

function serviceStatus(status?: AdminServiceHealthStatus): "ok" | "error" | "unknown" {
  if (!status) return "unknown";
  return status === "healthy" ? "ok" : "error";
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function secretState(...envNames: string[]) {
  const configuredEnv = envNames.find((envName) => Boolean(envValue(envName)));
  const envName = configuredEnv ?? envNames[0] ?? "UNKNOWN_SECRET";
  const value = configuredEnv ? envValue(configuredEnv) : null;
  return {
    env_name: envName,
    configured: Boolean(value),
    fingerprint: value ? secretFingerprint(value) : null
  };
}

function secretFingerprint(value: string) {
  if (value.length <= 8) return "已配置";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function databaseState(id: string, label: string, envName: string): AdminIntegrationSettings["databases"][number] {
  const value = envValue(envName);
  if (!value) {
    return { id, label, env_name: envName, configured: false, host: null, port: null, database: null, username: null };
  }

  try {
    const url = new URL(value);
    return {
      id,
      label,
      env_name: envName,
      configured: true,
      host: url.hostname || null,
      port: url.port || null,
      database: url.pathname.replace(/^\/+/, "") || null,
      username: url.username || null
    };
  } catch {
    return { id, label, env_name: envName, configured: true, host: "自定义连接串", port: null, database: null, username: null };
  }
}

function sanitizeStrategyParameters(input?: AdminStrategyParameters): AdminStrategyParameters {
  if (!input || typeof input !== "object") return {};
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key.trim(), String(value ?? "").trim()] as const)
      .filter(([key, value]) => key && value)
  );
}

function appendAuditEvent(
  db: PlatformDb,
  user: StoreUser,
  input: { area: string; summary: string; impact: string }
) {
  const now = new Date().toISOString();
  db.auditEvents = [
    {
      id: `audit_${randomUUID()}`,
      actor: user.name,
      area: input.area,
      // 026 · FR-584:审计文案不裸出 PII(含 PII 的场景名/文案经 maskPii;跟 FF_PII_MASK 开关一致)。
      summary: maskPii(input.summary),
      impact: maskPii(input.impact),
      time: displayRelativeTime(now),
      createdAt: now
    },
    ...(db.auditEvents ?? [])
  ].slice(0, 500);
}

function activeAdminTemplates(templates: StoredAdminTemplate[]) {
  return mergeAdminTemplates(templates).filter((template) => template.state !== "archived");
}

function adminTemplateForScenario(db: PlatformDb, templateId: string): StoredAdminTemplate {
  return activeAdminTemplates(db.templates).find((template) => template.id === templateId) ?? customAdminTemplateFallback(templateId);
}

function customAdminTemplateFallback(templateId: string): StoredAdminTemplate {
  const now = new Date().toISOString();
  return {
    id: templateId || "custom-scenario",
    name: templateId === "custom-scenario" ? "自建业务场景" : "自定义业务场景",
    category: "自定义",
    state: "custom",
    source: "custom",
    owner: "场景创建者",
    headline: "用户提交资料和业务目标后，由后台选择合适的真实 RAG 入库策略。",
    acceptedFiles: ["PDF", "Word", "Markdown", "表格资料", "图片", "音视频"],
    inputExamples: ["业务说明", "资料文件", "数据表格"],
    outputCapabilities: ["可追问答案", "引用依据", "业务成品"],
    productForm: ["hybrid", "task_workflow"],
    reviewRequirement: "需要管理员确认",
    evidenceSources: ["用户自建"],
    evidenceCoverage: 50,
    demoReadiness: 20,
    canEdit: false,
    canDelete: false,
    createdAt: now,
    updatedAt: now
  };
}

function mergeAdminTemplates(existing: StoredAdminTemplate[]) {
  const existingById = new Map(existing.map((item) => [item.id, normalizeAdminTemplate(item)]));
  const official = officialTemplates.map((template) => {
    const seeded = officialAdminTemplate(template);
    const stored = existingById.get(template.id);
    return {
      ...seeded,
      state: stored?.source === "official" ? stored.state : seeded.state,
      owner: stored?.owner || seeded.owner,
      reviewRequirement: stored?.reviewRequirement || seeded.reviewRequirement,
      evidenceSources: stored?.evidenceSources?.length ? stored.evidenceSources : seeded.evidenceSources,
      updatedAt: stored?.updatedAt || seeded.updatedAt,
      canDelete: false
    };
  });
  const officialIds = new Set(official.map((item) => item.id));
  const custom = existing
    .map(normalizeAdminTemplate)
    .filter((item) => item.source === "custom" && !officialIds.has(item.id) && item.state !== "archived");
  return [...official, ...custom];
}

function officialAdminTemplate(template: ScenarioTemplate): StoredAdminTemplate {
  const ready = template.demoWalkthrough.sampleInputs.length >= 2 && template.demoWalkthrough.citations.length >= 2;
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    state: "official",
    source: "official",
    owner: ownerForTemplate(template.id),
    headline: template.headline,
    acceptedFiles: template.acceptedFiles,
    inputExamples: template.inputExamples,
    outputCapabilities: template.outputCapabilities,
    productForm: template.productForm,
    reviewRequirement: template.reviewRequirement,
    evidenceSources: template.evidenceSources,
    evidenceCoverage: template.evidenceLevel === "validated" ? 100 : 60,
    demoReadiness: ready ? 100 : 55,
    canEdit: true,
    canDelete: false,
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z"
  };
}

function normalizeAdminTemplate(template: StoredAdminTemplate): StoredAdminTemplate {
  return {
    ...template,
    state: template.state ?? (template.source === "official" ? "official" : "candidate"),
    source: template.source ?? "custom",
    acceptedFiles: cleanStringArray(template.acceptedFiles, ["PDF", "Word", "Markdown", "表格资料"]),
    inputExamples: cleanStringArray(template.inputExamples, ["业务说明", "资料文件"]),
    outputCapabilities: cleanStringArray(template.outputCapabilities, ["可追问答案", "引用依据"]),
    productForm: cleanProductForms(template.productForm),
    reviewRequirement: cleanReviewRequirement(template.reviewRequirement),
    evidenceSources: cleanStringArray(template.evidenceSources, ["管理员创建"]),
    evidenceCoverage: Number.isFinite(template.evidenceCoverage) ? template.evidenceCoverage : 50,
    demoReadiness: Number.isFinite(template.demoReadiness) ? template.demoReadiness : 30,
    canEdit: true,
    canDelete: template.source === "custom"
  };
}

function ownerForTemplate(id: string) {
  if (id.includes("customer") || id.includes("rfp") || id.includes("voice")) return "销售运营";
  if (id.includes("support")) return "客户成功";
  if (id.includes("risk") || id.includes("domain")) return "风控";
  if (id.includes("contract")) return "法务";
  if (id.includes("policy")) return "人力行政";
  if (id.includes("data")) return "数据运营";
  if (id.includes("runbook")) return "运维负责人";
  return "知识运营";
}

function uniqueTemplateId(templates: StoredAdminTemplate[], seed: string) {
  const base = slugify(seed) || `template-${Date.now()}`;
  const used = new Set(templates.map((item) => item.id));
  if (!used.has(base)) return base;
  for (let index = 2; index < 200; index += 1) {
    const next = `${base}-${index}`;
    if (!used.has(next)) return next;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function slugify(value: string) {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (/^[a-z0-9-]+$/.test(ascii)) return ascii;
  return `template-${Array.from(value).map((char) => char.charCodeAt(0).toString(36)).join("-").slice(0, 60)}`;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringArray(value: unknown, fallback: string[]) {
  const items = Array.isArray(value) ? value : [];
  const cleaned = items.map((item) => String(item ?? "").trim()).filter(Boolean);
  return Array.from(new Set(cleaned.length ? cleaned : fallback));
}

function cleanProductForms(value: unknown): TemplateProductForm[] {
  const allowed: TemplateProductForm[] = ["chat", "embedded_assistant", "knowledge_portal", "document_review", "report_generator", "graph_explorer", "task_workflow", "hybrid"];
  const items = Array.isArray(value) ? value : [];
  const cleaned = items.filter((item): item is TemplateProductForm => allowed.includes(item as TemplateProductForm));
  return cleaned.length ? Array.from(new Set(cleaned)) : ["hybrid", "task_workflow"];
}

function cleanReviewRequirement(value: unknown): ScenarioTemplate["reviewRequirement"] {
  if (value === "无需管理员确认" || value === "需要管理员确认" || value === "建议管理员确认") return value;
  return "需要管理员确认";
}

function stripInternalTask(task: StoreTask): ProcessingTask {
  const { ownerUserId: _ownerUserId, createdAt: _createdAt, updatedAtIso: _updatedAtIso, ...publicTask } = task;
  return publicTask;
}

function toDisplayTask(task: StoreTask): StoreTask {
  return {
    ...task,
    submittedAt: displayRelativeTime(task.createdAt),
    updatedAt: displayRelativeTime(task.updatedAtIso ?? task.createdAt)
  };
}

function toAdminIntakeRequest(task: StoreTask, db: PlatformDb): StoredAdminIntakeRequest {
  const scenario = db.scenarios.find((item) => item.id === task.scenarioId);
  const files = db.files.filter((item) => item.scenarioId === task.scenarioId).map(normalizeFileRecord);
  const parsedArtifacts = db.parsedArtifacts.filter((item) => item.scenarioId === task.scenarioId);
  const knowledgeObjects = db.knowledgeObjects.filter((item) => item.scenarioId === task.scenarioId);
  return {
    id: `request_${task.id}`,
    scenarioId: task.scenarioId,
    scenarioName: scenario?.name ?? task.title.replace(/^创建/, ""),
    requester: scenario?.ownerName ?? task.owner,
    visibility: visibilityText(scenario?.visibility ?? task.visibility),
    submittedAt: displayRelativeTime(task.createdAt),
    status: adminStatusForTask(task.status),
    files: files.map((file) => file.originalName),
    storedFiles: files,
    requestedOutcome: scenario?.processingGoal ?? task.userMessage,
    recommendedModes: recommendedModesForTemplate(task.ragMode, scenario?.templateId ?? "custom-scenario"),
    recommendedEngines: recommendedEnginesForTemplate(task.ragMode, scenario?.templateId ?? "custom-scenario"),
    selectedMode: task.status === "submitted" || task.status === "waiting_review" ? "待选择" : task.ragMode,
    selectedEngine: task.status === "submitted" || task.status === "waiting_review" ? "待选择" : adminEngineForRagMode(task.ragMode),
    frontstageMapping: frontstageMappingForEngines(recommendedEnginesForTemplate(task.ragMode, scenario?.templateId ?? "custom-scenario")),
    permissionImpact: permissionImpactForVisibility(scenario?.visibility ?? task.visibility),
    strategyParameters: task.strategyParameters ?? {},
    parsedArtifactCount: parsedArtifacts.length,
    knowledgeObjectCount: knowledgeObjects.length,
    actions: adminActionsForTask(task.status),
    createdAt: task.createdAt
  };
}

function buildAssetDetailsForKnowledgeObject(
  item: StoredKnowledgeObject,
  scenario: StoredScenario | undefined,
  file: StoredFileRecord | undefined,
  artifact: StoredParsedArtifact | undefined
): StoredKnowledgeAssetDetail[] {
  const scenarioName = scenario?.name ?? "未关联场景";
  const sourceOriginalName = file?.originalName ?? item.sourceOriginalName;
  const accessControl = accessControlFromKnowledgeObject(item);
  const common = {
    engine: item.ragEngine,
    sourceOriginalName,
    scenarioName,
    scenarioId: item.scenarioId,
    descriptionCard: scenario?.descriptionCard,
    visibility: item.visibility,
    visibilityLabel: visibilityText(item.visibility),
    ownerName: item.ownerName,
    createdAt: item.createdAt,
    metadata: [
      { label: "来源文件", value: sourceOriginalName },
      { label: "业务场景", value: scenarioName },
      { label: "权限范围", value: accessControlLabel(accessControl) },
      { label: "负责人", value: item.ownerName },
      { label: "知识对象", value: item.id },
      { label: "解析产物", value: artifact?.id ?? item.artifactId },
      { label: "入库时间", value: displayRelativeTime(item.createdAt) },
      // 026 · FR-584:场景检出 PII 时后台详情可见(展示层已脱敏的提示文案)。
      ...(scenario?.piiHints?.length ? [{ label: "PII 检测", value: piiHintsNoticeText(scenario.piiHints) }] : [])
    ]
  };

  if (item.ragEngine === "Naive RAG") {
    const chunkLength = Math.max(1, item.content.length);
    return [
      {
        ...common,
        id: `chunk_${item.id}`,
        kind: "chunk",
        title: `文档切片 · ${sourceOriginalName}`,
        metric: `约 ${chunkLength} 字`,
        status: "已切片",
        content: sanitizeKnowledgeExcerpt(item.content)
      },
      {
        ...common,
        id: `embedding_${item.id}`,
        kind: "embedding",
        title: `向量索引 · ${sourceOriginalName}`,
        metric: "1 个向量记录",
        status: "已索引",
        content: `已将「${sourceOriginalName}」对应切片写入 Naive RAG 向量索引，可用于相似度召回、TopK 排序和引用回填。`,
        metadata: [
          ...common.metadata,
          { label: "索引类型", value: "向量索引" },
          { label: "默认用途", value: "语义召回 / 引用排序" }
        ]
      },
      {
        ...common,
        id: `citation_${item.id}`,
        kind: "citation",
        title: `引用证据 · ${sourceOriginalName}`,
        metric: "1 条引用来源",
        status: "可引用",
        content: `回答生成时可回填来源「${sourceOriginalName}」：${scenarioCitationExcerpt(item.content, 220)}`,
        metadata: [
          ...common.metadata,
          { label: "引用边界", value: "仅在权限命中的场景中可召回" }
        ]
      },
      {
        ...common,
        id: `eval_${item.id}`,
        kind: "eval",
        title: `试问结果 · ${scenarioName}`,
        metric: "1 组试问",
        status: "已通过",
        content: `试问：这批资料能回答什么？\n预期：围绕「${scenarioName}」返回带来源依据的业务答案，并明确无法覆盖的问题边界。`,
        metadata: [
          ...common.metadata,
          { label: "验证目标", value: "答案相关性 / 引用可追踪 / 无依据拒答" }
        ]
      }
    ];
  }

  if (item.ragEngine === "GraphRAG") {
    return [
      {
        ...common,
        id: `entity_${item.id}`,
        kind: "entity",
        title: `实体表 · ${scenarioName}`,
        metric: "实体抽取结果",
        status: "已抽取",
        content: `从「${sourceOriginalName}」抽取业务实体，用于关系召回和图谱问答。\n${scenarioCitationExcerpt(item.content, 240)}`
      },
      {
        ...common,
        id: `relationship_${item.id}`,
        kind: "relationship",
        title: `关系边 · ${scenarioName}`,
        metric: "关系候选",
        status: "已构建",
        content: `围绕场景「${scenarioName}」建立实体、事件和证据之间的关系边。`
      },
      {
        ...common,
        id: `graph_${item.id}`,
        kind: "graph",
        title: `知识图谱 · ${scenarioName}`,
        metric: "图谱视图",
        status: "可查看",
        content: `图谱已发布到后台资产台账，可用于多跳推理、客户画像和风险归因。`
      },
      {
        ...common,
        id: `review_${item.id}`,
        kind: "review",
        title: `关系复核 · ${scenarioName}`,
        metric: "复核队列",
        status: "待抽检",
        content: `建议抽检高影响实体、关系方向和跨文档证据，避免错误关系进入前台业务场景。`
      }
    ];
  }

  return [
    {
      ...common,
      id: `wiki_${item.id}`,
      kind: "wiki",
      title: `知识页 · ${scenarioName}`,
      metric: "页面资产",
      status: "已发布",
      content: sanitizeKnowledgeExcerpt(item.content)
    },
    {
      ...common,
      id: `fact_${item.id}`,
      kind: "fact",
      title: `事实卡 · ${sourceOriginalName}`,
      metric: "事实摘录",
      status: "已生成",
      content: `可被知识页和问答共同引用的事实摘要：${scenarioCitationExcerpt(item.content, 220)}`
    },
    {
      ...common,
      id: `link_${item.id}`,
      kind: "link",
      title: `互链目录 · ${scenarioName}`,
      metric: "目录关系",
      status: "已建立",
      content: `根据场景、来源和知识页生成目录互链，帮助前台用户在答案与知识页之间跳转。`
    },
    {
      ...common,
      id: `source_${item.id}`,
      kind: "source",
      title: `来源目录 · ${sourceOriginalName}`,
      metric: "来源登记",
      status: "已登记",
      content: `来源文件、解析产物和知识对象已经进入资产台账，可按权限范围追踪。`
    }
  ];
}

function emptyAdminDashboardSnapshot(): AdminDashboardSnapshot {
  return {
    requests: { total: 0, pending: 0, processing: 0, published: 0, rejected: 0 },
    assets: { total: 0, gbrain: 0, naive: 0, graph: 0 },
    healthCards: [],
    dataOverview: []
  };
}

async function defaultCheckAdminModuleHealth(engine: AdminRagEngine): Promise<AdminServiceHealth> {
  try {
    const response = await fetch(`${moduleBaseUrl(engine)}/health`, {
      signal: AbortSignal.timeout(1800)
    });
    const body = await response.json().catch(() => ({}));
    const rawStatus = String(body.status ?? "").toLowerCase();
    const service = String(body.service ?? engine);
    if (!response.ok) {
      return { id: engine, status: "down", detail: `${service} 健康检查失败：HTTP ${response.status}` };
    }
    const status: AdminServiceHealthStatus = rawStatus === "ok" || rawStatus === "healthy" ? "healthy" : "degraded";
    return {
      id: engine,
      status,
      detail: status === "healthy" ? `${service} 服务可用` : `${service} 返回状态：${rawStatus || "unknown"}`
    };
  } catch (error) {
    return {
      id: engine,
      status: "down",
      detail: error instanceof Error ? error.message : "服务健康检查不可用"
    };
  }
}

function buildAdminDataOverview(assets: StoredKnowledgeAssetDetail[]): AdminDashboardSnapshot["dataOverview"] {
  const scopes: AdminDashboardSnapshot["dataOverview"] = [
    {
      scope: "个人",
      total: 0,
      unit: "条资产",
      module: "个人知识空间",
      owner: "创建者",
      policy: "仅创建者和管理员可读，不进入团队或公司级召回。",
      health: "healthy"
    },
    {
      scope: "团队",
      total: 0,
      unit: "条资产",
      module: "团队知识空间",
      owner: "团队负责人",
      policy: "仅同团队成员可读，由平台代理模块 private source 权限。",
      health: "healthy"
    },
    {
      scope: "公司",
      total: 0,
      unit: "条资产",
      module: "公司大脑",
      owner: "管理员",
      policy: "发布后可被全局问答召回，需要管理员确认资料和入库策略。",
      health: "healthy"
    }
  ];
  for (const asset of assets) {
    const target = scopes.find((scope) => scope.scope === asset.visibilityLabel);
    if (target) target.total += 1;
  }
  return scopes.map((scope) => ({
    ...scope,
    health: scope.total === 0 ? "degraded" : "healthy"
  }));
}

function healthValue(status: AdminServiceHealthStatus) {
  if (status === "healthy") return "可用";
  if (status === "degraded") return "需复核";
  return "不可用";
}

function engineHealthRoute(engine: AdminRagEngine) {
  if (engine === "Gbrain") return "/admin/knowledge-bases/gbrain";
  if (engine === "Naive RAG") return "/admin/knowledge-bases/naive";
  return "/admin/knowledge-bases/graph"; // GraphRAG 管理统一指向图谱治理(P18)，与导航/子导航一致
}

function accessControlLabel(accessControl: StoredAccessControl) {
  const scope = visibilityText(accessControl.scope);
  if (accessControl.scope === "team") {
    return `${scope} · ${accessControl.teamIds.join("、") || "未分配团队"}`;
  }
  if (accessControl.scope === "company") {
    return `${scope} · ${accessControl.organizationId}`;
  }
  return `${scope} · ${accessControl.ownerName}`;
}

function excerpt(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function relevanceScore(query: string, item: StoredKnowledgeObject) {
  const haystack = `${item.title}\n${item.sourceOriginalName}\n${item.content}`.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  let score = haystack.includes(normalizedQuery) ? 8 : 0;
  for (const token of queryTokens(normalizedQuery)) {
    if (haystack.includes(token)) score += Math.max(1, Math.min(6, token.length));
  }
  if (haystack.includes(item.sourceOriginalName.toLowerCase())) score += 1;
  return score;
}

function queryTokens(query: string) {
  const rough = query
    .replace(/[？?，,。；;：:、（）()【】\[\]{}"'“”‘’]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  if (rough.length > 0) return Array.from(new Set(rough));
  const compact = query.replace(/\s+/g, "");
  const tokens: string[] = [];
  for (let size = 2; size <= Math.min(6, compact.length); size += 1) {
    for (let index = 0; index <= compact.length - size; index += 1) {
      tokens.push(compact.slice(index, index + size));
    }
  }
  return Array.from(new Set(tokens));
}

function buildScenarioAnswerText(scenarioName: string, query: string, engine: AdminRagEngine, evidence: string) {
  const label = storeKnowledgeTypeLabel(engine);
  const focus = engine === "GraphRAG"
    ? "本轮重点查看实体、关系、事件和证据链之间的连接。"
    : engine === "Naive RAG"
      ? "本轮重点查看原文片段、制度条款和可引用证据。"
      : "本轮重点查看沉淀后的知识页、事实卡和可复用结论。";
  const insight = excerpt(sanitizeKnowledgeExcerpt(evidence), 260);
  return `针对「${scenarioName}」中的问题「${query}」，我已从${label}中命中可引用依据。${focus}核心线索：${insight}\n\n引用来源已在右侧依据面板按类型整理。`;
}

// P38 B · 加法 MVP · R3 硬红线：独立于解析器的、基于原始字节的保守文本分类（PKP/specs/
//   P38-入库多引擎Naive兜底改造-执行spec.md §四 v9）。四闸全过才判定"可建 Naive 副本"，任一不过即拒绝。
//   ⚠️ 判据只吃 rawBytes + file.originalName 扩展名，绝不采信 file.mimeType（客户端可伪造），
//   也绝不用解析器输出 content（会被"表格文件："/"JSON 数据："等兜底文案污染）。
//   保证范围（务实边界，非绝对格式分类）与豁免边缘见 spec §四「R3 保证范围」。
const NAIVE_ELIGIBLE_EXTENSIONS = new Set(["md", "markdown", "txt"]);
const NAIVE_NUMERIC_CELL_PATTERN = /^\s*-?[\d.,%eE+]+\s*$/;
const NAIVE_NATURAL_LANG_CHAR_PATTERN = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}a-zA-Z]/u;
const NAIVE_MIN_CONTENT_LENGTH = 20;
const NAIVE_TABLE_MIN_ROWS = 3;
const NAIVE_TABLE_MIN_COLS = 2;
const NAIVE_TABLE_NUMERIC_RATIO = 0.6;
const NAIVE_MIN_NATURAL_LANG_RATIO = 0.3;

function isNaiveEligibleText(file: StoredFileRecord, rawBytes: Uint8Array): boolean {
  // ① 严格 UTF-8 闸：非法字节即拒绝（不用替换字符兜底）——封住图片/音视频/归档/二进制。
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
  } catch {
    return false;
  }

  // ② 扩展名 allowlist 闸：保守起步，只放 .md/.markdown/.txt。
  if (!NAIVE_ELIGIBLE_EXTENSIONS.has(extensionForFile(file.originalName))) return false;

  // ③ 内容结构探测闸：封"结构化/表格内容伪装成 .md/.txt"——JSON/CSV 无可靠魔数，必须探内容。
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return false; // 合法 JSON → 拒绝。
    } catch {
      // 不是合法 JSON，继续走下方探测（不能仅凭花括号/方括号开头就误拒真实 Markdown）。
    }
  }
  if (isNaiveTabularContent(text, ",") || isNaiveTabularContent(text, "\t")) return false;

  const chars = Array.from(text);
  const nonWhitespaceChars = chars.filter((ch) => !/\s/u.test(ch));
  const naturalLangChars = nonWhitespaceChars.filter((ch) => NAIVE_NATURAL_LANG_CHAR_PATTERN.test(ch));
  const naturalLangRatio = nonWhitespaceChars.length > 0 ? naturalLangChars.length / nonWhitespaceChars.length : 0;
  if (naturalLangRatio < NAIVE_MIN_NATURAL_LANG_RATIO) return false;

  // ④ 非空正文闸：去空白后长度须达最小阈值（封空 .md/纯空白/"未抽取到正文"类）。
  if (nonWhitespaceChars.length < NAIVE_MIN_CONTENT_LENGTH) return false;

  return true;
}

// CSV/TSV 数值表格探测：≥3 行、按 delimiter 分割列数一致且 ≥2 列、且数值型单元格占比 ≥60% → 判定为表格。
//   "数值型单元格"正则不匹配空字符串，空单元格天然只计入分母、不计入分子（"空单元格计入分母"）。
function isNaiveTabularContent(text: string, delimiter: string): boolean {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
  if (lines.length < NAIVE_TABLE_MIN_ROWS) return false;
  const rows = lines.map((line) => line.split(delimiter));
  const columnCount = rows[0].length;
  if (columnCount < NAIVE_TABLE_MIN_COLS) return false;
  if (!rows.every((row) => row.length === columnCount)) return false;
  const cells = rows.flat();
  const numericCells = cells.filter((cell) => NAIVE_NUMERIC_CELL_PATTERN.test(cell));
  return numericCells.length / cells.length >= NAIVE_TABLE_NUMERIC_RATIO;
}

// 单测导出：验证 isNaiveEligibleText 只依赖 rawBytes + file.originalName 扩展名，
//   与 file.mimeType / 解析器 content 输出无关（与 spec §四契约一致）。
export function __isNaiveEligibleTextForTest(file: StoredFileRecord, rawBytes: Uint8Array): boolean {
  return isNaiveEligibleText(file, rawBytes);
}

async function ingestScenarioSources(
  db: PlatformDb,
  scenario: StoredScenario,
  selectedMode: RagEngine,
  selectedEngine: AdminRagEngine,
  now: string,
  approver: StoreUser,
  strategyParameters?: AdminStrategyParameters
): Promise<{
  sourceIds: string[];
  piiHints?: PiiHint[];
  naiveReplicaStats: { created: number; skipped: number; failed: number };
  nextArtifacts: StoredParsedArtifact[];
  nextKnowledgeObjects: StoredKnowledgeObject[];
  nextModuleReferences: StoredModuleReference[];
  updatedFiles: StoredFileRecord[];
  // 024 · FR-552②（★ codex BLOCK#2）：partial M/N 真值——declaredN=本次声明入库的文件数，
  // succeededM=主引擎入库成功的篇数（不含 Naive 兜底副本），failedM=declaredN-succeededM。
  // 调用方(executeIngestQueueJob)据此判定 ready(M==N)/partial(0<M<N) 通知文案，禁用
  // naiveReplicaStats(那是副本失败数，非主入库 M/N)。
  declaredN: number;
  succeededM: number;
  failedM: number;
}> {
  const scenarioFiles = db.files
    .map((file, index) => ({ file: normalizeFileRecord(file), index }))
    .filter(({ file }) => file.scenarioId === scenario.id);
  const previousKnowledgeIds = new Set(db.knowledgeObjects.filter((item) => item.scenarioId === scenario.id).map((item) => item.id));
  const previousArtifactIds = new Set(db.parsedArtifacts.filter((item) => item.scenarioId === scenario.id).map((item) => item.id));
  const previousModuleReferenceIds = new Set((db.moduleReferences ?? []).filter((item) => item.scenarioId === scenario.id).map((item) => item.id));
  db.parsedArtifacts = db.parsedArtifacts.filter((item) => !previousArtifactIds.has(item.id));
  db.knowledgeObjects = db.knowledgeObjects.filter((item) => !previousKnowledgeIds.has(item.id));
  db.moduleReferences = (db.moduleReferences ?? []).filter((item) => !previousModuleReferenceIds.has(item.id));

  const nextArtifacts: StoredParsedArtifact[] = [];
  const nextKnowledgeObjects: StoredKnowledgeObject[] = [];
  const nextModuleReferences: StoredModuleReference[] = [];
  const accessControl = accessControlFromScenario(scenario);
  // P43 Q6:Naive 文档证据副本可观测计数——created=成功建副本 / skipped=GraphRAG 文件但资格闸不过
  //   （非白名单/结构探针/过短，else 分支）/ failed=进入副本分支后任一步（读原文件 readStoredFileBytes /
  //   资格通过后入库 ingestNaiveRagFile）抛错——读失败同样是"副本没建成的错误",记 failed 比 skipped 诚实
  //   （skipped 专指"看过内容、判定不合资格"的主动跳过）。仅 GraphRAG 主引擎进副本分支,其它引擎三项恒为
  //   0（TC-A8「副本数为 0 且不误导」）。
  let naiveReplicaCreated = 0;
  let naiveReplicaSkipped = 0;
  let naiveReplicaFailed = 0;
  // 024 · FR-552②：主引擎入库成功篇数(不含 Naive 兜底副本)，declaredN=scenarioFiles.length。
  let succeededM = 0;

  for (const { file, index } of scenarioFiles) {
    const artifactId = `artifact_${randomUUID()}`;
    const knowledgeObjectId = `ko_${randomUUID()}`;
    const content = await readSourceContent(file);

    // #4 非原子容错：单篇入库失败（embedding 超时 / graph 建图超时等）不阻断其它篇，
    // 已成功篇照常在循环后落盘；失败篇跳过并记录，保持文件记录可重传。
    let realIngest: { reference: StoredModuleReference } | null = null;
    if (shouldUseRealRagModules()) {
      try {
        realIngest = await ingestFileThroughRealRagModule({
          scenario,
          file,
          content,
          selectedEngine,
          accessControl,
          approver,
          now,
          strategyParameters
        });
      } catch (error) {
        console.error(
          `[ingestScenarioSources] 单篇入库失败，跳过（engine=${selectedEngine}, file=${file.originalName}）`,
          error
        );
        continue;
      }
    }
    const artifact: StoredParsedArtifact = {
      id: artifactId,
      scenarioId: scenario.id,
      sourceFileId: file.id,
      title: file.originalName,
      kind: artifactKindForFile(file),
      content,
      visibility: scenario.visibility,
      ownerUserId: scenario.ownerUserId,
      ownerName: scenario.ownerName,
      organizationId: accessControl.organizationId,
      teamIds: accessControl.teamIds,
      accessControl,
      ragMode: selectedMode,
      ragEngine: selectedEngine,
      createdAt: now
    };
    const knowledgeObject: StoredKnowledgeObject = {
      id: knowledgeObjectId,
      scenarioId: scenario.id,
      sourceFileId: file.id,
      artifactId,
      title: `${scenario.name} · ${file.originalName}`,
      kind: knowledgeKindForEngine(selectedEngine),
      content: buildKnowledgeContent(scenario, file, content, selectedEngine),
      visibility: scenario.visibility,
      ownerUserId: scenario.ownerUserId,
      ownerName: scenario.ownerName,
      organizationId: accessControl.organizationId,
      teamIds: accessControl.teamIds,
      accessControl,
      ragMode: selectedMode,
      ragEngine: selectedEngine,
      sourceOriginalName: file.originalName,
      moduleReferences: realIngest ? [realIngest.reference] : [],
      createdAt: now
    };

    nextArtifacts.push(artifact);
    nextKnowledgeObjects.push(knowledgeObject);
    if (realIngest) nextModuleReferences.push(realIngest.reference);
    succeededM += 1; // 024：走到这里(未在上方 continue 跳过)= 该篇主引擎入库成功。

    // P38 B · 加法 MVP：主引擎之外，给自然语言文本类文件额外建一份 Naive 副本兜底全局问答召回
    //   （PKP/specs/P38-入库多引擎Naive兜底改造-执行spec.md §四）。只加不改：独立 try/catch，
    //   任一步失败只 log 跳过，绝不影响上面主引擎 artifact/KO 的落盘；必须跑在下方原文件 rm 之前
    //   （ingestNaiveRagFile 内部按 file.relativePath 读原始字节，原件已删必失败）。
    // P40 §三【0】收窄：Naive 兜底只补 GraphRAG 的路由可达性缺口（全域问答按路由 engines 遍历，
    //   路由漏判就漏该库数据）——Gbrain 本身自带向量语义召回，再建 Naive 副本是纯冗余（同内容
    //   embedding 两次、召回两次、UI 计数膨胀），故只对 GraphRAG 建。
    let naiveArtifactId: string | undefined;
    let naiveKoId: string | undefined;
    if (shouldUseRealRagModules() && selectedEngine === "GraphRAG") {
      try {
        const rawBytes = await readStoredFileBytes(file);
        if (isNaiveEligibleText(file, rawBytes)) {
          const naiveIngest = await ingestNaiveRagFile({
            scenario,
            file,
            content,
            accessControl,
            approver,
            now,
            strategyParameters,
            selectedEngine: "Naive RAG"
          });
          naiveArtifactId = `artifact_${randomUUID()}`;
          naiveKoId = `ko_${randomUUID()}`;
          const naiveArtifact: StoredParsedArtifact = {
            id: naiveArtifactId,
            scenarioId: scenario.id,
            sourceFileId: file.id,
            title: file.originalName,
            kind: artifactKindForFile(file),
            content,
            visibility: scenario.visibility,
            ownerUserId: scenario.ownerUserId,
            ownerName: scenario.ownerName,
            organizationId: accessControl.organizationId,
            teamIds: accessControl.teamIds,
            accessControl,
            ragMode: selectedMode,
            ragEngine: "Naive RAG",
            createdAt: now
          };
          const naiveKnowledgeObject: StoredKnowledgeObject = {
            id: naiveKoId,
            scenarioId: scenario.id,
            sourceFileId: file.id,
            artifactId: naiveArtifactId,
            title: `${scenario.name} · ${file.originalName}`,
            kind: knowledgeKindForEngine("Naive RAG"),
            content: buildKnowledgeContent(scenario, file, content, "Naive RAG"),
            visibility: scenario.visibility,
            ownerUserId: scenario.ownerUserId,
            ownerName: scenario.ownerName,
            organizationId: accessControl.organizationId,
            teamIds: accessControl.teamIds,
            accessControl,
            ragMode: selectedMode,
            ragEngine: "Naive RAG",
            sourceOriginalName: file.originalName,
            moduleReferences: [naiveIngest.reference],
            createdAt: now
          };
          nextArtifacts.push(naiveArtifact);
          nextKnowledgeObjects.push(naiveKnowledgeObject);
          nextModuleReferences.push(naiveIngest.reference);
          naiveReplicaCreated += 1;
        } else {
          // 非白名单/结构探针拒绝（PDF·纯数值表·JSON·过短），如实计入跳过（第四节排除项：不夸大兜底范围）。
          naiveReplicaSkipped += 1;
        }
      } catch (error) {
        console.error(
          `[ingestScenarioSources] Naive 兜底副本入库失败，跳过（file=${file.originalName}）`,
          error
        );
        naiveArtifactId = undefined;
        naiveKoId = undefined;
        naiveReplicaFailed += 1;
      }
    }

    const policy = retentionPolicyForFile(file.originalName, file.mimeType);
    if (policy === "delete_after_ingest") {
      await rm(join(dataRoot(), file.relativePath), { force: true });
    }

    db.files[index] = {
      ...file,
      originalState: policy === "retain_source" ? "retained" : "deleted",
      originalAvailable: policy === "retain_source",
      retentionPolicy: policy,
      retentionReason: retentionReasonForPolicy(policy),
      accessControl,
      deletedAt: policy === "delete_after_ingest" ? now : undefined,
      parsedArtifactIds: naiveArtifactId ? [artifactId, naiveArtifactId] : [artifactId],
      knowledgeObjectIds: naiveKoId ? [knowledgeObjectId, naiveKoId] : [knowledgeObjectId]
    };
  }

  // #4 全失败不假发布（codex 审）：启用真实模块且有文件但零成功入库时抛错，
  // 让 decideAdminIntakeRequest 审批失败，而非把 task/scenario 标 ready 却无任何知识引用。
  if (shouldUseRealRagModules() && scenarioFiles.length > 0 && nextModuleReferences.length === 0) {
    throw new Error(`场景「${scenario.name}」全部 ${scenarioFiles.length} 篇入库失败，未产生任何知识引用`);
  }
  db.parsedArtifacts.unshift(...nextArtifacts);
  db.knowledgeObjects.unshift(...nextKnowledgeObjects);
  db.moduleReferences.unshift(...nextModuleReferences);
  // 026 · FR-582:入库旁路 PII 检测——逐文档 detect 汇总场景级 piiHints;检测抛错不阻断入库
  // (fail-open 旁路,与存储事实源失败须 fail-loud 分界)。
  let ingestPiiHints: PiiHint[] | undefined;
  try {
    const piiTotals = new Map<PiiKind, number>();
    for (const a of nextArtifacts) {
      for (const hit of detectPiiForIngest(a.content)) {
        piiTotals.set(hit.kind, (piiTotals.get(hit.kind) ?? 0) + hit.count);
      }
    }
    ingestPiiHints = piiTotals.size ? [...piiTotals.entries()].map(([kind, count]) => ({ kind, count })) : undefined;
  } catch (error) {
    console.error("[ingestScenarioSources] PII 检测失败,旁路跳过(不阻断入库)", error);
    ingestPiiHints = undefined;
  }
  // P35 Phase2 Round-5 收敛:requestedGranularity 提前到 triggerGbrainAutoLink 调用之前算好——主题聚合是
  //   opt-in best-effort 后置步骤,不能为它把入库变长阻塞:非主题请求下 auto_link 保持纯 fire-and-forget
  //   (不再同步等它跑完);仅当请求主题粒度时,才给"auto_link 等锁释放 + theme_compile 触发确认"这条链路
  //   一个共享总时限(FF_THEME_AGGREGATE_TIMEOUT_MS,默认 90s)。超时或持续撞锁 → 不再干等,文件保留为
  //   document-ready(本就完全可用),如实记审计 theme_deferred,不假装聚合成功。
  const requestedGranularity = GBRAIN_PAGE_GRANULARITY[strategyParameters?.page_granularity ?? ""] ?? "document";
  const themeDeadlineAt = requestedGranularity === "theme" ? Date.now() + resolveThemeAggregateTimeoutMs() : null;
  const deferredSourceIds = await triggerGbrainAutoLink(db, scenario, selectedEngine, approver, nextModuleReferences, requestedGranularity, themeDeadlineAt);
  // Round-4 修复⑦(codex 复审):主题粒度下若本批有文件入库失败（#4 非原子容错允许成功子集继续），
  //   缺成员的主题页会被误记"完成"——只在本批全部拿到已确认 document reference 后才触发聚合；
  //   否则保留成功文件为文档级（诚实状态，不假装齐），如实记审计。
  if (
    shouldUseRealRagModules() &&
    selectedEngine === "Gbrain" &&
    requestedGranularity === "theme" &&
    scenarioFiles.length > 0 &&
    nextModuleReferences.length < scenarioFiles.length
  ) {
    appendAuditEvent(db, approver, {
      area: "处理管线",
      summary: "主题级聚合未执行（编译未齐）",
      impact: `场景「${scenario.name}」${scenarioFiles.length} 篇中仅 ${nextModuleReferences.length} 篇入库成功，保留为文档级，不触发主题聚合`
    });
  } else {
    await triggerGbrainThemeCompile(db, scenario, selectedEngine, approver, nextModuleReferences, requestedGranularity, themeDeadlineAt, deferredSourceIds);
  }
  const sourceIds = Array.from(new Set(nextModuleReferences.map((ref) => ref.sourceId).filter(Boolean)));
  return {
    sourceIds,
    piiHints: ingestPiiHints,
    naiveReplicaStats: { created: naiveReplicaCreated, skipped: naiveReplicaSkipped, failed: naiveReplicaFailed },
    // 022b：暴露本次 ingest 产出的新记录 + 更新后的 file 记录，供调用方（executeIngestQueueJob）
    // 在终态提交时 replay 到最新 db 快照——ingest 本身在锁外跑（慢操作不占锁），传入的 db 快照
    // 在其执行期间可能已过期，不能直接把这份旧快照整体写回（会丢掉期间其它并发写入）。
    nextArtifacts,
    nextKnowledgeObjects,
    nextModuleReferences,
    updatedFiles: db.files.filter((f) => f.scenarioId === scenario.id),
    // 024 · FR-552②：全失败(succeededM===0 且 scenarioFiles.length>0)已被上方 #4 全失败抛错
    // 拦截，走不到这里；此处 declaredN/succeededM/failedM 覆盖 ready(M==N)/partial(0<M<N) 两分支。
    declaredN: scenarioFiles.length,
    succeededM,
    failedM: scenarioFiles.length - succeededM
  };
}

// P35 Phase2 Round-5 收敛:主题聚合是 opt-in 的 best-effort 后置步骤——不能为它把入库变长阻塞,也不能假成功。
//   给"auto_link 等锁释放 + theme_compile 触发确认"这条链路一个共享总时限(单个来源一份预算,同一 source 的
//   auto_link 等待与 theme_compile 触发共享同一个 deadline,总耗时天然被这一个环境变量卡住,不会出现
//   "每阶段各等 90s,合计翻倍"的放大)。
// Round-6 收尾(codex 复审)：env 值未校验会破坏"有界"性——负数/0/NaN/Infinity 都会让 deadline 失去
//   约束意义(NaN 使所有 >= 比较恒为 false 从而死循环重试；负数/0 让 deadline 一开始就在过去)。
//   只接受有限正数，任何非法值一律回退默认 90000。
function resolveThemeAggregateTimeoutMs(): number {
  // codex Round-7：上限封顶，防病理值（如 Number.MAX_VALUE）令 Date.now()+timeout 溢出为 Infinity → 无限重试。
  const THEME_AGGREGATE_TIMEOUT_MAX_MS = 600000; // 10min，远大于 90s 默认
  const raw = Number(process.env.FF_THEME_AGGREGATE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, THEME_AGGREGATE_TIMEOUT_MAX_MS) : 90000;
}

// 有界地反复尝试拿 dream run 锁:POST 撞锁(run.status==='skipped')就退避后重试,直到抢到锁或到 deadline 为止。
//   到 deadline 仍抢不到锁 → 返回 null(调用方按 lock_contention 处理,不再干等)。
// Round-6 收尾:循环入口先判 deadline 是否已过,已过直接返回 null,不再多发一次徒劳的 POST
//   (此前只在收到 skipped 响应后才检查 deadline,deadline 已过时仍会先打一次请求)。
// 导出仅为单测直接构造"deadline 已过"场景做确定性验证(避免真实链路里毫秒级时序竞争导致的测试不稳定)，
//   非公开 API，不供 platform-store 之外的业务代码调用。
export async function acquireDreamRunBeforeDeadline(
  engine: AdminRagEngine,
  writer: StoreUser,
  target: unknown,
  phases: string[],
  deadlineAt: number
): Promise<{ id: string; status: string } | null> {
  while (true) {
    if (Date.now() >= deadlineAt) return null;
    const res = await moduleJson<{ run: { id: string; status: string } }>(engine, "/nano/dream/runs", {
      method: "POST",
      user: writer,
      body: { target, phases }
    });
    if (res.run?.status !== "skipped") return res.run;
    if (Date.now() >= deadlineAt) return null;
    await sleep(Math.max(0, Math.min(3000, deadlineAt - Date.now())));
    if (Date.now() >= deadlineAt) return null;
  }
}

// 有界轮询 dream run 到终态;到 deadline 仍未到终态 → 不抛错,返回 timedOut=true(调用方按诚实降级处理,
//   既不当成失败也不当成成功)。run 级 status='failed' 仍视为硬错误抛出(与既有 pollNanoDreamRun 语义一致)。
// Round-6 收尾:while (Date.now() < deadlineAt) 已经保证 deadline 已过时不再多发 GET,此处保持不变。
// 导出理由同 acquireDreamRunBeforeDeadline:仅供单测确定性验证，非公开 API。
export async function pollNanoDreamRunBeforeDeadline(
  user: StoreUser,
  runId: string,
  deadlineAt: number
): Promise<{ run: any; timedOut: boolean }> {
  let lastRun: any = null;
  while (Date.now() < deadlineAt) {
    const body = await moduleJson<{ run: any }>("Gbrain", `/nano/dream/runs/${encodeURIComponent(runId)}`, {
      method: "GET",
      user
    });
    lastRun = body.run;
    if (["clean", "ok", "partial", "skipped"].includes(lastRun.status)) return { run: lastRun, timedOut: false };
    if (lastRun.status === "failed") throw new Error(`Gbrain 编译失败：${JSON.stringify(lastRun)}`);
    if (Date.now() >= deadlineAt) break;
    await sleep(Math.max(0, Math.min(1500, deadlineAt - Date.now())));
  }
  return { run: lastRun, timedOut: true };
}

// P20：GBrain 入库后触发一次 auto_link（按成功 reference 的 sourceId 去重，循环后触发而非每篇触发，
// 避免同一 source 内 N 次全量重扫）。异步非阻断：触发失败/异常只告警，绝不回滚已落盘的入库结果。
// P35 Phase2 Round-5 收敛(STILL-OPEN #3 + 新问题 15min 阻塞):此前(Round-4 修复③)不分粒度一律同步 poll
//   到终态(FF_NANO_DREAM_TIMEOUT_MS 默认 15min)——这把"主题聚合链路的锁等待"泛化成了"每一次 GBrain 入库
//   都可能被 auto_link 拖住 15 分钟"，违反"不能为它(主题聚合)把入库变长阻塞"的设计原则。改为按请求粒度分流:
//     - 非主题请求(文档级,占绝大多数入库):auto_link 是纯后置 best-effort 关联，只负责把它启动起来，
//       不等它跑完(回到 pre-Round4 的 fire-and-forget)。
//     - 主题请求:theme_compile 依赖 auto_link 先释放锁——给"抢锁 + 等完成"一个有界总预算(themeDeadlineAt，
//       由调用方按 FF_THEME_AGGREGATE_TIMEOUT_MS 算好传入)，超时/持续撞锁只记 theme_deferred 审计 + 跳过，
//       不假装、不再干等。
//   返回本轮在 auto_link 阶段就被判定 deferred(锁竞争/超时/异常)的 sourceId 集合，供 triggerGbrainThemeCompile
//   跳过这些注定拿不到锁的 source，不再发起徒劳的 theme_compile 请求。
async function triggerGbrainAutoLink(
  db: PlatformDb,
  scenario: StoredScenario,
  selectedEngine: AdminRagEngine,
  approver: StoreUser,
  nextModuleReferences: StoredModuleReference[],
  requestedGranularity: "document" | "theme",
  themeDeadlineAt: number | null
): Promise<Set<string>> {
  const deferredSourceIds = new Set<string>();
  if (selectedEngine !== "Gbrain") return deferredSourceIds;

  const gbrainSourceIds = Array.from(
    new Set(
      nextModuleReferences
        .filter((r) => r.engine === "Gbrain" && r.sourceId)
        .map((r) => r.sourceId)
    )
  );

  if (gbrainSourceIds.length === 0) return deferredSourceIds;

  const kind = sourceKindForScenario(scenario);
  const ownerUserId = scenario.ownerUserId;
  const writer: StoreUser = { ...approver, role: "admin" };

  for (const sourceId of gbrainSourceIds) {
    const target =
      kind === "public"
        ? { type: "public_source", source_id: sourceId }
        : { type: "user_source", source_id: sourceId, user_id: ownerUserId };

    try {
      if (requestedGranularity !== "theme" || themeDeadlineAt === null) {
        // 非主题请求：auto_link 不阻塞审批——启动后即返回，不等完成态。撞锁只做一次轻量重试
        // （只为把它启动起来，不是为了等它跑完），仍撞锁则记审计跳过，不升级为长阻塞等待。
        let res = await moduleJson<{ run: { status: string; id: string } }>(
          "Gbrain",
          "/nano/dream/runs",
          { method: "POST", user: writer, body: { target, phases: ["auto_link"] } }
        );

        if (res.run?.status === "skipped") {
          await sleep(3000);
          const retry = await moduleJson<{ run: { status: string; id: string } }>(
            "Gbrain",
            "/nano/dream/runs",
            { method: "POST", user: writer, body: { target, phases: ["auto_link"] } }
          ).catch(() => null);

          if (!retry || retry.run?.status === "skipped") {
            console.warn(
              `[triggerGbrainAutoLink] auto_link skipped after retry for sourceId=${sourceId}`
            );
            appendAuditEvent(db, approver, {
              area: "处理管线",
              summary: "自动关联排队跳过（并发，重试仍占用）",
              impact: `source=${sourceId}`,
            });
          }
        }
        continue;
      }

      // 主题请求：theme_compile 需等 auto_link 先释放锁——有界重试抢锁 + 有界等待完成，共享总预算 themeDeadlineAt。
      const run = await acquireDreamRunBeforeDeadline("Gbrain", writer, target, ["auto_link"], themeDeadlineAt);
      if (!run) {
        deferredSourceIds.add(sourceId);
        console.warn(`[triggerGbrainAutoLink] auto_link 持续撞锁,主题聚合延迟 sourceId=${sourceId}`);
        appendAuditEvent(db, approver, {
          area: "处理管线",
          summary: "主题级聚合延迟（theme_deferred：自动关联持续撞锁）",
          impact: `source=${sourceId}，原因=lock_contention，文件保留为可用文档级页，可后续重触发主题聚合`,
        });
        continue;
      }

      const { timedOut } = await pollNanoDreamRunBeforeDeadline(writer, run.id, themeDeadlineAt);
      if (timedOut) {
        deferredSourceIds.add(sourceId);
        console.warn(`[triggerGbrainAutoLink] auto_link 未在时限内完成,主题聚合延迟 sourceId=${sourceId}`);
        appendAuditEvent(db, approver, {
          area: "处理管线",
          summary: "主题级聚合延迟（theme_deferred：自动关联未在时限内完成）",
          impact: `source=${sourceId}，原因=timeout，文件保留为可用文档级页，可后续重触发主题聚合`,
        });
      }
    } catch (error) {
      // 非阻断：入库已成功，自动关联失败仅告警，不回滚入库。
      // codex Phase4.5 nit：失败也落一条审计，便于线上排障（否则只有 console 日志）。
      // 保持 await 触发（非 void fire-and-forget）：确保本 appendAuditEvent 在 ingestScenarioSources
      // 返回前执行，能被上游 decideAdminIntakeRequest 的 writeDb 一并落盘，否则审计丢失。
      console.error(
        `[triggerGbrainAutoLink] auto_link failed for sourceId=${sourceId}`,
        error
      );
      appendAuditEvent(db, approver, {
        area: "处理管线",
        summary: "自动关联触发失败",
        impact: `source=${sourceId}`,
      });
      if (requestedGranularity === "theme") deferredSourceIds.add(sourceId);
    }
  }
  return deferredSourceIds;
}

// P35 Phase2:GBrain 入库 granularity=theme 时，文档级编译 + auto_link 后再触发一次 theme_compile 相位
//   （聚类策略：一个 source = 一个主题簇，把该 source 全部 source_entry 页熔成 1 个 theme_entry）。
//   真产出 theme_entry → 把该 source 下每篇 Gbrain reference 的 metadata.granularity 升为 'theme' +
//   记 theme_page 关联（reference 仍指 source_entry 页，不改 per-file 归属）。
//   单篇 singleton / LLM 网关不可用 / 锁竞争超时 → 无 theme_entry → 诚实退化为文档级（granularity 保持
//   'document'，不假装有主题页）。
//   异步非阻断：触发失败/异常只告警，绝不回滚已落盘入库结果（同 triggerGbrainAutoLink）。
async function triggerGbrainThemeCompile(
  db: PlatformDb,
  scenario: StoredScenario,
  selectedEngine: AdminRagEngine,
  approver: StoreUser,
  nextModuleReferences: StoredModuleReference[],
  requestedGranularity: "document" | "theme",
  themeDeadlineAt: number | null,
  deferredSourceIds: Set<string>
): Promise<void> {
  if (selectedEngine !== "Gbrain") return;
  if (requestedGranularity !== "theme") return;
  if (themeDeadlineAt === null) return; // 理论不可达：theme 请求下调用方（ingestScenarioSources）必传 deadline。

  const gbrainRefs = nextModuleReferences.filter((r) => r.engine === "Gbrain" && r.sourceId);
  const gbrainSourceIds = Array.from(new Set(gbrainRefs.map((r) => r.sourceId)));
  if (gbrainSourceIds.length === 0) return;

  const kind = sourceKindForScenario(scenario);
  const ownerUserId = scenario.ownerUserId;
  const writer: StoreUser = { ...approver, role: "admin" };

  for (const sourceId of gbrainSourceIds) {
    // Round-5 收敛(STILL-OPEN #3):auto_link 阶段已在共享总预算内判定 lock_contention/timeout 并记过
    //   theme_deferred 审计——该 source 大概率仍占着锁，这里不再发起注定徒劳的 theme_compile 请求。
    if (deferredSourceIds.has(sourceId)) continue;

    try {
      const target =
        kind === "public"
          ? { type: "public_source", source_id: sourceId }
          : { type: "user_source", source_id: sourceId, user_id: ownerUserId };

      // 锁竞争：该 source 有 dream 在跑（如 auto_link 未释放）→ 有界重试抢锁，共享 themeDeadlineAt 剩余预算。
      const run = await acquireDreamRunBeforeDeadline("Gbrain", writer, target, ["theme_compile"], themeDeadlineAt);
      if (!run) {
        appendAuditEvent(db, approver, {
          area: "处理管线",
          summary: "主题级聚合延迟（theme_deferred：主题合成持续撞锁）",
          impact: `source=${sourceId}，原因=lock_contention，文件保留为可用文档级页，可后续重触发主题聚合`,
        });
        continue;
      }

      const { run: finalRun, timedOut } = await pollNanoDreamRunBeforeDeadline(writer, run.id, themeDeadlineAt);
      if (timedOut) {
        appendAuditEvent(db, approver, {
          area: "处理管线",
          summary: "主题级聚合延迟（theme_deferred：主题合成未在时限内完成）",
          impact: `source=${sourceId}，原因=timeout，文件保留为可用文档级页，可后续重触发主题聚合`,
        });
        continue;
      }

      const sourceRefs = gbrainRefs.filter((r) => r.sourceId === sourceId);

      // Round-4 修复②(codex 复审最关键 bug，假成功):此前只查"该 source 下是否存在任意 theme_entry 页"——
      //   历史批次遗留的旧主题页也会命中，把本次跳过/失败误标成"完成"。改为读 dream report 的 theme_compile
      //   phase 结果，只有 status='ok' 且 details.themePageId 存在才算本次真成功；再校验融合成员数
      //   ≥ 本批 Gbrain 引用数（否则疑似命中的是成员不全的旧融合结果，不升级）。
      const phases: Array<{ phase?: string; status?: string; details?: Record<string, unknown> }> =
        Array.isArray((finalRun as any)?.phases) ? (finalRun as any).phases : [];
      const themePhase = phases.find((p) => p.phase === "theme_compile");
      const themePageIdFromPhase =
        themePhase?.status === "ok" && typeof themePhase.details?.themePageId === "string"
          ? (themePhase.details.themePageId as string)
          : null;
      const themeMemberCount = typeof themePhase?.details?.memberCount === "number" ? (themePhase.details.memberCount as number) : null;
      // Round-5 收敛(必修3):memberCount 缺失时此前当"覆盖满足"放行——保守改为缺失即不升级（未知覆盖度不可当已验证）。
      const coverageOk = themeMemberCount !== null && themeMemberCount >= sourceRefs.length;

      if (themePageIdFromPhase && coverageOk) {
        // 取该 source 的聚合浏览页详情（slug/title 用于关联，不再靠"任意 theme_entry"匹配，靠 phase 给的 id）。
        const pages =
          (
            await moduleJson<{ pages: Array<{ id: string; slug: string; title: string; entry_kind?: string }> }>(
              "Gbrain",
              `/nano/sources/${encodeURIComponent(sourceId)}/pages`,
              { method: "GET", user: writer }
            )
          ).pages ?? [];
        const themePage = pages.find((p) => p.id === themePageIdFromPhase);
        if (themePage) {
          // 真产出主题页：升级该 source 全部 reference 为 theme 粒度 + 记 theme_page 关联（不改 source_entry 归属）。
          for (const ref of sourceRefs) {
            ref.metadata.granularity = "theme";
            ref.metadata.theme_page = { id: themePage.id, slug: themePage.slug, title: themePage.title };
            delete ref.metadata.granularity_requested;
          }
          appendAuditEvent(db, approver, {
            area: "处理管线",
            summary: "主题级聚合完成（生成聚合浏览页）",
            impact: `source=${sourceId}，theme_page=${themePage.id}，成员=${sourceRefs.length} 篇（融合 ${themeMemberCount ?? "?"} 篇）`,
          });
        } else {
          // phase 报告成功但页面查无（异常态）→ 诚实退化，不假装。
          appendAuditEvent(db, approver, {
            area: "处理管线",
            summary: "主题级聚合跳过（phase 成功但页面未找到，退化为文档级）",
            impact: `source=${sourceId}，run=${finalRun?.status ?? "unknown"}，成员=${sourceRefs.length} 篇`,
          });
        }
      } else {
        // 未真正成功（单篇 singleton 跳过 / 网关不可用 / memberCount 缺失 / 融合成员不全）→ 诚实退化为文档级。
        const reason = !themePageIdFromPhase
          ? `theme_compile phase 未成功(status=${themePhase?.status ?? "missing"})`
          : themeMemberCount === null
            ? "theme_compile phase 未报告 memberCount，保守不升级"
            : `融合成员数(${themeMemberCount})少于本批引用数(${sourceRefs.length})，疑似旧融合结果`;
        appendAuditEvent(db, approver, {
          area: "处理管线",
          summary: "主题级聚合跳过（退化为文档级）",
          impact: `source=${sourceId}，run=${finalRun?.status ?? "unknown"}，${reason}，成员=${sourceRefs.length} 篇`,
        });
      }
    } catch (error) {
      // 非阻断：入库已成功，theme_compile 失败仅告警，不回滚入库。
      console.error(`[triggerGbrainThemeCompile] theme_compile failed for sourceId=${sourceId}`, error);
      appendAuditEvent(db, approver, {
        area: "处理管线",
        summary: "主题级聚合触发失败",
        impact: `source=${sourceId}`,
      });
    }
  }
}

async function ingestFileThroughRealRagModule(input: {
  scenario: StoredScenario;
  file: StoredFileRecord;
  content: string;
  selectedEngine: AdminRagEngine;
  accessControl: StoredAccessControl;
  approver: StoreUser;
  now: string;
  strategyParameters?: AdminStrategyParameters;
}): Promise<{ reference: StoredModuleReference }> {
  if (input.selectedEngine === "Gbrain") {
    return ingestGbrainFile(input);
  }
  if (input.selectedEngine === "Naive RAG") {
    return ingestNaiveRagFile(input);
  }
  return ingestGraphRagFile(input);
}

// 幂等确保场景级 source 存在（I87 根治）：先按 name 查已有，无则创建；创建撞 409 duplicate_source 再兜底重查。
// 覆盖 (a) 同场景多文件第 2+ 篇同名建 source、(b) re-approve/重试时 source 已存在 两种 409 情形。泛型 S 保留各模块额外字段（如 Graph workspace）。
async function ensureModuleSource<S extends { id: string; name: string; kind: "private" | "public" }>(
  engine: AdminRagEngine,
  listPath: string,
  writer: StoreUser,
  createBody: { name: string; kind: "private" | "public"; description?: string }
): Promise<S> {
  const existing = await findModuleSourceByName<S>(engine, listPath, writer, createBody.name, createBody.kind);
  if (existing) return existing;
  try {
    const created = await moduleJson<{ source: S }>(engine, listPath, { method: "POST", user: writer, body: createBody });
    return created.source;
  } catch (error) {
    if (isDuplicateSourceError(error)) {
      const raced = await findModuleSourceByName<S>(engine, listPath, writer, createBody.name, createBody.kind);
      if (raced) return raced;
    }
    throw error;
  }
}

async function findModuleSourceByName<S extends { id: string; name: string; kind: "private" | "public" }>(
  engine: AdminRagEngine,
  listPath: string,
  writer: StoreUser,
  name: string,
  kind: "private" | "public"
): Promise<S | null> {
  // 同名同 kind 才复用（codex 审）：模块允许同名 public/private 并存，且 admin GET 可见全部 source；
  // 仅按 name 匹配可能在 visibility 变更/重试/历史脏数据时复用到 kind 不一致的 source。
  const { sources } = await moduleJson<{ sources: S[] }>(engine, listPath, { method: "GET", user: writer });
  return (sources ?? []).find((s) => s.name === name && s.kind === kind) ?? null;
}

function isDuplicateSourceError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("HTTP 409") && error.message.includes("duplicate_source");
}

function gbrainPublicSourceName(scenario: StoredScenario) {
  // 改造2：公司级 GBrain 上传归并进同一 public source（按 organizationId keyed，防多租户串源）；
  //   orgId 空则退化全局常量。ensureModuleSource 按 name 复用 → 跨文件 wiki 链同 source 才可解析。
  const org = (scenario.organizationId ?? "").trim();
  return org ? `company-public-gbrain-${asciiModuleSlug(org)}` : "company-public-gbrain";
}

const GBRAIN_PAGE_GRANULARITY: Record<string, "document" | "theme"> = {
  "文档级": "document",
  "主题级": "theme"
};

// B3 复审修复:与 nano-brain/src/core/slug.ts 的 slugify 同款算法(镜像,非跨模块导入——统一 API 只做
//   HTTP 分发,不直接复用模块内部实现)。仅用于按标题定位候选编译页；真归属仍靠下方
//   metadata.raw_document_id 强校验，slug 算法万一漂移也不会导致误判到别的文件。
function gbrainCanonicalSlug(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9一-龥]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "entry";
}

type GbrainDreamTarget =
  | { type: "public_source"; source_id: string }
  | { type: "user_source"; source_id: string; user_id: string };

async function getNanoCompileState(
  user: StoreUser,
  rawDocumentId: string
): Promise<{ status: string; content_hash: string; compiled_page_id: string | null } | null> {
  const body = await moduleJson<{
    compile_state: { status: string; content_hash: string; compiled_page_id: string | null } | null;
  }>("Gbrain", `/nano/raw-documents/${encodeURIComponent(rawDocumentId)}/compile-state`, { method: "GET", user });
  return body.compile_state ?? null;
}

// B2 复审修复(codex Round-2 BLOCK,最关键):dream run 级 status(skipped=没抢到锁、compile 根本没跑；
//   partial=批内有别的文件失败，本文件不一定在其中)不能代表"本文件真编译成功"——同 raw_document 重入库时
//   轮询到 run 级"成功"，但本文件正文从未真编译，会静默假成功。真凭据落到该 raw_document 自己的
//   raw_document_compile_state：status='compiled' 且 content_hash 匹配当前正文，才算数。未匹配(含被锁跳过)
//   → 重试触发一次新 compile run，有限次数耗尽才诚实抛错(不得静默降级)。
// 环境变量在函数体内读取(与 pollTraditionalJob/pollNanoDreamRun 同款,非模块加载期读一次),
//   保证测试可在运行期通过 env 覆盖重试参数。
async function compileGbrainRawDocument(
  writer: StoreUser,
  target: GbrainDreamTarget,
  rawDocumentId: string,
  expectedContentHash: string
): Promise<void> {
  const maxAttempts = Number(process.env.FF_NANO_COMPILE_MAX_ATTEMPTS ?? 3);
  const retryDelayMs = Number(process.env.FF_NANO_COMPILE_RETRY_DELAY_MS ?? 2000);
  let lastRun: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const run = (await moduleJson<{ run: { id: string; status: string } }>("Gbrain", "/nano/dream/runs", {
      method: "POST",
      user: writer,
      body: { target, phases: ["compile"], granularity: "document" }
    })).run;
    lastRun = await pollNanoDreamRun(writer, run.id);

    const state = await getNanoCompileState(writer, rawDocumentId);
    if (state && state.status === "compiled" && state.content_hash === expectedContentHash) return;

    if (attempt < maxAttempts) await sleep(retryDelayMs);
  }
  throw new Error(
    `Gbrain 编译未确认成功（已重试 ${maxAttempts} 次）：raw_document=${rawDocumentId}，最后 run 状态=${JSON.stringify(lastRun)}`
  );
}

async function ingestGbrainFile(input: {
  scenario: StoredScenario;
  file: StoredFileRecord;
  content: string;
  selectedEngine: AdminRagEngine;
  accessControl: StoredAccessControl;
  approver: StoreUser;
  now: string;
  strategyParameters?: AdminStrategyParameters;
}) {
  const sourceKind = sourceKindForScenario(input.scenario);
  const writer = sourceKind === "public" ? input.approver : storeUserFromAccessControl(input.accessControl);
  const source = sourceKind === "public"
    ? await ensureModuleSource<{ id: string; name: string; kind: "private" | "public" }>("Gbrain", "/nano/sources", { ...input.approver, role: "admin" }, { name: gbrainPublicSourceName(input.scenario), kind: "public" })
    : (await moduleJson<{ source: { id: string; name: string; kind: "private" | "public" } }>("Gbrain", "/internal/users/default-source", {
        method: "POST",
        user: writer,
        body: {}
      })).source;
  // 每篇先按文档级编译成 source_entry（compileGbrainRawDocument）。请求 theme 粒度时，聚合成 theme_entry
  //   由 ingestScenarioSources 在全部文件编译后统一触发 theme_compile 相位（一个 source = 一个簇）。
  //   本函数产出的 per-file reference 先记 granularity_requested='theme'，聚合成功后由 triggerGbrainThemeCompile
  //   升级为 granularity='theme' + theme_page 关联；单篇 singleton 退化为文档级（granularity 保持 'document'）。
  const requestedGranularity = GBRAIN_PAGE_GRANULARITY[input.strategyParameters?.page_granularity ?? ""] ?? "document";
  const effectiveGranularity = "document";
  const gbrainTitle = input.file.originalName.replace(/\.md$/i, "");
  const rawDocument = (await moduleJson<{ raw_document: { id: string; source_id: string; external_ref: string; title: string; content_hash: string } }>("Gbrain", "/nano/raw-documents", {
    method: "POST",
    user: writer,
    body: {
      source_id: source.id,
      external_ref: input.file.id,
      title: gbrainTitle,
      content_type: "text/markdown",
      body: input.content || `# ${gbrainTitle}\n\n未抽取到正文。`
    }
  })).raw_document;
  const target: GbrainDreamTarget = sourceKind === "public"
    ? { type: "public_source", source_id: source.id }
    : { type: "user_source", source_id: source.id, user_id: input.scenario.ownerUserId };

  await compileGbrainRawDocument(writer, target, rawDocument.id, rawDocument.content_hash);

  const pages = (await moduleJson<{
    pages: Array<{ id: string; slug: string; title: string; entry_kind?: string; granularity?: string; metadata?: Record<string, unknown> }>;
  }>("Gbrain", `/nano/sources/${encodeURIComponent(source.id)}/pages`, { method: "GET", user: writer })).pages ?? [];
  // B3 复审修复:编译页 slug 现为 canonical 标题 slug(与直建路径同源，不再拼 rawDoc 短码)。
  //   按 source_id(已通过 URL 限定) + slug(title) 定位候选，再用 metadata.raw_document_id 强校验归属——
  //   查不到或校验不过必须明确抛错，不得静默返回错误页面伪装成功。
  const canonicalSlug = gbrainCanonicalSlug(gbrainTitle);
  const page = pages.find((candidate) => candidate.entry_kind === "source_entry" && candidate.slug === canonicalSlug);
  if (!page || page.metadata?.raw_document_id !== rawDocument.id) {
    throw new Error(
      `Gbrain 编译页归属校验失败：raw_document=${rawDocument.id}，候选 slug=${canonicalSlug}，实际 metadata.raw_document_id=${String(page?.metadata?.raw_document_id ?? "none")}`
    );
  }
  return {
    reference: moduleReference({
      input,
      moduleId: "nano-brain",
      source,
      objectKind: "page",
      objectId: page.id,
      pageId: page.id,
      status: "ready",
      metadata: {
        slug: page.slug,
        originalFileName: input.file.originalName,
        title: page.title,
        granularity: effectiveGranularity,
        ...(requestedGranularity === "theme" ? { granularity_requested: "theme" } : {})
      }
    })
  };
}

async function ingestNaiveRagFile(input: {
  scenario: StoredScenario;
  file: StoredFileRecord;
  content: string;
  selectedEngine: AdminRagEngine;
  accessControl: StoredAccessControl;
  approver: StoreUser;
  now: string;
  strategyParameters?: AdminStrategyParameters;
}) {
  const sourceKind = sourceKindForScenario(input.scenario);
  const writer = sourceKind === "public" ? { ...input.approver, role: "admin" as const } : storeUserFromAccessControl(input.accessControl);
  const source = await ensureModuleSource<{ id: string; name: string; kind: "private" | "public" }>("Naive RAG", "/traditional/sources", writer, { name: realSourceName(input.scenario, "naive"), kind: sourceKind, description: input.scenario.description });
  const bytes = await readStoredFileBytes(input.file);
  const form = new FormData();
  form.set("source_id", source.id);
  form.set("file", new File([toArrayBuffer(bytes)], input.file.originalName, { type: input.file.mimeType || "application/octet-stream" }));
  // T1-B1: per-engine 切片参数透传（approve 时 strategyParameters 带入；缺省由模块落回默认 1200/160）
  const chunkSize = input.strategyParameters?.chunk_size;
  const chunkOverlap = input.strategyParameters?.chunk_overlap;
  if (chunkSize) form.set("chunk_size", String(chunkSize));
  if (chunkOverlap) form.set("chunk_overlap", String(chunkOverlap));
  const uploaded = await moduleJson<{
    document: { id: string; status: string; original_filename?: string };
    job: { id: string; status: string };
  }>("Naive RAG", "/traditional/documents", {
    method: "POST",
    user: writer,
    form
  });
  const job = await pollTraditionalJob(writer, uploaded.job.id);
  const chunks = await listTraditionalChunks(writer, uploaded.document.id);
  const chunkText = chunks.map((chunk: any) => chunk.chunk_text).filter(Boolean).join("\n\n");
  return {
    reference: moduleReference({
      input,
      moduleId: "traditional-rag",
      source,
      objectKind: "job",
      objectId: uploaded.job.id,
      documentId: uploaded.document.id,
      jobId: uploaded.job.id,
      status: job.status === "ready" ? "ready" : "submitted",
      metadata: {
        originalFileName: input.file.originalName,
        documentId: uploaded.document.id,
        jobStage: job.stage,
        chunkCount: chunks.length,
        indexedText: chunkText || input.content
      }
    })
  };
}

// P1: GraphRAG 面板 entity_schema 选项 → domain_profiles schema_profile_id。
// 「通用实体」「自定义 Schema」无对应 domain profile → 传空串解绑(真落 generic,清除残留旧绑定)。
const GRAPH_ENTITY_SCHEMA_TO_PROFILE: Record<string, string> = {
  "客户/人员/项目/事件": "customer_profile",
  "合同/条款/风险": "due_diligence",
};

async function ingestGraphRagFile(input: {
  scenario: StoredScenario;
  file: StoredFileRecord;
  content: string;
  selectedEngine: AdminRagEngine;
  accessControl: StoredAccessControl;
  approver: StoreUser;
  now: string;
  strategyParameters?: AdminStrategyParameters;
}) {
  const sourceKind = sourceKindForScenario(input.scenario);
  const writer = sourceKind === "public" ? { ...input.approver, role: "admin" as const } : storeUserFromAccessControl(input.accessControl);
  const source = await ensureModuleSource<{ id: string; name: string; kind: "private" | "public"; workspace?: string }>("GraphRAG", "/graph/sources", writer, { name: realSourceName(input.scenario, "graph"), kind: sourceKind, description: input.scenario.description });
  // P1: entity_schema 面板值 → 映射到 domain profile,建图前绑定 source。
  // 通用实体/自定义 Schema(映射不到)→ 传空串解绑,真落 generic 出厂默认(避免复用 source 时残留旧绑定,codex P1 审#2)。
  const entitySchema = input.strategyParameters?.entity_schema;
  if (entitySchema) {
    const profileId = GRAPH_ENTITY_SCHEMA_TO_PROFILE[entitySchema] ?? "";
    await moduleJson("GraphRAG", `/graph/sources/${source.id}`, { method: "PATCH", user: writer, body: { schema_profile_id: profileId } });
  }
  // xlsx 走 text 端点（待后端修 P25 批5）；CSV 走结构化直灌 custom_kg，不过 LLM
  const isCsv = input.file.originalName.toLowerCase().endsWith(".csv");
  let document: { id: string; status: string; original_filename?: string };
  if (isCsv) {
    const bytes = await readStoredFileBytes(input.file);
    const form = new FormData();
    form.set("source_id", source.id);
    form.set("file", new File([toArrayBuffer(bytes)], input.file.originalName, { type: input.file.mimeType || "text/csv" }));
    document = (await moduleJson<{ document: { id: string; status: string; original_filename?: string } }>("GraphRAG", "/graph/documents/upload", {
      method: "POST",
      user: writer,
      form
    })).document;
  } else {
    document = (await moduleJson<{ document: { id: string; status: string; original_filename?: string } }>("GraphRAG", "/graph/documents/text", {
      method: "POST",
      user: writer,
      body: {
        source_id: source.id,
        title: input.file.originalName,
        text: input.content || `${input.file.originalName} 未抽取到正文。`,
        metadata: { scenario_id: input.scenario.id, file_id: input.file.id }
      }
    })).document;
  }
  if (document.status === "failed") {
    throw new Error(`GraphRAG 入库失败：${input.file.originalName}`);
  }
  // graph 建图异步（模块 C1：插 processing 行后台建图），轮询到 ready 再建 ref，
  // 否则 ref 卡 submitted，被全域 retrieveRealGlobalCitations 的 filter(status==="ready") 永久排除（台账 I74 #6）。
  const finalDoc = document.status === "ready" ? document : await pollGraphDocument(writer, document.id);
  return {
    reference: moduleReference({
      input,
      moduleId: "graph-rag",
      source,
      objectKind: "document",
      objectId: finalDoc.id,
      documentId: finalDoc.id,
      status: finalDoc.status === "ready" ? "ready" : "submitted",
      metadata: { originalFileName: input.file.originalName, workspace: source.workspace, indexedText: input.content }
    })
  };
}

async function askRealScenarioKnowledge(
  user: StoreUser,
  scenario: StoredScenario,
  query: string,
  references: StoredModuleReference[],
  spans?: TraceSpan[]
): Promise<StoredScenarioAnswer> {
  const readyReferences = references.filter((reference) => reference.status === "ready");
  const activeReferences = readyReferences.length > 0 ? readyReferences : references;
  const engine = activeReferences[0]?.engine ?? adminEngineForRagMode(defaultSelectedMode(ragModeForTemplate(scenario.templateId)));
  const db = await readDb();
  const scenarioTopK = getEngineTopK(db, engine, 5);
  const scenarioMinScore = getEngineMinScore(db, engine, 0);
  const citations: StoredScenarioAnswer["answer"]["citations"] = [];
  // P37-T4c（FR-450）：GraphRAG 调用方可传入本次生效 mode/modeSource（下游 mode router 返回），透出到 trace。
  const recordRetriever = (reference: StoredModuleReference, startedAt: number, added: number, mode?: string, modeSource?: string) => {
    spans?.push({
      kind: "RETRIEVER",
      label: `${reference.engine} 检索`,
      engine: reference.engine,
      form: engineToForm(reference.engine),
      latencyMs: Date.now() - startedAt,
      sourceName: String(reference.metadata.originalFileName ?? reference.sourceName),
      scenarioName: scenario.name,
      hitCount: added,
      ...(mode !== undefined ? { mode } : {}),
      ...(modeSource !== undefined ? { modeSource } : {})
    });
  };

  if (engine === "Gbrain") {
    for (const reference of activeReferences.filter((item) => item.engine === "Gbrain")) {
      const reader = moduleReaderForReference(user, reference);
      const startedAt = Date.now();
      const before = citations.length;
      // I110：个人（"仅自己可用"）场景全部映射到同一 per-user source(user/<uid>)，
      // 只按 source_id 检索会串到同用户其他场景的资料（citationMatchesReference 仅
      // 比 sourceId，同源全部放行）。这里传本 reference 的 page_id 做查询级场景隔离，
      // nano 只返回本场景本页的 chunk；对每场景独立 source 的团队/公司场景也正确
      // （page 本就属该场景）。顺带消除个人场景多页迭代查全源导致的重复推送。
      // fail-closed（codex 审）：Gbrain reference 缺 pageId 时无法做场景隔离，跳过而非
      // 退回只按 source_id 查全源——后者会重新暴露本修复要消除的同用户跨场景串场。
      if (!reference.pageId) continue;
      const body = await moduleJson<{ answer?: string; citations?: any[] }>("Gbrain", "/nano/ask", {
        method: "POST",
        user: reader,
        body: { query, limit: scenarioTopK, source_id: reference.sourceId, page_ids: [reference.pageId] }
      });
      for (const citation of body.citations ?? []) {
        if (!citationMatchesReference(citation, reference)) continue;
        citations.push(realCitation(reference, citation.chunk_text ?? citation.text ?? citation.snippet ?? JSON.stringify(citation)));
      }
      recordRetriever(reference, startedAt, citations.length - before);
    }
  } else if (engine === "Naive RAG") {
    // 全局检索（修 I60）：场景内所有 Naive 源一次检索，TopK = 最终返回数；命中按 documentId 回填对应 reference（修 I95，activeReferences 未按 sourceId 去重、天然含全 document）。
    const naiveRefs = activeReferences.filter((item) => item.engine === "Naive RAG");
    const refByDocument = new Map(naiveRefs.map((reference) => [reference.documentId, reference]));
    const startedAt = Date.now();
    const before = citations.length;
    const results = await searchNaiveGlobal(user, query, naiveRefs, scenarioTopK, scenarioMinScore);
    for (const r of results) {
      const reference = refByDocument.get(r.documentId);
      if (!reference) continue;
      citations.push(realCitation(reference, r.text || ""));
    }
    if (naiveRefs[0]) {
      spans?.push({
        kind: "RETRIEVER",
        label: "Naive RAG 全局检索",
        engine: "Naive RAG",
        form: engineToForm("Naive RAG"),
        latencyMs: Date.now() - startedAt,
        sourceName: `${naiveRefs.length} 个来源`,
        scenarioName: scenario.name,
        hitCount: citations.length - before
      });
    }
  } else {
    for (const reference of activeReferences.filter((item) => item.engine === "GraphRAG")) {
      const reader = moduleReaderForReference(user, reference);
      const startedAt = Date.now();
      const before = citations.length;
      const body = await moduleJson<{ answer?: string; citations?: any[]; results?: any[]; mode?: string; mode_source?: string }>("GraphRAG", "/graph/ask", {
        method: "POST",
        user: reader,
        body: { query, limit: scenarioTopK, source_id: reference.sourceId, ...getGraphRetrievalParams(db) }
      });
      const graphCitations = body.citations ?? body.results ?? [];
      for (const citation of graphCitations) {
        citations.push(realCitation(reference, citation.context ?? citation.text ?? citation.chunk_text ?? citation.snippet ?? JSON.stringify(citation)));
      }
      recordRetriever(reference, startedAt, citations.length - before, body.mode, body.mode_source);
    }
  }

  if (citations.length === 0) {
    return {
      scenarioId: scenario.id,
      query,
      answer: {
        text: `「${scenario.name}」已经发布，但真实 ${engine} 服务没有召回到可引用结果。`,
        engine,
        citations: [],
        nextActions: ["补充资料", "调整检索问题", "后台检查入库结果"]
      }
    };
  }

  const evidence = citations
    .map((citation, index) => `资料 ${index + 1}（来源：${citation.sourceOriginalName}）：\n${citation.excerpt}`)
    .join("\n\n");
  // 用真实 LLM 基于召回到的真实证据合成业务答案；失败时回退到证据摘要模板。
  const generated = await callAgentChatModel(
    [
      {
        role: "system",
        content: [
          `你是企业知识中台「${scenario.name}」场景的答案生成器。`,
          "只能基于提供的资料依据回答，不要编造资料外的事实；依据不足要直说。",
          "面向业务用户，直接给结论，不要暴露 RAG/embedding 等技术细节。"
        ].join("\n")
      },
      { role: "user", content: [`问题：${query}`, "资料依据：", evidence].join("\n\n") }
    ],
    { temperature: 0.2, maxTokens: 900 },
    (info) => spans?.push({ kind: "LLM", label: "答案生成", latencyMs: info.latencyMs, model: info.model, promptTokens: info.promptTokens, completionTokens: info.completionTokens, totalTokens: info.totalTokens, promptCacheHitTokens: info.promptCacheHitTokens, promptCacheMissTokens: info.promptCacheMissTokens, error: info.error })
  );
  return {
    scenarioId: scenario.id,
    query,
    answer: {
      text: generated ?? buildScenarioAnswerText(scenario.name, query, engine, evidence),
      engine,
      citations,
      nextActions: ["继续追问", "查看引用资料", "生成业务成品"]
    }
  };
}

function moduleReference(input: {
  input: {
    scenario: StoredScenario;
    file: StoredFileRecord;
    selectedEngine: AdminRagEngine;
    accessControl: StoredAccessControl;
    now: string;
  };
  moduleId: StoreModuleId;
  source: { id: string; name?: string; kind?: "private" | "public" };
  objectKind: StoredModuleReference["objectKind"];
  objectId: string;
  documentId?: string;
  jobId?: string;
  pageId?: string;
  status: StoredModuleReference["status"];
  metadata: Record<string, unknown>;
}): StoredModuleReference {
  return {
    id: `module_ref_${randomUUID()}`,
    scenarioId: input.input.scenario.id,
    sourceFileId: input.input.file.id,
    engine: input.input.selectedEngine,
    moduleId: input.moduleId,
    sourceId: input.source.id,
    sourceName: input.source.name ?? input.source.id,
    sourceKind: input.source.kind ?? sourceKindForScenario(input.input.scenario),
    objectKind: input.objectKind,
    objectId: input.objectId,
    documentId: input.documentId,
    jobId: input.jobId,
    pageId: input.pageId,
    status: input.status,
    accessControl: input.input.accessControl,
    metadata: { ...input.metadata, scenarioName: input.input.scenario.name },
    createdAt: input.input.now
  };
}

function shouldUseRealRagModules() {
  const mode = process.env.FF_PLATFORM_INGEST_MODE ?? process.env.PLATFORM_MODULE_MODE ?? "real";
  return mode !== "local" && mode !== "mock";
}

function moduleIdForEngine(engine: AdminRagEngine): StoreModuleId {
  if (engine === "Gbrain") return "nano-brain";
  if (engine === "Naive RAG") return "traditional-rag";
  return "graph-rag";
}

function moduleBaseUrl(engine: AdminRagEngine) {
  const envName = engine === "Gbrain" ? "NANO_BRAIN_HTTP_URL" : engine === "Naive RAG" ? "TRADITIONAL_RAG_HTTP_URL" : "GRAPH_RAG_HTTP_URL";
  const fallback = engine === "Gbrain" ? "http://127.0.0.1:8100" : engine === "Naive RAG" ? "http://127.0.0.1:8101" : "http://127.0.0.1:8102";
  return (process.env[envName] ?? fallback).replace(/\/+$/, "");
}

async function moduleJson<T>(
  engine: AdminRagEngine,
  path: string,
  input: { method: string; user: StoreUser; body?: unknown; form?: FormData }
): Promise<T> {
  const response = await fetch(`${moduleBaseUrl(engine)}${path}`, {
    method: input.method,
    headers: moduleHeaders(input.user, !input.form),
    body: input.form ?? (input.body === undefined ? undefined : JSON.stringify(input.body))
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${engine} 模块调用失败 ${input.method} ${path}: HTTP ${response.status} ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body as T;
}

function moduleHeaders(user: StoreUser, json: boolean) {
  const token = process.env.RAG_INTERNAL_TOKEN;
  if (!token) throw new Error("缺少 RAG_INTERNAL_TOKEN，无法调用真实 RAG 模块。");
  const headers = new Headers({
    "x-ff-internal-token": token,
    "x-ff-user-id": asciiHeaderValue(user.userId),
    "x-ff-username": asciiHeaderValue(user.userId),
    "x-ff-is-admin": String(user.role === "admin")
  });
  if (json) headers.set("content-type", "application/json");
  return headers;
}

function asciiHeaderValue(value: string) {
  return value.replace(/[^\x20-\x7E]/g, "_");
}

function sourceKindForScenario(scenario: StoredScenario): "private" | "public" {
  return scenario.visibility === "company" ? "public" : "private";
}

function storeUserFromAccessControl(accessControl: StoredAccessControl): StoreUser {
  return {
    userId: accessControl.ownerUserId,
    name: accessControl.ownerName,
    role: "member",
    organizationId: accessControl.organizationId,
    teamIds: accessControl.teamIds
  };
}

function moduleReaderForReference(user: StoreUser, reference: StoredModuleReference): StoreUser {
  if (reference.sourceKind === "public" || user.role === "admin") return user;
  return storeUserFromAccessControl(reference.accessControl);
}

function realSourceName(scenario: StoredScenario, suffix: string) {
  // RAG 模块（尤其 nano-brain）要求 source 名仅含 ASCII 字母数字与 _./- ，不能含中文。
  // scenario.id 形如 scene_<uuid>，本身 ASCII 且唯一，足以保证来源命名唯一与可追溯。
  return asciiModuleSlug(`${scenario.id}-${suffix}`).slice(0, 90) || `scene-${suffix}`;
}

function asciiModuleSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

async function readStoredFileBytes(file: StoredFileRecord) {
  return new Uint8Array(await readFile(join(dataRoot(), file.relativePath)));
}

async function pollTraditionalJob(user: StoreUser, jobId: string): Promise<any> {
  const timeoutMs = Number(process.env.FF_RAG_JOB_TIMEOUT_MS ?? 900000);
  const started = Date.now();
  let lastJob: any = null;
  while (Date.now() - started <= timeoutMs) {
    const body = await moduleJson<{ job: any }>("Naive RAG", `/traditional/jobs/${jobId}`, {
      method: "GET",
      user
    });
    lastJob = body.job;
    if (lastJob.status === "ready") return lastJob;
    if (lastJob.status === "failed") throw new Error(`Naive RAG 入库失败：${JSON.stringify(lastJob.error ?? lastJob)}`);
    await sleep(1500);
  }
  throw new Error(`Naive RAG 入库超时：${jobId}，最后状态 ${JSON.stringify(lastJob)}`);
}

async function pollNanoDreamRun(user: StoreUser, runId: string): Promise<any> {
  const timeoutMs = Number(process.env.FF_NANO_DREAM_TIMEOUT_MS ?? 900000);
  const started = Date.now();
  let lastRun: any = null;
  while (Date.now() - started <= timeoutMs) {
    const body = await moduleJson<{ run: any }>("Gbrain", `/nano/dream/runs/${encodeURIComponent(runId)}`, {
      method: "GET",
      user
    });
    lastRun = body.run;
    if (["clean", "ok", "partial", "skipped"].includes(lastRun.status)) return lastRun;
    if (lastRun.status === "failed") throw new Error(`Gbrain 编译失败：${JSON.stringify(lastRun)}`);
    await sleep(1500);
  }
  throw new Error(`Gbrain 编译超时：${runId}，最后状态 ${JSON.stringify(lastRun)}`);
}

// 轮询 graph 文档到 ready（graph 建图为模块 C1 异步后台任务，与 traditional 的 pollTraditionalJob 对齐）。
async function pollGraphDocument(user: StoreUser, documentId: string): Promise<any> {
  const timeoutMs = Number(process.env.FF_GRAPH_DOC_TIMEOUT_MS ?? 900000);
  const started = Date.now();
  let lastDoc: any = null;
  while (Date.now() - started <= timeoutMs) {
    const body = await moduleJson<{ document: any }>("GraphRAG", `/graph/documents/${documentId}`, { method: "GET", user });
    lastDoc = body.document;
    if (lastDoc.status === "ready") return lastDoc;
    if (lastDoc.status === "failed") throw new Error(`GraphRAG 入库失败：${JSON.stringify(lastDoc.error ?? lastDoc)}`);
    await sleep(2000);
  }
  const minutes = Math.round(timeoutMs / 60000);
  throw new Error(`GraphRAG 建图轮询在 ${minutes} 分钟内未见 ready，但 GraphRAG 建图为后台异步任务，模块可能仍在后台继续建图，可稍后重试入库或在 GraphRAG 模块侧查该文档状态，不代表资料损坏或建图失败。文档ID：${documentId}，最后状态 ${JSON.stringify(lastDoc)}`);
}

async function listTraditionalChunks(user: StoreUser, documentId: string) {
  try {
    const body = await moduleJson<{ chunks: any[] }>("Naive RAG", `/traditional/documents/${documentId}/chunks`, {
      method: "GET",
      user
    });
    return body.chunks ?? [];
  } catch {
    return [];
  }
}

function realCitation(reference: StoredModuleReference, text: string): StoredScenarioAnswer["answer"]["citations"][number] {
  return {
    knowledgeObjectId: reference.objectId,
    sourceOriginalName: String(reference.metadata.originalFileName ?? reference.sourceName),
    scenarioName: String(reference.metadata.scenarioName ?? reference.scenarioId),
    engine: reference.engine,
    // 保留较完整正文喂给生成模型，避免短文档末尾关键条款被截断。
    excerpt: scenarioCitationExcerpt(text, 1200)
  };
}

function citationMatchesReference(citation: any, reference: StoredModuleReference) {
  const sourceId = citation?.sourceId ?? citation?.source_id;
  return !sourceId || sourceId === reference.sourceId;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function normalizeFileRecord(file: StoredFileRecord): StoredFileRecord {
  const retentionPolicy = file.retentionPolicy ?? retentionPolicyForFile(file.originalName, file.mimeType);
  const accessControl = normalizeAccessControl(file.accessControl, {
    scope: file.accessControl?.scope ?? "private",
    ownerUserId: file.accessControl?.ownerUserId ?? "",
    ownerName: file.accessControl?.ownerName ?? "",
    organizationId: file.accessControl?.organizationId,
    teamIds: file.accessControl?.teamIds
  });
  return {
    ...file,
    originalState: file.originalState ?? "temporary",
    originalAvailable: file.originalAvailable ?? true,
    retentionPolicy,
    retentionReason: file.retentionReason ?? retentionReasonForPolicy(retentionPolicy),
    accessControl,
    parsedArtifactIds: file.parsedArtifactIds ?? [],
    knowledgeObjectIds: file.knowledgeObjectIds ?? []
  };
}

async function readSourceContent(file: StoredFileRecord) {
  try {
    const bytes = await readFile(join(dataRoot(), file.relativePath));
    return parseUploadedFileContent(file, bytes);
  } catch {
    return `${file.originalName} 的原始文件不可用，使用已登记的文件元数据重建解析记录。`;
  }
}

async function parseUploadedFileContent(file: StoredFileRecord, bytes: Uint8Array) {
  const ext = extensionForFile(file.originalName);
  const mime = file.mimeType.toLowerCase();
  if (["docx"].includes(ext) || mime.includes("wordprocessingml")) return parseDocxContent(bytes, file.originalName);
  if (["xlsx", "xls"].includes(ext) || mime.includes("spreadsheetml")) return parseXlsxContent(bytes, file.originalName);
  if (["json"].includes(ext) || mime.includes("json")) return parseJsonContent(decodeUtf8(bytes), file.originalName);
  if (["html", "htm"].includes(ext) || mime.includes("html")) return parseHtmlContent(decodeUtf8(bytes), file.originalName);
  if (ext === "pdf" || mime.includes("pdf")) return parsePdfContent(decodeUtf8(bytes), file.originalName);
  if (isImageFile(ext, mime)) return parseImageContent(file, bytes);
  if (isAudioFile(ext, mime)) return parseAudioVisualContent(file, bytes, "音频资料");
  if (isVideoFile(ext, mime)) return parseAudioVisualContent(file, bytes, "视频资料");
  const text = decodeUtf8(bytes);
  // 026:入库走保真清洗(不遮),出口才遮——sanitizeKnowledgeExcerpt 在此=库内改写,违反 FR-585。
  return sanitizeKnowledgeContentForStore(text) || text.trim() || `${file.originalName} 已完成解析，但没有抽取到正文。`;
}

function parseDocxContent(bytes: Uint8Array, fileName: string) {
  const entries = readZipEntries(bytes);
  const documentXml = entries.get("word/document.xml") ?? "";
  const textRuns = Array.from(documentXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)).map((match) => decodeXmlEntities(match[1]));
  const text = textRuns.join("").replace(/\s+/g, " ").trim();
  return text ? `Word 文档：${fileName}\n${text}` : `${fileName} 已读取为 Word 文档，但没有抽取到正文。`;
}

function parseXlsxContent(bytes: Uint8Array, fileName: string) {
  const entries = readZipEntries(bytes);
  const sharedStringsXml = entries.get("xl/sharedStrings.xml") ?? "";
  const sharedStrings = Array.from(sharedStringsXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((match) => decodeXmlEntities(match[1]));
  const sheets = Array.from(entries.entries()).filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
  const rows: string[] = [];
  for (const [, xml] of sheets) {
    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const values = Array.from(rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)).map((cellMatch) => {
        const attrs = cellMatch[1];
        const body = cellMatch[2];
        const rawValue = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1]?.trim() ?? body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]?.trim() ?? "";
        if (/\bt=["']s["']/.test(attrs)) return sharedStrings[Number(rawValue)] ?? rawValue;
        return decodeXmlEntities(rawValue);
      }).filter(Boolean);
      if (values.length) rows.push(values.join(" | "));
    }
  }
  return rows.length ? `表格文件：${fileName}\n${rows.join("\n")}` : `${fileName} 已读取为表格，但没有抽取到单元格内容。`;
}

function parseJsonContent(raw: string, fileName: string) {
  try {
    const parsed = JSON.parse(raw);
    const flattened = flattenJson(parsed).join("\n");
    return flattened ? `JSON 数据：${fileName}\n${flattened}` : `JSON 数据：${fileName}\n${raw}`;
  } catch {
    return raw.trim() || `${fileName} 是 JSON 文件，但内容为空。`;
  }
}

function parseHtmlContent(raw: string, fileName: string) {
  const text = decodeHtmlEntities(raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
  return text ? `网页/HTML 文档：${fileName}\n${text}` : `${fileName} 已读取为 HTML，但没有抽取到正文。`;
}

function parsePdfContent(raw: string, fileName: string) {
  const readable = extractPdfReadableText(raw);
  const cleaned = stripRawParserPayload(readable || raw);
  return cleaned ? `PDF 文档：${fileName}\n${cleaned}` : `${fileName} 已读取为 PDF，但没有抽取到可展示正文。`;
}

function parseMediaMetadata(file: StoredFileRecord, bytes: Uint8Array, label: string) {
  return `${label}：${file.originalName}\n文件类型：${file.mimeType || extensionForFile(file.originalName)}\n文件大小：${formatBytes(bytes.byteLength)}\n该资料已作为多模态输入登记，可在配置 OCR、ASR 或视频抽帧服务后抽取文字、图像说明和时间轴证据。`;
}

async function parseImageContent(file: StoredFileRecord, bytes: Uint8Array) {
  const description = await extractImageDescription(file, bytes);
  if (description) {
    return `图片资料：${file.originalName}\n文件类型：${file.mimeType || extensionForFile(file.originalName)}\n文件大小：${formatBytes(bytes.byteLength)}\n图像解析：${description}`;
  }
  return parseMediaMetadata(file, bytes, "图片资料");
}

async function parseAudioVisualContent(file: StoredFileRecord, bytes: Uint8Array, label: "音频资料" | "视频资料") {
  const transcript = await transcribeMediaFile(file, bytes);
  if (transcript) {
    return `${label}：${file.originalName}\n文件类型：${file.mimeType || extensionForFile(file.originalName)}\n文件大小：${formatBytes(bytes.byteLength)}\n转写文本：${transcript}`;
  }
  return parseMediaMetadata(file, bytes, label);
}

async function extractImageDescription(file: StoredFileRecord, bytes: Uint8Array): Promise<string | null> {
  if (isLocalMediaParsingMode()) return null;
  const apiKey = await readIntegrationEnv("VISION_API_KEY") ?? await readIntegrationEnv("OPENROUTER_API_KEY") ?? await readIntegrationEnv("OPENAI_API_KEY");
  if (!apiKey) return null;
  const baseUrl = (await readIntegrationEnv("VISION_BASE_URL") ?? await readIntegrationEnv("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const model = await readIntegrationEnv("VISION_MODEL") ?? await readIntegrationEnv("OPENROUTER_VISION_MODEL") ?? await readIntegrationEnv("AGENT_MODEL") ?? "openai/gpt-4o-mini";
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost",
        "X-Title": "ff-companybrain"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "你是企业知识入库的图像解析器。提取图片中的文字、表格、关键对象、关系和业务含义，输出可用于 RAG 检索的中文摘要。"
          },
          {
            role: "user",
            content: [
              { type: "text", text: `请解析这张上传资料图片，文件名：${file.originalName}` },
              { type: "image_url", image_url: { url: `data:${file.mimeType || "image/png"};base64,${Buffer.from(bytes).toString("base64")}` } }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 900
      }),
      signal: AbortSignal.timeout(Number(await readIntegrationEnv("VISION_TIMEOUT_MS") ?? 45000))
    });
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) return null;
    const content = body?.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim() ? content.trim() : null;
  } catch {
    return null;
  }
}

async function transcribeMediaFile(file: StoredFileRecord, bytes: Uint8Array): Promise<string | null> {
  if (isLocalMediaParsingMode()) return null;
  if (bytes.byteLength > 25 * 1024 * 1024) return null;
  const apiKey = await readIntegrationEnv("MEDIA_TRANSCRIPTION_API_KEY") ?? await readIntegrationEnv("OPENAI_API_KEY");
  if (!apiKey) return null;
  const baseUrl = (await readIntegrationEnv("MEDIA_TRANSCRIPTION_BASE_URL") ?? await readIntegrationEnv("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = await readIntegrationEnv("MEDIA_TRANSCRIPTION_MODEL") ?? await readIntegrationEnv("OPENAI_TRANSCRIPTION_MODEL") ?? "gpt-4o-mini-transcribe";
  try {
    const form = new FormData();
    form.set("model", model);
    form.set("file", new File([toArrayBuffer(bytes)], file.originalName, { type: file.mimeType || "application/octet-stream" }));
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(Number(await readIntegrationEnv("MEDIA_TRANSCRIPTION_TIMEOUT_MS") ?? 120000))
    });
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) return null;
    return typeof body?.text === "string" && body.text.trim() ? body.text.trim() : null;
  } catch {
    return null;
  }
}

function isLocalMediaParsingMode() {
  return process.env.FF_PLATFORM_AGENT_MODE === "local"
    || process.env.FF_PLATFORM_AGENT_MODE === "off"
    || process.env.FF_PLATFORM_MEDIA_MODE === "local"
    || process.env.FF_PLATFORM_MEDIA_MODE === "off";
}

function readZipEntries(bytes: Uint8Array) {
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset + 30 <= bytes.byteLength) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    if (view.getUint32(0, true) !== 0x04034b50) break;
    const flags = view.getUint16(6, true);
    const method = view.getUint16(8, true);
    const compressedSize = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = decodeUtf8(bytes.slice(nameStart, nameStart + nameLength));
    if (dataEnd > bytes.byteLength || flags & 0x08) break;
    const compressed = bytes.slice(dataStart, dataEnd);
    let data: Uint8Array | null = null;
    if (method === 0) data = compressed;
    if (method === 8) data = inflateRawSync(compressed);
    if (data) entries.set(name, decodeUtf8(data));
    offset = dataEnd;
  }
  return entries;
}

function flattenJson(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") {
    return prefix ? [`${prefix}: ${String(value)}`] : [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenJson(item, `${prefix}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, nested]) => flattenJson(nested, prefix ? `${prefix}.${key}` : key));
}

function decodeUtf8(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function decodeXmlEntities(value: string) {
  return decodeHtmlEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function isImageFile(ext: string, mime: string) {
  return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"].includes(ext) || mime.startsWith("image/");
}

function isAudioFile(ext: string, mime: string) {
  return ["mp3", "m4a", "wav", "webm", "mpeg", "mpga", "aac", "flac", "ogg"].includes(ext) || mime.startsWith("audio/");
}

function isVideoFile(ext: string, mime: string) {
  return ["mp4", "mov", "mkv", "avi", "webm", "m4v"].includes(ext) || mime.startsWith("video/");
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function buildKnowledgeContent(scenario: StoredScenario, file: StoredFileRecord, content: string, engine: AdminRagEngine) {
  const normalized = content.replace(/\s+/g, " ").trim();
  const excerpt = normalized.length > 260 ? `${normalized.slice(0, 260)}...` : normalized;
  return `场景：${scenario.name}\n来源：${file.originalName}\n引擎：${engine}\n权限：${visibilityText(scenario.visibility)}\n内容：${excerpt}`;
}

function artifactKindForFile(file: StoredFileRecord): ParsedArtifactKind {
  const ext = extensionForFile(file.originalName);
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (["csv", "xls", "xlsx"].includes(ext)) return "table";
  if (ext === "json") return "structured_data";
  if (["zip", "rar", "7z"].includes(ext)) return "archive_manifest";
  if (["txt", "text"].includes(ext)) return "text";
  if (isImageFile(ext, file.mimeType.toLowerCase()) || isAudioFile(ext, file.mimeType.toLowerCase()) || isVideoFile(ext, file.mimeType.toLowerCase())) return "document_text";
  return "document_text";
}

function knowledgeKindForEngine(engine: AdminRagEngine): KnowledgeObjectKind {
  if (engine === "Naive RAG") return "evidence_chunk";
  if (engine === "GraphRAG") return "graph_object";
  return "knowledge_page";
}

function retentionPolicyForFile(fileName: string, mimeType?: string): FileRetentionPolicy {
  const ext = extensionForFile(fileName);
  if (["md", "markdown"].includes(ext) || mimeType === "text/markdown") return "retain_source";
  return "delete_after_ingest";
}

function retentionReasonForPolicy(policy: FileRetentionPolicy) {
  if (policy === "retain_source") return "Markdown 是可读、可版本化的知识源，入库后继续保留。";
  return "解析产物和知识对象已入库，原始文件按默认策略清理。";
}

function extensionForFile(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function requestMatchesTask(requestId: string, task: StoreTask) {
  return requestId === task.id || requestId === task.scenarioId || requestId === `request_${task.id}`;
}

function adminStatusForTask(status: StoreTask["status"]): StoredAdminIntakeRequest["status"] {
  if (status === "ready") return "已发布";
  if (status === "failed") return "已退回";
  if (status === "processing") return "处理中";
  if (status === "waiting_review") return "等待复核";
  return "待管理员确认";
}

function adminActionsForTask(status: StoreTask["status"]) {
  if (status === "ready") return ["查看资料", "查看发布结果"];
  if (status === "failed") return ["查看资料", "查看退回原因"];
  return ["查看资料", "配置引擎策略", "确认入库", "退回补充"];
}

function defaultSelectedMode(mode: RagEngine): RagEngine {
  return mode === "混合处理" ? "知识百科" : mode;
}

function adminEngineForRagMode(mode: RagEngine): AdminRagEngine {
  if (mode === "文档证据") return "Naive RAG";
  if (mode === "关系图谱") return "GraphRAG";
  return "Gbrain";
}

function ragModeForAdminEngine(engine: AdminRagEngine): RagEngine {
  if (engine === "Naive RAG") return "文档证据";
  if (engine === "GraphRAG") return "关系图谱";
  return "知识百科";
}

function displayRelativeTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "刚刚";
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function ragModeForTemplate(templateId: string): RagEngine {
  if (["customer-360", "risk-investigation", "domain-relationship", "voice-of-customer"].includes(templateId)) return "关系图谱";
  if (["contract-playbook", "rfp-security", "policy-evidence", "data-analyst", "it-runbook", "meeting-media-memory"].includes(templateId)) return "文档证据";
  if (["personal-wiki", "team-handbook", "research-guide"].includes(templateId)) return "知识百科";
  return "混合处理";
}

function recommendedModesForTemplate(primary: RagEngine, templateId: string): RagEngine[] {
  if (templateId === "custom-scenario") return ["知识百科", "文档证据", "关系图谱"];
  if (primary === "混合处理") return ["知识百科", "文档证据", "关系图谱"];
  return [primary];
}

function recommendedEnginesForTemplate(primary: RagEngine, templateId: string): AdminRagEngine[] {
  return recommendedModesForTemplate(primary, templateId).map(adminEngineForRagMode);
}

function frontstageMappingForEngines(engines: AdminRagEngine[]) {
  const labels = engines.map((engine) => {
    if (engine === "Gbrain") return "知识百科";
    if (engine === "Naive RAG") return "文档证据";
    return "关系图谱";
  });
  return `发布到前台后映射为：${labels.join(" / ")}。`;
}

function visibilityText(visibility: StoreVisibility): StoredAdminIntakeRequest["visibility"] {
  if (visibility === "private") return "个人";
  if (visibility === "team") return "团队";
  return "公司";
}

function permissionImpactForVisibility(visibility: StoreVisibility) {
  if (visibility === "private") return "如果按个人范围入库，团队和公司级问答不会召回这批资料。";
  if (visibility === "team") return "如果按团队范围入库，只有团队成员和管理员可以使用这批资料。";
  return "如果按公司范围入库，需要管理员复核引用、权限和发布边界后才能进入公司大脑。";
}

function safeFileName(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^_+|_+$/g, "") || "file";
}
