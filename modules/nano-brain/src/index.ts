export { closeNanoBrainPool, getNanoBrainPool } from './db';
export { captureContent, captureMarkdown, captureText } from './core/capture';
export {
  insertAuditLog,
  listAuditLogs,
  type AuditAction,
  type AuditLog,
} from './core/audit';
export {
  saveFactCandidates,
  normalizeFactCandidates,
  type FactCandidate,
  type FactCandidateKind,
  type FactCandidateNotability,
  type FactCandidateWarning,
} from './core/fact-candidates';
export {
  reviewFactSubmission,
  type FactReviewAction,
  type FactReviewResult,
} from './core/fact-review';
export {
  insertApprovedFact,
  normalizeApprovedFact,
  type ApprovedFactInput,
  type FactKind,
  type FactNotability,
  type NanoFact,
} from './core/facts';
export {
  getFactSubmission,
  listAdminFactSubmissions,
  listFactSubmissions,
  submitFactSubmission,
  type FactSubmission,
  type FactSubmissionStatus,
  type FactSubmissionWarning,
} from './core/fact-submissions';
export { createNanoBrainHttpApp, startNanoBrainHttpServer } from './http/server';
export { migrateNanoBrainDatabase } from './migrations';
export {
  DREAM_PHASES,
  DREAM_PHASE_STATUSES,
  DREAM_RUN_STATUSES,
  DREAM_TARGET_TYPES,
  DREAM_TRIGGER_TYPES,
  isDreamPhase,
  isDreamPhaseStatus,
  isDreamRunStatus,
  isDreamTargetType,
  type DreamLock,
  type DreamPhase,
  type DreamPhaseResult,
  type DreamPhaseRun,
  type DreamPhaseStatus,
  type DreamReport,
  type DreamRun,
  type DreamRunStatus,
  type DreamTarget,
  type DreamTargetType,
  type DreamTriggerType,
  type PageDreamState,
} from './core/dream/types';
export {
  acquireDreamLock,
  buildDreamLockId,
  cleanupExpiredDreamLocks,
  getActiveDreamLockForTarget,
  getDreamLock,
  getDreamLockTargetColumns,
  getDreamLockTtlMs,
  releaseDreamLock,
  type AcquireDreamLockOptions,
  type DreamLockAcquireResult,
  type DreamLockTargetColumns,
} from './core/dream/locks';
export {
  getDreamRun,
  getDreamRunReport,
  listDreamPhaseRuns,
  runDream,
  runDreamAsSystem,
  type DreamActor,
  type DreamPhaseHandler,
  type DreamPhaseHandlerContext,
  type RunDreamInput,
  type RunDreamSystemInput,
} from './core/dream/runner';
export {
  EXTRACT_LINKS_PHASE_VERSION,
  runExtractLinksPhase,
} from './core/dream/phases/extract-links';
export {
  REFRESH_EMBEDDINGS_PHASE_VERSION,
  runRefreshEmbeddingsPhase,
} from './core/dream/phases/refresh-embeddings';
export {
  HEALTH_CHECK_PHASE_VERSION,
  runHealthCheckPhase,
} from './core/dream/phases/health-check';
export {
  REVIEW_QUEUE_SUMMARY_PHASE_VERSION,
  runReviewQueueSummaryPhase,
} from './core/dream/phases/review-queue-summary';
export {
  listPageChunks,
  prepareChunksForMarkdown,
  splitMarkdownIntoChunkTexts,
  type NanoChunk,
  type PreparedChunk,
} from './core/chunks';
export {
  embedTexts,
  getEmbeddingConfig,
  type EmbeddingConfig,
} from './core/embeddings';
export {
  searchNanoBrain,
  type NanoSearchResponse,
  type NanoSearchResult,
} from './core/search';
export {
  askNanoBrain,
  createOpenRouterAskClient,
  ASK_NO_EVIDENCE_NOTE,
  ASK_DEGRADED_PREFIX,
  type AskResult,
  type AskCitation,
  type AskLlmClient,
} from './core/ask';
export {
  extractLinksFromMarkdown,
  graphQuery,
  listBacklinks,
  listOutgoingLinks,
  replacePageLinks,
  type GraphQueryResult,
  type LinkDirection,
  type NanoLink,
} from './core/links';
export {
  archivePage,
  getPage,
  listPages,
  putMarkdownPage,
  type NanoPage,
} from './core/pages';
export {
  createPublicSource,
  ensureDefaultPrivateSource,
  getReadableSource,
  getSourceById,
  listReadableSources,
  NanoBrainError,
  updateSourceName,
  type NanoSource,
  type SourceKind,
} from './core/sources';
export {
  assertCanManageSource,
  assertCanReadSource,
  assertCanWriteSource,
  canManageSource,
  canReadSource,
  canWriteSource,
  NanoBrainPermissionError,
} from './core/permissions';

export const nanoBrainModuleId = 'nano-brain';
