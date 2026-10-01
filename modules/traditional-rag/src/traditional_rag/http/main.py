import asyncio
import logging
from datetime import datetime, timezone

import uvicorn
from fastapi import FastAPI

from traditional_rag.config import get_settings
from traditional_rag.core.documents import complete_upload_job, reset_stale_jobs_for_recovery
from traditional_rag.db import close_pool
from traditional_rag.http.auth import assert_internal_token_valid
from traditional_rag.http.routes.documents import router as documents_router
from traditional_rag.http.routes.health import router as health_router
from traditional_rag.http.routes.internal import router as internal_router
from traditional_rag.http.routes.search import router as search_router
from traditional_rag.http.routes.sources import router as sources_router


def create_app() -> FastAPI:
    # A5：监听前校验必须在 create_app() 顶部，确保生产进程一创建应用就完成校验。
    assert_internal_token_valid()

    app = FastAPI(title="FF Traditional RAG", version="0.1.0")
    app.include_router(health_router)
    app.include_router(internal_router)
    app.include_router(sources_router)
    app.include_router(documents_router)
    app.include_router(search_router)

    @app.on_event("startup")
    async def recover_jobs_on_startup() -> None:
        # C2：把上次进程残留(updated_at < 启动时刻)的非终态 job 重新派发；
        # 同步 complete_upload_job 投线程池(不阻塞 loop)，Semaphore 限并发(< pool max_size 防连接饥饿)。
        started_at = datetime.now(timezone.utc)
        logger = logging.getLogger("traditional_rag")
        try:
            job_ids = reset_stale_jobs_for_recovery(started_at)
        except Exception:
            logger.exception("启动恢复扫描失败")
            return
        if not job_ids:
            return
        logger.warning("启动恢复：%d 个残留 job 重新派发", len(job_ids))
        semaphore = asyncio.Semaphore(get_settings().job_recovery_concurrency)

        async def _run(job_id: str) -> None:
            async with semaphore:
                try:
                    await asyncio.to_thread(complete_upload_job, job_id)
                except Exception:
                    logger.exception("恢复 job 失败 job_id=%s", job_id)

        # codex 必修：create_task 只收协程，gather() 返回 Future 会抛 TypeError；包一层协程。
        async def _recover_all() -> None:
            await asyncio.gather(*[_run(job_id) for job_id in job_ids])

        # fire-and-forget：不阻塞 startup，后台并发恢复。
        asyncio.create_task(_recover_all())

    @app.on_event("shutdown")
    async def close_db_pool() -> None:
        close_pool()  # C3：关闭连接池

    return app


app = create_app()


def main() -> None:
    settings = get_settings()
    # 直接运行 app，容器 PID 1 可由 Uvicorn 接收 SIGTERM 并执行 shutdown 钩子。
    uvicorn.run(app, host="0.0.0.0", port=settings.http_port, reload=False)


if __name__ == "__main__":
    main()
