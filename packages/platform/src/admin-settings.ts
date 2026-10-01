import type { HealthResponse, ModuleId } from "@ff/contracts";

export type SecretConfigStatus = {
  envName: string;
  configured: boolean;
  fingerprint: string | null;
};

export type DatabaseConfigStatus = {
  id: string;
  label: string;
  envName: string;
  configured: boolean;
  host: string | null;
  port: string | null;
  database: string | null;
  username: string | null;
};

export type ProviderConfigStatus = {
  id: string;
  label: string;
  provider: string;
  baseUrl: string | null;
  model: string | null;
  dimensions?: number | null;
  secrets: SecretConfigStatus[];
  controls: string[];
};

export type ParserConfigStatus = {
  id: string;
  label: string;
  baseUrl: string | null;
  modelVersion: string | null;
  language: string | null;
  options: string[];
  secrets: SecretConfigStatus[];
};

export type ModuleServiceConfigStatus = {
  id: ModuleId;
  label: string;
  baseUrl: string;
  status: "ok" | "error" | "unknown";
  service: string;
  requiredEnv: string[];
  role: string;
};

export type RuntimePolicyConfigStatus = {
  label: string;
  value: string;
  impact: string;
};

export type AdminIntegrationSettings = {
  checkedAt: string;
  overallStatus: "ready" | "degraded" | "blocked";
  providers: ProviderConfigStatus[];
  parsers: ParserConfigStatus[];
  modules: ModuleServiceConfigStatus[];
  databases: DatabaseConfigStatus[];
  runtimePolicies: RuntimePolicyConfigStatus[];
};

type BuildAdminIntegrationSettingsInput = {
  env?: NodeJS.ProcessEnv;
  moduleHealth?: Partial<Record<ModuleId, HealthResponse>>;
  checkedAt?: Date;
};

const moduleHttpUrlEnv: Record<ModuleId, string> = {
  "nano-brain": "NANO_BRAIN_HTTP_URL",
  "traditional-rag": "TRADITIONAL_RAG_HTTP_URL",
  "graph-rag": "GRAPH_RAG_HTTP_URL"
};

const moduleDefaultHttpUrl: Record<ModuleId, string> = {
  "nano-brain": "http://127.0.0.1:8100",
  "traditional-rag": "http://127.0.0.1:8101",
  "graph-rag": "http://127.0.0.1:8102"
};

const moduleLabels: Record<ModuleId, string> = {
  "nano-brain": "知识百科服务",
  "traditional-rag": "文档证据服务",
  "graph-rag": "关系图谱服务"
};

export function buildAdminIntegrationSettings(input: BuildAdminIntegrationSettingsInput = {}): AdminIntegrationSettings {
  const env = input.env ?? process.env;
  const providers: ProviderConfigStatus[] = [
    {
      id: "agent",
      label: "回答模型",
      provider: env.AGENT_PROVIDER ?? "openai-compatible",
      baseUrl: emptyToNull(env.AGENT_BASE_URL),
      model: emptyToNull(env.AGENT_MODEL),
      secrets: [secretStatus("AGENT_API_KEY", env.AGENT_API_KEY)],
      controls: [
        `温度 ${env.AGENT_TEMPERATURE ?? "0"}`,
        env.AGENT_STREAM_USAGE === "true" ? "记录流式用量" : "不记录流式用量"
      ]
    },
    {
      id: "embedding",
      label: "向量模型",
      provider: env.EMBEDDING_PROVIDER ?? "openai-compatible",
      baseUrl: emptyToNull(env.EMBEDDING_BASE_URL),
      model: emptyToNull(env.EMBEDDING_MODEL),
      dimensions: numberOrNull(env.EMBEDDING_DIMENSIONS),
      secrets: [secretStatus("EMBEDDING_API_KEY", env.EMBEDDING_API_KEY)],
      controls: ["用于文档切片、图谱检索和公司大脑召回"]
    }
  ];

  const parsers: ParserConfigStatus[] = [
    {
      id: "mineru",
      label: "PDF 解析服务",
      baseUrl: emptyToNull(env.MINERU_BASE_URL ?? "https://mineru.net"),
      modelVersion: emptyToNull(env.MINERU_MODEL_VERSION ?? "vlm"),
      language: emptyToNull(env.MINERU_LANGUAGE ?? "ch"),
      options: [
        env.MINERU_ENABLE_TABLE === "false" ? "不抽取表格" : "抽取表格",
        env.MINERU_ENABLE_FORMULA === "false" ? "不抽取公式" : "抽取公式",
        env.MINERU_IS_OCR === "true" ? "启用 OCR" : "按文档文本优先"
      ],
      secrets: [secretStatus("MINERU_API_KEY", env.MINERU_API_KEY)]
    }
  ];

  const modules = (Object.keys(moduleLabels) as ModuleId[]).map((id): ModuleServiceConfigStatus => {
    const health = input.moduleHealth?.[id];
    return {
      id,
      label: moduleLabels[id],
      baseUrl: env[moduleHttpUrlEnv[id]] ?? moduleDefaultHttpUrl[id],
      status: health?.status ?? "unknown",
      service: health?.service ?? id,
      requiredEnv: ["RAG_INTERNAL_TOKEN", moduleHttpUrlEnv[id]],
      role: moduleRole(id)
    };
  });

  const databases = [
    databaseStatus("postgres-admin", "PostgreSQL 管理连接", "POSTGRES_ADMIN_URL", env.POSTGRES_ADMIN_URL),
    databaseStatus("identity", "账号与权限库", "IDENTITY_DATABASE_URL", env.IDENTITY_DATABASE_URL),
    databaseStatus("platform", "平台业务库", "PLATFORM_DATABASE_URL", env.PLATFORM_DATABASE_URL),
    databaseStatus("nano-brain", "知识百科库", "NANO_BRAIN_DATABASE_URL", env.NANO_BRAIN_DATABASE_URL),
    databaseStatus("traditional-rag", "文档证据库", "TRADITIONAL_RAG_DATABASE_URL", env.TRADITIONAL_RAG_DATABASE_URL),
    databaseStatus("graph-rag", "关系图谱库", "GRAPH_RAG_DATABASE_URL", env.GRAPH_RAG_DATABASE_URL),
    databaseStatus("agent", "会话与任务库", "AGENT_DATABASE_URL", env.AGENT_DATABASE_URL)
  ];

  const runtimePolicies: RuntimePolicyConfigStatus[] = [
    {
      label: "内部调用令牌",
      value: secretStatus("RAG_INTERNAL_TOKEN", env.RAG_INTERNAL_TOKEN).configured ? "已配置" : "未配置",
      impact: "统一 API 调用 RAG 模块时必须携带"
    },
    {
      label: "Agent 检查点 Schema",
      value: env.AGENT_CHECKPOINT_SCHEMA ?? "langgraph",
      impact: "控制 LangGraph 会话状态存储位置"
    },
    {
      label: "文档存储目录",
      value: env.TRADITIONAL_RAG_STORAGE_DIR ?? ".traditional-rag-storage",
      impact: "保存上传文件、MinerU 结果和抽取图片"
    },
    {
      label: "图谱工作目录",
      value: env.GRAPH_RAG_WORKING_DIR ?? ".graph-rag-workdir",
      impact: "保存 LightRAG 运行时索引和工作文件"
    }
  ];

  return {
    checkedAt: (input.checkedAt ?? new Date()).toISOString(),
    overallStatus: summarizeStatus({ providers, parsers, modules, databases }),
    providers,
    parsers,
    modules,
    databases,
    runtimePolicies
  };
}

function secretStatus(envName: string, value: string | undefined): SecretConfigStatus {
  const normalized = value?.trim() ?? "";
  return {
    envName,
    configured: normalized.length > 0,
    fingerprint: normalized ? `...${normalized.slice(-4)}` : null
  };
}

function databaseStatus(id: string, label: string, envName: string, value: string | undefined): DatabaseConfigStatus {
  const parsed = parseDatabaseUrl(value);
  return {
    id,
    label,
    envName,
    configured: Boolean(value?.trim()),
    host: parsed?.host ?? null,
    port: parsed?.port ?? null,
    database: parsed?.database ?? null,
    username: parsed?.username ?? null
  };
}

function parseDatabaseUrl(value: string | undefined): { host: string; port: string | null; database: string; username: string | null } | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return {
      host: url.hostname,
      port: url.port || null,
      database: url.pathname.replace(/^\//, ""),
      username: url.username || null
    };
  } catch {
    return null;
  }
}

function summarizeStatus(input: Pick<AdminIntegrationSettings, "providers" | "parsers" | "modules" | "databases">): AdminIntegrationSettings["overallStatus"] {
  const missingProviderSecret = input.providers.some((provider) => provider.secrets.some((secret) => !secret.configured));
  const missingParserSecret = input.parsers.some((parser) => parser.secrets.some((secret) => !secret.configured));
  const missingDatabase = input.databases.some((database) => !database.configured);
  if (missingProviderSecret || missingParserSecret || missingDatabase) return "blocked";
  if (input.modules.some((module) => module.status !== "ok")) return "degraded";
  return "ready";
}

function moduleRole(id: ModuleId): string {
  if (id === "nano-brain") return "个人 Wiki、知识导航、事实沉淀";
  if (id === "traditional-rag") return "PDF、表格、制度和证据型问答";
  return "客户画像、关系风险、多跳图谱检索";
}

function emptyToNull(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function numberOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
