import type pg from 'pg';
import { getNanoBrainPool } from '../../../db';
import { extractLinksFromMarkdown, replacePageLinks } from '../../links';
import type { DreamPhaseHandlerContext } from '../runner';
import type { DreamPhaseResult } from '../types';

export const EXTRACT_LINKS_PHASE_VERSION = 'm19.v1';

type JsonObject = Record<string, unknown>;

type ExtractLinksPageRow = {
  id: string;
  source_id: string;
  slug: string;
  body: string;
  content_hash: string;
  updated_by: string;
  state_phase_version: string | null;
  state_content_hash: string | null;
};

type ExistingLinkRow = {
  from_page_id: string;
  to_slug: string;
  link_type: string;
  context: string | null;
  confidence: number | string;
};

type PlannedPage = {
  id: string;
  sourceId: string;
  slug: string;
  body: string;
  contentHash: string;
  updatedBy: string;
  extractedLinkCount: number;
  existingLinkCount: number;
  reason: 'state_missing' | 'content_changed' | 'phase_version_changed' | 'links_out_of_sync';
};

type ExtractLinksPlan = {
  totalPages: number;
  archivedPages: number;
  dreamGeneratedPages: number;
  eligiblePages: number;
  skippedUnchangedPages: number;
  staleLinksToDelete: number;
  linksToWrite: number;
  pages: PlannedPage[];
};

function linkSignature(link: { toSlug?: string; to_slug?: string; linkType?: string; link_type?: string; context: string | null; confidence: number | string }): string {
  const toSlug = 'toSlug' in link ? link.toSlug : link.to_slug;
  const linkType = 'linkType' in link ? link.linkType : link.link_type;
  return `${linkType}\u0000${toSlug}\u0000${link.context ?? ''}\u0000${Number(link.confidence)}`;
}

function existingLinksMatchExtracted(existing: ExistingLinkRow[], extracted: ReturnType<typeof extractLinksFromMarkdown>): boolean {
  if (existing.length !== extracted.length) return false;

  const existingSignatures = new Set(existing.map(linkSignature));
  if (existingSignatures.size !== extracted.length) return false;

  for (const link of extracted) {
    if (!existingSignatures.has(linkSignature(link))) return false;
  }
  return true;
}

async function getSourcePageCounts(sourceId: string): Promise<{ totalPages: number; archivedPages: number; dreamGeneratedPages: number }> {
  const result = await getNanoBrainPool().query(
    `
      SELECT
        count(*)::int AS total_pages,
        count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived_pages,
        count(*) FILTER (
          WHERE archived_at IS NULL
            AND metadata @> '{"dream_generated": true}'::jsonb
        )::int AS dream_generated_pages
      FROM pages
      WHERE source_id = $1
    `,
    [sourceId],
  );

  const row = result.rows[0] ?? {};
  return {
    totalPages: Number(row.total_pages ?? 0),
    archivedPages: Number(row.archived_pages ?? 0),
    dreamGeneratedPages: Number(row.dream_generated_pages ?? 0),
  };
}

async function listEligiblePages(sourceId: string): Promise<ExtractLinksPageRow[]> {
  const result = await getNanoBrainPool().query(
    `
      SELECT
        p.id,
        p.source_id,
        p.slug,
        p.body,
        p.content_hash,
        p.updated_by,
        pds.phase_version AS state_phase_version,
        pds.content_hash AS state_content_hash
      FROM pages p
      LEFT JOIN page_dream_state pds
        ON pds.page_id = p.id
       AND pds.phase = 'extract_links'
      WHERE p.source_id = $1
        AND p.archived_at IS NULL
        AND NOT (p.metadata @> '{"dream_generated": true}'::jsonb)
      ORDER BY p.updated_at ASC, p.slug ASC
    `,
    [sourceId],
  );
  return result.rows;
}

async function getExistingLinksByPage(pageIds: string[]): Promise<Map<string, ExistingLinkRow[]>> {
  const linksByPage = new Map<string, ExistingLinkRow[]>();
  if (pageIds.length === 0) return linksByPage;

  const result = await getNanoBrainPool().query(
    `
      SELECT from_page_id, to_slug, link_type, context, confidence
      FROM links
      WHERE from_page_id = ANY($1::text[])
        AND origin = 'manual'
      ORDER BY from_page_id ASC, link_type ASC, to_slug ASC
    `,
    [pageIds],
  );

  for (const row of result.rows as ExistingLinkRow[]) {
    const pageLinks = linksByPage.get(row.from_page_id) ?? [];
    pageLinks.push(row);
    linksByPage.set(row.from_page_id, pageLinks);
  }

  return linksByPage;
}

async function buildExtractLinksPlan(sourceId: string): Promise<ExtractLinksPlan> {
  const counts = await getSourcePageCounts(sourceId);
  const pages = await listEligiblePages(sourceId);
  const existingLinksByPage = await getExistingLinksByPage(pages.map((page) => page.id));
  const plannedPages: PlannedPage[] = [];
  let skippedUnchangedPages = 0;
  let staleLinksToDelete = 0;
  let linksToWrite = 0;

  for (const page of pages) {
    const extractedLinks = extractLinksFromMarkdown(page.body);
    const existingLinks = existingLinksByPage.get(page.id) ?? [];
    const stateIsCurrent = page.state_content_hash === page.content_hash && page.state_phase_version === EXTRACT_LINKS_PHASE_VERSION;
    const linksAreCurrent = existingLinksMatchExtracted(existingLinks, extractedLinks);

    let reason: PlannedPage['reason'] | null = null;
    if (!page.state_content_hash || !page.state_phase_version) {
      reason = 'state_missing';
    } else if (page.state_content_hash !== page.content_hash) {
      reason = 'content_changed';
    } else if (page.state_phase_version !== EXTRACT_LINKS_PHASE_VERSION) {
      reason = 'phase_version_changed';
    } else if (!linksAreCurrent) {
      reason = 'links_out_of_sync';
    }

    if (stateIsCurrent && linksAreCurrent) {
      skippedUnchangedPages += 1;
      continue;
    }

    staleLinksToDelete += existingLinks.length;
    linksToWrite += extractedLinks.length;
    plannedPages.push({
      id: page.id,
      sourceId: page.source_id,
      slug: page.slug,
      body: page.body,
      contentHash: page.content_hash,
      updatedBy: page.updated_by,
      extractedLinkCount: extractedLinks.length,
      existingLinkCount: existingLinks.length,
      reason: reason ?? 'links_out_of_sync',
    });
  }

  return {
    ...counts,
    eligiblePages: pages.length,
    skippedUnchangedPages,
    staleLinksToDelete,
    linksToWrite,
    pages: plannedPages,
  };
}

async function upsertPageDreamState(client: pg.PoolClient, input: { runId: string; page: PlannedPage }): Promise<void> {
  const details: JsonObject = {
    runId: input.runId,
    phaseVersion: EXTRACT_LINKS_PHASE_VERSION,
    extractedLinks: input.page.extractedLinkCount,
    previousLinks: input.page.existingLinkCount,
    reason: input.page.reason,
  };

  await client.query(
    `
      INSERT INTO page_dream_state (source_id, page_id, phase, phase_version, content_hash, details)
      VALUES ($1, $2, 'extract_links', $3, $4, $5::jsonb)
      ON CONFLICT (page_id, phase)
      DO UPDATE SET
        source_id = EXCLUDED.source_id,
        phase_version = EXCLUDED.phase_version,
        content_hash = EXCLUDED.content_hash,
        processed_at = now(),
        details = EXCLUDED.details
    `,
    [input.page.sourceId, input.page.id, EXTRACT_LINKS_PHASE_VERSION, input.page.contentHash, JSON.stringify(details)],
  );
}

async function applyExtractLinksPlan(runId: string, plan: ExtractLinksPlan): Promise<void> {
  if (plan.pages.length === 0) return;

  const pool = getNanoBrainPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const page of plan.pages) {
      await replacePageLinks(client, {
        pageId: page.id,
        sourceId: page.sourceId,
        fromSlug: page.slug,
        body: page.body,
        createdBy: page.updatedBy,
      });
      await upsertPageDreamState(client, { runId, page });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function buildDetails(plan: ExtractLinksPlan, dryRun: boolean): JsonObject {
  return {
    phaseVersion: EXTRACT_LINKS_PHASE_VERSION,
    dryRun,
    totalPages: plan.totalPages,
    archivedPages: plan.archivedPages,
    dreamGeneratedPages: plan.dreamGeneratedPages,
    eligiblePages: plan.eligiblePages,
    skippedUnchangedPages: plan.skippedUnchangedPages,
    pagesToProcess: plan.pages.length,
    linksToWrite: plan.linksToWrite,
    staleLinksToDelete: plan.staleLinksToDelete,
    pageReasons: plan.pages.reduce<Record<string, number>>((counts, page) => {
      counts[page.reason] = (counts[page.reason] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

export async function runExtractLinksPhase(ctx: DreamPhaseHandlerContext): Promise<Omit<DreamPhaseResult, 'phase' | 'durationMs'>> {
  if (ctx.target.type === 'review_queue') {
    return {
      status: 'skipped',
      summary: 'extract_links is not applicable to review_queue targets',
      details: { reason: 'not_applicable', dryRun: ctx.dryRun, phaseVersion: EXTRACT_LINKS_PHASE_VERSION },
    };
  }

  const sourceId = ctx.target.sourceId;
  const plan = await buildExtractLinksPlan(sourceId);

  if (ctx.dryRun) {
    return {
      status: plan.pages.length > 0 ? 'ok' : 'clean',
      summary: `dry-run: extract_links would process ${plan.pages.length} page(s) and write ${plan.linksToWrite} link(s)`,
      details: buildDetails(plan, true),
    };
  }

  await applyExtractLinksPlan(ctx.runId, plan);

  return {
    status: plan.pages.length > 0 ? 'ok' : 'clean',
    summary:
      plan.pages.length > 0
        ? `extract_links processed ${plan.pages.length} page(s) and wrote ${plan.linksToWrite} link(s)`
        : 'extract_links found no changed pages',
    details: buildDetails(plan, false),
  };
}
