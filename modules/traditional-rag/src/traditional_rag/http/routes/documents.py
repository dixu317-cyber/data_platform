import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel, Field

from traditional_rag.core.chunks import keyword_search_chunks, list_document_chunks
from traditional_rag.core.structured import search_structured_rows
from traditional_rag.core.documents import (
    archive_document,
    complete_upload_job,
    create_uploaded_document,
    delete_document,
    delete_document_chunk,
    get_readable_document,
    get_readable_job,
    list_readable_documents,
    list_readable_jobs,
)
from traditional_rag.core.tables import build_table_row_chunks, list_document_tables, list_readable_tables, query_tables
from traditional_rag.core.types import UserContext
from traditional_rag.http.auth import require_internal_user
from traditional_rag.http.errors import raise_http_error
from traditional_rag.http.serializers import to_public_chunk, to_public_document, to_public_job, to_public_table

router = APIRouter(prefix="/traditional")


class TableQueryRequest(BaseModel):
    query: str | None = Field(default=None, max_length=500)
    operation: str | None = None
    aggregate: str | None = None
    table_id: str | None = None
    source_id: str | None = None
    document_id: str | None = None
    sheet_name: str | None = None
    column: str | None = None
    group_by: str | None = None
    sort_column: str | None = None
    sort_direction: str | None = None
    filters: list[dict] | None = None
    columns: list[str] | None = None
    limit: int | None = Field(default=None, ge=1, le=200)


class StructuredSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=10, ge=1, le=50)
    source_id: str | None = None
    document_id: str | None = None
    table_id: str | None = None
    filters: list[dict] | None = None


@router.post("/documents", status_code=201)
async def upload_document_route(
    background_tasks: BackgroundTasks,
    source_id: str = Form(...),
    file: UploadFile = File(...),
    chunk_size: int | None = Form(default=None, ge=300, le=1600),
    chunk_overlap: int | None = Form(default=None, ge=0, le=300),
    user: UserContext = Depends(require_internal_user),
) -> dict:
    try:
        content = await file.read()
        result = await create_uploaded_document(
            user,
            source_id,
            file.filename or "upload.bin",
            content,
            file.content_type,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
        background_tasks.add_task(complete_upload_job, result.job.id)
        return {
            "document": to_public_document(result.document),
            "job": to_public_job(result.job),
        }
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
        return {"document": to_public_document(document)}
    except Exception as error:
        raise_http_error(error)


@router.delete("/documents/{document_id}")
async def delete_document_route(
    document_id: str,
    purge: bool = Query(False, description="true=硬删文档+cascade清 chunks(FR-153 re-ingest 移除);默认软归档"),
    user: UserContext = Depends(require_internal_user),
) -> dict:
    try:
        if purge:
            removed = await delete_document(user, document_id)
            return {"deleted": removed, "purged": True}
        document = await archive_document(user, document_id)
        return {"document": to_public_document(document), "archived": True}
    except Exception as error:
        raise_http_error(error)


@router.get("/documents/{document_id}/chunks")
async def list_document_chunks_route(document_id: str, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        document = await get_readable_document(user, document_id)
        chunks = list_document_chunks(document.id)
        if chunks:
            return {"chunks": [to_public_chunk(chunk) for chunk in chunks]}
        # CSV/XLSX 无文本 chunk(行数据在 traditional_tables/_rows)，把表格行渲染为 chunk 式条目预览
        if document.file_type in {"csv", "xlsx"}:
            tables = list_readable_tables(user, document.id)
            return {"chunks": build_table_row_chunks(tables)}
        return {"chunks": []}
    except Exception as error:
        raise_http_error(error)


@router.delete("/documents/{document_id}/chunks/{chunk_id}")
async def delete_document_chunk_route(document_id: str, chunk_id: str, user: UserContext = Depends(require_internal_user)) -> dict:
    """删除某文档下一个噪声 chunk(真删 traditional_chunks 行)。"""
    try:
        deleted = await delete_document_chunk(user, document_id, chunk_id)
        return {"deleted": deleted, "chunk_id": chunk_id}
    except Exception as error:
        raise_http_error(error)


@router.get("/documents/{document_id}/tables")
async def list_document_tables_route(document_id: str, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        tables = await list_document_tables(user, document_id)
        return {"tables": [to_public_table(table) for table in tables]}
    except Exception as error:
        raise_http_error(error)


@router.get("/tables")
async def list_tables_route(
    document_id: str | None = Query(default=None),
    source_id: str | None = Query(default=None),
    user: UserContext = Depends(require_internal_user),
) -> dict:
    try:
        if document_id:
            tables = await list_document_tables(user, document_id)
        else:
            tables = list_readable_tables(user, source_id=source_id)
        return {"tables": [to_public_table(table) for table in tables]}
    except Exception as error:
        raise_http_error(error)


@router.post("/tables/query")
async def query_tables_route(body: TableQueryRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        return await query_tables(user, body.model_dump(exclude_none=True))
    except Exception as error:
        raise_http_error(error)


@router.post("/structured/search")
async def structured_search_route(body: StructuredSearchRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        return await asyncio.to_thread(search_structured_rows, user, body.model_dump(exclude_none=True))
    except Exception as error:
        raise_http_error(error)


@router.get("/chunks/search")
async def search_chunks_route(
    q: str = Query(...),
    limit: int = Query(default=10, ge=1, le=50),
    user: UserContext = Depends(require_internal_user),
) -> dict:
    try:
        chunks = keyword_search_chunks(user, q, limit=limit)
        return {"chunks": [to_public_chunk(chunk) for chunk in chunks]}
    except Exception as error:
        raise_http_error(error)


@router.get("/jobs")
async def list_jobs_route(
    source_id: str | None = Query(default=None),
    document_id: str | None = Query(default=None),
    user: UserContext = Depends(require_internal_user),
) -> dict:
    try:
        jobs = await list_readable_jobs(user, source_id=source_id, document_id=document_id)
        return {"jobs": [to_public_job(job) for job in jobs]}
    except Exception as error:
        raise_http_error(error)


@router.get("/jobs/{job_id}")
async def get_job_route(job_id: str, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        job = await get_readable_job(user, job_id)
        return {"job": to_public_job(job)}
    except Exception as error:
        raise_http_error(error)
