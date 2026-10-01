import { NanoBrainError } from './sources';

export type EmbeddingConfig = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type EmbeddingCallContext =
  | 'search'
  | 'chunk-index'
  | 'dream-refresh-embeddings'
  | 'dream-auto-link'
  | 'fact-embed';

export function getEmbeddingConfig(): EmbeddingConfig {
  const provider = process.env.EMBEDDING_PROVIDER ?? 'openai-compatible';
  const baseUrl = process.env.EMBEDDING_BASE_URL;
  const apiKey = process.env.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL;

  if (!baseUrl) {
    throw new NanoBrainError('缺少 EMBEDDING_BASE_URL', 'embedding_failed');
  }
  if (!apiKey) {
    throw new NanoBrainError('缺少 EMBEDDING_API_KEY', 'embedding_failed');
  }
  if (!model) {
    throw new NanoBrainError('缺少 EMBEDDING_MODEL', 'embedding_failed');
  }
  if (provider !== 'openai-compatible') {
    throw new NanoBrainError(`暂不支持的 embedding provider: ${provider}`, 'embedding_failed');
  }

  return { provider, baseUrl, apiKey, model };
}

function embeddingsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/embeddings`;
}

function assertEmbeddingVector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new NanoBrainError('embedding 服务返回了空向量', 'embedding_failed');
  }
  const vector = value.map((item) => Number(item));
  if (vector.some((item) => !Number.isFinite(item))) {
    throw new NanoBrainError('embedding 服务返回了非法向量', 'embedding_failed');
  }
  return vector;
}

// 获取配置的 embedding 维度，默认 1024（与 traditional/graph 的 config default 一致）
export function getEmbeddingDimensions(): number {
  const raw = (process.env.EMBEDDING_DIMENSIONS ?? '').trim();
  // 只接受正整数字符串（与 traditional 的 pydantic int 同严格度），否则退 1024
  return /^[1-9]\d*$/.test(raw) ? Number(raw) : 1024;
}

// MRL 截断 + L2 归一化：与 traditional-rag 的 _truncate_normalize 完全同口径。
// 取前 targetDim 维再归一化；targetDim 无效或不小于原维度时原样返回；norm=0 退未归一化切片。
function truncateNormalize(vector: number[], targetDim: number): number[] {
  if (targetDim <= 0 || targetDim >= vector.length) {
    return vector;
  }
  const sub = vector.slice(0, targetDim);
  const norm = Math.sqrt(sub.reduce((sum, x) => sum + x * x, 0));
  return norm > 0 ? sub.map((x) => x / norm) : sub;
}

const EMBED_BATCH_SIZE = 10; // DashScope 硬约束 ≤10（台账 I111），勿照搬上层调度批大小

async function embedOneBatch(
  texts: string[],
  context: EmbeddingCallContext,
): Promise<{ model: string; embeddings: number[][] }> {
  const config = getEmbeddingConfig();
  // OpenRouter embedding 端点会间歇性挂起 / 限速；fetch 网络错误（含 AbortSignal 超时）+ 429/5xx 有界重试穿过抖动，4xx 立即失败（G3）。
  const attempts = 5;
  let response: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      response = await fetch(embeddingsEndpoint(config.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          'http-referer': 'http://localhost',
          'x-title': 'FF-CompanyBrain',
        },
        body: JSON.stringify({
          model: config.model,
          input: texts,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      // 网络错误（含超时）：重试；耗尽则抛。
      lastError = error;
      const reason = error instanceof Error ? error.name : 'unknown';
      if (attempt < attempts - 1) {
        console.warn(
          `[nano-brain] embedding retry: context=${context} attempt=${attempt + 1}/${attempts} textCount=${texts.length} reason=${reason}`,
        );
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * (attempt + 1), 3000)));
        continue;
      }
      console.error(
        `[nano-brain] embedding failed: context=${context} attempts=${attempts} textCount=${texts.length} reason=${reason}`,
      );
      throw new NanoBrainError(
        `embedding 服务网络错误: ${lastError instanceof Error ? lastError.message : 'unknown'}（context=${context}, attempts=${attempts}）`,
        'embedding_failed',
      );
    }

    // 状态判断在 try/catch 之外，避免不可重试的 4xx throw 被 catch 当网络错误再重试。
    if (response.ok) {
      break;
    }

    const status = response.status;
    if (status === 429 || (status >= 500 && status < 600)) {
      // 限速 / 服务端错误：可重试。
      const message = await response.text().catch(() => '');
      lastError = `HTTP ${status} ${message.slice(0, 300)}`;
      const reason = `http_${status}`;
      if (attempt < attempts - 1) {
        console.warn(
          `[nano-brain] embedding retry: context=${context} attempt=${attempt + 1}/${attempts} textCount=${texts.length} reason=${reason}`,
        );
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * (attempt + 1), 3000)));
        continue;
      }
      console.error(
        `[nano-brain] embedding failed: context=${context} attempts=${attempts} textCount=${texts.length} reason=${reason}`,
      );
      throw new NanoBrainError(
        `embedding 服务调用失败: ${lastError}（context=${context}, attempts=${attempts}）`,
        'embedding_failed',
      );
    }

    // 其它 4xx（400/401/403/404…）：业务失败，立即抛不重试。
    const message = await response.text().catch(() => '');
    const reason = `http_${status}`;
    console.error(
      `[nano-brain] embedding failed: context=${context} attempts=${attempt + 1} textCount=${texts.length} reason=${reason}`,
    );
    throw new NanoBrainError(
      `embedding 服务调用失败: HTTP ${status} ${message.slice(0, 300)}（context=${context}, attempts=${attempt + 1}）`,
      'embedding_failed',
    );
  }

  const payload = await response!.json();
  const data = payload?.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new NanoBrainError('embedding 服务返回数量与输入不一致', 'embedding_failed');
  }

  const embeddings = data.map((item: any) => assertEmbeddingVector(item?.embedding));

  // 同批向量维度一致性校验（与 traditional 口径一致，防混合维度污染存储）
  if (embeddings.length > 0) {
    const baseDim = embeddings[0].length;
    for (const vec of embeddings) {
      if (vec.length !== baseDim) {
        throw new NanoBrainError('embedding 服务返回了不一致维度的向量', 'embedding_failed');
      }
    }
  }

  // MRL 截断：按配置维度截断 + L2 归一化，chunk 存储与 query 检索同维同口径（一处改两头生效）
  const targetDim = getEmbeddingDimensions();
  const processedEmbeddings = embeddings.map((vec) => truncateNormalize(vec, targetDim));

  return { model: config.model, embeddings: processedEmbeddings };
}

export async function embedTexts(
  texts: string[],
  context: EmbeddingCallContext,
): Promise<{ model: string; embeddings: number[][] }> {
  if (texts.length === 0) {
    return { model: getEmbeddingConfig().model, embeddings: [] };
  }

  let model = '';
  const embeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const result = await embedOneBatch(batch, context);
    model = result.model;
    embeddings.push(...result.embeddings);
  }

  // 跨批维度一致性校验：防异常服务响应下不同批返回不同维度，拼接出混维向量污染 DB。
  if (embeddings.length > 0) {
    const dim0 = embeddings[0].length;
    if (embeddings.some((v) => v.length !== dim0)) {
      throw new NanoBrainError(`embedding 跨批向量维度不一致（期望 ${dim0}）`, 'embedding_failed');
    }
  }

  return { model, embeddings };
}

export function vectorToSqlLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
