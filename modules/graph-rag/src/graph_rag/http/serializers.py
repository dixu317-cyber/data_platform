from graph_rag.core.documents import GraphDocument
from graph_rag.core.sources import GraphSource


def to_public_source(source: GraphSource) -> dict:
    return {
        "id": source.id,
        "name": source.name,
        "description": source.description,
        "kind": source.kind,
        "workspace": source.workspace,
        "owner_user_id": source.owner_user_id,
        "created_by": source.created_by,
        "created_at": source.created_at.isoformat(),
        "updated_at": source.updated_at.isoformat(),
        "archived_at": source.archived_at.isoformat() if source.archived_at else None,
    }


def to_public_document(document: GraphDocument, include_content: bool = False) -> dict:
    body = {
        "id": document.id,
        "source_id": document.source_id,
        "original_filename": document.original_filename,
        "file_type": document.file_type,
        "status": document.status,
        "content_hash": document.content_hash,
        "metadata": document.metadata,
        "uploaded_by": document.uploaded_by,
        "created_at": document.created_at.isoformat(),
        "updated_at": document.updated_at.isoformat(),
        "archived_at": document.archived_at.isoformat() if document.archived_at else None,
    }
    if include_content:
        body["content_text"] = document.content_text
    return body
