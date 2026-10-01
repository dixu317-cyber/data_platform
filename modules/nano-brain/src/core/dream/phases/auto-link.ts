import { getNanoBrainPool } from '../../../db';
import {
  discoverAutoLinks,
  type AutoLinkDeps,
  type DiscoveryPage,
  type RepresentativeEmbedder,
} from '../../auto-link';
import { embedTexts } from '../../embeddings';
import type { DreamPhaseHandlerContext } from '../runner';
import type { DreamPhaseResult } from '../types';

export const AUTO_LINK_PHASE_VERSION = 'm22.v1';

const REPRESENTATIVE_TEXT_MAX_CHARS = 2000;

// 默认代表向量取法(spec §13-2 实现者择一):标题 + 正文摘要,一次批量 embed。
//   embedTexts 失败(embedding 不可达)→ 抛出 → discoverAutoLinks 内 catch 降级 related 为空(不连坐)。
const defaultRepresentativeEmbedder: RepresentativeEmbedder = async (pages: DiscoveryPage[]) => {
  const texts = pages.map((p) => `${p.title}\n${p.body}`.slice(0, REPRESENTATIVE_TEXT_MAX_CHARS));
  const { embeddings } = await embedTexts(texts, 'dream-auto-link');
  const map = new Map<string, number[]>();
  pages.forEach((page, index) => {
    const vec = embeddings[index];
    if (vec) map.set(page.slug, vec);
  });
  return map;
};

async function loadDiscoveryPages(sourceId: string): Promise<DiscoveryPage[]> {
  const result = await getNanoBrainPool().query(
    `
      SELECT id, slug, title, body
      FROM pages
      WHERE source_id = $1
        AND archived_at IS NULL
        AND NOT (metadata @> '{"dream_generated": true}'::jsonb)
      ORDER BY slug ASC
    `,
    [sourceId],
  );
  return result.rows.map((row) => ({ id: row.id, slug: row.slug, title: row.title, body: row.body }));
}

function resolveCreatedBy(ctx: DreamPhaseHandlerContext): string {
  if (ctx.actor.type === 'system') return ctx.actor.userId ?? 'system';
  return ctx.actor.user.userId;
}

/**
 * 015 · T1 · FR-382:自动语义互链发现相位。
 * deps 可注入 embedder / thresholds(测试 patch embedding 接口层验分级 + 降级不连坐)。
 * 降级不连坐:embedding 挂 → mentions 路仍织、related 降级为空、相位 status 非 failed。
 */
export async function runAutoLinkPhase(
  ctx: DreamPhaseHandlerContext,
  deps: AutoLinkDeps = {},
): Promise<Omit<DreamPhaseResult, 'phase' | 'durationMs'>> {
  if (ctx.target.type === 'review_queue') {
    return {
      status: 'skipped',
      summary: 'auto_link is not applicable to review_queue targets',
      details: { reason: 'not_applicable', phaseVersion: AUTO_LINK_PHASE_VERSION },
    };
  }

  const sourceId = ctx.target.sourceId;
  const pages = await loadDiscoveryPages(sourceId);

  if (pages.length < 2) {
    return {
      status: 'clean',
      summary: 'auto_link found fewer than 2 pages; no links discovered',
      details: { phaseVersion: AUTO_LINK_PHASE_VERSION, pageCount: pages.length },
    };
  }

  if (ctx.dryRun) {
    return {
      status: 'ok',
      summary: `dry-run: auto_link would scan ${pages.length} page(s)`,
      details: { phaseVersion: AUTO_LINK_PHASE_VERSION, dryRun: true, pageCount: pages.length },
    };
  }

  const effectiveDeps: AutoLinkDeps = {
    embedder: deps.embedder ?? defaultRepresentativeEmbedder,
    thresholds: deps.thresholds,
    createdBy: deps.createdBy ?? resolveCreatedBy(ctx),
  };

  const pool = getNanoBrainPool();
  const client = await pool.connect();
  let summary;
  try {
    await client.query('BEGIN');
    summary = await discoverAutoLinks(client, { sourceId, pages }, effectiveDeps);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    status: summary.autoCount + summary.suggestedCount > 0 ? 'ok' : 'clean',
    summary: `auto_link wove ${summary.autoCount} auto + ${summary.suggestedCount} suggested link(s) across ${summary.pageCount} page(s)`,
    details: { phaseVersion: AUTO_LINK_PHASE_VERSION, ...summary },
  };
}
