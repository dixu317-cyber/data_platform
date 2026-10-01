"""One-shot LightRAG/Neo4j storage initialization for the migrate container."""

import asyncio
import hashlib
import os
from pathlib import Path
from urllib.parse import unquote, urlparse

import numpy as np
from lightrag import LightRAG
from lightrag.kg.shared_storage import initialize_share_data
from lightrag.utils import EmbeddingFunc, Tokenizer, TokenizerInterface


class _DeterministicTokenizer(TokenizerInterface):
    """Avoid a network download for a one-shot schema bootstrap."""

    def encode(self, text: str, **_kwargs):
        return list(range(len(text.split())))

    def decode(self, tokens):
        return " " .join("x" for _ in tokens)


def configure_postgres() -> None:
    parsed = urlparse(os.environ["GRAPH_RAG_DATABASE_URL"])
    os.environ.update(
        POSTGRES_HOST=parsed.hostname or "postgres",
        POSTGRES_PORT=str(parsed.port or 5432),
        POSTGRES_USER=unquote(parsed.username or ""),
        POSTGRES_PASSWORD=unquote(parsed.password or ""),
        POSTGRES_DATABASE=unquote(parsed.path.lstrip("/")),
        POSTGRES_VECTOR_INDEX_TYPE="HNSW",
        POSTGRES_SERVER_SETTINGS="search_path=lightrag,public",
    )


async def deterministic_embedding(texts: list[str]) -> np.ndarray:
    dimensions = int(os.environ.get("EMBEDDING_DIMENSIONS", "1024"))
    vectors = []
    for text in texts:
        digest = hashlib.sha256(text.encode()).digest()
        vectors.append([(digest[index % len(digest)] / 255.0) for index in range(dimensions)])
    return np.asarray(vectors, dtype=np.float32)


async def forbidden_llm(*_args, **_kwargs):
    raise RuntimeError("migrate storage setup must not call an LLM")


async def main() -> None:
    configure_postgres()
    initialize_share_data(workers=1)
    workdir = Path(os.environ.get("GRAPH_RAG_WORKING_DIR", "/tmp/ff-graph-rag"))
    workdir.mkdir(parents=True, exist_ok=True)
    dimensions = int(os.environ.get("EMBEDDING_DIMENSIONS", "1024"))
    rag = LightRAG(
        working_dir=str(workdir),
        workspace="m2b_bootstrap",
        embedding_func=EmbeddingFunc(
            embedding_dim=dimensions,
            max_token_size=8192,
            model_name=os.environ.get("EMBEDDING_MODEL", "qwen/qwen3-embedding-8b"),
            func=deterministic_embedding,
        ),
        llm_model_func=forbidden_llm,
        llm_model_name="migrate-forbidden",
        tokenizer=Tokenizer("m2b-deterministic", _DeterministicTokenizer()),
        kv_storage="PGKVStorage",
        vector_storage="PGVectorStorage",
        doc_status_storage="PGDocStatusStorage",
        graph_storage="Neo4JStorage",
    )
    await rag.initialize_storages()
    await rag.finalize_storages()


if __name__ == "__main__":
    asyncio.run(main())
