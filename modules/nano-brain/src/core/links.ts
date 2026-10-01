import type pg from 'pg';
import type { UserContext } from '@ff/contracts';
import { randomUUID } from 'node:crypto';
import { getNanoBrainPool } from '../db';
import { assertCanReadSource } from './permissions';
import { getSourceById, NanoBrainError } from './sources';
import { slugify } from './slug';

export type LinkDirection = 'out' | 'in' | 'both';

// 015 · T1 · FR-381/383:手写/机器链分治与置信分级共用 origin 值域。
//   manual = 人手写(wikilink / 编辑正文)· auto = 高置信机器链(参与检索邻域)
//   suggested = 低置信机器候选(只进建议流,不参与检索邻域)。
export const LINK_ORIGIN_MANUAL = 'manual';
export const LINK_ORIGIN_AUTO = 'auto';
export const LINK_ORIGIN_SUGGESTED = 'suggested';
// graphQuery 检索邻域只取 manual+auto(FR-383 语义:auto 参与检索 / suggested 不参与)。
export const GRAPH_NEIGHBORHOOD_ORIGINS = [LINK_ORIGIN_MANUAL, LINK_ORIGIN_AUTO] as const;

export type NanoLink = {
  id: string;
  sourceId: string;
  fromPageId: string;
  fromSlug: string;
  toSourceId: string | null;
  toSlug: string;
  linkType: string;
  origin: string;
  context: string | null;
  confidence: number;
  createdBy: string;
  createdAt: Date;
};

export type GraphQueryResult = {
  rootSlug: string;
  depth: number;
  direction: LinkDirection;
  links: NanoLink[];
  nodes: string[];
};

type ExtractedLink = {
  toSlug: string;
  linkType: string;
  context: string;
  confidence: number;
};

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function normalizeLinkType(linkType: unknown): string | undefined {
  if (linkType === undefined || linkType === null || linkType === '') return undefined;
  if (typeof linkType !== 'string') throw new NanoBrainError('link_type 必须是字符串', 'invalid_input');
  const normalized = linkType.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(normalized)) {
    throw new NanoBrainError('link_type 格式非法', 'invalid_input');
  }
  return normalized;
}

function normalizeDepth(depth: unknown): number {
  if (depth === undefined || depth === null) return 1;
  const value = Number(depth);
  if (!Number.isInteger(value) || value < 1 || value > 2) {
    throw new NanoBrainError('depth 第一阶段只支持 1 到 2', 'invalid_input');
  }
  return value;
}

function normalizeDirection(direction: unknown): LinkDirection {
  if (direction === undefined || direction === null || direction === '') return 'both';
  if (direction === 'out' || direction === 'in' || direction === 'both') return direction;
  throw new NanoBrainError('direction 必须是 out、in 或 both', 'invalid_input');
}

function normalizeRootSlug(slug: unknown): string {
  if (typeof slug !== 'string') throw new NanoBrainError('slug 必须是字符串', 'invalid_input');
  const normalized = normalizeSlug(slug);
  if (!normalized) throw new NanoBrainError('slug 不能为空', 'invalid_input');
  return normalized;
}

function contextForMarkdownLink(body: string, index: number): string {
  const start = Math.max(0, body.lastIndexOf('\n', index - 1) + 1);
  const endOfLine = body.indexOf('\n', index);
  const end = endOfLine >= 0 ? endOfLine : body.length;
  return body.slice(start, end).trim().slice(0, 500);
}

function addUniqueLink(links: ExtractedLink[], seen: Set<string>, link: ExtractedLink): void {
  const key = `${link.linkType}:${link.toSlug}`;
  if (seen.has(key)) return;
  seen.add(key);
  links.push(link);
}

export function extractLinksFromMarkdown(body: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  const wikiLinkPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  for (const match of body.matchAll(wikiLinkPattern)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    const toSlug = slugify(raw);
    addUniqueLink(links, seen, {
      toSlug,
      linkType: 'mentions',
      context: contextForMarkdownLink(body, match.index ?? 0),
      confidence: 1,
    });
  }

  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of body.matchAll(markdownLinkPattern)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith('#')) continue;
    const withoutAnchor = raw.split('#')[0] ?? raw;
    const withoutExtension = withoutAnchor.replace(/\.md$/i, '');
    const toSlug = slugify(withoutExtension);
    if (!toSlug) continue;
    addUniqueLink(links, seen, {
      toSlug,
      linkType: 'mentions',
      context: contextForMarkdownLink(body, match.index ?? 0),
      confidence: 0.9,
    });
  }

  return links;
}

function mapLink(row: any): NanoLink {
  return {
    id: row.id,
    sourceId: row.source_id,
    fromPageId: row.from_page_id,
    fromSlug: row.from_slug,
    toSourceId: row.to_source_id,
    toSlug: row.to_slug,
    linkType: row.link_type,
    origin: row.origin,
    context: row.context,
    confidence: Number(row.confidence),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function replacePageLinks(
  client: pg.PoolClient,
  input: {
    pageId: string;
    sourceId: string;
    fromSlug: string;
    body: string;
    createdBy: string;
  },
): Promise<void> {
  // 015 · T1 · AM-1502(手写链与机器链分治):DELETE **仅收窄到 origin='manual'**——
  //   编辑条目正文重抽手写链时,机器建的 auto/suggested 链原样存活,不被清空整张自动网。
  //   禁止无 origin 谓词的 DELETE(否则每次编辑清空整张自动网)。
  await client.query(`DELETE FROM links WHERE from_page_id = $1 AND origin = '${LINK_ORIGIN_MANUAL}'`, [input.pageId]);
  const extracted = extractLinksFromMarkdown(input.body);

  for (const link of extracted) {
    await client.query(
      `
        INSERT INTO links (
          id, source_id, from_page_id, from_slug, to_source_id, to_slug,
          link_type, origin, context, confidence, created_by
        )
        VALUES ($1, $2, $3, $4, NULL, $5, $6, '${LINK_ORIGIN_MANUAL}', $7, $8, $9)
        ON CONFLICT (source_id, from_slug, to_slug, link_type)
        DO UPDATE SET
          from_page_id = EXCLUDED.from_page_id,
          origin = '${LINK_ORIGIN_MANUAL}',
          context = EXCLUDED.context,
          confidence = EXCLUDED.confidence,
          created_by = EXCLUDED.created_by,
          created_at = now()
      `,
      [
        randomUUID(),
        input.sourceId,
        input.pageId,
        input.fromSlug,
        link.toSlug,
        link.linkType,
        link.context,
        link.confidence,
        input.createdBy,
      ],
    );
  }
}

export async function listOutgoingLinks(
  ctx: UserContext,
  input: { sourceId: string; slug: string; linkType?: unknown },
): Promise<NanoLink[]> {
  const source = await getSourceById(input.sourceId);
  if (!source) throw new NanoBrainError('source 不存在', 'not_found');
  assertCanReadSource(ctx, source);

  const linkType = normalizeLinkType(input.linkType);
  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT id, source_id, from_page_id, from_slug, to_source_id, to_slug,
             link_type, origin, context, confidence, created_by, created_at
      FROM links
      WHERE source_id = $1
        AND from_slug = $2
        AND ($3::text IS NULL OR link_type = $3)
      ORDER BY link_type ASC, to_slug ASC
    `,
    [input.sourceId, normalizeSlug(input.slug), linkType ?? null],
  );
  return result.rows.map(mapLink);
}

export async function listBacklinks(
  ctx: UserContext,
  input: { slug: string; linkType?: unknown },
): Promise<NanoLink[]> {
  const linkType = normalizeLinkType(input.linkType);
  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT l.id, l.source_id, l.from_page_id, l.from_slug, l.to_source_id, l.to_slug,
             l.link_type, l.origin, l.context, l.confidence, l.created_by, l.created_at
      FROM links l
      JOIN sources s ON s.id = l.source_id
      JOIN pages p ON p.id = l.from_page_id
      WHERE l.to_slug = $1
        AND p.archived_at IS NULL
        AND ($2::boolean = true OR s.kind = 'public' OR s.owner_user_id = $3)
        AND ($4::text IS NULL OR l.link_type = $4)
      ORDER BY s.kind ASC, l.from_slug ASC
    `,
    [normalizeSlug(input.slug), ctx.isAdmin, ctx.userId, linkType ?? null],
  );
  return result.rows.map(mapLink);
}

async function graphStep(
  ctx: UserContext,
  slugs: string[],
  input: { direction: LinkDirection; linkType?: string },
): Promise<NanoLink[]> {
  if (slugs.length === 0) return [];
  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT l.id, l.source_id, l.from_page_id, l.from_slug, l.to_source_id, l.to_slug,
             l.link_type, l.origin, l.context, l.confidence, l.created_by, l.created_at
      FROM links l
      JOIN sources s ON s.id = l.source_id
      JOIN pages p ON p.id = l.from_page_id
      WHERE p.archived_at IS NULL
        AND l.origin = ANY($7::text[])
        AND ($1::boolean = true OR s.kind = 'public' OR s.owner_user_id = $2)
        AND ($3::text IS NULL OR l.link_type = $3)
        AND (
          ($4::boolean = true AND l.from_slug = ANY($6::text[]))
          OR
          ($5::boolean = true AND l.to_slug = ANY($6::text[]))
        )
      ORDER BY l.from_slug ASC, l.to_slug ASC, l.link_type ASC
    `,
    [
      ctx.isAdmin,
      ctx.userId,
      input.linkType ?? null,
      input.direction === 'out' || input.direction === 'both',
      input.direction === 'in' || input.direction === 'both',
      slugs,
      // 015 · T1 · AM-1504/FR-383:检索邻域只取 manual+auto,suggested 不参与 graphQuery。
      GRAPH_NEIGHBORHOOD_ORIGINS as unknown as string[],
    ],
  );
  return result.rows.map(mapLink);
}

export async function graphQuery(
  ctx: UserContext,
  input: { slug: unknown; depth?: unknown; direction?: unknown; linkType?: unknown },
): Promise<GraphQueryResult> {
  const rootSlug = normalizeRootSlug(input.slug);
  const depth = normalizeDepth(input.depth);
  const direction = normalizeDirection(input.direction);
  const linkType = normalizeLinkType(input.linkType);

  const linksById = new Map<string, NanoLink>();
  const visited = new Set<string>([rootSlug]);
  let frontier = [rootSlug];

  for (let level = 0; level < depth; level += 1) {
    const links = await graphStep(ctx, frontier, { direction, linkType });
    const next = new Set<string>();

    for (const link of links) {
      linksById.set(link.id, link);
      for (const slug of [link.fromSlug, link.toSlug]) {
        if (!visited.has(slug)) {
          visited.add(slug);
          next.add(slug);
        }
      }
    }

    frontier = Array.from(next);
    if (frontier.length === 0) break;
  }

  return {
    rootSlug,
    depth,
    direction,
    links: Array.from(linksById.values()),
    nodes: Array.from(visited).sort(),
  };
}
