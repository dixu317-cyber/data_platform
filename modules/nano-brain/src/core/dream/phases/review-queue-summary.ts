import { getNanoBrainPool } from '../../../db';
import type { DreamPhaseHandlerContext } from '../runner';
import type { DreamPhaseResult } from '../types';

export const REVIEW_QUEUE_SUMMARY_PHASE_VERSION = 'm22.v1';

const REVIEWABLE_STATUSES = ['pending_review', 'needs_changes'] as const;
const MAX_SAMPLE_ITEMS = 20;

type JsonObject = Record<string, unknown>;

type ReviewableStatus = (typeof REVIEWABLE_STATUSES)[number];

type SubmissionRow = {
  id: string;
  target_source_id: string;
  submitted_by: string;
  raw_claim: string;
  raw_evidence_text: string | null;
  raw_evidence_url: string | null;
  status: ReviewableStatus;
  normalized_candidates: unknown;
  created_at: Date;
  updated_at: Date;
};

type ApprovedFactRow = {
  id: string;
  source_id: string;
  entity_slug: string | null;
  claim_metric: string | null;
  claim_value: number | string | null;
  claim_unit: string | null;
  claim_period: string | null;
  fact: string;
};

type GroupKey = {
  entitySlug: string;
  claimMetric: string | null;
  claimPeriod: string | null;
};

type CandidateSummary = {
  ref: string;
  submissionId: string;
  targetSourceId: string;
  status: ReviewableStatus;
  rawClaim: string;
  normalizedRawClaim: string;
  entitySlug: string;
  claimMetric: string | null;
  claimPeriod: string | null;
  claimValue: number | null;
  claimUnit: string | null;
};

type GroupSummary = {
  key: GroupKey;
  candidateCount: number;
  submissionIds: string[];
  candidates: CandidateSummary[];
};

type DuplicateItem = {
  groupKey: GroupKey;
  reason: 'same_raw_claim' | 'same_claim_value_unit';
  submissionIds: string[];
  candidateRefs: string[];
  normalizedRawClaim?: string;
  claimValue?: number;
  claimUnit?: string | null;
};

type ConflictItem = {
  groupKey: GroupKey;
  reason: 'submission_value_mismatch' | 'approved_fact_value_mismatch';
  submissionIds: string[];
  candidateRefs: string[];
  values: number[];
  approvedFacts?: Array<{ id: string; sourceId: string; claimValue: number; claimUnit: string | null; fact: string }>;
};

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEntitySlug(value: unknown): string {
  return normalizeOptionalString(value) ?? 'unknown';
}

function normalizeClaimNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeRawClaim(rawClaim: string): string {
  return rawClaim
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function candidateGroupKey(candidate: CandidateSummary | ApprovedFactRow): GroupKey {
  if ('entitySlug' in candidate) {
    return {
      entitySlug: candidate.entitySlug,
      claimMetric: candidate.claimMetric,
      claimPeriod: candidate.claimPeriod,
    };
  }

  return {
    entitySlug: normalizeEntitySlug(candidate.entity_slug),
    claimMetric: normalizeOptionalString(candidate.claim_metric),
    claimPeriod: normalizeOptionalString(candidate.claim_period),
  };
}

function groupKeyId(key: GroupKey): string {
  return JSON.stringify([key.entitySlug, key.claimMetric, key.claimPeriod]);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.map((value) => String(value)))].map(Number).sort((a, b) => a - b);
}

function sample<T>(items: T[]): T[] {
  return items.slice(0, MAX_SAMPLE_ITEMS);
}

function buildCandidateSummaries(submissions: SubmissionRow[]): CandidateSummary[] {
  const candidates: CandidateSummary[] = [];

  for (const submission of submissions) {
    const rawCandidates = parseJsonArray(submission.normalized_candidates);
    const normalizedRawClaim = normalizeRawClaim(submission.raw_claim);
    const candidateObjects = rawCandidates.length > 0 ? rawCandidates : [null];

    candidateObjects.forEach((rawCandidate, index) => {
      const object = rawCandidate && typeof rawCandidate === 'object' && !Array.isArray(rawCandidate) ? (rawCandidate as JsonObject) : {};
      candidates.push({
        ref: `${submission.id}#${index}`,
        submissionId: submission.id,
        targetSourceId: submission.target_source_id,
        status: submission.status,
        rawClaim: submission.raw_claim,
        normalizedRawClaim,
        entitySlug: normalizeEntitySlug(object.entity_slug),
        claimMetric: normalizeOptionalString(object.claim_metric),
        claimPeriod: normalizeOptionalString(object.claim_period),
        claimValue: normalizeClaimNumber(object.claim_value),
        claimUnit: normalizeOptionalString(object.claim_unit),
      });
    });
  }

  return candidates;
}

function groupCandidates(candidates: CandidateSummary[]): GroupSummary[] {
  const groups = new Map<string, GroupSummary>();

  for (const candidate of candidates) {
    const key = candidateGroupKey(candidate);
    const id = groupKeyId(key);
    const existing = groups.get(id);
    if (existing) {
      existing.candidateCount += 1;
      existing.candidates.push(candidate);
      existing.submissionIds = uniqueStrings([...existing.submissionIds, candidate.submissionId]);
    } else {
      groups.set(id, {
        key,
        candidateCount: 1,
        submissionIds: [candidate.submissionId],
        candidates: [candidate],
      });
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (b.candidateCount !== a.candidateCount) return b.candidateCount - a.candidateCount;
    return groupKeyId(a.key).localeCompare(groupKeyId(b.key));
  });
}

function findDuplicates(groups: GroupSummary[]): DuplicateItem[] {
  const duplicates: DuplicateItem[] = [];

  for (const group of groups) {
    const byRawClaim = new Map<string, CandidateSummary[]>();
    const byValueUnit = new Map<string, CandidateSummary[]>();

    for (const candidate of group.candidates) {
      if (candidate.normalizedRawClaim) {
        byRawClaim.set(candidate.normalizedRawClaim, [...(byRawClaim.get(candidate.normalizedRawClaim) ?? []), candidate]);
      }
      if (candidate.claimValue !== null) {
        const valueUnitKey = JSON.stringify([candidate.claimValue, candidate.claimUnit]);
        byValueUnit.set(valueUnitKey, [...(byValueUnit.get(valueUnitKey) ?? []), candidate]);
      }
    }

    for (const [normalizedRawClaim, items] of byRawClaim.entries()) {
      if (items.length < 2) continue;
      duplicates.push({
        groupKey: group.key,
        reason: 'same_raw_claim',
        submissionIds: uniqueStrings(items.map((item) => item.submissionId)),
        candidateRefs: uniqueStrings(items.map((item) => item.ref)),
        normalizedRawClaim,
      });
    }

    for (const [valueUnitKey, items] of byValueUnit.entries()) {
      if (items.length < 2) continue;
      const [claimValue, claimUnit] = JSON.parse(valueUnitKey) as [number, string | null];
      duplicates.push({
        groupKey: group.key,
        reason: 'same_claim_value_unit',
        submissionIds: uniqueStrings(items.map((item) => item.submissionId)),
        candidateRefs: uniqueStrings(items.map((item) => item.ref)),
        claimValue,
        claimUnit,
      });
    }
  }

  return duplicates;
}

function findSubmissionConflicts(groups: GroupSummary[]): ConflictItem[] {
  const conflicts: ConflictItem[] = [];

  for (const group of groups) {
    const valuedCandidates = group.candidates.filter((candidate) => candidate.claimValue !== null);
    const values = uniqueNumbers(valuedCandidates.map((candidate) => candidate.claimValue as number));
    if (values.length < 2) continue;
    conflicts.push({
      groupKey: group.key,
      reason: 'submission_value_mismatch',
      submissionIds: uniqueStrings(valuedCandidates.map((candidate) => candidate.submissionId)),
      candidateRefs: uniqueStrings(valuedCandidates.map((candidate) => candidate.ref)),
      values,
    });
  }

  return conflicts;
}

function buildApprovedFactMap(facts: ApprovedFactRow[]): Map<string, ApprovedFactRow[]> {
  const byGroup = new Map<string, ApprovedFactRow[]>();
  for (const fact of facts) {
    const key = candidateGroupKey(fact);
    const id = groupKeyId(key);
    byGroup.set(id, [...(byGroup.get(id) ?? []), fact]);
  }
  return byGroup;
}

function findApprovedFactConflicts(groups: GroupSummary[], facts: ApprovedFactRow[]): ConflictItem[] {
  const conflicts: ConflictItem[] = [];
  const approvedFactsByGroup = buildApprovedFactMap(facts);

  for (const group of groups) {
    const approvedFacts = approvedFactsByGroup.get(groupKeyId(group.key)) ?? [];
    if (approvedFacts.length === 0) continue;

    const valuedCandidates = group.candidates.filter((candidate) => candidate.claimValue !== null);
    if (valuedCandidates.length === 0) continue;

    const conflictingFacts = approvedFacts
      .map((fact) => ({
        id: fact.id,
        sourceId: fact.source_id,
        claimValue: normalizeClaimNumber(fact.claim_value),
        claimUnit: normalizeOptionalString(fact.claim_unit),
        fact: fact.fact,
      }))
      .filter((fact): fact is { id: string; sourceId: string; claimValue: number; claimUnit: string | null; fact: string } => fact.claimValue !== null)
      .filter((fact) => valuedCandidates.some((candidate) => candidate.claimValue !== fact.claimValue));

    if (conflictingFacts.length === 0) continue;

    conflicts.push({
      groupKey: group.key,
      reason: 'approved_fact_value_mismatch',
      submissionIds: uniqueStrings(valuedCandidates.map((candidate) => candidate.submissionId)),
      candidateRefs: uniqueStrings(valuedCandidates.map((candidate) => candidate.ref)),
      values: uniqueNumbers(valuedCandidates.map((candidate) => candidate.claimValue as number)),
      approvedFacts: sample(conflictingFacts),
    });
  }

  return conflicts;
}

async function getReviewableSubmissions(targetSourceId: string | undefined): Promise<SubmissionRow[]> {
  const values: unknown[] = [];
  const conditions = [`s.kind = 'public'`, `fs.status IN ('pending_review', 'needs_changes')`];

  if (targetSourceId) {
    values.push(targetSourceId);
    conditions.push(`fs.target_source_id = $${values.length}`);
  }

  const result = await getNanoBrainPool().query(
    `
      SELECT
        fs.id,
        fs.target_source_id,
        fs.submitted_by,
        fs.raw_claim,
        fs.raw_evidence_text,
        fs.raw_evidence_url,
        fs.status,
        fs.normalized_candidates,
        fs.created_at,
        fs.updated_at
      FROM fact_submissions fs
      JOIN sources s ON s.id = fs.target_source_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY fs.created_at ASC, fs.id ASC
    `,
    values,
  );

  return result.rows as SubmissionRow[];
}

async function getApprovedFacts(targetSourceId: string | undefined): Promise<ApprovedFactRow[]> {
  const values: unknown[] = [];
  const conditions = [`s.kind = 'public'`, `f.claim_value IS NOT NULL`];

  if (targetSourceId) {
    values.push(targetSourceId);
    conditions.push(`f.source_id = $${values.length}`);
  }

  const result = await getNanoBrainPool().query(
    `
      SELECT
        f.id,
        f.source_id,
        f.entity_slug,
        f.claim_metric,
        f.claim_value,
        f.claim_unit,
        f.claim_period,
        f.fact
      FROM facts f
      JOIN sources s ON s.id = f.source_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY f.created_at ASC, f.id ASC
    `,
    values,
  );

  return result.rows as ApprovedFactRow[];
}

function countByStatus(submissions: SubmissionRow[]): Record<ReviewableStatus, number> {
  return submissions.reduce<Record<ReviewableStatus, number>>(
    (counts, submission) => {
      counts[submission.status] += 1;
      return counts;
    },
    { pending_review: 0, needs_changes: 0 },
  );
}

function buildDetails(input: {
  ctx: DreamPhaseHandlerContext;
  submissions: SubmissionRow[];
  groups: GroupSummary[];
  duplicates: DuplicateItem[];
  conflicts: ConflictItem[];
}): JsonObject {
  const missingEvidenceItems = input.submissions
    .filter((submission) => !normalizeOptionalString(submission.raw_evidence_text) && !normalizeOptionalString(submission.raw_evidence_url))
    .map((submission) => ({
      id: submission.id,
      targetSourceId: submission.target_source_id,
      status: submission.status,
      rawClaim: submission.raw_claim,
    }));
  const statusCounts = countByStatus(input.submissions);

  return {
    phaseVersion: REVIEW_QUEUE_SUMMARY_PHASE_VERSION,
    dryRun: input.ctx.dryRun,
    targetType: 'review_queue',
    targetSourceId: input.ctx.target.type === 'review_queue' ? (input.ctx.target.targetSourceId ?? null) : null,
    statusCounts: {
      ...statusCounts,
      total: input.submissions.length,
    },
    candidateCount: input.groups.reduce((count, group) => count + group.candidateCount, 0),
    missingEvidence: {
      count: missingEvidenceItems.length,
      submissionIds: missingEvidenceItems.map((item) => item.id),
      items: sample(missingEvidenceItems),
    },
    groups: input.groups.map((group) => ({
      key: group.key,
      candidateCount: group.candidateCount,
      submissionIds: group.submissionIds,
      candidates: sample(group.candidates),
    })),
    possibleDuplicates: {
      count: input.duplicates.length,
      items: sample(input.duplicates),
    },
    possibleConflicts: {
      count: input.conflicts.length,
      items: sample(input.conflicts),
    },
    readOnly: true,
  };
}

export async function runReviewQueueSummaryPhase(ctx: DreamPhaseHandlerContext): Promise<Omit<DreamPhaseResult, 'phase' | 'durationMs'>> {
  if (ctx.target.type !== 'review_queue') {
    return {
      status: 'skipped',
      summary: 'review_queue_summary is not applicable to source targets',
      details: {
        reason: 'not_applicable',
        phaseVersion: REVIEW_QUEUE_SUMMARY_PHASE_VERSION,
        dryRun: ctx.dryRun,
        targetType: ctx.target.type,
      },
    };
  }

  const targetSourceId = ctx.target.targetSourceId;
  const [submissions, approvedFacts] = await Promise.all([getReviewableSubmissions(targetSourceId), getApprovedFacts(targetSourceId)]);
  const candidates = buildCandidateSummaries(submissions);
  const groups = groupCandidates(candidates);
  const duplicates = findDuplicates(groups);
  const conflicts = [...findSubmissionConflicts(groups), ...findApprovedFactConflicts(groups, approvedFacts)];
  const details = buildDetails({ ctx, submissions, groups, duplicates, conflicts });
  const issueCount = (details.missingEvidence as { count: number }).count + duplicates.length + conflicts.length;

  return {
    status: submissions.length === 0 && issueCount === 0 ? 'clean' : 'ok',
    summary:
      submissions.length === 0
        ? 'review_queue_summary found no pending review submissions'
        : `review_queue_summary analyzed ${submissions.length} submission(s), ${groups.length} group(s), ${issueCount} review signal(s)`,
    details,
  };
}
