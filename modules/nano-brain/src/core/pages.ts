import { createHash, randomUUID } from 'node:crypto';
import type { UserContext } from '@ff/contracts';
import { getNanoBrainPool } from '../db';
import { prepareChunksForMarkdown, replacePageChunks } from './chunks';
import { replacePageLinks } from './links';
import { snapshotPageVersion } from './page-versions';
import { assertCanReadSource, assertCanWriteSource } from './permissions';
import { getSourceById, NanoBrainError } from './sources';
import { slugify } from './slug';

const MAX_MARKDOWN_BYTES = 1024 * 1024;

export type NanoPage = {
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
  // 014 · T5 · §10 008 wiki 消费契约(AM-1418):编译条目附加结构(back-compat 不破 {slug,title,body})。
  //   entryKind/compileStatus 供 015 孤页/质量面板;metadata.entry.outline 供 008 大纲/思维导图;
  //   存量 raw_passthrough 页取列默认值(raw_passthrough/uncompiled,body=原文可浏览)。
  entryKind: string;
  compileStatus: string;
  compileVersion: string | null;
  granularity: string | null;
  metadata: Record<string, unknown>;
};

type PutMarkdownPageInput = {
  sourceId: string;
  slug?: string;
  title?: string;
  body: string;
  contentType: string;
};

function normalizeMarkdownBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd() + '\n';
}

function assertMarkdownInput(input: { body: unknown; contentType: unknown }): string {
  if (input.contentType !== 'text/markdown') {
    throw new NanoBrainError('第一阶段只支持 text/markdown', 'invalid_input');
  }
  if (typeof input.body !== 'string') {
    throw new NanoBrainError('Markdown 内容必须是字符串', 'invalid_input');
  }
  const body = normalizeMarkdownBody(input.body);
  if (body.trim().length === 0) {
    throw new NanoBrainError('Markdown 内容不能为空', 'invalid_input');
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_MARKDOWN_BYTES) {
    throw new NanoBrainError('Markdown 内容超过第一阶段大小限制', 'invalid_input');
  }
  return body;
}

function extractH1Title(body: string): string | null {
  for (const line of body.split('\n')) {
    const match = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function assertValidSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (normalized.length < 1 || normalized.length > 96) {
    throw new NanoBrainError('页面 slug 长度必须在 1 到 96 个字符之间', 'invalid_input');
  }
  if (!/^[a-z0-9\u4e00-\u9fa5][a-z0-9\u4e00-\u9fa5_./-]*$/.test(normalized)) {
    throw new NanoBrainError('页面 slug 只能包含字母、数字、中文、下划线、点、斜杠或短横线，且必须以字母、数字或中文开头', 'invalid_input');
  }
  return normalized;
}

function resolveSlug(inputSlug: string | undefined, title: string, body: string): string {
  if (inputSlug) return assertValidSlug(inputSlug);
  const candidate = slugify(title);
  if (candidate) return assertValidSlug(candidate);
  const shortHash = createHash('sha256').update(body).digest('hex').slice(0, 12);
  return `untitled-${shortHash}`;
}

function resolveTitle(inputTitle: string | undefined, body: string, slug: string): string {
  const title = inputTitle?.trim() || extractH1Title(body) || slug;
  if (title.length > 200) {
    throw new NanoBrainError('页面标题不能超过 200 个字符', 'invalid_input');
  }
  return title;
}

function hashContent(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

function mapPage(row: any): NanoPage {
  return {
    id: row.id,
    sourceId: row.source_id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    contentHash: row.content_hash,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // 附加结构列(back-compat:存量页取 DEFAULT raw_passthrough/uncompiled;metadata 默认 {}).
    entryKind: row.entry_kind,
    compileStatus: row.compile_status,
    compileVersion: row.compile_version ?? null,
    granularity: row.granularity ?? null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

async function getRequiredSource(sourceId: string) {
  const source = await getSourceById(sourceId);
  if (!source) throw new NanoBrainError('source 不存在', 'not_found');
  return source;
}

export async function putMarkdownPage(ctx: UserContext, input: PutMarkdownPageInput): Promise<NanoPage> {
  const source = await getRequiredSource(input.sourceId);
  assertCanWriteSource(ctx, source);

  const body = assertMarkdownInput({ body: input.body, contentType: input.contentType });
  const preliminaryTitle = input.title?.trim() || extractH1Title(body) || '';
  const slug = resolveSlug(input.slug, preliminaryTitle, body);
  const title = resolveTitle(input.title, body, slug);
  const contentHash = hashContent(body);
  const chunks = await prepareChunksForMarkdown(body);

  const pool = getNanoBrainPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // 015 · T3 · AM-1513:更新即留版本(先快照后写)+ 空更新幂等 + 并发不丢版本。
    //   锁定既有活跃/归档行(FOR UPDATE):串行化同条目并发写,version_no 在锁内计算不跳错、不丢版本。
    const existing = await client.query(
      `SELECT id, content_hash FROM pages WHERE source_id = $1 AND slug = $2 FOR UPDATE`,
      [input.sourceId, slug],
    );

    let page: NanoPage;
    if (existing.rows[0]) {
      const pageId = existing.rows[0].id as string;
      const previousHash = existing.rows[0].content_hash as string;
      const bodyChanged = previousHash !== contentHash;
      // body 变更 → 事务内先快照本次内容为新版本(version_no=max+1)再落 pages;空更新(同 hash)短路不产版本(幂等)。
      if (bodyChanged) {
        await snapshotPageVersion(client, {
          pageId,
          sourceId: input.sourceId,
          title,
          body,
          contentHash,
          editedBy: ctx.userId,
          editReason: null,
        });
      }
      const result = await client.query(
        `
          UPDATE pages
          SET title = $3, body = $4, content_hash = $5, updated_by = $6, updated_at = now(), archived_at = NULL, archived_by = NULL
          WHERE source_id = $1 AND slug = $2
          RETURNING id, source_id, slug, title, body, content_hash, created_by, updated_by, created_at, updated_at, entry_kind, compile_status, compile_version, granularity, metadata
        `,
        [input.sourceId, slug, title, body, contentHash, ctx.userId],
      );
      page = mapPage(result.rows[0]);
    } else {
      const result = await client.query(
        `
          INSERT INTO pages (id, source_id, slug, title, body, content_hash, created_by, updated_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
          RETURNING id, source_id, slug, title, body, content_hash, created_by, updated_by, created_at, updated_at, entry_kind, compile_status, compile_version, granularity, metadata
        `,
        [randomUUID(), input.sourceId, slug, title, body, contentHash, ctx.userId],
      );
      page = mapPage(result.rows[0]);
      // 首次创建也落 version_no=1(首个版本 = 创建内容)。
      await snapshotPageVersion(client, {
        pageId: page.id,
        sourceId: page.sourceId,
        title: page.title,
        body: page.body,
        contentHash: page.contentHash,
        editedBy: ctx.userId,
        editReason: null,
      });
    }

    await replacePageChunks(client, { pageId: page.id, sourceId: page.sourceId, slug: page.slug, chunks });
    await replacePageLinks(client, { pageId: page.id, sourceId: page.sourceId, fromSlug: page.slug, body, createdBy: ctx.userId });
    await client.query('COMMIT');
    return page;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getPage(ctx: UserContext, input: { sourceId: string; slug: string }): Promise<NanoPage> {
  const source = await getRequiredSource(input.sourceId);
  assertCanReadSource(ctx, source);

  const slug = assertValidSlug(input.slug);
  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT id, source_id, slug, title, body, content_hash, created_by, updated_by, created_at, updated_at, entry_kind, compile_status, compile_version, granularity, metadata
      FROM pages
      WHERE source_id = $1 AND slug = $2 AND archived_at IS NULL
    `,
    [input.sourceId, slug],
  );

  if (!result.rows[0]) throw new NanoBrainError('页面不存在', 'not_found');
  return mapPage(result.rows[0]);
}

export async function listPages(ctx: UserContext, input: { sourceId: string }): Promise<NanoPage[]> {
  const source = await getRequiredSource(input.sourceId);
  assertCanReadSource(ctx, source);

  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT id, source_id, slug, title, body, content_hash, created_by, updated_by, created_at, updated_at, entry_kind, compile_status, compile_version, granularity, metadata
      FROM pages
      WHERE source_id = $1 AND archived_at IS NULL
      ORDER BY updated_at DESC, slug ASC
    `,
    [input.sourceId],
  );

  return result.rows.map(mapPage);
}

export async function archivePage(ctx: UserContext, input: { sourceId: string; slug: string }): Promise<NanoPage> {
  const source = await getRequiredSource(input.sourceId);
  assertCanWriteSource(ctx, source);

  const slug = assertValidSlug(input.slug);
  const pool = getNanoBrainPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query(
      `
        UPDATE pages
        SET archived_at = now(), archived_by = $3, updated_by = $3, updated_at = now()
        WHERE source_id = $1 AND slug = $2 AND archived_at IS NULL
        RETURNING id, source_id, slug, title, body, content_hash, created_by, updated_by, created_at, updated_at, entry_kind, compile_status, compile_version, granularity, metadata
      `,
      [input.sourceId, slug, ctx.userId],
    );

    if (!result.rows[0]) throw new NanoBrainError('页面不存在', 'not_found');

    const page = mapPage(result.rows[0]);
    await client.query('DELETE FROM links WHERE from_page_id = $1', [page.id]);
    await client.query('DELETE FROM chunks WHERE page_id = $1', [page.id]);
    await client.query('COMMIT');
    return page;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
