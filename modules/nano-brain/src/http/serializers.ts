export function toPublicSource(source: {
  id: string;
  name: string;
  kind: string;
  ownerUserId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    owner_user_id: source.ownerUserId,
    created_by: source.createdBy,
    created_at: source.createdAt,
    updated_at: source.updatedAt,
  };
}

export function toPublicPage(page: {
  id: string;
  sourceId: string;
  slug: string;
  title: string;
  body: string;
  contentHash: string;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  // 014 · T5 · AM-1418:008 wiki 消费契约附加结构(back-compat 不破基础字段;存量页取默认值)。
  entryKind?: string;
  compileStatus?: string;
  compileVersion?: string | null;
  granularity?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return {
    id: page.id,
    source_id: page.sourceId,
    slug: page.slug,
    title: page.title,
    body: page.body,
    content_hash: page.contentHash,
    created_by: page.createdBy,
    updated_by: page.updatedBy,
    created_at: page.createdAt,
    updated_at: page.updatedAt,
    // 附加结构:供 008 大纲/思维导图(metadata.entry.outline)+ 015 孤页/质量面板(entry_kind/compile_status)。
    entry_kind: page.entryKind,
    compile_status: page.compileStatus,
    compile_version: page.compileVersion ?? null,
    granularity: page.granularity ?? null,
    metadata: page.metadata ?? {},
  };
}

export function toPublicChunk(chunk: {
  id: string;
  pageId: string;
  sourceId: string;
  slug: string;
  chunkIndex: number;
  chunkText: string;
  contentHash: string;
  embeddingModel: string;
  embeddingDimensions: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: chunk.id,
    page_id: chunk.pageId,
    source_id: chunk.sourceId,
    slug: chunk.slug,
    chunk_index: chunk.chunkIndex,
    chunk_text: chunk.chunkText,
    content_hash: chunk.contentHash,
    embedding_model: chunk.embeddingModel,
    embedding_dimensions: chunk.embeddingDimensions,
    created_at: chunk.createdAt,
    updated_at: chunk.updatedAt,
  };
}

export function toPublicSearchResult(result: {
  chunkId: string;
  pageId: string;
  sourceId: string;
  sourceKind: string;
  sourceName: string;
  slug: string;
  title: string;
  chunkIndex: number;
  snippet: string;
  score: number;
  matchTypes: string[];
  // 004 · FR-164:fact 引用锚点字段(chunk 引用时为 undefined),供聚合层构建统一 citation locator。
  resultType?: string;
  knowledgeType?: string;
  factId?: string;
  entitySlug?: string | null;
}) {
  return {
    chunk_id: result.chunkId,
    page_id: result.pageId,
    source_id: result.sourceId,
    source_kind: result.sourceKind,
    source_name: result.sourceName,
    slug: result.slug,
    title: result.title,
    chunk_index: result.chunkIndex,
    snippet: result.snippet,
    score: result.score,
    match_types: result.matchTypes,
    result_type: result.resultType,
    knowledge_type: result.knowledgeType,
    fact_id: result.factId,
    entity_slug: result.entitySlug ?? undefined,
  };
}

export function toPublicFactSubmission(submission: {
  id: string;
  targetSourceId: string;
  submittedBy: string;
  rawClaim: string;
  rawEvidenceText: string | null;
  rawEvidenceUrl: string | null;
  rawContext: string | null;
  warnings: unknown[];
  status: string;
  normalizedCandidates: unknown[];
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: submission.id,
    target_source_id: submission.targetSourceId,
    submitted_by: submission.submittedBy,
    raw_claim: submission.rawClaim,
    raw_evidence_text: submission.rawEvidenceText,
    raw_evidence_url: submission.rawEvidenceUrl,
    raw_context: submission.rawContext,
    warnings: submission.warnings,
    status: submission.status,
    normalized_candidates: submission.normalizedCandidates,
    created_at: submission.createdAt,
    updated_at: submission.updatedAt,
  };
}

export function toPublicFact(fact: {
  id: string;
  sourceId: string;
  submissionId: string;
  entitySlug: string | null;
  fact: string;
  kind: string;
  confidence: number;
  notability: string;
  context: string | null;
  validFrom: string | null;
  validUntil: string | null;
  claimMetric: string | null;
  claimValue: number | null;
  claimUnit: string | null;
  claimPeriod: string | null;
  evidenceUrl: string | null;
  evidenceQuote: string | null;
  approvedBy: string;
  approvedAt: Date;
  submittedBy?: string;
  submissionStatus?: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: fact.id,
    source_id: fact.sourceId,
    submission_id: fact.submissionId,
    entity_slug: fact.entitySlug,
    fact: fact.fact,
    kind: fact.kind,
    confidence: fact.confidence,
    notability: fact.notability,
    context: fact.context,
    valid_from: fact.validFrom,
    valid_until: fact.validUntil,
    claim_metric: fact.claimMetric,
    claim_value: fact.claimValue,
    claim_unit: fact.claimUnit,
    claim_period: fact.claimPeriod,
    evidence_url: fact.evidenceUrl,
    evidence_quote: fact.evidenceQuote,
    approved_by: fact.approvedBy,
    approved_at: fact.approvedAt,
    submitted_by: fact.submittedBy,
    submission_status: fact.submissionStatus,
    created_at: fact.createdAt,
    updated_at: fact.updatedAt,
  };
}

export function toPublicAuditLog(log: {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  previousStatus: string | null;
  nextStatus: string | null;
  reviewComment: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}) {
  return {
    id: log.id,
    actor_user_id: log.actorUserId,
    action: log.action,
    target_type: log.targetType,
    target_id: log.targetId,
    previous_status: log.previousStatus,
    next_status: log.nextStatus,
    review_comment: log.reviewComment,
    payload: log.payload,
    created_at: log.createdAt,
  };
}

export function toPublicLink(link: {
  id: string;
  sourceId: string;
  fromPageId: string;
  fromSlug: string;
  toSourceId: string | null;
  toSlug: string;
  linkType: string;
  context: string | null;
  confidence: number;
  createdBy: string;
  createdAt: Date;
}) {
  return {
    id: link.id,
    source_id: link.sourceId,
    from_page_id: link.fromPageId,
    from_slug: link.fromSlug,
    to_source_id: link.toSourceId,
    to_slug: link.toSlug,
    link_type: link.linkType,
    context: link.context,
    confidence: link.confidence,
    created_by: link.createdBy,
    created_at: link.createdAt,
  };
}

export function toPublicDreamRun(run: {
  id: string;
  target: unknown;
  triggeredBy: string;
  triggeredByUserId: string | null;
  dryRun: boolean;
  status: string;
  requestedPhases: unknown[];
  totals: Record<string, unknown>;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: run.id,
    target: run.target,
    triggered_by: run.triggeredBy,
    triggered_by_user_id: run.triggeredByUserId,
    dry_run: run.dryRun,
    status: run.status,
    requested_phases: run.requestedPhases,
    totals: run.totals,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    created_at: run.createdAt,
  };
}

export function toPublicDreamReport(report: {
  schemaVersion: string;
  runId: string;
  target: unknown;
  status: string;
  dryRun: boolean;
  requestedPhases: unknown[];
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  phases: unknown[];
  totals: Record<string, unknown>;
}) {
  return {
    schema_version: report.schemaVersion,
    run_id: report.runId,
    target: report.target,
    status: report.status,
    dry_run: report.dryRun,
    requested_phases: report.requestedPhases,
    started_at: report.startedAt,
    finished_at: report.finishedAt,
    duration_ms: report.durationMs,
    phases: report.phases,
    totals: report.totals,
  };
}

export function toPublicDreamLock(lock: {
  id: string;
  targetType: string;
  targetSourceId: string | null;
  targetUserId: string | null;
  holderId: string;
  holderHost: string | null;
  acquiredAt: Date;
  ttlExpiresAt: Date;
}) {
  return {
    id: lock.id,
    target_type: lock.targetType,
    target_source_id: lock.targetSourceId,
    target_user_id: lock.targetUserId,
    holder_id: lock.holderId,
    holder_host: lock.holderHost,
    acquired_at: lock.acquiredAt,
    ttl_expires_at: lock.ttlExpiresAt,
  };
}

export function toPublicDreamStatus(status: {
  checkedAt: Date;
  activeLocks: Parameters<typeof toPublicDreamLock>[0][];
  recentRuns: Parameters<typeof toPublicDreamRun>[0][];
  recentFailures: Parameters<typeof toPublicDreamRun>[0][];
}) {
  return {
    checked_at: status.checkedAt,
    active_locks: status.activeLocks.map(toPublicDreamLock),
    recent_runs: status.recentRuns.map(toPublicDreamRun),
    recent_failures: status.recentFailures.map(toPublicDreamRun),
  };
}
