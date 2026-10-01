// 014 · T3 · FR-370/371/378/379 · §6.2/§6.3/§7.4/§7.6:compile 相位(批量编译 + 状态/成本韧性)。
//   批量遍历一个 source 内待编译的 raw_documents,逐源 compileSource,收集部分成功结果:
//     - LLM 网关不可用(client.compile 返回 null)→ 该源 skipped(诚实降级,不伪造条目;capture 已落 raw_documents,AM-1410)。
//     - 编译失败(client.compile 抛错 / 产物不可解析抛错)→ 该源 failed(记因、原文 raw_passthrough 可读、可重试,不连坐,AM-1409)。
//     - 成功 → compiled。
//   整批 runStatus 承 001/004 reconcileIngestOutcome:compiled>0 且 failed>0 → partial(非全成功也非全失败,不伪装 ready)。
//   幂等 + 增量重编判据用 raw_document_compile_state(content_hash + compile_version + status):
//     三路重编触发(AM-1413):content_hash 变(该源+依赖 theme stale)/ compile_version 变(全量 stale)/ failed 重试(仅 failed 重入队);
//     未受影响源(未变 + 未依赖变更源)跳过(processed_at 不变、不重复调 LLM,AM-1412)。
import { createHash, randomUUID } from 'node:crypto';
import { getNanoBrainPool } from '../../../db';
import {
  COMPILE_PROMPT_VERSION,
  compileSource,
  resolveEntrySlug,
  type CompileGranularity,
} from '../../compile';
import { getRawDocument, type RawDocument } from '../../raw-documents';
import { createOpenRouterCompileClient, type CompileLlmClient } from '../../llm';
import type { DreamPhaseHandlerContext } from '../runner';
import type { DreamPhaseResult } from '../types';

export const COMPILE_PHASE_VERSION = 'compile.phase.v1';

// 重编触发原因(AM-1413 三路 + 首编)。
export type CompileReason = 'uncompiled' | 'content_changed' | 'version_changed' | 'failed_retry';

type CompileStateRow = {
  raw_document_id: string;
  status: string;
  content_hash: string;
  compile_version: string;
  compiled_page_id: string | null;
};

type PendingItem = { doc: RawDocument; reason: CompileReason };

export type CompilePlan = {
  docs: RawDocument[];
  states: Map<string, CompileStateRow>;
  pending: PendingItem[];
};

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function mapRawDocument(row: any): RawDocument {
  return {
    id: row.id,
    sourceId: row.source_id,
    externalRef: row.external_ref,
    title: row.title,
    contentType: row.content_type,
    rawBody: row.raw_body,
    contentHash: row.content_hash,
    byteSize: row.byte_size,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listSourceRawDocuments(sourceId: string): Promise<RawDocument[]> {
  const result = await getNanoBrainPool().query(
    `SELECT id, source_id, external_ref, title, content_type, raw_body, content_hash, byte_size, created_by, created_at, updated_at
     FROM raw_documents WHERE source_id = $1 ORDER BY created_at ASC, id ASC`,
    [sourceId],
  );
  return result.rows.map(mapRawDocument);
}

async function listCompileStates(sourceId: string): Promise<Map<string, CompileStateRow>> {
  const result = await getNanoBrainPool().query<CompileStateRow>(
    `SELECT raw_document_id, status, content_hash, compile_version, compiled_page_id
     FROM raw_document_compile_state WHERE source_id = $1`,
    [sourceId],
  );
  const map = new Map<string, CompileStateRow>();
  for (const row of result.rows) map.set(row.raw_document_id, row);
  return map;
}

/**
 * 编译 plan(增量判据):逐 raw_document 判定是否待编译 + 触发原因。
 *   无 state 行 → uncompiled(首编);state.status='failed' → failed_retry;
 *   compile_version != 目标 → version_changed(prompt 升版全量);content_hash != 原文 → content_changed(源更新);
 *   其余(compiled + hash 一致 + version 一致)→ 未受影响,跳过。
 */
export async function planCompileForSource(sourceId: string, compileVersion: string = COMPILE_PROMPT_VERSION): Promise<CompilePlan> {
  const [docs, states] = await Promise.all([listSourceRawDocuments(sourceId), listCompileStates(sourceId)]);
  const pending: PendingItem[] = [];
  for (const doc of docs) {
    const st = states.get(doc.id);
    if (!st) {
      pending.push({ doc, reason: 'uncompiled' });
    } else if (st.status === 'failed') {
      pending.push({ doc, reason: 'failed_retry' });
    } else if (st.status !== 'compiled') {
      pending.push({ doc, reason: 'uncompiled' });
    } else if (st.compile_version !== compileVersion) {
      pending.push({ doc, reason: 'version_changed' });
    } else if (st.content_hash !== doc.contentHash) {
      pending.push({ doc, reason: 'content_changed' });
    }
    // else: 未受影响,跳过(不重编、processed_at 不变)。
  }
  return { docs, states, pending };
}

export type StaleOutcome = {
  pending: Array<{ rawDocumentId: string; reason: CompileReason }>;
  byReason: Record<CompileReason, number>;
  sourceEntriesStaled: number;
  themesStaled: number;
};

// 内部:对一个已算好的 plan 施加 stale 标记(content_changed / version_changed → 该 source_entry stale + 经 page_members 传播 theme)。
async function applyStale(plan: CompilePlan): Promise<StaleOutcome> {
  const byReason: Record<CompileReason, number> = { uncompiled: 0, content_changed: 0, version_changed: 0, failed_retry: 0 };
  const staledThemeIds = new Set<string>();
  let sourceEntriesStaled = 0;
  const pool = getNanoBrainPool();

  for (const item of plan.pending) {
    byReason[item.reason] += 1;
    // failed_retry / uncompiled 不标 compiled 条目 stale(failed 仅重入队,首编无既存条目)。
    if (item.reason !== 'content_changed' && item.reason !== 'version_changed') continue;

    const st = plan.states.get(item.doc.id);
    const pageId = st?.compiled_page_id ?? null;
    if (!pageId) continue;

    // 标该 source_entry stale(仅 compiled → stale,避免误伤已 stale/failed)。
    const upd = await pool.query(
      `UPDATE pages SET compile_status = 'stale', updated_at = now()
       WHERE id = $1 AND compile_status = 'compiled' RETURNING id`,
      [pageId],
    );
    if (upd.rows.length > 0) sourceEntriesStaled += 1;

    // 经 page_members 反查依赖它的 theme_entry,一并标 stale(N-2 增量传播,AM-1412/1413)。
    const themes = await pool.query<{ theme_page_id: string }>(
      `SELECT DISTINCT theme_page_id FROM page_members WHERE member_page_id = $1 OR raw_document_id = $2`,
      [pageId, item.doc.id],
    );
    for (const t of themes.rows) {
      const tu = await pool.query(
        `UPDATE pages SET compile_status = 'stale', updated_at = now()
         WHERE id = $1 AND compile_status <> 'stale' RETURNING id`,
        [t.theme_page_id],
      );
      if (tu.rows.length > 0) staledThemeIds.add(t.theme_page_id);
    }
  }

  return {
    pending: plan.pending.map((p) => ({ rawDocumentId: p.doc.id, reason: p.reason })),
    byReason,
    sourceEntriesStaled,
    themesStaled: staledThemeIds.size,
  };
}

/**
 * 重编触发标记(AM-1413):算 plan + 施加 stale。三路各自不误伤:
 *   content_hash 变 → 该 source_entry + 依赖 theme stale;compile_version 变 → 全量 source_entry stale;
 *   failed 重试 → 仅 failed 重入队(compiled 条目 stale = 0)。
 */
export async function markRecompileStale(sourceId: string, compileVersion: string = COMPILE_PROMPT_VERSION): Promise<StaleOutcome> {
  const plan = await planCompileForSource(sourceId, compileVersion);
  return applyStale(plan);
}

// skip(网关不可用)→ 确保存在 raw_passthrough 页(body=原文可浏览),不伪造 source_entry(AM-1410)。
// B1 复审修复(codex Round-2 BLOCK):降级/失败回退时该 page 不再代表编译产物,须在同一事务内清理
//   旧 chunks/links/page_provenance(复用 pages.ts archivePage 同款 DELETE 模式),否则检索仍会命中
//   已失效的旧编译索引,即便页面已显示"失败/原文"。
async function ensurePassthroughPage(doc: RawDocument, compileStatus: 'uncompiled' | 'failed', error?: { name: string; message: string }): Promise<void> {
  const pool = getNanoBrainPool();
  const slug = resolveEntrySlug(doc);
  const metadata = { compile: { prompt_version: null, error: error ?? null, degraded: compileStatus } };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upserted = await client.query(
      `
        INSERT INTO pages (
          id, source_id, slug, title, body, content_hash, created_by, updated_by,
          entry_kind, compile_status, compile_version, granularity, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 'raw_passthrough', $8, NULL, NULL, $9::jsonb)
        ON CONFLICT (source_id, slug)
        DO UPDATE SET
          body = EXCLUDED.body,
          content_hash = EXCLUDED.content_hash,
          updated_by = EXCLUDED.updated_by,
          updated_at = now(),
          entry_kind = 'raw_passthrough',
          compile_status = EXCLUDED.compile_status,
          metadata = EXCLUDED.metadata,
          archived_at = NULL,
          archived_by = NULL
        RETURNING id
      `,
      [randomUUID(), doc.sourceId, slug, doc.title, doc.rawBody, doc.contentHash, doc.createdBy, compileStatus, JSON.stringify(metadata)],
    );
    const pageId: string = upserted.rows[0].id;
    await client.query('DELETE FROM chunks WHERE page_id = $1', [pageId]);
    await client.query('DELETE FROM links WHERE from_page_id = $1', [pageId]);
    await client.query('DELETE FROM page_provenance WHERE page_id = $1', [pageId]);
    await client.query('COMMIT');
  } catch (txError) {
    await client.query('ROLLBACK');
    throw txError;
  } finally {
    client.release();
  }
}

// 编译失败(AM-1409):记 compile_status='failed' + metadata.compile.error,原文 raw_passthrough 可读,state 标 failed 可重试。
async function recordCompileFailure(doc: RawDocument, error: unknown, compileVersion: string): Promise<void> {
  const name = error instanceof Error ? error.name : 'CompileError';
  const message = error instanceof Error ? error.message : String(error);
  await ensurePassthroughPage(doc, 'failed', { name, message });
  const pool = getNanoBrainPool();
  await pool.query(
    `
      INSERT INTO raw_document_compile_state (raw_document_id, source_id, compile_version, content_hash, compiled_page_id, status, processed_at)
      VALUES ($1, $2, $3, $4, NULL, 'failed', now())
      ON CONFLICT (raw_document_id)
      DO UPDATE SET compile_version = EXCLUDED.compile_version, content_hash = EXCLUDED.content_hash, status = 'failed', processed_at = now()
    `,
    [doc.id, doc.sourceId, compileVersion, doc.contentHash],
  );
}

export type CompileBatchResultItem = {
  rawDocumentId: string;
  reason: CompileReason;
  status: 'compiled' | 'failed' | 'skipped' | 'unchanged';
  pageId?: string;
  error?: { name: string; message: string };
};

// runStatus 承 reconcileIngestOutcome(001/004):部分成功可见,不伪装 ready。
export type CompileBatchRunStatus = 'clean' | 'ok' | 'partial' | 'skipped' | 'failed';

export type CompileBatchOutcome = {
  declaredN: number; // 本轮待编译源数(声明数,防规模缩水)
  compiled: number;
  failed: number;
  skipped: number;
  unchanged: number;
  runStatus: CompileBatchRunStatus;
  results: CompileBatchResultItem[];
  staled: StaleOutcome;
};

function deriveBatchRunStatus(input: { declaredN: number; compiled: number; failed: number; skipped: number }): CompileBatchRunStatus {
  const { declaredN, compiled, failed, skipped } = input;
  if (declaredN === 0) return 'clean';
  if (compiled === 0 && failed === 0 && skipped > 0) return 'skipped'; // 全 skip(诚实降级)
  if (compiled === 0 && failed > 0) return 'failed'; // 全失败
  if (failed > 0 && compiled > 0) return 'partial'; // 部分成功(非伪装 ready、非全失败)
  return 'ok'; // compiled>0 且无失败
}

export type CompilePendingInput = {
  sourceId: string;
  llm: CompileLlmClient;
  compileVersion?: string;
  granularity?: CompileGranularity;
  segmentCharBudget?: number;
};

/**
 * 批量编译一个 source 内的待编译源(compile 相位主体)。
 *   先 plan + 施加 stale(重编触发标记),再逐源 compileSource,收集 compiled/failed/skipped 部分成功结果。
 *   失败不连坐(逐源 try/catch)、skip 不伪造(落 raw_passthrough)、run=partial 语义(reconcileIngestOutcome)。
 */
export async function compilePendingSources(input: CompilePendingInput): Promise<CompileBatchOutcome> {
  const compileVersion = input.compileVersion ?? COMPILE_PROMPT_VERSION;
  const plan = await planCompileForSource(input.sourceId, compileVersion);
  const staled = await applyStale(plan);

  const results: CompileBatchResultItem[] = [];
  let compiled = 0;
  let failed = 0;
  let skipped = 0;
  let unchanged = 0;

  for (const item of plan.pending) {
    try {
      const outcome = await compileSource({
        rawDocumentId: item.doc.id,
        llm: input.llm,
        compileVersion,
        granularity: input.granularity,
        segmentCharBudget: input.segmentCharBudget,
        force: true, // plan 已判定待编译,绕过 compileSource 内幂等守卫
      });
      if (outcome.status === 'compiled') {
        compiled += 1;
        results.push({ rawDocumentId: item.doc.id, reason: item.reason, status: 'compiled', pageId: outcome.pageId });
      } else if (outcome.status === 'skipped') {
        // 网关不可用:诚实降级为可浏览原文,不伪造条目(AM-1410)。
        skipped += 1;
        await ensurePassthroughPage(item.doc, 'uncompiled');
        results.push({ rawDocumentId: item.doc.id, reason: item.reason, status: 'skipped' });
      } else {
        unchanged += 1;
        results.push({ rawDocumentId: item.doc.id, reason: item.reason, status: 'unchanged', pageId: outcome.pageId });
      }
    } catch (error) {
      // 编译失败(LLM 抛错 / 产物不可解析):一等失败状态,不连坐、可重试(AM-1409)。
      failed += 1;
      await recordCompileFailure(item.doc, error, compileVersion);
      const name = error instanceof Error ? error.name : 'CompileError';
      const message = error instanceof Error ? error.message : String(error);
      results.push({ rawDocumentId: item.doc.id, reason: item.reason, status: 'failed', error: { name, message } });
    }
  }

  const declaredN = plan.pending.length;
  const runStatus = deriveBatchRunStatus({ declaredN, compiled, failed, skipped });
  return { declaredN, compiled, failed, skipped, unchanged, runStatus, results, staled };
}

// compile 相位 → DreamPhaseStatus 映射(相位枚举无 'partial',partial/failed 均落 'failed' 由 run 层 deriveRunStatus 归并为 partial)。
function toPhaseStatus(runStatus: CompileBatchRunStatus): DreamPhaseResult['status'] {
  switch (runStatus) {
    case 'clean':
      return 'clean';
    case 'ok':
      return 'ok';
    case 'skipped':
      return 'skipped';
    case 'partial':
    case 'failed':
      return 'failed';
  }
}

/**
 * dream compile 相位处理器(runner 注册)。测试主体打在 compilePendingSources / markRecompileStale(注入 fake/spy 客户端);
 *   本处理器用默认 openrouter 客户端(网关不可用 → skipped 不伪造)。相位序调整归实现期 runner + 015 联合确认(spec §13-3)。
 */
export async function runCompilePhase(ctx: DreamPhaseHandlerContext): Promise<Omit<DreamPhaseResult, 'phase' | 'durationMs'>> {
  if (ctx.target.type === 'review_queue') {
    return {
      status: 'skipped',
      summary: 'compile is not applicable to review_queue targets',
      details: { reason: 'not_applicable', phaseVersion: COMPILE_PHASE_VERSION },
    };
  }

  const sourceId = ctx.target.sourceId;

  if (ctx.dryRun) {
    const plan = await planCompileForSource(sourceId);
    return {
      status: plan.pending.length > 0 ? 'ok' : 'clean',
      summary: `dry-run: compile would process ${plan.pending.length} source(s)`,
      details: { phaseVersion: COMPILE_PHASE_VERSION, dryRun: true, pending: plan.pending.length },
    };
  }

  const outcome = await compilePendingSources({ sourceId, llm: createOpenRouterCompileClient(), granularity: ctx.granularity });
  const details = {
    phaseVersion: COMPILE_PHASE_VERSION,
    dryRun: false,
    declaredN: outcome.declaredN,
    compiled: outcome.compiled,
    failed: outcome.failed,
    skipped: outcome.skipped,
    unchanged: outcome.unchanged,
    batchStatus: outcome.runStatus,
    staled: outcome.staled,
  };
  const base = {
    status: toPhaseStatus(outcome.runStatus),
    summary: `compile: ${outcome.compiled} compiled, ${outcome.failed} failed, ${outcome.skipped} skipped (${outcome.runStatus})`,
    details,
  };
  if (outcome.failed > 0) {
    const firstFailure = outcome.results.find((r) => r.status === 'failed');
    return { ...base, error: { name: firstFailure?.error?.name ?? 'CompileError', message: firstFailure?.error?.message ?? 'compile failed', failed: outcome.failed } };
  }
  return base;
}
