from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    service_name: str = "traditional-rag"
    http_port: int = Field(default=8101, alias="TRADITIONAL_RAG_HTTP_PORT")
    internal_token: str | None = Field(default=None, alias="RAG_INTERNAL_TOKEN")
    database_url: str | None = Field(default=None, alias="TRADITIONAL_RAG_DATABASE_URL")
    storage_dir: str = Field(default=".traditional-rag-storage", alias="TRADITIONAL_RAG_STORAGE_DIR")
    embedding_provider: str | None = Field(default=None, alias="EMBEDDING_PROVIDER")
    embedding_base_url: str | None = Field(default=None, alias="EMBEDDING_BASE_URL")
    embedding_api_key: str | None = Field(default=None, alias="EMBEDDING_API_KEY")
    embedding_model: str | None = Field(default=None, alias="EMBEDDING_MODEL")
    embedding_dimensions: int = Field(default=1024, alias="EMBEDDING_DIMENSIONS")
    # 022b T3：批间受控并发。EMBED_BATCH_SIZE 钳制 1~10（DashScope 硬约束，台账 I111，
    # env 不得绕过；非 main 的 32）；EMBED_BATCH_CONCURRENCY 钳制 ≥1。
    embed_batch_size: int = Field(default=10, alias="EMBED_BATCH_SIZE")
    embed_batch_concurrency: int = Field(default=3, alias="EMBED_BATCH_CONCURRENCY")
    # P7-B：token chunking 为 opt-in（P7-A 评测显示在当前语料上不优于字符基线，默认关）。
    # 开启后按 embedding 模型自身分词器（vendored tokenizer.json）计 chunk 尺寸；关闭则走字符切分（基线）。
    chunk_token_mode: bool = Field(default=False, alias="CHUNK_TOKEN_MODE")
    # 从本地 vendored tokenizer.json 加载（EMBEDDING_TOKENIZER_PATH，离线/国内稳，零运行时网络）；
    # 无本地文件则退回字符兜底。用 scripts/fetch-tokenizers.sh 下载 tokenizer.json。
    embedding_tokenizer_path: str | None = Field(default=None, alias="EMBEDDING_TOKENIZER_PATH")
    mineru_api_key: str | None = Field(default=None, alias="MINERU_API_KEY")
    mineru_base_url: str = Field(default="https://mineru.net", alias="MINERU_BASE_URL")
    mineru_model_version: str = Field(default="vlm", alias="MINERU_MODEL_VERSION")
    mineru_language: str = Field(default="ch", alias="MINERU_LANGUAGE")
    mineru_enable_table: bool = Field(default=True, alias="MINERU_ENABLE_TABLE")
    mineru_enable_formula: bool = Field(default=True, alias="MINERU_ENABLE_FORMULA")
    mineru_is_ocr: bool = Field(default=False, alias="MINERU_IS_OCR")
    mineru_poll_interval_seconds: int = Field(default=3, alias="MINERU_POLL_INTERVAL_SECONDS")
    mineru_timeout_seconds: int = Field(default=600, alias="MINERU_TIMEOUT_SECONDS")
    job_recovery_concurrency: int = Field(default=2, alias="TRADITIONAL_RAG_JOB_RECOVERY_CONCURRENCY")
    db_pool_min_size: int = Field(default=1, alias="TRADITIONAL_RAG_DB_POOL_MIN_SIZE")
    db_pool_max_size: int = Field(default=10, alias="TRADITIONAL_RAG_DB_POOL_MAX_SIZE")

    @field_validator("embed_batch_size", mode="after")
    @classmethod
    def _clamp_embed_batch_size(cls, value: int) -> int:
        return max(1, min(10, value))

    @field_validator("embed_batch_concurrency", mode="after")
    @classmethod
    def _clamp_embed_batch_concurrency(cls, value: int) -> int:
        return max(1, value)


def get_settings() -> Settings:
    return Settings()
