import logging
from datetime import datetime, timezone

import uvicorn
from fastapi import FastAPI

from graph_rag.config import get_settings
from graph_rag.core.documents import recover_interrupted_documents
from graph_rag.core.lightrag_service import finalize_lightrag_instances
from graph_rag.core.neo4j_boundary import assert_neo4j_config_valid
from graph_rag.db import close_pool
from graph_rag.http.auth import assert_internal_token_valid
from graph_rag.http.routes.documents import router as documents_router
from graph_rag.http.routes.health import router as health_router
from graph_rag.http.routes.internal import router as internal_router
from graph_rag.http.routes.search import router as search_router
from graph_rag.http.routes.sources import router as sources_router


def create_app() -> FastAPI:
    # A5：监听前校验必须在 create_app() 顶部，确保生产进程一创建应用就完成校验。
    assert_internal_token_valid()
    assert_neo4j_config_valid()

    app = FastAPI(title="FF GraphRAG", version="0.1.0")
    app.include_router(health_router)
    app.include_router(internal_router)
    app.include_router(sources_router)
    app.include_router(documents_router)
    app.include_router(search_router)

    @app.on_event("startup")
    async def recover_on_startup() -> None:
        # C1：把上次进程残留在 processing 的文档标 failed，避免重启后永久卡在 processing。
        try:
            recovered = recover_interrupted_documents(datetime.now(timezone.utc))
            if recovered:
                logging.getLogger("graph_rag").warning("启动恢复：%d 个残留 processing 文档已标记 failed", recovered)
        except Exception:
            # codex 必修：不静默吞异常——恢复失败必须可见，否则旧 processing 永久卡住且无感知。
            logging.getLogger("graph_rag").exception("启动恢复 recover_interrupted_documents 失败")

    @app.on_event("shutdown")
    async def shutdown_lightrag() -> None:
        try:
            await finalize_lightrag_instances()
        finally:
            close_pool()  # C3：即使 storage finalize 失败也必须关闭连接池

    return app


app = create_app()


def main() -> None:
    settings = get_settings()
    # 直接运行 app，容器 PID 1 可由 Uvicorn 接收 SIGTERM 并执行 shutdown 钩子。
    uvicorn.run(app, host="0.0.0.0", port=settings.http_port, reload=False)


if __name__ == "__main__":
    main()
