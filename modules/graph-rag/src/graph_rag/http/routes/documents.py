from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel, Field

from graph_rag.core.documents import (
    archive_document,
    create_and_schedule_text_document,
    create_and_schedule_uploaded_document,
    get_readable_document,
    list_readable_documents,
)
from graph_rag.core.types import UserContext
from graph_rag.http.auth import require_internal_user
from graph_rag.http.errors import raise_http_error
from graph_rag.http.serializers import to_public_document

router = APIRouter(prefix="/graph")


class TextDocumentRequest(BaseModel):
    source_id: str
    text: str = Field(min_length=1)
    title: str | None = Field(default=None, max_length=180)
    metadata: dict | None = None


@router.post("/documents/text", status_code=201)
async def create_text_document_route(
    body: TextDocumentRequest,
    user: UserContext = Depends(require_internal_user),
) -> dict:
    try:
        document = await create_and_schedule_text_document(
            user, body.source_id, body.text, title=body.title, metadata=body.metadata
        )
        return {"document": to_public_document(document)}
    except Exception as error:
        raise_http_error(error)


@router.post("/documents/upload", status_code=201)
async def upload_document_route(
    source_id: str = Form(...),
    file: UploadFile = File(...),
    user: UserContext = Depends(require_internal_user),
) -> dict:
    try:
        content = await file.read()
        document = await create_and_schedule_uploaded_document(
            user, source_id, file.filename or "document.txt", content, file.content_type
        )
        return {"document": to_public_document(document)}
    except Exception as error:
        raise_http_error(error)


@router.get("/documents")
async def list_documents_route(
    source_id: str | None = Query(default=None),
    user: UserContext = Depends(require_internal_user),
) -> dict:
    try:
        documents = await list_readable_documents(user, source_id)
        return {"documents": [to_public_document(document) for document in documents]}
    except Exception as error:
        raise_http_error(error)


@router.get("/documents/{document_id}")
async def get_document_route(document_id: str, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        document = await get_readable_document(user, document_id)
        return {"document": to_public_document(document, include_content=True)}
    except Exception as error:
        raise_http_error(error)


@router.delete("/documents/{document_id}")
async def delete_document_route(
    document_id: str,
    purge: bool = Query(False, description="true=清实体(adelete_by_doc_id)+归档(FR-154 re-ingest 移除);默认仅归档"),
    user: UserContext = Depends(require_internal_user),
) -> dict:
    try:
        document = await archive_document(user, document_id, purge=purge)
        return {
            "document": to_public_document(document),
            "purged" if purge else "archived": True,
        }
    except Exception as error:
        raise_http_error(error)
