import { getNanoBrainPool } from '../../../db';
import type { DreamPhaseHandlerContext } from '../runner';
import type { DreamPhaseResult, DreamTarget } from '../types';

export const HEALTH_CHECK_PHASE_VERSION = 'm21.v1';

const MAX_REPORTED_ITEMS = 10;
const RECENT_FAILED_RUN_LIMIT = 5;

type JsonObject = Record<string, unknown>;

type CountRow = Record<string, unknown>;

type SourcePageCounts = {
  total: number;
  active: number;
  archived: number;
  dreamGenerated: number;
};

type SourceChunkCounts = {
  total: number;
  pagesWithChunks: number;
  missingEmbeddings: number;
};

type SourceLinkCounts = {
  total: number;
};

type SourceFactCounts = {
  total: number;
};

type PendingSubmissionCounts = {
  pending: number;
};

type StaleEmbeddingsReport =
  | {
      status: 'available';
      currentModel: string;
      staleChunks: number;
      stalePages: number;
      missingChunks: number;
      staleModelCounts: Record<string, number>;
    }
  | {
      status: 'unavailable';
      staleChunks: null;
      stalePages: null;
      missingChunks: number;
      error: { message: string };
    };

type DanglingLinksReport = {
  count: number;
  samples: Array<{
    id: string;
    fromSlug: string;
    toSlug: string;
    linkType: string;
  }>;
};

type OrphanPagesReport = {
  count: number;
  samples: Array<{
    id: string;
    slug: string;
    title: string;
  }>;
};

type RecentFailedRunsReport = {
  count: number;
  items: Array<{
    id: string;
    status: string;
    targetType: string;
    targetSourceId: string | null;
    targetUserId: string | null;
    createdAt: Date;
    finishedAt: Date | null;
  }>;
};

type ReviewQueueCounts = {
  pending: number;
  needs_changes: number;
  approved: number;
  rejected: number;
  total: number;
};

function asNumber(value: unknown): number {
  return Number(value ?? 0);
}

function currentEmbeddingModel(): { ok: true; model: string } | { ok: false; message: string } {
  const model = process.env.EMBEDDING_MODEL?.trim();
  if (!model) return { ok: false, message: '缺少 EMBEDDING_MODEL，无法判断 stale embeddings' };
  return { ok: true, model };
}

async function getSourcePageCounts(sourceId: string): Promise<SourcePageCounts> {
  const result = await getNanoBrainPool().query(
    `
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE archived_at IS NULL)::int AS active,
        count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived,
        count(*) FILTER (
          WHERE archived_at IS NULL
            AND metadata @> '{"dream_generated": true}'::jsonb
        )::int AS dream_generated
      FROM pages
      WHERE source_id = $1
    `,
    [sourceId],
  );
  const row = result.rows[0] as CountRow | undefined;
  return {
    total: asNumber(row?.total),
    active: asNumber(row?.active),
    archived: asNumber(row?.archived),
    dreamGenerated: asNumber(row?.dream_generated),
  };
}

async function getSourceChunkCounts(sourceId: string): Promise<SourceChunkCounts> {
  const result = await getNanoBrainPool().query(
    `
      SELECT
        count(*)::int AS total,
        count(DISTINCT page_id)::int AS pages_with_chunks,
        count(*) FILTER (WHERE embedding IS NULL)::int AS missing_embeddings
      FROM chunks
      WHERE source_id = $1
    `,
    [sourceId],
  );
  const row = result.rows[0] as CountRow | undefined;
  return {
    total: asNumber(row?.total),
    pagesWithChunks: asNumber(row?.pages_with_chunks),
    missingEmbeddings: asNumber(row?.missing_embeddings),
  };
}

async function getSourceLinkCounts(sourceId: string): Promise<SourceLinkCounts> {
  const result = await getNanoBrainPool().query(
    `SELECT count(*)::int AS total FROM links WHERE source_id = $1`,
    [sourceId],
  );
  return { total: asNumber(result.rows[0]?.total) };
}

async function getSourceFactCounts(sourceId: string): Promise<SourceFactCounts> {
  const result = await getNanoBrainPool().query(
    `SELECT count(*)::int AS total FROM facts WHERE source_id = $1`,
    [sourceId],
  );
  return { total: asNumber(result.rows[0]?.total) };
}

async function getPendingSubmissionCounts(sourceId: string): Promise<PendingSubmissionCounts> {
  const result = await getNanoBrainPool().query(
    `
      SELECT count(*)::int AS pending
      FROM fact_submissions
      WHERE target_source_id = $1
        AND status = 'pending_review'
    `,
    [sourceId],
  );
  return { pending: asNumber(result.rows[0]?.pending) };
}

async function getStaleEmbeddingsReport(sourceId: string, missingChunks: number): Promise<StaleEmbeddingsReport> {
  const model = currentEmbeddingModel();
  if (!model.ok) {
    return {
      status: 'unavailable',
      staleChunks: null,
      stalePages: null,
      missingChunks,
      error: { message: model.message },
    };
  }

  const [staleResult, modelCountsResult] = await Promise.all([
    getNanoBrainPool().query(
      `
        SELECT
          count(*)::int AS stale_chunks,
          count(DISTINCT page_id)::int AS stale_pages
        FROM chunks
        WHERE source_id = $1
          AND embedding_model IS DISTINCT FROM $2
      `,
      [sourceId, model.model],
    ),
    getNanoBrainPool().query(
      `
        SELECT COALESCE(embedding_model, '<missing>') AS embedding_model, count(*)::int AS count
        FROM chunks
        WHERE source_id = $1
          AND embedding_model IS DISTINCT FROM $2
        GROUP BY COALESCE(embedding_model, '<missing>')
        ORDER BY count DESC, embedding_model ASC
      `,
      [sourceId, model.model],
    ),
  ]);

  const staleRow = staleResult.rows[0] as CountRow | undefined;
  const staleModelCounts = modelCountsResult.rows.reduce<Record<string, number>>((counts, row: any) => {
    counts[String(row.embedding_model)] = asNumber(row.count);
    return counts;
  }, {});

  return {
    status: 'available',
    currentModel: model.model,
    staleChunks: asNumber(staleRow?.stale_chunks),
    stalePages: asNumber(staleRow?.stale_pages),
    missingChunks,
    staleModelCounts,
  };
}

async function getDanglingLinksReport(sourceId: string): Promise<DanglingLinksReport> {
  const [countResult, sampleResult] = await Promise.all([
    getNanoBrainPool().query(
      `
        SELECT count(*)::int AS count
        FROM links l
        LEFT JOIN pages target_page
          ON target_page.source_id = l.source_id
         AND target_page.slug = l.to_slug
         AND target_page.archived_at IS NULL
        WHERE l.source_id = $1
          AND target_page.id IS NULL
      `,
      [sourceId],
    ),
    getNanoBrainPool().query(
      `
        SELECT l.id, l.from_slug, l.to_slug, l.link_type
        FROM links l
        LEFT JOIN pages target_page
          ON target_page.source_id = l.source_id
         AND target_page.slug = l.to_slug
         AND target_page.archived_at IS NULL
        WHERE l.source_id = $1
          AND target_page.id IS NULL
        ORDER BY l.from_slug ASC, l.to_slug ASC, l.link_type ASC, l.id ASC
        LIMIT $2
      `,
      [sourceId, MAX_REPORTED_ITEMS],
    ),
  ]);

  return {
    count: asNumber(countResult.rows[0]?.count),
    samples: sampleResult.rows.map((row: any) => ({
      id: row.id,
      fromSlug: row.from_slug,
      toSlug: row.to_slug,
      linkType: row.link_type,
    })),
  };
}

async function getOrphanPagesReport(sourceId: string): Promise<OrphanPagesReport> {
  const orphanWhere = `
    p.source_id = $1
    AND p.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM links outgoing
      WHERE outgoing.source_id = p.source_id
        AND outgoing.from_page_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM links incoming
      WHERE incoming.source_id = p.source_id
        AND incoming.to_slug = p.slug
    )
  `;

  const [countResult, sampleResult] = await Promise.all([
    getNanoBrainPool().query(`SELECT count(*)::int AS count FROM pages p WHERE ${orphanWhere}`, [sourceId]),
    getNanoBrainPool().query(
      `
        SELECT p.id, p.slug, p.title
        FROM pages p
        WHERE ${orphanWhere}
        ORDER BY p.slug ASC, p.id ASC
        LIMIT $2
      `,
      [sourceId, MAX_REPORTED_ITEMS],
    ),
  ]);

  return {
    count: asNumber(countResult.rows[0]?.count),
    samples: sampleResult.rows.map((row: any) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
    })),
  };
}

function recentFailedRunsWhere(target: DreamTarget): { sql: string; params: unknown[] } {
  if (target.type === 'user_source') {
    return {
      sql: `target_type = 'user_source' AND target_source_id = $1 AND target_user_id = $2`,
      params: [target.sourceId, target.userId],
    };
  }

  if (target.type === 'public_source') {
    return {
      sql: `target_type = 'public_source' AND target_source_id = $1 AND target_user_id IS NULL`,
      params: [target.sourceId],
    };
  }

  if (target.targetSourceId) {
    return {
      sql: `target_type = 'review_queue' AND target_source_id = $1 AND target_user_id IS NULL`,
      params: [target.targetSourceId],
    };
  }

  return {
    sql: `target_type = 'review_queue' AND target_user_id IS NULL`,
    params: [],
  };
}

async function getRecentFailedRunsReport(target: DreamTarget, currentRunId: string): Promise<RecentFailedRunsReport> {
  const targetWhere = recentFailedRunsWhere(target);
  const currentRunParam = targetWhere.params.length + 1;
  const limitParam = targetWhere.params.length + 2;
  const params = [...targetWhere.params, currentRunId, RECENT_FAILED_RUN_LIMIT];

  const [countResult, itemsResult] = await Promise.all([
    getNanoBrainPool().query(
      `
        SELECT count(*)::int AS count
        FROM dream_runs
        WHERE ${targetWhere.sql}
          AND id <> $${currentRunParam}
          AND status = 'failed'
      `,
      params.slice(0, currentRunParam),
    ),
    getNanoBrainPool().query(
      `
        SELECT id, status, target_type, target_source_id, target_user_id, created_at, finished_at
        FROM dream_runs
        WHERE ${targetWhere.sql}
          AND id <> $${currentRunParam}
          AND status = 'failed'
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitParam}
      `,
      params,
    ),
  ]);

  return {
    count: asNumber(countResult.rows[0]?.count),
    items: itemsResult.rows.map((row: any) => ({
      id: row.id,
      status: row.status,
      targetType: row.target_type,
      targetSourceId: row.target_source_id,
      targetUserId: row.target_user_id,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    })),
  };
}

async function buildSourceHealthDetails(ctx: DreamPhaseHandlerContext): Promise<JsonObject> {
  if (ctx.target.type === 'review_queue') {
    throw new Error('source health details require a source target');
  }

  const sourceId = ctx.target.sourceId;
  const [pages, chunks, links, facts, pendingSubmissions, danglingLinks, orphanPages, recentFailedDreamRuns] = await Promise.all([
    getSourcePageCounts(sourceId),
    getSourceChunkCounts(sourceId),
    getSourceLinkCounts(sourceId),
    getSourceFactCounts(sourceId),
    getPendingSubmissionCounts(sourceId),
    getDanglingLinksReport(sourceId),
    getOrphanPagesReport(sourceId),
    getRecentFailedRunsReport(ctx.target, ctx.runId),
  ]);
  const staleEmbeddings = await getStaleEmbeddingsReport(sourceId, chunks.missingEmbeddings);

  return {
    phaseVersion: HEALTH_CHECK_PHASE_VERSION,
    dryRun: ctx.dryRun,
    targetType: ctx.target.type,
    source: ctx.source
      ? {
          id: ctx.source.id,
          kind: ctx.source.kind,
          ownerUserId: ctx.source.ownerUserId,
        }
      : { id: sourceId },
    pages,
    chunks,
    links,
    facts,
    pendingSubmissions,
    staleEmbeddings,
    danglingLinks,
    orphanPages,
    recentFailedDreamRuns,
  };
}

async function getReviewQueueCounts(targetSourceId: string | undefined): Promise<ReviewQueueCounts> {
  const values: unknown[] = [];
  const conditions = [`s.kind = 'public'`];
  if (targetSourceId) {
    values.push(targetSourceId);
    conditions.push(`fs.target_source_id = $${values.length}`);
  }

  const result = await getNanoBrainPool().query(
    `
      SELECT
        count(*) FILTER (WHERE fs.status = 'pending_review')::int AS pending,
        count(*) FILTER (WHERE fs.status = 'needs_changes')::int AS needs_changes,
        count(*) FILTER (WHERE fs.status = 'approved')::int AS approved,
        count(*) FILTER (WHERE fs.status = 'rejected')::int AS rejected,
        count(*)::int AS total
      FROM fact_submissions fs
      JOIN sources s ON s.id = fs.target_source_id
      WHERE ${conditions.join(' AND ')}
    `,
    values,
  );

  const row = result.rows[0] as CountRow | undefined;
  return {
    pending: asNumber(row?.pending),
    needs_changes: asNumber(row?.needs_changes),
    approved: asNumber(row?.approved),
    rejected: asNumber(row?.rejected),
    total: asNumber(row?.total),
  };
}

async function buildReviewQueueHealthDetails(ctx: DreamPhaseHandlerContext): Promise<JsonObject> {
  const targetSourceId = ctx.target.type === 'review_queue' ? ctx.target.targetSourceId : undefined;
  const [queue, recentFailedDreamRuns] = await Promise.all([getReviewQueueCounts(targetSourceId), getRecentFailedRunsReport(ctx.target, ctx.runId)]);

  return {
    phaseVersion: HEALTH_CHECK_PHASE_VERSION,
    dryRun: ctx.dryRun,
    targetType: 'review_queue',
    targetSourceId: targetSourceId ?? null,
    reviewQueue: queue,
    recentFailedDreamRuns,
  };
}

function sourceIssueCount(details: JsonObject): number {
  const pendingSubmissions = details.pendingSubmissions as PendingSubmissionCounts;
  const staleEmbeddings = details.staleEmbeddings as StaleEmbeddingsReport;
  const danglingLinks = details.danglingLinks as DanglingLinksReport;
  const orphanPages = details.orphanPages as OrphanPagesReport;
  const recentFailedDreamRuns = details.recentFailedDreamRuns as RecentFailedRunsReport;

  let issues = 0;
  if (pendingSubmissions.pending > 0) issues += 1;
  if (staleEmbeddings.status === 'available' && staleEmbeddings.staleChunks > 0) issues += 1;
  if (staleEmbeddings.missingChunks > 0) issues += 1;
  if (danglingLinks.count > 0) issues += 1;
  if (orphanPages.count > 0) issues += 1;
  if (recentFailedDreamRuns.count > 0) issues += 1;
  return issues;
}

function reviewQueueIssueCount(details: JsonObject): number {
  const queue = details.reviewQueue as ReviewQueueCounts;
  const recentFailedDreamRuns = details.recentFailedDreamRuns as RecentFailedRunsReport;
  let issues = 0;
  if (queue.pending > 0) issues += 1;
  if (queue.needs_changes > 0) issues += 1;
  if (recentFailedDreamRuns.count > 0) issues += 1;
  return issues;
}

export async function runHealthCheckPhase(ctx: DreamPhaseHandlerContext): Promise<Omit<DreamPhaseResult, 'phase' | 'durationMs'>> {
  if (ctx.target.type === 'review_queue') {
    const details = await buildReviewQueueHealthDetails(ctx);
    const issues = reviewQueueIssueCount(details);
    return {
      status: issues > 0 ? 'ok' : 'clean',
      summary:
        issues > 0
          ? `health_check found ${issues} review queue health signal(s)`
          : 'health_check found no review queue health issues',
      details,
    };
  }

  const details = await buildSourceHealthDetails(ctx);
  const issues = sourceIssueCount(details);
  return {
    status: issues > 0 ? 'ok' : 'clean',
    summary: issues > 0 ? `health_check found ${issues} source health issue(s)` : 'health_check found no source health issues',
    details,
  };
}
