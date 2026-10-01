import type pg from 'pg';
import { getNanoBrainPool } from '../../../db';
import { embedTexts, getEmbeddingConfig, getEmbeddingDimensions, vectorToSqlLiteral } from '../../embeddings';
import type { DreamPhaseHandlerContext } from '../runner';
import type { DreamPhaseResult } from '../types';

export const REFRESH_EMBEDDINGS_PHASE_VERSION = 'm20.v1';

// embedTexts 内部已强制 ≤10 分批（DashScope 硬约束），此 32 仅上层调度批，不代表实际请求批大小
const EMBEDDING_REFRESH_BATCH_SIZE = 32;
const MAX_REPORTED_FAILURES = 10;

type JsonObject = Record<string, unknown>;

type RefreshEmbeddingChunkRow = {
  id: string;
  page_id: string;
  source_id: string;
  slug: string;
  chunk_index: number;
  chunk_text: string;
  embedding_model: string;
  embedding_dims: number;
};

type RefreshEmbeddingsPlan = {
  currentModel: string;
  targetDimensions: number;
  totalChunks: number;
  totalPages: number;
  staleChunks: RefreshEmbeddingChunkRow[];
  stalePages: number;
  // 004 · FR-179:维度不一致(同模型名但向量维度 ≠ config 目标维度)待刷新计数,须暴露不静默。
  dimensionMismatchChunks: number;
};

type RefreshFailure = {
  chunkIds: string[];
  pageIds: string[];
  message: string;
  name?: string;
};

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

function failureFromError(chunks: RefreshEmbeddingChunkRow[], error: unknown): RefreshFailure {
  const sanitized = sanitizeError(error);
  return {
    chunkIds: chunks.map((chunk) => chunk.id),
    pageIds: Array.from(new Set(chunks.map((chunk) => chunk.page_id))),
    message: typeof sanitized.message === 'string' ? sanitized.message : String(error),
    ...(typeof sanitized.name === 'string' ? { name: sanitized.name } : {}),
  };
}

async function getSourceChunkCounts(sourceId: string): Promise<{ totalChunks: number; totalPages: number }> {
  const result = await getNanoBrainPool().query(
    `
      SELECT
        count(*)::int AS total_chunks,
        count(DISTINCT page_id)::int AS total_pages
      FROM chunks
      WHERE source_id = $1
    `,
    [sourceId],
  );

  const row = result.rows[0] ?? {};
  return {
    totalChunks: Number(row.total_chunks ?? 0),
    totalPages: Number(row.total_pages ?? 0),
  };
}

// FR-178:stale 判据 = 模型名不同 **或** 向量维度 ≠ 当前 config 目标维度。
// 修"改了维度但模型名没变→refresh 认为不 stale、永不重嵌、旧维度 chunk 被向量路永久排除"的坑。
async function listStaleChunks(sourceId: string, currentModel: string, targetDimensions: number): Promise<RefreshEmbeddingChunkRow[]> {
  const result = await getNanoBrainPool().query(
    `
      SELECT id, page_id, source_id, slug, chunk_index, chunk_text, embedding_model,
             vector_dims(embedding) AS embedding_dims
      FROM chunks
      WHERE source_id = $1
        AND (embedding_model IS DISTINCT FROM $2 OR vector_dims(embedding) IS DISTINCT FROM $3)
      ORDER BY slug ASC, chunk_index ASC, id ASC
    `,
    [sourceId, currentModel, targetDimensions],
  );
  return result.rows.map((row) => ({ ...row, embedding_dims: Number(row.embedding_dims) }));
}

export async function buildRefreshEmbeddingsPlan(sourceId: string): Promise<RefreshEmbeddingsPlan> {
  const currentModel = getEmbeddingConfig().model;
  const targetDimensions = getEmbeddingDimensions();
  const [counts, staleChunks] = await Promise.all([
    getSourceChunkCounts(sourceId),
    listStaleChunks(sourceId, currentModel, targetDimensions),
  ]);

  return {
    currentModel,
    targetDimensions,
    ...counts,
    staleChunks,
    stalePages: new Set(staleChunks.map((chunk) => chunk.page_id)).size,
    dimensionMismatchChunks: staleChunks.filter((chunk) => chunk.embedding_dims !== targetDimensions).length,
  };
}

async function updateChunkEmbedding(
  client: pg.PoolClient,
  input: {
    chunkId: string;
    embedding: number[];
    embeddingModel: string;
  },
): Promise<void> {
  await client.query(
    `
      UPDATE chunks
      SET embedding = $2::vector,
          embedding_model = $3,
          updated_at = now()
      WHERE id = $1
    `,
    [input.chunkId, vectorToSqlLiteral(input.embedding), input.embeddingModel],
  );
}

async function refreshChunkBatch(
  batch: RefreshEmbeddingChunkRow[],
  currentModel: string,
): Promise<{ refreshedChunks: number; refreshedPages: Set<string>; failures: RefreshFailure[] }> {
  try {
    const { model, embeddings } = await embedTexts(batch.map((chunk) => chunk.chunk_text), 'dream-refresh-embeddings');
    if (model !== currentModel) {
      throw new Error(`embedding model mismatch: expected ${currentModel}, got ${model}`);
    }
    if (embeddings.length !== batch.length) {
      throw new Error(`embedding count mismatch: expected ${batch.length}, got ${embeddings.length}`);
    }

    const client = await getNanoBrainPool().connect();
    try {
      await client.query('BEGIN');
      for (let index = 0; index < batch.length; index += 1) {
        const chunk = batch[index]!;
        const embedding = embeddings[index];
        if (!embedding) throw new Error(`missing embedding for chunk ${chunk.id}`);
        await updateChunkEmbedding(client, { chunkId: chunk.id, embedding, embeddingModel: model });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return {
      refreshedChunks: batch.length,
      refreshedPages: new Set(batch.map((chunk) => chunk.page_id)),
      failures: [],
    };
  } catch (error) {
    return {
      refreshedChunks: 0,
      refreshedPages: new Set<string>(),
      failures: [failureFromError(batch, error)],
    };
  }
}

async function applyRefreshEmbeddingsPlan(
  plan: RefreshEmbeddingsPlan,
): Promise<{ refreshedChunks: number; refreshedPages: number; failedChunks: number; failedPages: number; failures: RefreshFailure[] }> {
  let refreshedChunks = 0;
  const refreshedPageIds = new Set<string>();
  const failedPageIds = new Set<string>();
  const failures: RefreshFailure[] = [];

  for (let start = 0; start < plan.staleChunks.length; start += EMBEDDING_REFRESH_BATCH_SIZE) {
    const batch = plan.staleChunks.slice(start, start + EMBEDDING_REFRESH_BATCH_SIZE);
    const result = await refreshChunkBatch(batch, plan.currentModel);
    refreshedChunks += result.refreshedChunks;
    for (const pageId of result.refreshedPages) refreshedPageIds.add(pageId);
    for (const failure of result.failures) {
      failures.push(failure);
      for (const pageId of failure.pageIds) failedPageIds.add(pageId);
    }
  }

  return {
    refreshedChunks,
    refreshedPages: refreshedPageIds.size,
    failedChunks: failures.reduce((count, failure) => count + failure.chunkIds.length, 0),
    failedPages: failedPageIds.size,
    failures,
  };
}

function buildDetails(
  plan: RefreshEmbeddingsPlan,
  input: {
    dryRun: boolean;
    refreshedChunks?: number;
    refreshedPages?: number;
    failedChunks?: number;
    failedPages?: number;
    failures?: RefreshFailure[];
  },
): JsonObject {
  const staleModelCounts = plan.staleChunks.reduce<Record<string, number>>((counts, chunk) => {
    counts[chunk.embedding_model] = (counts[chunk.embedding_model] ?? 0) + 1;
    return counts;
  }, {});

  return {
    phaseVersion: REFRESH_EMBEDDINGS_PHASE_VERSION,
    dryRun: input.dryRun,
    currentEmbeddingModel: plan.currentModel,
    // FR-179:目标维度 + 维度不一致待刷新计数暴露(不静默排除)。
    targetDimensions: plan.targetDimensions,
    dimensionMismatchChunks: plan.dimensionMismatchChunks,
    totalChunks: plan.totalChunks,
    totalPages: plan.totalPages,
    staleChunks: plan.staleChunks.length,
    stalePages: plan.stalePages,
    staleModelCounts,
    refreshedChunks: input.refreshedChunks ?? 0,
    refreshedPages: input.refreshedPages ?? 0,
    failedChunks: input.failedChunks ?? 0,
    failedPages: input.failedPages ?? 0,
    failures: (input.failures ?? []).slice(0, MAX_REPORTED_FAILURES),
    failureCount: input.failures?.length ?? 0,
  };
}

export async function runRefreshEmbeddingsPhase(ctx: DreamPhaseHandlerContext): Promise<Omit<DreamPhaseResult, 'phase' | 'durationMs'>> {
  if (ctx.target.type === 'review_queue') {
    return {
      status: 'skipped',
      summary: 'refresh_embeddings is not applicable to review_queue targets',
      details: { reason: 'not_applicable', dryRun: ctx.dryRun, phaseVersion: REFRESH_EMBEDDINGS_PHASE_VERSION },
    };
  }

  const sourceId = ctx.target.sourceId;
  const plan = await buildRefreshEmbeddingsPlan(sourceId);

  if (ctx.dryRun) {
    return {
      status: plan.staleChunks.length > 0 ? 'ok' : 'clean',
      summary: `dry-run: refresh_embeddings would refresh ${plan.staleChunks.length} chunk(s) across ${plan.stalePages} page(s)`,
      details: buildDetails(plan, { dryRun: true }),
    };
  }

  const result = await applyRefreshEmbeddingsPlan(plan);
  const details = buildDetails(plan, { dryRun: false, ...result });

  if (result.failedChunks > 0) {
    const firstFailure = result.failures[0];
    return {
      status: 'failed',
      summary: `refresh_embeddings refreshed ${result.refreshedChunks} chunk(s) and failed ${result.failedChunks} chunk(s)`,
      details,
      error: {
        name: firstFailure?.name ?? 'EmbeddingRefreshError',
        message: firstFailure?.message ?? 'embedding refresh failed',
        failedChunks: result.failedChunks,
        failedPages: result.failedPages,
      },
    };
  }

  return {
    status: result.refreshedChunks > 0 ? 'ok' : 'clean',
    summary:
      result.refreshedChunks > 0
        ? `refresh_embeddings refreshed ${result.refreshedChunks} chunk(s) across ${result.refreshedPages} page(s)`
        : 'refresh_embeddings found no stale chunks',
    details,
  };
}
