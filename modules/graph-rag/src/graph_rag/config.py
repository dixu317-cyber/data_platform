from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    service_name: str = "graph-rag"
    http_port: int = Field(default=8102, alias="GRAPH_RAG_HTTP_PORT")
    internal_token: str | None = Field(default=None, alias="RAG_INTERNAL_TOKEN")
    database_url: str | None = Field(default=None, alias="GRAPH_RAG_DATABASE_URL")
    embedding_provider: str | None = Field(default=None, alias="EMBEDDING_PROVIDER")
    embedding_base_url: str | None = Field(default=None, alias="EMBEDDING_BASE_URL")
    embedding_api_key: str | None = Field(default=None, alias="EMBEDDING_API_KEY")
    embedding_model: str | None = Field(default=None, alias="EMBEDDING_MODEL")
    embedding_dimensions: int = Field(default=1024, alias="EMBEDDING_DIMENSIONS")
    agent_base_url: str | None = Field(default=None, alias="AGENT_BASE_URL")
    agent_api_key: str | None = Field(default=None, alias="AGENT_API_KEY")
    agent_model: str | None = Field(default=None, alias="AGENT_MODEL")
    neo4j_uri: str | None = Field(default=None, alias="NEO4J_URI")
    neo4j_username: str | None = Field(default=None, alias="NEO4J_USERNAME")
    neo4j_password: str | None = Field(default=None, alias="NEO4J_PASSWORD")
    neo4j_database: str = Field(default="neo4j", alias="NEO4J_DATABASE")
    neo4j_max_connection_pool_size: int = Field(
        default=10, alias="NEO4J_MAX_CONNECTION_POOL_SIZE"
    )
    neo4j_connection_timeout_seconds: float = Field(
        default=10.0, alias="NEO4J_CONNECTION_TIMEOUT_SECONDS"
    )
    # I92：实体关系密集文档(组织架构/生态语料)LightRAG 建图逐次串行调 LLM 抽实体,
    # 600s 偏小致 timeout_may_have_partial_index 失败；放宽到 1800s 让慢文档能建完(治标)。
    ingest_timeout_seconds: int = Field(default=1800, alias="GRAPH_RAG_INGEST_TIMEOUT_SECONDS")
    # #5 必修：source 级联删除前等在途 ingest task 跑完的上限；超时拒绝删除(409)而不是
    # cancel 在途写入或无限期挂起 HTTP 请求。
    delete_wait_seconds: float = Field(default=60.0, alias="GRAPH_RAG_DELETE_WAIT_SECONDS")
    db_pool_min_size: int = Field(default=1, alias="GRAPH_RAG_DB_POOL_MIN_SIZE")
    db_pool_max_size: int = Field(default=10, alias="GRAPH_RAG_DB_POOL_MAX_SIZE")
    query_timeout_seconds: int = Field(default=30, alias="GRAPH_RAG_QUERY_TIMEOUT_SECONDS")
    query_concurrency: int = Field(default=4, alias="GRAPH_RAG_QUERY_CONCURRENCY")
    query_max_sources: int = Field(default=30, alias="GRAPH_RAG_QUERY_MAX_SOURCES")
    # 011 FR-309 / 009 §15 第5条:graph mode 管理员旋钮。auto=启用 FR-308 问题路由器;
    # 其余(local/global/hybrid/mix/naive)=钉死该 mode(A/B 与运维手动干预)。默认 auto。
    graph_query_mode: str = Field(default="auto", alias="GRAPH_QUERY_MODE")
    # 011 T4(FR-313/314/315):传给 LightRAG QueryParam 的精细化旋钮(管理员高级配置)。
    #   None = 不覆盖库默认。top_k 承接 009「取证范围」= search 的 limit,故不单列。
    # FR-313:chunk_top_k 缺省派生自 top_k(未配即等于 top_k),配了则覆盖。
    graph_chunk_top_k: int | None = Field(default=None, alias="GRAPH_CHUNK_TOP_K")
    # FR-314:max_total_tokens 暴露为可配;max_entity_tokens/max_relation_tokens **定死取库默认**
    #   (刻意不暴露为配置项,防 token 预算被过度切碎)。
    graph_max_total_tokens: int | None = Field(default=None, alias="GRAPH_MAX_TOTAL_TOKENS")
    # FR-315:enable_rerank 承接 009「语义/关键词权重」+ 全局 rerank 策略。None=用库默认。
    graph_enable_rerank: bool | None = Field(default=None, alias="GRAPH_ENABLE_RERANK")


def get_settings() -> Settings:
    return Settings()
