from traditional_rag.core.chunks import TraditionalChunk
from traditional_rag.core.documents import TraditionalDocument, TraditionalJob
from traditional_rag.core.sources import TraditionalSource
from traditional_rag.core.tables import TraditionalTable


def to_public_source(source: TraditionalSource) -> dict:
    return {
        "id": source.id,
        "name": source.name,
        "description": source.description,
        "kind": source.kind,
        "owner_user_id": source.owner_user_id,
        "created_by": source.created_by,
        "created_at": source.created_at.isoformat(),
        "updated_at": source.updated_at.isoformat(),
        "archived_at": source.archived_at.isoformat() if source.archived_at else None,
    }


def to_public_document(document: TraditionalDocument) -> dict:
    return {
        "id": document.id,
        "source_id": document.source_id,
        "original_filename": document.original_filename,
        "file_type": document.file_type,
        "status": document.status,
        "content_hash": document.content_hash,
        "storage_path": document.storage_path,
        "metadata": document.metadata,
        "uploaded_by": document.uploaded_by,
        "created_at": document.created_at.isoformat(),
        "updated_at": document.updated_at.isoformat(),
        "archived_at": document.archived_at.isoformat() if document.archived_at else None,
    }


def to_public_job(job: TraditionalJob) -> dict:
    return {
        "id": job.id,
        "document_id": job.document_id,
        "source_id": job.source_id,
        "status": job.status,
        "stage": job.stage,
        "error": job.error,
        "created_by": job.created_by,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
    }


def to_public_chunk(chunk: TraditionalChunk) -> dict:
    return {
        "id": chunk.id,
        "document_id": chunk.document_id,
        "source_id": chunk.source_id,
        "chunk_index": chunk.chunk_index,
        "chunk_text": chunk.chunk_text,
        "metadata": chunk.metadata,
        "embedding_model": chunk.embedding_model,
        "embedding_dimensions": chunk.embedding_dimensions,
        "created_at": chunk.created_at.isoformat(),
    }


def to_public_table(table: TraditionalTable) -> dict:
    return {
        "id": table.id,
        "document_id": table.document_id,
        "source_id": table.source_id,
        "table_index": table.table_index,
        "sheet_name": table.sheet_name,
        "columns": table.columns,
        "row_count": table.row_count,
        "metadata": table.metadata,
        "created_at": table.created_at.isoformat(),
    }
