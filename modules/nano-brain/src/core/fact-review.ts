import type { UserContext } from '@ff/contracts';
import { getNanoBrainPool } from '../db';
import { insertAuditLog, type AuditLog } from './audit';
import { registerConflictsForFact } from './fact-conflicts';
import { embedApprovedFact, insertApprovedFact, normalizeApprovedFact, type ApprovedFactInput, type NanoFact } from './facts';
import { getFactSubmission, type FactSubmission, type FactSubmissionStatus } from './fact-submissions';
import { NanoBrainPermissionError } from './permissions';
import { NanoBrainError } from './sources';

export type FactReviewAction = 'approve' | 'reject' | 'request_changes';

export type ReviewFactSubmissionInput = {
  submissionId: string;
  action: FactReviewAction;
  approvedFact?: unknown;
  reviewComment?: string | null;
};

export type FactReviewResult = {
  submission: FactSubmission;
  fact: NanoFact | null;
  auditLog: AuditLog;
  // 004 · FR-160:审核结果暴露检索索引状态。true = 向量索引待生成(嵌入失败,fact 仍入库、仍可关键词召回)。
  retrievalIndexPending: boolean;
  retrievalNote: string | null;
};

const RETRIEVAL_INDEX_PENDING_NOTE = '检索索引待生成（嵌入服务暂不可用，稍后由 dream 相位补嵌）';

const MAX_REVIEW_COMMENT_LENGTH = 4000;

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

function mapFactSubmission(row: any): FactSubmission {
  return {
    id: row.id,
    targetSourceId: row.target_source_id,
    submittedBy: row.submitted_by,
    rawClaim: row.raw_claim,
    rawEvidenceText: row.raw_evidence_text,
    rawEvidenceUrl: row.raw_evidence_url,
    rawContext: row.raw_context,
    warnings: parseJsonArray(row.warnings) as any,
    status: row.status,
    normalizedCandidates: parseJsonArray(row.normalized_candidates),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeAction(value: unknown): FactReviewAction {
  if (value === 'approve' || value === 'reject' || value === 'request_changes') return value;
  throw new NanoBrainError('审核动作不合法', 'invalid_input');
}

function normalizeReviewComment(value: unknown, action: FactReviewAction): string | null {
  if (value === undefined || value === null) {
    if (action === 'reject' || action === 'request_changes') {
      throw new NanoBrainError('驳回或要求补充时必须提供审核说明', 'invalid_input');
    }
    return null;
  }
  if (typeof value !== 'string') throw new NanoBrainError('审核说明必须是字符串', 'invalid_input');
  const trimmed = value.trim();
  if (!trimmed) {
    if (action === 'reject' || action === 'request_changes') {
      throw new NanoBrainError('驳回或要求补充时必须提供审核说明', 'invalid_input');
    }
    return null;
  }
  if (trimmed.length > MAX_REVIEW_COMMENT_LENGTH) {
    throw new NanoBrainError(`审核说明不能超过 ${MAX_REVIEW_COMMENT_LENGTH} 个字符`, 'invalid_input');
  }
  return trimmed;
}

function nextStatusForAction(action: FactReviewAction): FactSubmissionStatus {
  if (action === 'approve') return 'approved';
  if (action === 'reject') return 'rejected';
  return 'needs_changes';
}

function auditActionForReview(action: FactReviewAction) {
  if (action === 'approve') return 'fact_submission.approve' as const;
  if (action === 'reject') return 'fact_submission.reject' as const;
  return 'fact_submission.request_changes' as const;
}

function toRawSubmissionPayload(submission: FactSubmission) {
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
    created_at: submission.createdAt,
    updated_at: submission.updatedAt,
  };
}

function toApprovedPayload(approvedFact: ApprovedFactInput | null) {
  if (!approvedFact) return null;
  return {
    entity_slug: approvedFact.entitySlug,
    fact: approvedFact.fact,
    kind: approvedFact.kind,
    confidence: approvedFact.confidence,
    notability: approvedFact.notability,
    context: approvedFact.context,
    valid_from: approvedFact.validFrom,
    valid_until: approvedFact.validUntil,
    claim_metric: approvedFact.claimMetric,
    claim_value: approvedFact.claimValue,
    claim_unit: approvedFact.claimUnit,
    claim_period: approvedFact.claimPeriod,
    evidence_url: approvedFact.evidenceUrl,
    evidence_quote: approvedFact.evidenceQuote,
  };
}

async function getSubmissionForUpdate(client: any, submissionId: string): Promise<FactSubmission> {
  const result = await client.query(
    `
      SELECT id, target_source_id, submitted_by, raw_claim, raw_evidence_text, raw_evidence_url, raw_context,
        warnings, status, normalized_candidates, created_at, updated_at
      FROM fact_submissions
      WHERE id = $1
      FOR UPDATE
    `,
    [submissionId],
  );
  if (!result.rows[0]) throw new NanoBrainError('事实提交不存在', 'not_found');
  return mapFactSubmission(result.rows[0]);
}

export async function reviewFactSubmission(ctx: UserContext, input: ReviewFactSubmissionInput): Promise<FactReviewResult> {
  if (!ctx.isAdmin) {
    throw new NanoBrainPermissionError('只有管理员可以审核事实提交');
  }
  if (!input.submissionId?.trim()) throw new NanoBrainError('submission id 不能为空', 'invalid_input');

  const action = normalizeAction(input.action);
  const reviewComment = normalizeReviewComment(input.reviewComment, action);
  const approvedFact = action === 'approve' ? normalizeApprovedFact(input.approvedFact) : null;

  const pool = getNanoBrainPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const submission = await getSubmissionForUpdate(client, input.submissionId.trim());
    if (submission.status === 'approved' || submission.status === 'rejected') {
      throw new NanoBrainError('已完成审核的 submission 不能再次审核', 'invalid_input');
    }

    let fact: NanoFact | null = null;
    const nextStatus = nextStatusForAction(action);
    if (approvedFact) {
      fact = await insertApprovedFact(client, { actorUserId: ctx.userId, submission, approvedFact });
      // 015 · T4 · FR-396:审核时检测冲突并登记(同事务)。冲突仅"标记+进队列 open",
      // 不阻断入库——fact 照常 approved 落库,矛盾旁挂待裁决(唯一约束保证重跑幂等)。
      await registerConflictsForFact(client, fact);
    }

    await client.query(
      `
        UPDATE fact_submissions
        SET status = $2,
            updated_at = now()
        WHERE id = $1
      `,
      [submission.id, nextStatus],
    );

    const auditLog = await insertAuditLog(client, {
      actorUserId: ctx.userId,
      action: auditActionForReview(action),
      targetType: 'fact_submission',
      targetId: submission.id,
      previousStatus: submission.status,
      nextStatus,
      reviewComment,
      payload: {
        raw_submission: toRawSubmissionPayload(submission),
        normalized_candidates: submission.normalizedCandidates,
        approved_payload: toApprovedPayload(approvedFact),
        fact_id: fact?.id ?? null,
      },
    });

    await client.query('COMMIT');

    // FR-160:审核事务已提交(fact 结构化数据已落库)——**之后**才补嵌入索引。
    // 嵌入失败绝不回滚 fact:embedApprovedFact 内部吞异常、标 retrievable 待补。
    let retrievalIndexPending = false;
    if (fact) {
      const { embedded } = await embedApprovedFact(fact);
      retrievalIndexPending = !embedded;
      fact = { ...fact, retrievable: embedded };
    }

    const updatedSubmission = await getFactSubmission(ctx, submission.id);
    return {
      submission: updatedSubmission,
      fact,
      auditLog,
      retrievalIndexPending,
      retrievalNote: retrievalIndexPending ? RETRIEVAL_INDEX_PENDING_NOTE : null,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
