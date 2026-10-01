import asyncio

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from traditional_rag.core.search import search
from traditional_rag.core.types import UserContext
from traditional_rag.http.auth import require_internal_user
from traditional_rag.http.errors import raise_http_error

router = APIRouter(prefix="/traditional")


class QueryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=10, ge=1, le=30)
    min_score: float | None = Field(default=None, ge=0, le=1)
    source_id: str | None = None
    source_ids: list[str] | None = None
    document_id: str | None = None
    file_types: list[str] | None = None


@router.post("/search")
async def search_route(body: QueryRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        # C2：同步 search 投线程池，避免同步 psycopg/urllib embedding 阻塞事件循环。
        return await asyncio.to_thread(search, user, body.model_dump(exclude_none=True))
    except Exception as error:
        raise_http_error(error)
