import os

from fastapi import Header, HTTPException

from graph_rag.config import get_settings
from graph_rag.core.types import UserContext

PLACEHOLDER_INTERNAL_TOKEN = "change-me-internal-token"
MIN_INTERNAL_TOKEN_LENGTH = 32


def assert_internal_token_valid() -> None:
    """A5：监听前校验，纯校验无副作用。占位/空/过短直接 raise，交由调用方在启动路径让进程非 0 退出。

    不限 FF_DEPLOY_MODE——启动期新校验覆盖所有部署模式（请求期 require_internal_user 的
    production-only 占位拒绝逻辑保留不变）。
    """
    token = get_settings().internal_token
    if not token:
        raise RuntimeError("RAG_INTERNAL_TOKEN 未配置，进程拒绝启动")
    if token == PLACEHOLDER_INTERNAL_TOKEN:
        raise RuntimeError("RAG_INTERNAL_TOKEN 仍是出厂占位值，进程拒绝启动")
    if len(token) < MIN_INTERNAL_TOKEN_LENGTH:
        raise RuntimeError(f"RAG_INTERNAL_TOKEN 长度不足 {MIN_INTERNAL_TOKEN_LENGTH}，进程拒绝启动")


async def require_internal_user(
    x_ff_internal_token: str | None = Header(default=None),
    x_ff_user_id: str | None = Header(default=None),
    x_ff_username: str | None = Header(default=None),
    x_ff_is_admin: str | None = Header(default=None),
) -> UserContext:
    settings = get_settings()
    if not settings.internal_token:
        raise HTTPException(status_code=500, detail="RAG_INTERNAL_TOKEN is not configured")
    if os.environ.get("FF_DEPLOY_MODE") == "production" and settings.internal_token == "change-me-internal-token":
        raise HTTPException(status_code=500, detail="RAG_INTERNAL_TOKEN 仍是出厂占位值，生产模式拒绝服务")
    if x_ff_internal_token != settings.internal_token:
        raise HTTPException(status_code=401, detail="invalid internal token")
    if not x_ff_user_id or not x_ff_username:
        raise HTTPException(status_code=401, detail="missing user context headers")
    return UserContext(
        user_id=x_ff_user_id,
        username=x_ff_username,
        is_admin=x_ff_is_admin == "true",
    )
