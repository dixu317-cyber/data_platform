import { Hono } from 'hono';
import {
  executeDreamInBackground,
  getDreamStatus,
  getReadableDreamRunReport,
  listDreamRuns,
  markRunFailed,
  startDream,
} from '../../core/dream/runner';
import { isDreamPhase, isDreamRunStatus, isDreamTargetType, type DreamPhase, type DreamRunStatus, type DreamTarget, type DreamTargetType } from '../../core/dream/types';
import { NanoBrainError } from '../../core/sources';
import { internalRoute } from '../route';
import { toPublicDreamReport, toPublicDreamRun, toPublicDreamStatus } from '../serializers';

export const dreamRouter = new Hono();

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseTargetType(value: string | undefined): DreamTargetType | undefined {
  if (value === undefined) return undefined;
  if (!isDreamTargetType(value)) throw new NanoBrainError('target_type 不合法', 'invalid_input');
  return value;
}

function parseRunStatus(value: string | undefined): DreamRunStatus | undefined {
  if (value === undefined) return undefined;
  if (!isDreamRunStatus(value)) throw new NanoBrainError('status 不合法', 'invalid_input');
  return value;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

const COMPILE_GRANULARITIES = ['document', 'theme', 'paragraph'] as const;
type CompileGranularityInput = (typeof COMPILE_GRANULARITIES)[number];

function parseGranularity(value: unknown): CompileGranularityInput | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !(COMPILE_GRANULARITIES as readonly string[]).includes(value)) {
    throw new NanoBrainError(`granularity 不合法(须为 document/theme/paragraph): ${String(value)}`, 'invalid_input');
  }
  return value as CompileGranularityInput;
}

function parsePhases(value: unknown): DreamPhase[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new NanoBrainError('phases 必须是数组', 'invalid_input');
  return value.map((phase) => {
    if (typeof phase !== 'string' || !isDreamPhase(phase)) {
      throw new NanoBrainError(`dream phase 不合法: ${String(phase)}`, 'invalid_input');
    }
    return phase;
  });
}

function parseDreamTarget(body: Record<string, unknown>, currentUserId: string): DreamTarget {
  const rawTarget = asObject(body.target ?? body);
  const targetType = nonEmptyString(rawTarget.type ?? rawTarget.target_type);
  const sourceId = nonEmptyString(rawTarget.sourceId ?? rawTarget.source_id ?? body.source_id);

  if (targetType === 'user_source') {
    const userId = nonEmptyString(rawTarget.userId ?? rawTarget.user_id ?? body.user_id) ?? currentUserId;
    return { type: 'user_source', sourceId: sourceId ?? '', userId };
  }

  if (targetType === 'public_source') {
    return { type: 'public_source', sourceId: sourceId ?? '' };
  }

  if (targetType === 'review_queue') {
    const targetSourceId = nonEmptyString(rawTarget.targetSourceId ?? rawTarget.target_source_id ?? body.target_source_id ?? sourceId);
    return targetSourceId ? { type: 'review_queue', targetSourceId } : { type: 'review_queue' };
  }

  throw new NanoBrainError('dream target type 不合法', 'invalid_input');
}

dreamRouter.post(
  '/nano/dream/runs',
  internalRoute('触发 dream 失败', async (c, ctx) => {
    const body = asObject(await c.req.json());
    const input = {
      target: parseDreamTarget(body, ctx.userId),
      phases: parsePhases(body.phases),
      dryRun: body.dry_run === true || body.dryRun === true,
      granularity: parseGranularity(body.granularity),
    };
    // G1 后台化：startDream 建 run+拿锁（快，请求内 await），phases 后台跑，秒回 202 + 真实 status（running/skipped）。
    const { run, lockResult, resolved, actor } = await startDream(ctx, input);
    if (lockResult.acquired) {
      // fire-and-forget：必 catch 防 unhandledRejection；错误落 dream_runs=failed，markRunFailed 二次失败只 log。
      void executeDreamInBackground(actor, resolved, input, run.id, lockResult.lock).catch(async (err) => {
        try {
          await markRunFailed(run.id, err);
        } catch (markErr) {
          console.error('[Nano Brain] markRunFailed 二次失败:', markErr);
        }
      });
    }
    return c.json({ run: toPublicDreamRun(run) }, 202);
  }),
);

dreamRouter.get(
  '/nano/dream/runs',
  internalRoute('读取 dream runs 失败', async (c, ctx) => {
    const runs = await listDreamRuns(ctx, {
      targetType: parseTargetType(c.req.query('target_type')),
      sourceId: c.req.query('source_id'),
      status: parseRunStatus(c.req.query('status')),
      limit: parseLimit(c.req.query('limit')),
    });
    return c.json({ runs: runs.map(toPublicDreamRun) });
  }),
);

dreamRouter.get(
  '/nano/dream/runs/:runId',
  internalRoute('读取 dream run 报告失败', async (c, ctx) => {
    const report = await getReadableDreamRunReport(ctx, c.req.param('runId')!);
    if (!report) throw new NanoBrainError('dream run 不存在', 'not_found');
    return c.json({ run: toPublicDreamReport(report) });
  }),
);

dreamRouter.get(
  '/nano/dream/status',
  internalRoute('读取 dream 状态失败', async (c, ctx) => {
    const status = await getDreamStatus(ctx, { limit: parseLimit(c.req.query('limit')) });
    return c.json({ status: toPublicDreamStatus(status) });
  }),
);
