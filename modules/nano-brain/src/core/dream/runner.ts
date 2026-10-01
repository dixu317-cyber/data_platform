import { randomUUID } from 'node:crypto';
import type { UserContext } from '@ff/contracts';
import { getNanoBrainPool } from '../../db';
import { NanoBrainPermissionError } from '../permissions';
import { getSourceById, NanoBrainError, type NanoSource } from '../sources';
import type { CompileGranularity } from '../compile';
import { acquireDreamLock, cleanupExpiredDreamLocks, getDreamLockTtlMs, refreshDreamLock, releaseDreamLock, type DreamLockAcquireResult } from './locks';
import { runAutoLinkPhase } from './phases/auto-link';
import { runCompilePhase } from './phases/compile';
import { runExtractLinksPhase } from './phases/extract-links';
import { runHealthCheckPhase } from './phases/health-check';
import { runRefreshEmbeddingsPhase } from './phases/refresh-embeddings';
import { runReviewQueueSummaryPhase } from './phases/review-queue-summary';
import { runThemeCompilePhase } from './phases/theme-compile';
import {
  DREAM_PHASES,
  isDreamPhase,
  isDreamRunStatus,
  isDreamTargetType,
  type DreamLock,
  type DreamPhase,
  type DreamPhaseResult,
  type DreamPhaseRun,
  type DreamReport,
  type DreamRun,
  type DreamRunStatus,
  type DreamTarget,
  type DreamTargetType,
  type DreamTriggerType,
} from './types';

const DEFAULT_SOURCE_PHASES: DreamPhase[] = ['extract_links', 'refresh_embeddings', 'health_check'];
const DEFAULT_REVIEW_QUEUE_PHASES: DreamPhase[] = ['review_queue_summary', 'health_check'];

const DEFAULT_PHASE_HANDLERS: Partial<Record<DreamPhase, DreamPhaseHandler>> = {
  extract_links: runExtractLinksPhase,
  refresh_embeddings: runRefreshEmbeddingsPhase,
  health_check: runHealthCheckPhase,
  review_queue_summary: runReviewQueueSummaryPhase,
  compile: runCompilePhase,
  auto_link: runAutoLinkPhase,
  theme_compile: runThemeCompilePhase,
};

type JsonObject = Record<string, unknown>;

export type DreamActor =
  | { type: 'user'; user: UserContext }
  | { type: 'admin'; user: UserContext }
  | { type: 'system'; userId?: string | null };

export type DreamPhaseHandlerContext = {
  runId: string;
  target: DreamTarget;
  phase: DreamPhase;
  dryRun: boolean;
  actor: DreamActor;
  source: NanoSource | null;
  /** 编译粒度(文档级/主题级/段落级)——由触发方(如后台入库)指定,compile 相位消费;缺省 compile 落 document。 */
  granularity?: CompileGranularity;
};

export type DreamPhaseHandler = (ctx: DreamPhaseHandlerContext) => Promise<Omit<DreamPhaseResult, 'phase' | 'durationMs'> | void>;

export type RunDreamInput = {
  target: DreamTarget;
  phases?: DreamPhase[];
  dryRun?: boolean;
  lockTtlMs?: number;
  phaseHandlers?: Partial<Record<DreamPhase, DreamPhaseHandler>>;
  /** 编译粒度(可选):透传给 compile 相位;缺省由 compile 落 document。 */
  granularity?: CompileGranularity;
};

export type RunDreamSystemInput = RunDreamInput & {
  triggeredByUserId?: string | null;
};

export type ListDreamRunsOptions = {
  targetType?: DreamTargetType;
  sourceId?: string;
  status?: DreamRunStatus;
  limit?: number;
};

export type DreamStatus = {
  checkedAt: Date;
  activeLocks: DreamLock[];
  recentRuns: DreamRun[];
  recentFailures: DreamRun[];
};

type ResolvedDreamRequest = {
  target: DreamTarget;
  requestedPhases: DreamPhase[];
  source: NanoSource | null;
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseJsonObject(value: unknown): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
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

function mapDreamRun(row: any): DreamRun {
  return {
    id: row.id,
    target: parseJsonObject(row.target) as DreamTarget,
    triggeredBy: row.triggered_by,
    triggeredByUserId: row.triggered_by_user_id,
    dryRun: row.dry_run,
    status: row.status,
    requestedPhases: parseJsonArray(row.requested_phases).filter((phase): phase is DreamPhase => typeof phase === 'string' && isDreamPhase(phase)),
    totals: parseJsonObject(row.totals),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

function mapDreamPhaseRun(row: any): DreamPhaseRun {
  return {
    id: row.id,
    runId: row.run_id,
    phase: row.phase,
    status: row.status,
    durationMs: row.duration_ms,
    summary: row.summary,
    details: parseJsonObject(row.details),
    error: row.error === null ? null : parseJsonObject(row.error),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

function mapDreamLock(row: any): DreamLock {
  return {
    id: row.id,
    targetType: row.target_type,
    targetSourceId: row.target_source_id,
    targetUserId: row.target_user_id,
    holderId: row.holder_id,
    holderHost: row.holder_host,
    acquiredAt: row.acquired_at,
    ttlExpiresAt: row.ttl_expires_at,
  };
}

function normalizeLimit(value: number | undefined, fallback = 20, max = 100): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) throw new NanoBrainError('limit 必须是正整数', 'invalid_input');
  return Math.min(Math.floor(value), max);
}

function assertDreamRunReadable(ctx: UserContext, run: DreamRun): void {
  if (ctx.isAdmin) return;
  if (run.target.type === 'user_source' && run.target.userId === ctx.userId) return;
  throw new NanoBrainPermissionError('无权读取该 dream run');
}

function normalizeActor(ctx: UserContext): DreamActor {
  return ctx.isAdmin ? { type: 'admin', user: ctx } : { type: 'user', user: ctx };
}

function getActorUserId(actor: DreamActor): string | null {
  if (actor.type === 'system') return actor.userId ?? null;
  return actor.user.userId;
}

function getTriggeredBy(actor: DreamActor): DreamTriggerType {
  return actor.type;
}

function assertTargetShape(target: DreamTarget): void {
  if (target.type === 'user_source') {
    if (!hasNonEmptyString(target.sourceId) || !hasNonEmptyString(target.userId)) {
      throw new NanoBrainError('user_source dream target 需要 sourceId 和 userId', 'invalid_input');
    }
    return;
  }

  if (target.type === 'public_source') {
    if (!hasNonEmptyString(target.sourceId)) {
      throw new NanoBrainError('public_source dream target 需要 sourceId', 'invalid_input');
    }
    return;
  }

  if (target.type === 'review_queue') {
    if (target.targetSourceId !== undefined && !hasNonEmptyString(target.targetSourceId)) {
      throw new NanoBrainError('review_queue targetSourceId 不能为空字符串', 'invalid_input');
    }
    return;
  }

  throw new NanoBrainError('dream target type 不合法', 'invalid_input');
}

function normalizePhases(target: DreamTarget, phases: DreamPhase[] | undefined): DreamPhase[] {
  const rawPhases = phases ?? (target.type === 'review_queue' ? DEFAULT_REVIEW_QUEUE_PHASES : DEFAULT_SOURCE_PHASES);
  if (!Array.isArray(rawPhases) || rawPhases.length === 0) {
    throw new NanoBrainError('dream phases 不能为空', 'invalid_input');
  }

  const normalized: DreamPhase[] = [];
  for (const phase of rawPhases) {
    if (!isDreamPhase(phase)) {
      throw new NanoBrainError(`dream phase 不合法: ${String(phase)}`, 'invalid_input');
    }
    if (!normalized.includes(phase)) normalized.push(phase);
  }
  return normalized;
}

async function resolveDreamRequest(actor: DreamActor, input: RunDreamInput): Promise<ResolvedDreamRequest> {
  const target = input.target;
  assertTargetShape(target);
  const requestedPhases = normalizePhases(target, input.phases);

  if (target.type === 'user_source') {
    const source = await getSourceById(target.sourceId.trim());
    if (!source) throw new NanoBrainError('source 不存在', 'not_found');
    if (source.kind !== 'private' || source.ownerUserId !== target.userId) {
      throw new NanoBrainError('user_source dream target 必须指向用户自己的 private source', 'invalid_input');
    }
    if (actor.type === 'user' && actor.user.userId !== target.userId) {
      throw new NanoBrainPermissionError('普通用户只能触发自己的 private source dream');
    }
    return { target: { type: 'user_source', sourceId: source.id, userId: target.userId }, requestedPhases, source };
  }

  if (target.type === 'public_source') {
    if (actor.type !== 'admin' && actor.type !== 'system') {
      throw new NanoBrainPermissionError('只有管理员或系统可以触发 public source dream');
    }
    const source = await getSourceById(target.sourceId.trim());
    if (!source) throw new NanoBrainError('source 不存在', 'not_found');
    if (source.kind !== 'public') {
      throw new NanoBrainError('public_source dream target 必须指向 public source', 'invalid_input');
    }
    return { target: { type: 'public_source', sourceId: source.id }, requestedPhases, source };
  }

  if (actor.type !== 'admin' && actor.type !== 'system') {
    throw new NanoBrainPermissionError('只有管理员或系统可以触发 review queue dream');
  }

  if (target.targetSourceId) {
    const source = await getSourceById(target.targetSourceId.trim());
    if (!source) throw new NanoBrainError('source 不存在', 'not_found');
    if (source.kind !== 'public') {
      throw new NanoBrainError('review_queue targetSourceId 必须指向 public source', 'invalid_input');
    }
    return { target: { type: 'review_queue', targetSourceId: source.id }, requestedPhases, source };
  }

  return { target: { type: 'review_queue' }, requestedPhases, source: null };
}

function isPhaseApplicable(target: DreamTarget, phase: DreamPhase): boolean {
  if (phase === 'health_check') return true;
  if (target.type === 'review_queue') return phase === 'review_queue_summary';
  return phase === 'extract_links' || phase === 'refresh_embeddings';
}

async function placeholderPhaseHandler(ctx: DreamPhaseHandlerContext): Promise<Omit<DreamPhaseResult, 'phase' | 'durationMs'>> {
  if (!isPhaseApplicable(ctx.target, ctx.phase)) {
    return {
      status: 'skipped',
      summary: `phase ${ctx.phase} is not applicable to ${ctx.target.type}`,
      details: { reason: 'not_applicable', dryRun: ctx.dryRun },
    };
  }

  return {
    status: 'clean',
    summary: `phase ${ctx.phase} is not implemented yet; no derived data was changed`,
    details: { reason: 'phase_placeholder', dryRun: ctx.dryRun, implemented: false },
  };
}

function sanitizeError(error: unknown): JsonObject {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

function deriveRunStatus(phases: DreamPhaseResult[]): Exclude<DreamRunStatus, 'pending' | 'running'> {
  if (phases.length === 0) return 'skipped';
  const failed = phases.filter((phase) => phase.status === 'failed').length;
  const ok = phases.filter((phase) => phase.status === 'ok').length;
  const clean = phases.filter((phase) => phase.status === 'clean').length;
  const skipped = phases.filter((phase) => phase.status === 'skipped').length;

  if (failed === phases.length) return 'failed';
  if (failed > 0) return 'partial';
  if (ok > 0) return 'ok';
  if (clean > 0) return 'clean';
  if (skipped === phases.length) return 'skipped';
  return 'failed';
}

function buildRunTotals(input: { phases: DreamPhaseResult[]; dryRun: boolean; lock?: JsonObject }): JsonObject {
  const statusCounts = input.phases.reduce<Record<string, number>>((counts, phase) => {
    counts[phase.status] = (counts[phase.status] ?? 0) + 1;
    return counts;
  }, {});
  return {
    dryRun: input.dryRun,
    phaseCount: input.phases.length,
    statusCounts,
    ...(input.lock ? { lock: input.lock } : {}),
  };
}

async function insertDreamRun(input: {
  target: DreamTarget;
  actor: DreamActor;
  dryRun: boolean;
  requestedPhases: DreamPhase[];
}): Promise<DreamRun> {
  const pool = getNanoBrainPool();
  const targetSourceId = input.target.type === 'user_source' || input.target.type === 'public_source' ? input.target.sourceId : (input.target.targetSourceId ?? null);
  const targetUserId = input.target.type === 'user_source' ? input.target.userId : null;
  const result = await pool.query(
    `
      INSERT INTO dream_runs (
        id,
        target_type,
        target_source_id,
        target_user_id,
        target,
        triggered_by,
        triggered_by_user_id,
        dry_run,
        status,
        requested_phases,
        totals
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'pending', $9::jsonb, '{}'::jsonb)
      RETURNING id, target, triggered_by, triggered_by_user_id, dry_run, status, requested_phases, totals, started_at, finished_at, created_at
    `,
    [
      randomUUID(),
      input.target.type,
      targetSourceId,
      targetUserId,
      JSON.stringify(input.target),
      getTriggeredBy(input.actor),
      getActorUserId(input.actor),
      input.dryRun,
      JSON.stringify(input.requestedPhases),
    ],
  );
  return mapDreamRun(result.rows[0]);
}

async function markRunRunning(runId: string): Promise<void> {
  await getNanoBrainPool().query(
    `
      UPDATE dream_runs
      SET status = 'running', started_at = COALESCE(started_at, now())
      WHERE id = $1
    `,
    [runId],
  );
}

async function finishRun(runId: string, status: Exclude<DreamRunStatus, 'pending' | 'running'>, totals: JsonObject): Promise<void> {
  await getNanoBrainPool().query(
    `
      UPDATE dream_runs
      SET status = $2, totals = $3::jsonb, started_at = COALESCE(started_at, now()), finished_at = now()
      WHERE id = $1
    `,
    [runId, status, JSON.stringify(totals)],
  );
}

export async function recoverInterruptedDreamRuns(startedBefore: Date): Promise<number> {
  // G2 启动恢复：进程崩溃后 running/pending 的 dream_runs 永远不重置（锁 TTL 过期也不改 run）。
  // 用 COALESCE(started_at, created_at)：pending 的 started_at 为 null，否则会漏。
  const pool = getNanoBrainPool();
  const updated = await pool.query(
    `UPDATE dream_runs
       SET status = 'failed', finished_at = now(), totals = totals || '{"error":"interrupted_by_restart"}'::jsonb
     WHERE status IN ('pending', 'running') AND COALESCE(started_at, created_at) < $1
     RETURNING id`,
    [startedBefore],
  );
  const recoveredIds = updated.rows.map((row) => row.id as string);
  if (recoveredIds.length > 0) {
    // 同步删除这些 run 持有的 dream_locks（holder_id = run id），否则重启后同 target 假锁到 TTL 结束。
    await pool.query(`DELETE FROM dream_locks WHERE holder_id = ANY($1::text[])`, [recoveredIds]);
  }
  return recoveredIds.length;
}

async function insertPhaseRun(runId: string, phase: DreamPhase): Promise<string> {
  const result = await getNanoBrainPool().query(
    `
      INSERT INTO dream_phase_runs (id, run_id, phase, status)
      VALUES ($1, $2, $3, 'pending')
      RETURNING id
    `,
    [randomUUID(), runId, phase],
  );
  return result.rows[0].id;
}

async function markPhaseRunning(phaseRunId: string): Promise<void> {
  await getNanoBrainPool().query(
    `
      UPDATE dream_phase_runs
      SET status = 'running', started_at = now()
      WHERE id = $1
    `,
    [phaseRunId],
  );
}

async function finishPhaseRun(phaseRunId: string, result: DreamPhaseResult): Promise<void> {
  await getNanoBrainPool().query(
    `
      UPDATE dream_phase_runs
      SET status = $2, duration_ms = $3, summary = $4, details = $5::jsonb, error = $6::jsonb, finished_at = now()
      WHERE id = $1
    `,
    [
      phaseRunId,
      result.status,
      result.durationMs,
      result.summary,
      JSON.stringify(result.details ?? {}),
      result.error === undefined ? null : JSON.stringify(result.error),
    ],
  );
}

async function insertSkippedLockPhaseRuns(runId: string, phases: DreamPhase[], existingLock: DreamLock | null): Promise<DreamPhaseResult[]> {
  const results: DreamPhaseResult[] = [];
  for (const phase of phases) {
    const phaseRunId = await insertPhaseRun(runId, phase);
    const result: DreamPhaseResult = {
      phase,
      status: 'skipped',
      durationMs: 0,
      summary: 'dream target is locked by another run',
      details: {
        reason: 'lock_not_acquired',
        existingLock: existingLock
          ? {
              id: existingLock.id,
              holderId: existingLock.holderId,
              holderHost: existingLock.holderHost,
              acquiredAt: existingLock.acquiredAt,
              ttlExpiresAt: existingLock.ttlExpiresAt,
            }
          : null,
      },
    };
    await finishPhaseRun(phaseRunId, result);
    results.push(result);
  }
  return results;
}

async function executePhase(input: {
  runId: string;
  target: DreamTarget;
  phase: DreamPhase;
  dryRun: boolean;
  actor: DreamActor;
  source: NanoSource | null;
  granularity?: CompileGranularity;
  handler: DreamPhaseHandler;
}): Promise<DreamPhaseResult> {
  const phaseRunId = await insertPhaseRun(input.runId, input.phase);
  await markPhaseRunning(phaseRunId);
  const started = Date.now();

  let result: DreamPhaseResult;
  try {
    const handlerResult = await input.handler({
      runId: input.runId,
      target: input.target,
      phase: input.phase,
      dryRun: input.dryRun,
      actor: input.actor,
      source: input.source,
      granularity: input.granularity,
    });
    const durationMs = Date.now() - started;
    result = {
      phase: input.phase,
      status: handlerResult?.status ?? 'clean',
      durationMs,
      summary: handlerResult?.summary ?? `phase ${input.phase} completed without changes`,
      details: handlerResult?.details ?? {},
      error: handlerResult?.error,
    };
  } catch (error) {
    result = {
      phase: input.phase,
      status: 'failed',
      durationMs: Date.now() - started,
      summary: `phase ${input.phase} failed`,
      details: {},
      error: sanitizeError(error),
    };
  }

  await finishPhaseRun(phaseRunId, result);
  return result;
}

const DREAM_LOCK_HEARTBEAT_MS = 2 * 60 * 1000;

function startLockHeartbeat(lock: DreamLock, ttlMs?: number): { stop: () => void } {
  // G1：后台长 Dream（如 refresh_embeddings 多批 embedding）可能超过锁 TTL，被 cleanup 清后同 target 并发。
  // 执行期定期续 ttl_expires_at；stop 时清定时器。续锁失败静默（下轮再续 / 最终靠启动恢复兜底）。
  // codex：间隔按实际 TTL 算（min(2min, ttl/2)），避免 TTL 小于 2min 时首次续期前锁就过期。
  const ttl = getDreamLockTtlMs(ttlMs);
  const intervalMs = Math.max(1000, Math.min(DREAM_LOCK_HEARTBEAT_MS, Math.floor(ttl / 2)));
  const timer = setInterval(() => {
    void refreshDreamLock(lock, ttlMs).catch(() => {});
  }, intervalMs);
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref?: () => void }).unref!();
  }
  return { stop: () => clearInterval(timer) };
}

// G1：前半（快）——建 run + 拿锁；未拿锁则内部标 skipped。返回真实 status 的 run。
async function startResolvedDream(
  actor: DreamActor,
  resolved: ResolvedDreamRequest,
  input: RunDreamInput,
): Promise<{ run: DreamRun; lockResult: DreamLockAcquireResult }> {
  const dryRun = input.dryRun === true;
  const run = await insertDreamRun({ target: resolved.target, actor, dryRun, requestedPhases: resolved.requestedPhases });
  const lockResult: DreamLockAcquireResult = await acquireDreamLock(resolved.target, { holderId: run.id, ttlMs: input.lockTtlMs });

  if (!lockResult.acquired) {
    const phases = await insertSkippedLockPhaseRuns(run.id, resolved.requestedPhases, lockResult.existingLock);
    const totals = buildRunTotals({ phases, dryRun, lock: { acquired: false, reason: 'lock_not_acquired' } });
    await finishRun(run.id, 'skipped', totals);
  } else {
    try {
      await markRunRunning(run.id);
    } catch (err) {
      // codex：拿锁后状态切换失败，best-effort 释放锁，避免锁泄漏到 TTL 过期，再抛原错误。
      await releaseDreamLock(lockResult.lock).catch(() => {});
      throw err;
    }
  }

  const updated = await getDreamRun(run.id);
  return { run: updated ?? run, lockResult };
}

// G1：后半（慢）——跑 phases + finish + release，执行期 heartbeat 续锁。
async function executeResolvedDreamPhases(
  actor: DreamActor,
  resolved: ResolvedDreamRequest,
  input: RunDreamInput,
  runId: string,
  lock: DreamLock,
): Promise<void> {
  const dryRun = input.dryRun === true;
  const heartbeat = startLockHeartbeat(lock, input.lockTtlMs);
  const phaseResults: DreamPhaseResult[] = [];
  try {
    for (const phase of resolved.requestedPhases) {
      const handler = input.phaseHandlers?.[phase] ?? DEFAULT_PHASE_HANDLERS[phase] ?? placeholderPhaseHandler;
      phaseResults.push(
        await executePhase({
          runId,
          target: resolved.target,
          phase,
          dryRun,
          actor,
          source: resolved.source,
          granularity: input.granularity,
          handler,
        }),
      );
    }

    const status = deriveRunStatus(phaseResults);
    const totals = buildRunTotals({ phases: phaseResults, dryRun, lock: { acquired: true } });
    await finishRun(runId, status, totals);
  } finally {
    heartbeat.stop();
    await releaseDreamLock(lock);
  }
}

// 同步组合：供 runDream / runDreamAsSystem / MCP 保持原同步终态语义，不受 G1 HTTP 后台化影响。
async function runResolvedDream(actor: DreamActor, resolved: ResolvedDreamRequest, input: RunDreamInput): Promise<DreamReport> {
  const { run, lockResult } = await startResolvedDream(actor, resolved, input);
  if (lockResult.acquired) {
    await executeResolvedDreamPhases(actor, resolved, input, run.id, lockResult.lock);
  }
  const report = await getDreamRunReport(run.id);
  if (!report) throw new Error(`dream run report missing after run: ${run.id}`);
  return report;
}

// G1 HTTP 后台化入口：startDream 建 run+拿锁（请求内 await，快），executeDreamInBackground 后台跑 phases。
export async function startDream(
  ctx: UserContext,
  input: RunDreamInput,
): Promise<{ run: DreamRun; lockResult: DreamLockAcquireResult; resolved: ResolvedDreamRequest; actor: DreamActor }> {
  const actor = normalizeActor(ctx);
  const resolved = await resolveDreamRequest(actor, input);
  const { run, lockResult } = await startResolvedDream(actor, resolved, input);
  return { run, lockResult, resolved, actor };
}

export async function executeDreamInBackground(
  actor: DreamActor,
  resolved: ResolvedDreamRequest,
  input: RunDreamInput,
  runId: string,
  lock: DreamLock,
): Promise<void> {
  await executeResolvedDreamPhases(actor, resolved, input, runId, lock);
}

// G1 后台 catch 用：只更新仍活跃(pending/running)的 run，避免 release lock 失败等场景把已完成 run 覆盖成 failed。
export async function markRunFailed(runId: string, error: unknown): Promise<void> {
  await getNanoBrainPool().query(
    `UPDATE dream_runs
       SET status = 'failed', finished_at = now(), totals = totals || $2::jsonb
     WHERE id = $1 AND status IN ('pending', 'running')`,
    [runId, JSON.stringify({ error: sanitizeError(error) })],
  );
}

export async function runDream(ctx: UserContext, input: RunDreamInput): Promise<DreamReport> {
  const actor = normalizeActor(ctx);
  const resolved = await resolveDreamRequest(actor, input);
  return runResolvedDream(actor, resolved, input);
}

export async function runDreamAsSystem(input: RunDreamSystemInput): Promise<DreamReport> {
  const actor: DreamActor = { type: 'system', userId: input.triggeredByUserId ?? null };
  const resolved = await resolveDreamRequest(actor, input);
  return runResolvedDream(actor, resolved, input);
}

export async function getDreamRun(runId: string): Promise<DreamRun | null> {
  if (!hasNonEmptyString(runId)) throw new NanoBrainError('dream run id 不能为空', 'invalid_input');
  const result = await getNanoBrainPool().query(
    `
      SELECT id, target, triggered_by, triggered_by_user_id, dry_run, status, requested_phases, totals, started_at, finished_at, created_at
      FROM dream_runs
      WHERE id = $1
    `,
    [runId.trim()],
  );
  return result.rows[0] ? mapDreamRun(result.rows[0]) : null;
}

export async function listDreamPhaseRuns(runId: string): Promise<DreamPhaseRun[]> {
  if (!hasNonEmptyString(runId)) throw new NanoBrainError('dream run id 不能为空', 'invalid_input');
  const result = await getNanoBrainPool().query(
    `
      SELECT id, run_id, phase, status, duration_ms, summary, details, error, started_at, finished_at, created_at
      FROM dream_phase_runs
      WHERE run_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [runId.trim()],
  );
  return result.rows.map(mapDreamPhaseRun);
}

export async function getDreamRunReport(runId: string): Promise<DreamReport | null> {
  const run = await getDreamRun(runId);
  if (!run) return null;
  const phaseRuns = await listDreamPhaseRuns(run.id);
  const startedAt = run.startedAt ?? run.createdAt;
  const finishedAt = run.finishedAt ?? run.startedAt ?? run.createdAt;
  return {
    schemaVersion: '1',
    runId: run.id,
    target: run.target,
    status: run.status,
    dryRun: run.dryRun,
    requestedPhases: run.requestedPhases,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    phases: phaseRuns.map((phaseRun) => ({
      phase: phaseRun.phase,
      status: phaseRun.status === 'pending' || phaseRun.status === 'running' ? 'skipped' : phaseRun.status,
      durationMs: phaseRun.durationMs ?? 0,
      summary: phaseRun.summary ?? '',
      details: phaseRun.details,
      ...(phaseRun.error ? { error: phaseRun.error } : {}),
    })),
    totals: run.totals,
  };
}

function appendDreamRunPermissionFilter(ctx: UserContext, clauses: string[], params: unknown[]): void {
  if (ctx.isAdmin) return;
  params.push(ctx.userId);
  clauses.push(`target_type = 'user_source' AND target_user_id = $${params.length}`);
}

function appendDreamRunOptionFilters(options: ListDreamRunsOptions, clauses: string[], params: unknown[]): void {
  if (options.targetType !== undefined) {
    if (!isDreamTargetType(options.targetType)) throw new NanoBrainError('target_type 不合法', 'invalid_input');
    params.push(options.targetType);
    clauses.push(`target_type = $${params.length}`);
  }

  if (options.sourceId !== undefined) {
    if (!hasNonEmptyString(options.sourceId)) throw new NanoBrainError('source_id 不能为空', 'invalid_input');
    params.push(options.sourceId.trim());
    clauses.push(`target_source_id = $${params.length}`);
  }

  if (options.status !== undefined) {
    if (!isDreamRunStatus(options.status)) throw new NanoBrainError('status 不合法', 'invalid_input');
    params.push(options.status);
    clauses.push(`status = $${params.length}`);
  }
}

export async function listDreamRuns(ctx: UserContext, options: ListDreamRunsOptions = {}): Promise<DreamRun[]> {
  const limit = normalizeLimit(options.limit);
  const clauses: string[] = [];
  const params: unknown[] = [];
  appendDreamRunPermissionFilter(ctx, clauses, params);
  appendDreamRunOptionFilters(options, clauses, params);
  params.push(limit);

  const result = await getNanoBrainPool().query(
    `
      SELECT id, target, triggered_by, triggered_by_user_id, dry_run, status, requested_phases, totals, started_at, finished_at, created_at
      FROM dream_runs
      ${clauses.length > 0 ? `WHERE ${clauses.map((clause) => `(${clause})`).join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}
    `,
    params,
  );
  return result.rows.map(mapDreamRun);
}

export async function getReadableDreamRunReport(ctx: UserContext, runId: string): Promise<DreamReport | null> {
  const run = await getDreamRun(runId);
  if (!run) return null;
  assertDreamRunReadable(ctx, run);
  return getDreamRunReport(run.id);
}

async function listActiveDreamLocks(ctx: UserContext, limit: number): Promise<DreamLock[]> {
  await cleanupExpiredDreamLocks();
  const clauses = ['ttl_expires_at > now()'];
  const params: unknown[] = [];
  if (!ctx.isAdmin) {
    params.push(ctx.userId);
    clauses.push(`target_type = 'user_source' AND target_user_id = $${params.length}`);
  }
  params.push(limit);

  const result = await getNanoBrainPool().query(
    `
      SELECT id, target_type, target_source_id, target_user_id, holder_id, holder_host, acquired_at, ttl_expires_at
      FROM dream_locks
      WHERE ${clauses.map((clause) => `(${clause})`).join(' AND ')}
      ORDER BY acquired_at DESC, id DESC
      LIMIT $${params.length}
    `,
    params,
  );
  return result.rows.map(mapDreamLock);
}

async function listRecentFailedDreamRuns(ctx: UserContext, limit: number): Promise<DreamRun[]> {
  const clauses = [`status IN ('failed', 'partial')`];
  const params: unknown[] = [];
  appendDreamRunPermissionFilter(ctx, clauses, params);
  params.push(limit);
  const result = await getNanoBrainPool().query(
    `
      SELECT id, target, triggered_by, triggered_by_user_id, dry_run, status, requested_phases, totals, started_at, finished_at, created_at
      FROM dream_runs
      WHERE ${clauses.map((clause) => `(${clause})`).join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}
    `,
    params,
  );
  return result.rows.map(mapDreamRun);
}

export async function getDreamStatus(ctx: UserContext, options: { limit?: number } = {}): Promise<DreamStatus> {
  const limit = normalizeLimit(options.limit, 10, 50);
  const [activeLocks, recentRuns, recentFailures] = await Promise.all([
    listActiveDreamLocks(ctx, limit),
    listDreamRuns(ctx, { limit }),
    listRecentFailedDreamRuns(ctx, limit),
  ]);
  return { checkedAt: new Date(), activeLocks, recentRuns, recentFailures };
}

export { DREAM_PHASES };
