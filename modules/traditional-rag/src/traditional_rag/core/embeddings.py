from __future__ import annotations

import json
import math
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from traditional_rag.config import get_settings
from traditional_rag.core.errors import TraditionalRagError


def _require_embedding_settings() -> tuple[str, str, str]:
    settings = get_settings()
    if settings.embedding_provider != "openai-compatible":
        raise TraditionalRagError("Embedding 配置缺失：EMBEDDING_PROVIDER 必须为 openai-compatible", "config_error")
    if not settings.embedding_base_url:
        raise TraditionalRagError("Embedding 配置缺失：请设置 EMBEDDING_BASE_URL", "config_error")
    if not settings.embedding_api_key:
        raise TraditionalRagError("Embedding 配置缺失：请设置 EMBEDDING_API_KEY", "config_error")
    if not settings.embedding_model:
        raise TraditionalRagError("Embedding 配置缺失：请设置 EMBEDDING_MODEL", "config_error")
    return settings.embedding_base_url.rstrip("/"), settings.embedding_api_key, settings.embedding_model


def _truncate_normalize(vector: list[float], target_dim: int) -> list[float]:
    # MRL 截断：取前 target_dim 维 + L2 归一化，与存量 SQL l2_normalize(subvector(emb,1,N)) 完全同口径。
    if target_dim <= 0 or target_dim >= len(vector):
        return vector
    truncated = vector[:target_dim]
    norm = math.sqrt(sum(x * x for x in truncated))
    if norm == 0:
        return truncated
    return [x / norm for x in truncated]


EMBED_BATCH_SIZE = 10  # DashScope 硬约束 ≤10（台账 I111），勿照搬 main 的 32；默认值，实际取 settings.embed_batch_size（已钳制 1~10）


def _embed_one_batch(texts: list[str]) -> tuple[list[list[float]], str, int]:
    base_url, api_key, model = _require_embedding_settings()
    payload = {"model": model, "input": texts}
    encoded_payload = json.dumps(payload).encode("utf-8")
    last_network_error: Exception | None = None
    result: dict[str, Any] | None = None
    attempts = 5
    for attempt in range(attempts):
        request = urllib.request.Request(
            f"{base_url}/embeddings",
            data=encoded_payload,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                body = response.read().decode("utf-8")
                result = json.loads(body)
                break
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise TraditionalRagError(f"Embedding API HTTP {error.code}: {detail}", "embedding_error") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            # OpenRouter embedding 端点会间歇性挂起；用短超时 + 快速重试穿过抖动，
            # 而不是在单次请求上干等到 120s。
            last_network_error = error
            if attempt < attempts - 1:
                time.sleep(min(1.0 * (attempt + 1), 3.0))
                continue
        except json.JSONDecodeError as error:
            raise TraditionalRagError("Embedding API 返回非 JSON 响应", "embedding_error") from error
    if result is None:
        raise TraditionalRagError(f"Embedding API 网络错误：{last_network_error.reason if last_network_error else 'unknown'}", "embedding_error")

    data = result.get("data")
    if not isinstance(data, list) or len(data) != len(texts):
        raise TraditionalRagError(f"Embedding API 响应条数异常：{result}", "embedding_error")
    ordered = sorted(data, key=lambda item: item.get("index", 0) if isinstance(item, dict) else 0)
    vectors: list[list[float]] = []
    for item in ordered:
        if not isinstance(item, dict) or not isinstance(item.get("embedding"), list):
            raise TraditionalRagError(f"Embedding API 响应缺少 embedding：{item}", "embedding_error")
        vector = [float(value) for value in item["embedding"]]
        if not vector:
            raise TraditionalRagError("Embedding API 返回空向量", "embedding_error")
        vectors.append(vector)
    dimensions = len(vectors[0])
    if any(len(vector) != dimensions for vector in vectors):
        raise TraditionalRagError("Embedding API 返回向量维度不一致", "embedding_error")
    # 降维到配置维度（默认 1024）：MRL 截断 + 归一化，与存量 SQL 迁移同口径，保证 query/chunk 同维。
    target_dim = get_settings().embedding_dimensions
    if 0 < target_dim < dimensions:
        vectors = [_truncate_normalize(vector, target_dim) for vector in vectors]
        dimensions = target_dim
    return vectors, model, dimensions


def embed_texts(texts: list[str]) -> tuple[list[list[float]], str, int]:
    if not texts:
        return [], get_settings().embedding_model or "", 0
    settings = get_settings()
    batch_size = settings.embed_batch_size  # 已钳制 1~10，env 不得绕过 DashScope 铁律
    concurrency = settings.embed_batch_concurrency  # 已钳制 ≥1
    batch_starts = list(range(0, len(texts), batch_size))
    # 结果按 batch 起始 index 回填的槽位（非 as_completed 直接 append）：
    # 并发完成顺序不确定，但每个 future 落回自己的 slot，最终按输入序拼接，向量与 chunk 序逐一对应。
    slots: list[list[list[float]] | None] = [None] * len(batch_starts)
    model = ""
    dimensions = 0
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        future_to_slot = {
            executor.submit(_embed_one_batch, texts[start : start + batch_size]): slot
            for slot, start in enumerate(batch_starts)
        }
        for future in as_completed(future_to_slot):
            slot = future_to_slot[future]
            # 任一批抛错（含 TraditionalRagError）在此重新抛出：整体失败，不返回部分向量（AM-2216 文档级原子）。
            batch_vectors, model, dimensions = future.result()
            slots[slot] = batch_vectors
    all_vectors: list[list[float]] = []
    for batch_vectors in slots:
        assert batch_vectors is not None  # 全部 future 都已 result() 成功才能走到这里
        all_vectors.extend(batch_vectors)
    # 跨批维度一致性校验：防异常服务响应下不同批返回不同维度，拼接出混维向量污染 DB。
    if all_vectors:
        dim0 = len(all_vectors[0])
        if any(len(v) != dim0 for v in all_vectors):
            raise TraditionalRagError("Embedding 跨批向量维度不一致", "embedding_error")
        dimensions = dim0
    return all_vectors, model, dimensions


def vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.8g}" for value in vector) + "]"
