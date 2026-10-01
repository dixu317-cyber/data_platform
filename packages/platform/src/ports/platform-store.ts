/**
 * 本 port 为平台持久化领域抽象，实现（JSON / PG）在别处。
 */
import type {
  AdminDashboardSnapshot,
  AdminIntegrationSettings,
  AdminKnowledgeAssetKind,
  AdminRagEngine,
  AdminServiceHealth,
  AdminStrategyParameters,
  AdminTemplateMutationInput,
  GlobalChatSessionSummary,
  MonitoringFormPanels,
  MonitoringOverview,
  MonitoringTrendPoint,
  ProcessingTask,
  RagEngine,
  ScenarioChatSessionSummary,
  StoreUploadFile,
  StoreUser,
  StoreVisibility,
  StoredAdminAuditEvent,
  StoredAdminIntakeRequest,
  StoredAdminTemplate,
  MonitoringTelemetry,
  MonitoringTelemetryDetail,
  StoredFilePreview,
  StoredFileRecord,
  StoredGlobalChatSession,
  StoredKnowledgeAssetDetail,
  StoredKnowledgeObject,
  StoredScenario,
  StoredScenarioChatSession,
  StoredScenarioWorkbench,
  TraceFormLabel,
} from '../store-types';

export interface PlatformStore {
  setTraceFeedback(user: StoreUser, input: { traceId: string; vote: "up" | "down"; note?: string }): Promise<{ ok: boolean; message: string }>;
  getMonitoringOverview(user: StoreUser): Promise<MonitoringOverview>;
  listMonitoringTraces(user: StoreUser, input?: { form?: TraceFormLabel; onlyFailed?: boolean; onlyDownvoted?: boolean; limit?: number }): Promise<MonitoringTelemetry[]>;
  getMonitoringTrace(user: StoreUser, traceId: string): Promise<MonitoringTelemetryDetail | null>;
  getMonitoringTrends(user: StoreUser): Promise<MonitoringTrendPoint[]>;
  getMonitoringFormPanels(user: StoreUser): Promise<MonitoringFormPanels>;
  createStoredScenario(actor: StoreUser, input: { templateId: string; name: string; description: string; visibility: StoreVisibility; processingGoal: string; files: StoreUploadFile[] }): Promise<{ scenario: StoredScenario; task: ProcessingTask; files: StoredFileRecord[] }>;
  listStoredTasks(user: StoreUser): Promise<ProcessingTask[]>;
  listStoredScenarios(user: StoreUser): Promise<StoredScenario[]>;
  getStoredScenarioWorkbench(user: StoreUser, scenarioId: string): Promise<StoredScenarioWorkbench | null>;
  listStoredKnowledgeObjects(user: StoreUser): Promise<StoredKnowledgeObject[]>;
  // TODO: 源码未显式标注返回类型，Phase 1 落 PG 实现时坐实
  getStoredPlatformSnapshot(user: StoreUser): Promise<unknown>;
  getStoredFilePreview(user: StoreUser, fileId: string): Promise<StoredFilePreview | null>;
  listAdminIntakeRequests(user: StoreUser): Promise<StoredAdminIntakeRequest[]>;
  listAdminAuditEvents(user: StoreUser): Promise<StoredAdminAuditEvent[]>;
  updateRuntimeConfig(user: StoreUser, input: Record<string, unknown>): Promise<AdminIntegrationSettings>;
  updateEngineRetrievalConfig(user: StoreUser, input: Record<string, unknown>): Promise<AdminIntegrationSettings>;
  getAdminIntegrationSettings(user: StoreUser): Promise<AdminIntegrationSettings | null>;
  listAdminScenarioTemplates(user: StoreUser): Promise<StoredAdminTemplate[]>;
  createAdminScenarioTemplate(user: StoreUser, input: AdminTemplateMutationInput): Promise<StoredAdminTemplate | null>;
  updateAdminScenarioTemplate(user: StoreUser, templateId: string, input: AdminTemplateMutationInput): Promise<StoredAdminTemplate | null>;
  deleteAdminScenarioTemplate(user: StoreUser, templateId: string): Promise<{ ok: true } | { ok: false; reason: "not_found" | "official_locked" | "forbidden" }>;
  listAdminKnowledgeAssetDetails(user: StoreUser, input?: { engine?: AdminRagEngine; kind?: AdminKnowledgeAssetKind }): Promise<StoredKnowledgeAssetDetail[]>;
  adminEngineRecallVerify(user: StoreUser, input: { engine: AdminRagEngine; query?: string }): Promise<{ engine: AdminRagEngine; query: string; hits: Array<{ source: string; scenario: string; excerpt: string }>; checkedSources: number }>;
  adminExportKnowledgeAssetsCsv(user: StoreUser, input?: { engine?: AdminRagEngine }): Promise<string>;
  adminBatchReviewRequests(user: StoreUser, input?: { engine?: AdminRagEngine }): Promise<{ approved: number; failed: number; engine?: AdminRagEngine }>;
  createScenarioDataRequest(user: StoreUser, input: { scenarioId: string; action: "update" | "delete" }): Promise<{ ok: boolean; taskId?: string; message: string }>;
  getAdminStrategies(user: StoreUser): Promise<Array<{ id: string; name: string; scope: string; impact: string; controls: string[] }>>;
  getAdminEvaluations(user: StoreUser): Promise<Array<{ profile: string; evidence: number; score: string; latency: string }>>;
  getAdminDashboardSnapshot(user: StoreUser, options?: { checkHealth?: (engine: AdminRagEngine) => Promise<AdminServiceHealth> }): Promise<AdminDashboardSnapshot>;
  listGlobalChatSessions(user: StoreUser): Promise<GlobalChatSessionSummary[]>;
  getGlobalChatSession(user: StoreUser, sessionId: string): Promise<StoredGlobalChatSession | null>;
  listScenarioChatSessions(user: StoreUser, scenarioId: string): Promise<ScenarioChatSessionSummary[]>;
  getScenarioChatSession(user: StoreUser, input: { scenarioId: string; sessionId: string }): Promise<StoredScenarioChatSession | null>;
  decideAdminIntakeRequest(user: StoreUser, input: { requestId: string; action: "approve" | "reject"; selectedMode?: RagEngine; selectedEngine?: AdminRagEngine; strategyParameters?: AdminStrategyParameters; reason?: string }): Promise<StoredAdminIntakeRequest | null>;
  renameGlobalChatSession(user: StoreUser, input: { sessionId: string; title: string }): Promise<GlobalChatSessionSummary | null>;
  deleteGlobalChatSession(user: StoreUser, sessionId: string): Promise<{ ok: boolean }>;
}
