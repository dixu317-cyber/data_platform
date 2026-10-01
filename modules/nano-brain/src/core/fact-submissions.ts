import { randomUUID } from 'node:crypto';
import type { UserContext } from '@ff/contracts';
import { getNanoBrainPool } from '../db';
import { NanoBrainPermissionError } from './permissions';
import { getSourceById, NanoBrainError } from './sources';

export type FactSubmissionStatus = 'pending_review' | 'needs_changes' | 'approved' | 'rejected';

export type FactSubmissionWarning = {
  code: 'missing_evidence';
  message: string;
};

export type FactSubmission = {
  id: string;
  targetSourceId: string;
  submittedBy: string;
  rawClaim: string;
  rawEvidenceText: string | null;
  rawEvidenceUrl: string | null;
  rawContext: string | null;
  warnings: FactSubmissionWarning[];
  status: FactSubmissionStatus;
  normalizedCandidates: unknown[];
  createdAt: Date;
  updatedAt: Date;
};

export type SubmitFactInput = {
  targetSourceId: string;
  rawClaim: string;
  rawEvidenceText?: string | null;
  rawEvidenceUrl?: string | null;
  rawContext?: string | null;
};

export type ListFactSubmissionsInput = {
  status?: FactSubmissionStatus;
  submittedBy?: string;
  targetSourceId?: string;
  limit?: number;
};

const MAX_CLAIM_LENGTH = 4000;
const MAX_EVIDENCE_TEXT_LENGTH = 12000;
const MAX_CONTEXT_LENGTH = 12000;
const MAX_URL_LENGTH = 2048;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function normalizeOptionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new NanoBrainError(`${label} 必须是字符串`, 'invalid_input');
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new NanoBrainError(`${label} 不能超过 ${maxLength} 个字符`, 'invalid_input');
  }
  return trimmed;
}

function normalizeRequiredText(value: unknown, label: string, maxLength: number): string {
  const normalized = normalizeOptionalText(value, label, maxLength);
  if (!normalized) throw new NanoBrainError(`${label} 不能为空`, 'invalid_input');
  return normalized;
}

function normalizeUrl(value: unknown): string | null {
  const url = normalizeOptionalText(value, '证据 URL', MAX_URL_LENGTH);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return parsed.toString();
  } catch {
    throw new NanoBrainError('证据 URL 必须是合法的 http(s) URL', 'invalid_input');
  }
}

function normalizeStatus(value: string | undefined): FactSubmissionStatus | undefined {
  if (value === undefined) return undefined;
  if (value === 'pending_review' || value === 'needs_changes' || value === 'approved' || value === 'rejected') {
    return value;
  }
  throw new NanoBrainError('submission status 不合法', 'invalid_input');
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new NanoBrainError(`limit 必须是 1 到 ${MAX_LIMIT} 的整数`, 'invalid_input');
  }
  return value;
}

function buildWarnings(input: { rawEvidenceText: string | null; rawEvidenceUrl: string | null }): FactSubmissionWarning[] {
  if (input.rawEvidenceText || input.rawEvidenceUrl) return [];
  return [{ code: 'missing_evidence', message: '未提供证据文本或证据 URL，审核时需要重点确认事实来源。' }];
}

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
    warnings: parseJsonArray(row.warnings) as FactSubmissionWarning[],
    status: row.status,
    normalizedCandidates: parseJsonArray(row.normalized_candidates),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertPublicTargetSource(targetSourceId: string): Promise<void> {
  const source = await getSourceById(targetSourceId);
  if (!source) throw new NanoBrainError('目标 source 不存在', 'not_found');
  if (source.kind !== 'public') {
    throw new NanoBrainError('事实只能提交到公共 source', 'invalid_input');
  }
}

async function assertCanReadSubmission(ctx: UserContext, submission: FactSubmission): Promise<void> {
  if (ctx.isAdmin) return;
  if (submission.submittedBy !== ctx.userId) {
    throw new NanoBrainPermissionError('无权读取该事实提交');
  }
}

export async function submitFactSubmission(ctx: UserContext, input: SubmitFactInput): Promise<FactSubmission> {
  if (typeof input.targetSourceId !== 'string' || !input.targetSourceId.trim()) {
    throw new NanoBrainError('target_source_id 不能为空', 'invalid_input');
  }
  const targetSourceId = input.targetSourceId.trim();
  await assertPublicTargetSource(targetSourceId);

  const rawClaim = normalizeRequiredText(input.rawClaim, '事实线索', MAX_CLAIM_LENGTH);
  const rawEvidenceText = normalizeOptionalText(input.rawEvidenceText, '证据文本', MAX_EVIDENCE_TEXT_LENGTH);
  const rawEvidenceUrl = normalizeUrl(input.rawEvidenceUrl);
  const rawContext = normalizeOptionalText(input.rawContext, '上下文', MAX_CONTEXT_LENGTH);
  const warnings = buildWarnings({ rawEvidenceText, rawEvidenceUrl });

  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      INSERT INTO fact_submissions (
        id,
        target_source_id,
        submitted_by,
        raw_claim,
        raw_evidence_text,
        raw_evidence_url,
        raw_context,
        warnings,
        status,
        normalized_candidates
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'pending_review', '[]'::jsonb)
      RETURNING id, target_source_id, submitted_by, raw_claim, raw_evidence_text, raw_evidence_url, raw_context,
        warnings, status, normalized_candidates, created_at, updated_at
    `,
    [randomUUID(), targetSourceId, ctx.userId, rawClaim, rawEvidenceText, rawEvidenceUrl, rawContext, JSON.stringify(warnings)],
  );
  return mapFactSubmission(result.rows[0]);
}

export async function getFactSubmission(ctx: UserContext, submissionId: string): Promise<FactSubmission> {
  if (!submissionId?.trim()) throw new NanoBrainError('submission id 不能为空', 'invalid_input');
  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT id, target_source_id, submitted_by, raw_claim, raw_evidence_text, raw_evidence_url, raw_context,
        warnings, status, normalized_candidates, created_at, updated_at
      FROM fact_submissions
      WHERE id = $1
    `,
    [submissionId.trim()],
  );
  if (!result.rows[0]) throw new NanoBrainError('事实提交不存在', 'not_found');
  const submission = mapFactSubmission(result.rows[0]);
  await assertCanReadSubmission(ctx, submission);
  return submission;
}

export async function listAdminFactSubmissions(ctx: UserContext, input: ListFactSubmissionsInput = {}): Promise<FactSubmission[]> {
  if (!ctx.isAdmin) {
    throw new NanoBrainPermissionError('只有管理员可以查看全部事实提交队列');
  }
  return listFactSubmissions(ctx, input);
}

export async function listFactSubmissions(ctx: UserContext, input: ListFactSubmissionsInput = {}): Promise<FactSubmission[]> {
  const status = normalizeStatus(input.status);
  const limit = normalizeLimit(input.limit);

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (!ctx.isAdmin) {
    values.push(ctx.userId);
    conditions.push(`submitted_by = $${values.length}`);
  } else if (input.submittedBy) {
    values.push(input.submittedBy);
    conditions.push(`submitted_by = $${values.length}`);
  }

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  if (input.targetSourceId) {
    values.push(input.targetSourceId);
    conditions.push(`target_source_id = $${values.length}`);
  }

  values.push(limit);
  const limitPlaceholder = `$${values.length}`;
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT id, target_source_id, submitted_by, raw_claim, raw_evidence_text, raw_evidence_url, raw_context,
        warnings, status, normalized_candidates, created_at, updated_at
      FROM fact_submissions
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limitPlaceholder}
    `,
    values,
  );

  return result.rows.map(mapFactSubmission);
}
