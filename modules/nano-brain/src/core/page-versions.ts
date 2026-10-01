// 015 · Gbrain 知识网络 · T3 · 页面版本历史(N-7)
//   AM-1513:更新即留版本(事务内快照 + version_no 单调)+ 空更新幂等 + 并发不丢版本。
//   AM-1514:版本历史列出 + 取某版本全文 + 两版本 diff + 非破坏式回滚(追加新版本,中间存活)。
//
// 版本模型 = 完整历史(complete history):每一次“有效提交的内容状态”对应一行 page_versions,
//   version_no 从创建时的 1 起严格单调自增;pages.body 恒等于最新版本的 body。
//   - 创建条目 → 落 version_no=1(首个版本 = 创建内容,呼应语义声明“首次创建也落 version_no=1”)。
//   - body 变更的更新 → 事务内先 INSERT page_versions(version_no=max+1)快照本次内容,再落 pages(先快照后写)。
//   - content_hash 无变化的空更新 → 短路,不产生新版本(幂等)。
//   - 回滚到 vK = 把 vK 的内容作为新版本追加(version_no=max+1、edit_reason 标“回滚自 vK”),
//     不删中间版本、不倒退 version_no(非破坏式,决策②)。
//
// 并发不丢版本:更新/回滚事务持有 pages 行的 FOR UPDATE 锁(见 pages.ts putMarkdownPage),
//   同条目并发写被串行化;version_no=max+1 在锁内计算;UNIQUE(page_id,version_no) 作兜底防重复/跳错。

import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { UserContext } from '@ff/contracts';
import { getNanoBrainPool } from '../db';
import { assertCanReadSource, assertCanWriteSource } from './permissions';
import { getSourceById, NanoBrainError } from './sources';

// 版本快照回滚使用的 audit 动作(audit_logs.action 为无约束 TEXT,直接登记,不触碰共享 audit.ts 的类型联合)。
export const PAGE_VERSION_ROLLBACK_ACTION = 'page_version.rollback';
export const PAGE_VERSION_AUDIT_TARGET_TYPE = 'page_version';

export type PageVersion = {
  id: string;
  pageId: string;
  sourceId: string;
  versionNo: number;
  title: string;
  body: string;
  contentHash: string;
  editedBy: string;
  editReason: string | null;
  createdAt: Date;
};

export type SnapshotPageVersionInput = {
  pageId: string;
  sourceId: string;
  title: string;
  body: string;
  contentHash: string;
  editedBy: string;
  editReason?: string | null;
};

function mapPageVersion(row: any): PageVersion {
  return {
    id: row.id,
    pageId: row.page_id,
    sourceId: row.source_id,
    versionNo: Number(row.version_no),
    title: row.title,
    body: row.body,
    contentHash: row.content_hash,
    editedBy: row.edited_by,
    editReason: row.edit_reason ?? null,
    createdAt: row.created_at,
  };
}

/**
 * 在既有事务内快照一个页面版本:version_no = 当前该 page 的 max+1(锁内计算,单调不跳空)。
 * 由 pages.ts 的 putMarkdownPage 更新/创建路径与本模块 rollback 调用(调用方须已持有 pages 行锁以保证并发不丢版本)。
 */
export async function snapshotPageVersion(
  client: pg.PoolClient,
  input: SnapshotPageVersionInput,
): Promise<PageVersion> {
  const next = await client.query<{ next: string }>(
    `SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM page_versions WHERE page_id = $1`,
    [input.pageId],
  );
  const versionNo = Number(next.rows[0].next);
  const result = await client.query(
    `
      INSERT INTO page_versions (
        id, page_id, source_id, version_no, title, body, content_hash, edited_by, edit_reason
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, page_id, source_id, version_no, title, body, content_hash, edited_by, edit_reason, created_at
    `,
    [
      randomUUID(),
      input.pageId,
      input.sourceId,
      versionNo,
      input.title,
      input.body,
      input.contentHash,
      input.editedBy,
      input.editReason ?? null,
    ],
  );
  return mapPageVersion(result.rows[0]);
}

async function getRequiredSource(sourceId: string) {
  const source = await getSourceById(sourceId);
  if (!source) throw new NanoBrainError('source 不存在', 'not_found');
  return source;
}

function normalizeSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (normalized.length < 1 || normalized.length > 96) {
    throw new NanoBrainError('页面 slug 长度必须在 1 到 96 个字符之间', 'invalid_input');
  }
  return normalized;
}

async function loadActivePage(
  client: pg.PoolClient | pg.Pool,
  sourceId: string,
  slug: string,
): Promise<{ id: string; sourceId: string; slug: string; title: string; body: string; contentHash: string }> {
  const result = await client.query(
    `SELECT id, source_id, slug, title, body, content_hash FROM pages WHERE source_id = $1 AND slug = $2 AND archived_at IS NULL`,
    [sourceId, slug],
  );
  if (!result.rows[0]) throw new NanoBrainError('页面不存在', 'not_found');
  const row = result.rows[0];
  return {
    id: row.id,
    sourceId: row.source_id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    contentHash: row.content_hash,
  };
}

/** 列出某条目的版本历史(version_no 降序:最新在前)。含 version_no/edited_by/created_at/edit_reason。 */
export async function listPageVersions(
  ctx: UserContext,
  input: { sourceId: string; slug: string },
): Promise<PageVersion[]> {
  const source = await getRequiredSource(input.sourceId);
  assertCanReadSource(ctx, source);
  const slug = normalizeSlug(input.slug);

  const pool = getNanoBrainPool();
  const page = await loadActivePage(pool, input.sourceId, slug);
  const result = await pool.query(
    `
      SELECT id, page_id, source_id, version_no, title, body, content_hash, edited_by, edit_reason, created_at
      FROM page_versions
      WHERE page_id = $1
      ORDER BY version_no DESC
    `,
    [page.id],
  );
  return result.rows.map(mapPageVersion);
}

/** 取某条目某个版本的全文(用于查看 / diff 输入)。 */
export async function getPageVersion(
  ctx: UserContext,
  input: { sourceId: string; slug: string; versionNo: number },
): Promise<PageVersion> {
  const source = await getRequiredSource(input.sourceId);
  assertCanReadSource(ctx, source);
  const slug = normalizeSlug(input.slug);
  if (!Number.isInteger(input.versionNo) || input.versionNo < 1) {
    throw new NanoBrainError('version_no 必须是正整数', 'invalid_input');
  }

  const pool = getNanoBrainPool();
  const page = await loadActivePage(pool, input.sourceId, slug);
  const result = await pool.query(
    `
      SELECT id, page_id, source_id, version_no, title, body, content_hash, edited_by, edit_reason, created_at
      FROM page_versions
      WHERE page_id = $1 AND version_no = $2
    `,
    [page.id, input.versionNo],
  );
  if (!result.rows[0]) throw new NanoBrainError('版本不存在', 'not_found');
  return mapPageVersion(result.rows[0]);
}

export type VersionDiffLine = {
  type: 'context' | 'add' | 'remove';
  text: string;
  fromLine: number | null;
  toLine: number | null;
};

export type PageVersionDiff = {
  fromVersion: number;
  toVersion: number;
  lines: VersionDiffLine[];
  addedCount: number;
  removedCount: number;
};

/** 行级 LCS diff:比较两个版本的 body,产出 add/remove/context 行 + 增删计数。确定性,可供前台渲染。 */
function diffLines(fromText: string, toText: string): { lines: VersionDiffLine[]; addedCount: number; removedCount: number } {
  const a = fromText.split('\n');
  const b = toText.split('\n');
  const n = a.length;
  const m = b.length;
  // LCS DP。
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: VersionDiffLine[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: 'context', text: a[i], fromLine: i + 1, toLine: j + 1 });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'remove', text: a[i], fromLine: i + 1, toLine: null });
      removedCount += 1;
      i += 1;
    } else {
      lines.push({ type: 'add', text: b[j], fromLine: null, toLine: j + 1 });
      addedCount += 1;
      j += 1;
    }
  }
  while (i < n) {
    lines.push({ type: 'remove', text: a[i], fromLine: i + 1, toLine: null });
    removedCount += 1;
    i += 1;
  }
  while (j < m) {
    lines.push({ type: 'add', text: b[j], fromLine: null, toLine: j + 1 });
    addedCount += 1;
    j += 1;
  }
  return { lines, addedCount, removedCount };
}

/** 比较某条目的两个版本内容(可 diff)。 */
export async function diffPageVersions(
  ctx: UserContext,
  input: { sourceId: string; slug: string; fromVersion: number; toVersion: number },
): Promise<PageVersionDiff> {
  const from = await getPageVersion(ctx, { sourceId: input.sourceId, slug: input.slug, versionNo: input.fromVersion });
  const to = await getPageVersion(ctx, { sourceId: input.sourceId, slug: input.slug, versionNo: input.toVersion });
  const { lines, addedCount, removedCount } = diffLines(from.body, to.body);
  return {
    fromVersion: from.versionNo,
    toVersion: to.versionNo,
    lines,
    addedCount,
    removedCount,
  };
}

export type RollbackResult = {
  targetVersion: number;
  newVersion: PageVersion;
  body: string;
  title: string;
};

/**
 * 非破坏式回滚(决策②):回滚到版本 K = 把 vK 的内容作为新版本追加(version_no=max+1),
 *   写回 pages.body(当前 body == vK body),不删中间版本、不倒退 version_no,写 audit_logs。
 *   事务内对 pages 行 FOR UPDATE(并发安全,与更新路径同锁点)。
 */
export async function rollbackPageToVersion(
  ctx: UserContext,
  input: { sourceId: string; slug: string; targetVersion: number; reason?: string },
): Promise<RollbackResult> {
  const source = await getRequiredSource(input.sourceId);
  assertCanWriteSource(ctx, source);
  const slug = normalizeSlug(input.slug);
  if (!Number.isInteger(input.targetVersion) || input.targetVersion < 1) {
    throw new NanoBrainError('targetVersion 必须是正整数', 'invalid_input');
  }

  const pool = getNanoBrainPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 锁定活跃 pages 行(串行化同条目并发写,防丢版本)。
    const pageRow = await client.query(
      `SELECT id FROM pages WHERE source_id = $1 AND slug = $2 AND archived_at IS NULL FOR UPDATE`,
      [input.sourceId, slug],
    );
    if (!pageRow.rows[0]) throw new NanoBrainError('页面不存在', 'not_found');
    const pageId = pageRow.rows[0].id as string;

    // 取目标版本 vK。
    const targetRes = await client.query(
      `SELECT id, page_id, source_id, version_no, title, body, content_hash, edited_by, edit_reason, created_at
       FROM page_versions WHERE page_id = $1 AND version_no = $2`,
      [pageId, input.targetVersion],
    );
    if (!targetRes.rows[0]) throw new NanoBrainError('回滚目标版本不存在', 'not_found');
    const target = mapPageVersion(targetRes.rows[0]);

    const editReason = input.reason?.trim() || `回滚自 v${target.versionNo}`;

    // 非破坏式:把 vK 内容作为新版本追加(version_no=max+1),中间版本不动。
    const newVersion = await snapshotPageVersion(client, {
      pageId,
      sourceId: input.sourceId,
      title: target.title,
      body: target.body,
      contentHash: target.contentHash,
      editedBy: ctx.userId,
      editReason,
    });

    // 写回 pages 当前 body == vK。
    await client.query(
      `UPDATE pages
       SET title = $2, body = $3, content_hash = $4, updated_by = $5, updated_at = now()
       WHERE id = $1`,
      [pageId, target.title, target.body, target.contentHash, ctx.userId],
    );

    // 审计留痕(audit_logs.action 无 CHECK 约束,直接登记回滚动作)。
    await client.query(
      `INSERT INTO audit_logs (
         id, actor_user_id, action, target_type, target_id, previous_status, next_status, review_comment, payload
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        randomUUID(),
        ctx.userId,
        PAGE_VERSION_ROLLBACK_ACTION,
        PAGE_VERSION_AUDIT_TARGET_TYPE,
        pageId,
        null,
        String(newVersion.versionNo),
        editReason,
        JSON.stringify({
          sourceId: input.sourceId,
          slug,
          targetVersion: target.versionNo,
          newVersion: newVersion.versionNo,
        }),
      ],
    );

    await client.query('COMMIT');
    return {
      targetVersion: target.versionNo,
      newVersion,
      body: target.body,
      title: target.title,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
