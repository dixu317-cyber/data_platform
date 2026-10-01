from pathlib import Path

from traditional_rag.config import get_settings


def get_storage_root() -> Path:
    return Path(get_settings().storage_dir).expanduser().resolve()


def ensure_storage_layout() -> Path:
    root = get_storage_root()
    for child in ("files", "mineru", "images", "tmp"):
        (root / child).mkdir(parents=True, exist_ok=True)
    return root


def resolve_storage_path(*parts: str) -> Path:
    root = get_storage_root()
    candidate = root.joinpath(*parts).resolve()
    if root != candidate and root not in candidate.parents:
        raise ValueError("storage path escapes TRADITIONAL_RAG_STORAGE_DIR")
    return candidate
