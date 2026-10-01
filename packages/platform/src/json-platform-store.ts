/**
 * JSON 适配器 —— P12 Phase 0 T0.2（承重前置，行为不变）
 *
 * 用同包 platform-store.ts 的导出函数 1:1 字段委托，实现三个 port 接口。
 * - 字段委托（`method = store.method`）让 tsc 对每个成员逐一做接口一致性校验，
 *   是"行为等价"的最强静态证明：任何签名漂移都会在此处编译失败。
 *
 * Phase 1「拔根」已把逻辑本体 + frontstage + scenario-product-surface + 本适配器迁入
 * packages/platform（T1a 物理归位完成）。T1b 将新增 PgPlatformStore（同一 port，调用方无感），
 * 存储从 JSON 换成 PG。
 */
import type { AnswerOrchestrator } from "./ports/answer-orchestrator";
import type { ModuleClient } from "./ports/module-client";
import type { PlatformStore } from "./ports/platform-store";

import * as store from "./platform-store";

export class JsonModuleClient implements ModuleClient {
  listGraphCurationSources = store.listGraphCurationSources;
  getGraphCurationDetail = store.getGraphCurationDetail;
  mergeGraphCurationEntities = store.mergeGraphCurationEntities;
  editGraphCurationEntity = store.editGraphCurationEntity;
  deleteGraphCurationEntity = store.deleteGraphCurationEntity;
  deleteGraphCurationRelation = store.deleteGraphCurationRelation;
  listNaiveDocuments = store.listNaiveDocuments;
  getDocumentChunks = store.getDocumentChunks;
  deleteDocumentChunk = store.deleteDocumentChunk;
  listGbrainPageSources = store.listGbrainPageSources;
  listGbrainPages = store.listGbrainPages;
  editGbrainPage = store.editGbrainPage;
}

export class JsonPlatformStore implements PlatformStore {
  setTraceFeedback = store.setTraceFeedback;
  getMonitoringOverview = store.getMonitoringOverview;
  listMonitoringTraces = store.listMonitoringTraces;
  getMonitoringTrace = store.getMonitoringTrace;
  getMonitoringTrends = store.getMonitoringTrends;
  getMonitoringFormPanels = store.getMonitoringFormPanels;
  createStoredScenario = store.createStoredScenario;
  listStoredTasks = store.listStoredTasks;
  listStoredScenarios = store.listStoredScenarios;
  getStoredScenarioWorkbench = store.getStoredScenarioWorkbench;
  listStoredKnowledgeObjects = store.listStoredKnowledgeObjects;
  getStoredPlatformSnapshot = store.getStoredPlatformSnapshot;
  getStoredFilePreview = store.getStoredFilePreview;
  listAdminIntakeRequests = store.listAdminIntakeRequests;
  listAdminAuditEvents = store.listAdminAuditEvents;
  updateRuntimeConfig = store.updateRuntimeConfig;
  updateEngineRetrievalConfig = store.updateEngineRetrievalConfig;
  getAdminIntegrationSettings = store.getAdminIntegrationSettings;
  listAdminScenarioTemplates = store.listAdminScenarioTemplates;
  createAdminScenarioTemplate = store.createAdminScenarioTemplate;
  updateAdminScenarioTemplate = store.updateAdminScenarioTemplate;
  deleteAdminScenarioTemplate = store.deleteAdminScenarioTemplate;
  listAdminKnowledgeAssetDetails = store.listAdminKnowledgeAssetDetails;
  adminEngineRecallVerify = store.adminEngineRecallVerify;
  adminExportKnowledgeAssetsCsv = store.adminExportKnowledgeAssetsCsv;
  adminBatchReviewRequests = store.adminBatchReviewRequests;
  createScenarioDataRequest = store.createScenarioDataRequest;
  getAdminStrategies = store.getAdminStrategies;
  getAdminEvaluations = store.getAdminEvaluations;
  getAdminDashboardSnapshot = store.getAdminDashboardSnapshot;
  listGlobalChatSessions = store.listGlobalChatSessions;
  getGlobalChatSession = store.getGlobalChatSession;
  listScenarioChatSessions = store.listScenarioChatSessions;
  getScenarioChatSession = store.getScenarioChatSession;
  decideAdminIntakeRequest = store.decideAdminIntakeRequest;
  renameGlobalChatSession = store.renameGlobalChatSession;
  deleteGlobalChatSession = store.deleteGlobalChatSession;
}

export class JsonAnswerOrchestrator implements AnswerOrchestrator {
  askStoredScenarioKnowledge = store.askStoredScenarioKnowledge;
  createGlobalChatSession = store.createGlobalChatSession;
  appendGlobalChatMessage = store.appendGlobalChatMessage;
  createScenarioChatSession = store.createScenarioChatSession;
  appendScenarioChatMessage = store.appendScenarioChatMessage;
}
