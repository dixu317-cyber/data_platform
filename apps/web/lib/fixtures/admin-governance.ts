type FixtureEngine = "Gbrain" | "Naive RAG" | "GraphRAG";

export const adminNav = [
  { label: "总览", href: "/admin" },
  { label: "模板治理", href: "/admin/templates" },
  { label: "知识库资产", href: "/admin/knowledge-bases" },
  { label: "检索策略", href: "/admin/strategies" },
  { label: "处理管线", href: "/admin/pipelines" },
  { label: "运行监控", href: "/admin/monitoring" },
  { label: "质量评估", href: "/admin/evaluations" },
  { label: "系统接入", href: "/admin/settings" },
  { label: "审计记录", href: "/admin/audit" }
];

export const adminTemplates = [
  { id: "customer-360", name: "客户 360 简报", owner: "销售运营", state: "已发布", defaultStrategy: "严格证据答复", reviewPolicy: "必须复核", inputs: ["表格资料", "客户系统导出", "会议纪要"], evidenceCoverage: 100, evidenceSources: ["官方模板研究", "知识库产品文档"], demoReadiness: 100, demoScenarioName: "赋范科技续约简报", sampleQuestion: "这个客户当前续约风险和机会是什么？", productForms: ["报告生成", "关系图谱"], limitations: ["依赖客户系统和会议记录新鲜度"], impact: "用于续约、扩容和客户风险判断" },
  { id: "support-agent", name: "智能客服知识代理", owner: "客户成功", state: "已发布", defaultStrategy: "证据优先", reviewPolicy: "抽样复核", inputs: ["常见问题", "帮助中心", "工单导出"], evidenceCoverage: 100, evidenceSources: ["客服机器人案例", "知识库产品文档"], demoReadiness: 100, demoScenarioName: "订单与发票客服代理", sampleQuestion: "客户说订单延迟三天，应该怎么回复？", productForms: ["嵌入式助手", "客服问答"], limitations: ["上线前必须验证拒答和转人工"], impact: "用于嵌入式客服答复" },
  { id: "personal-wiki", name: "个人知识库", owner: "知识运营", state: "已发布", defaultStrategy: "知识页导航", reviewPolicy: "无需复核", inputs: ["笔记文档", "文档资料", "网页摘录"], evidenceCoverage: 86, evidenceSources: ["知识库模板研究", "知识库产品形态"], demoReadiness: 88, demoScenarioName: "张磊销售笔记知识库", sampleQuestion: "这批笔记里最常见的客户异议是什么？", productForms: ["知识门户", "问答"], limitations: ["不适合直接生成正式对外文件"], impact: "用于个人和小团队知识沉淀" },
  { id: "risk-investigation", name: "关系风险尽调", owner: "风控", state: "审核中", defaultStrategy: "关系风险扩展", reviewPolicy: "必须复核", inputs: ["合同", "供应商清单", "事件记录"], evidenceCoverage: 72, evidenceSources: ["图谱检索研究", "尽调流程"], demoReadiness: 76, demoScenarioName: "云启网络关系风险尽调", sampleQuestion: "这家供应商有哪些关联风险？", productForms: ["关系图谱", "尽调报告"], limitations: ["低置信关系不能直接作为结论"], impact: "用于高风险关系识别" },
  { id: "policy-evidence", name: "制度政策证据问答", owner: "人力行政", state: "已发布", defaultStrategy: "制度答复", reviewPolicy: "抽样复核", inputs: ["制度文档", "公告", "员工手册"], evidenceCoverage: 92, evidenceSources: ["企业知识库实践", "制度问答案例"], demoReadiness: 90, demoScenarioName: "差旅报销制度问答", sampleQuestion: "一线城市住宿报销标准是多少？", productForms: ["知识门户", "员工问答"], limitations: ["需要明确制度版本和解释口径"], impact: "用于员工制度问答" }
];

export const strategyProfiles = [
  { id: "traditional-evidence-first", name: "Evidence-first Retrieval", scope: "Naive RAG", impact: "正式文档优先、引用更完整、延迟中等；前台映射为文档证据。", controls: ["引用严格", "正式文档优先", "结果 8 条"] },
  { id: "graph-risk-expansion", name: "Graph Risk Expansion", scope: "GraphRAG", impact: "适合多跳关系、风险事件和客户画像；前台映射为关系图谱。", controls: ["多跳路径", "低置信标记", "证据必需"] },
  { id: "nano-wiki-navigation", name: "Compiled Knowledge Navigation", scope: "Gbrain", impact: "适合知识手册、学习指南和个人知识库；前台映射为知识百科。", controls: ["页面深度 2", "互链导航", "事实优先"] },
  { id: "company-strict-evidence", name: "严格证据答复", scope: "公司大脑", impact: "适合对外发送和高风险问题", controls: ["高置信门槛", "无依据拒答", "引用优先"] }
];

export const adminOperationSummary = [
  { area: "pipelines", label: "待处理请求", status: "watch", count: 4 },
  { area: "templates", label: "模板治理", status: "healthy", count: 10 },
  { area: "knowledge-bases", label: "知识库资产", status: "healthy", count: 38 },
  { area: "strategies", label: "检索策略", status: "healthy", count: 12 },
  { area: "graph", label: "关系图谱", status: "watch", count: 1 },
  { area: "evaluations", label: "质量评估", status: "healthy", count: 24 },
  { area: "settings", label: "系统接入", status: "watch", count: 5 },
  { area: "audit", label: "审计记录", status: "healthy", count: 96 }
];

export type AdminIntegrationSettings = {
  checked_at: string;
  overall_status: "ready" | "degraded" | "blocked";
  providers: Array<{
    id: string;
    label: string;
    provider: string;
    base_url: string | null;
    model: string | null;
    dimensions?: number | null;
    secrets: Array<{ env_name: string; configured: boolean; fingerprint: string | null }>;
    controls: string[];
  }>;
  parsers: Array<{
    id: string;
    label: string;
    base_url: string | null;
    model_version: string | null;
    language: string | null;
    options: string[];
    secrets: Array<{ env_name: string; configured: boolean; fingerprint: string | null }>;
  }>;
  modules: Array<{
    id: string;
    label: string;
    base_url: string;
    status: "ok" | "error" | "unknown";
    service: string;
    required_env: string[];
    role: string;
  }>;
  databases: Array<{
    id: string;
    label: string;
    env_name: string;
    configured: boolean;
    host: string | null;
    port: string | null;
    database: string | null;
    username: string | null;
  }>;
  runtime_policies: Array<{
    label: string;
    value: string;
    impact: string;
    key?: "rerankTopN" | "rerankMinScore" | "perSourceTimeoutMs" | "sourceFanout" | "candidatePoolSize";
    source?: "db" | "env" | "default";
    numeric?: { value: number; min: number; max: number; step: number; unit?: string };
  }>;
  engine_retrieval: Array<{
    engine: string;
    label: string;
    topK: number | null;
    source: "db" | "default";
    min: number;
    max: number;
    default_hint: string;
    minScore: number | null;
    minScoreSource: "db" | "default";
    minScoreMin: number;
    minScoreMax: number;
    supportsMinScore: boolean;
    mode: string | null;
    modeSource: "db" | "default";
    modeOptions: string[];
    chunkTopK: number | null;
    chunkTopKSource: "db" | "default";
    chunkTopKMin: number;
    chunkTopKMax: number;
    maxTotalTokens: number | null;
    maxTotalTokensSource: "db" | "default";
    maxTotalTokensMin: number;
    maxTotalTokensMax: number;
    enableRerank: boolean | null;
    enableRerankSource: "db" | "default";
    supportsGraphRetrieval: boolean;
    linkDepth: number | null;
    linkDepthSource: "db" | "default";
    linkDepthMin: number;
    linkDepthMax: number;
    supportsLinkDepth: boolean;
  }>;
};

export const adminIntegrationSettings: AdminIntegrationSettings = {
  checked_at: "待连接统一 API",
  overall_status: "degraded",
  providers: [
    {
      id: "agent",
      label: "回答模型",
      provider: "openai-compatible",
      base_url: "https://openrouter.ai/api/v1",
      model: "deepseek/deepseek-v4-flash",
      secrets: [{ env_name: "AGENT_API_KEY", configured: true, fingerprint: "...****" }],
      controls: ["温度 0", "不记录流式用量"]
    },
    {
      id: "embedding",
      label: "向量模型",
      provider: "openai-compatible",
      base_url: "https://openrouter.ai/api/v1",
      model: "qwen/qwen3-embedding-8b",
      dimensions: 4096,
      secrets: [{ env_name: "EMBEDDING_API_KEY", configured: true, fingerprint: "...****" }],
      controls: ["用于文档切片、图谱检索和公司大脑召回"]
    }
  ],
  parsers: [
    {
      id: "mineru",
      label: "PDF 解析服务",
      base_url: "https://mineru.net",
      model_version: "vlm",
      language: "ch",
      options: ["抽取表格", "抽取公式", "按文档文本优先"],
      secrets: [{ env_name: "MINERU_API_KEY", configured: true, fingerprint: "...****" }]
    }
  ],
  modules: [
    { id: "nano-brain", label: "Gbrain 服务", base_url: "http://127.0.0.1:8100", status: "unknown", service: "nano-brain", required_env: ["RAG_INTERNAL_TOKEN", "NANO_BRAIN_HTTP_URL"], role: "编译式知识组织、知识页导航、事实沉淀" },
    { id: "traditional-rag", label: "Naive RAG 服务", base_url: "http://127.0.0.1:8101", status: "unknown", service: "traditional-rag", required_env: ["RAG_INTERNAL_TOKEN", "TRADITIONAL_RAG_HTTP_URL"], role: "文档切片、向量检索、证据型问答" },
    { id: "graph-rag", label: "GraphRAG 服务", base_url: "http://127.0.0.1:8102", status: "unknown", service: "graph-rag", required_env: ["RAG_INTERNAL_TOKEN", "GRAPH_RAG_HTTP_URL"], role: "实体关系、风险链路、多跳图谱检索" }
  ],
  databases: [
    { id: "identity", label: "账号与权限库", env_name: "IDENTITY_DATABASE_URL", configured: true, host: "localhost", port: "5432", database: "ff_identity", username: "muyu" },
    { id: "traditional-rag", label: "Naive RAG 文档库", env_name: "TRADITIONAL_RAG_DATABASE_URL", configured: true, host: "localhost", port: "5432", database: "ff_traditional_rag", username: "muyu" },
    { id: "graph-rag", label: "GraphRAG 图谱库", env_name: "GRAPH_RAG_DATABASE_URL", configured: true, host: "localhost", port: "5432", database: "ff_graph_rag", username: "muyu" }
  ],
  runtime_policies: [
    { label: "内部调用令牌", value: "已配置", impact: "统一接口调用知识处理模块时必须携带" },
    { label: "文档存储目录", value: ".traditional-rag-storage", impact: "保存上传文件、MinerU 结果和抽取图片" }
  ],
  engine_retrieval: [
    { engine: "Gbrain", label: "Gbrain", topK: null, source: "default", min: 1, max: 30, default_hint: "未设置时各检索路径用各自默认：全域召回 4 / 召回验证 3 / 场景问答 5", minScore: null, minScoreSource: "default", minScoreMin: 0, minScoreMax: 1, supportsMinScore: false, mode: null, modeSource: "default", modeOptions: ["auto", "local", "global", "hybrid", "naive", "mix"], chunkTopK: null, chunkTopKSource: "default", chunkTopKMin: 1, chunkTopKMax: 200, maxTotalTokens: null, maxTotalTokensSource: "default", maxTotalTokensMin: 1, maxTotalTokensMax: 100000, enableRerank: null, enableRerankSource: "default", supportsGraphRetrieval: false, linkDepth: null, linkDepthSource: "default", linkDepthMin: 1, linkDepthMax: 2, supportsLinkDepth: true },
    { engine: "Naive RAG", label: "Naive RAG", topK: null, source: "default", min: 1, max: 30, default_hint: "未设置时各检索路径用各自默认：全域召回 4 / 召回验证 3 / 场景问答 5", minScore: null, minScoreSource: "default", minScoreMin: 0, minScoreMax: 1, supportsMinScore: true, mode: null, modeSource: "default", modeOptions: ["auto", "local", "global", "hybrid", "naive", "mix"], chunkTopK: null, chunkTopKSource: "default", chunkTopKMin: 1, chunkTopKMax: 200, maxTotalTokens: null, maxTotalTokensSource: "default", maxTotalTokensMin: 1, maxTotalTokensMax: 100000, enableRerank: null, enableRerankSource: "default", supportsGraphRetrieval: false, linkDepth: null, linkDepthSource: "default", linkDepthMin: 1, linkDepthMax: 2, supportsLinkDepth: false },
    { engine: "GraphRAG", label: "GraphRAG", topK: null, source: "default", min: 1, max: 30, default_hint: "未设置时各检索路径用各自默认：全域召回 4 / 召回验证 3 / 场景问答 5", minScore: null, minScoreSource: "default", minScoreMin: 0, minScoreMax: 1, supportsMinScore: false, mode: null, modeSource: "default", modeOptions: ["auto", "local", "global", "hybrid", "naive", "mix"], chunkTopK: null, chunkTopKSource: "default", chunkTopKMin: 1, chunkTopKMax: 200, maxTotalTokens: null, maxTotalTokensSource: "default", maxTotalTokensMin: 1, maxTotalTokensMax: 100000, enableRerank: null, enableRerankSource: "default", supportsGraphRetrieval: true, linkDepth: null, linkDepthSource: "default", linkDepthMin: 1, linkDepthMax: 2, supportsLinkDepth: false }
  ]
};

export const adminGraphSnapshot = {
  nodes: [
    { id: "ff", label: "赋范科技", type: "客户", health: "watch" },
    { id: "zl", label: "张磊", type: "负责人", health: "good" },
    { id: "wh", label: "王皓 技术负责人", type: "关键人", health: "good" },
    { id: "contract", label: "年度框架合同", type: "合同", health: "watch" },
    { id: "expansion", label: "二期扩容", type: "机会", health: "good" },
    { id: "risk", label: "互动停滞", type: "风险", health: "risk" }
  ],
  edges: [
    { source: "ff", target: "zl", label: "负责人", confidence: 0.86, evidence: "客户关系表" },
    { source: "ff", target: "wh", label: "关键决策人", confidence: 0.91, evidence: "会议纪要" },
    { source: "ff", target: "contract", label: "续签中", confidence: 0.88, evidence: "合同记录" },
    { source: "contract", target: "expansion", label: "绑定增购", confidence: 0.81, evidence: "销售机会表" },
    { source: "ff", target: "risk", label: "存在风险", confidence: 0.76, evidence: "互动时间线" },
    { source: "wh", target: "expansion", label: "推动", confidence: 0.72, evidence: "公开信号" }
  ]
};

export const adminAuditEvents = [
  { id: "audit-1", actor: "admin@muyu.ai", area: "模板治理", summary: "发布客户 360 简报模板", impact: "前台可创建客户分析场景", time: "2026-06-25 10:30" },
  { id: "audit-2", actor: "ops@muyu.ai", area: "检索策略", summary: "启用严格证据答复", impact: "高风险问题必须保留引用", time: "2026-06-25 10:10" },
  { id: "audit-3", actor: "qa@muyu.ai", area: "质量验证", summary: "完成客服策略对比验证", impact: "客服模板继续使用证据优先策略", time: "2026-06-25 09:45" },
  { id: "audit-4", actor: "risk@muyu.ai", area: "关系图谱", summary: "调整风险关系阈值", impact: "低置信关系进入人工复核", time: "2026-06-25 09:30" },
  { id: "audit-5", actor: "system@muyu.ai", area: "处理管线", summary: "重试安全问卷处理任务", impact: "问卷答案包重新生成", time: "2026-06-25 09:10" }
];

export const knowledgeBaseInventory = [
  { name: "木羽个人知识库", module: "Gbrain", status: "正常", volume: "184 页面", owner: "木羽", visibility: "个人", access: "仅本人和管理员可见", policy: "前台映射为知识百科，不会进入团队或公司级召回" },
  { name: "销售团队知识手册", module: "Gbrain", status: "正常", volume: "1,340 页面", owner: "销售运营", visibility: "团队", access: "销售团队成员可见", policy: "跨团队召回需要管理员授权" },
  { name: "客户关系库", module: "GraphRAG", status: "正常", volume: "12,480 对象", owner: "销售运营", visibility: "团队", access: "销售与客户成功可见", policy: "关系边带来源和置信度" },
  { name: "合同与条款库", module: "Naive RAG", status: "观察", volume: "2,160 文档", owner: "法务", visibility: "公司", access: "公司级场景可召回", policy: "必须保留原文引用" },
  { name: "关系风险库", module: "GraphRAG", status: "需更新", volume: "8,920 关系", owner: "风控", visibility: "团队", access: "风控团队可见", policy: "低置信关系必须复核" }
];

export const adminDashboardHealthCards = [
  {
    id: "postgres",
    label: "关系数据库",
    status: "正常",
    value: `${adminIntegrationSettings.databases.filter((item) => item.configured).length}/${adminIntegrationSettings.databases.length}`,
    detail: "账号权限、Naive RAG 和 GraphRAG 存储已连接",
    route: "/admin/settings"
  },
  {
    id: "model",
    label: "回答模型",
    status: "正常",
    value: adminIntegrationSettings.providers.find((item) => item.id === "agent") ? "主力模型" : "待配置",
    detail: "答案生成、任务解释和管理员复核建议共用",
    route: "/admin/settings"
  },
  {
    id: "embedding",
    label: "向量模型",
    status: "正常",
    value: `${adminIntegrationSettings.providers.find((item) => item.id === "embedding")?.dimensions ?? 0} 维`,
    detail: "用于文档切片、图谱召回和公司大脑检索",
    route: "/admin/settings"
  },
  {
    id: "parser",
    label: "文档解析",
    status: "观察",
    value: adminIntegrationSettings.parsers[0] ? "版式识别" : "待配置",
    detail: "PDF、表格和公式抽取需要任务级复核",
    route: "/admin/settings"
  },
  {
    id: "rag-services",
    label: "知识处理链路",
    status: "观察",
    value: "2/3",
    detail: "Gbrain、Naive RAG 可运行；GraphRAG 需复核",
    route: "/admin/pipelines"
  }
];

export const adminDashboardDataOverview = [
  { scope: "个人", total: 184, unit: "页面", module: "Gbrain", owner: "木羽", health: "正常", policy: "前台映射为知识百科，不会进入团队或公司级召回" },
  { scope: "团队", total: 14720, unit: "对象", module: "Gbrain / GraphRAG", owner: "销售运营、风控", health: "观察", policy: "跨团队召回需要管理员授权" },
  { scope: "公司", total: 2160, unit: "文档", module: "Naive RAG", owner: "法务", health: "正常", policy: "必须保留原文引用和发布复核记录" }
];

export const adminDashboardRiskItems = [
  { label: "公司级资料发布门禁", severity: "高", count: 1, detail: "合同与条款库可进入公司级召回，必须保留原文引用。" },
  { label: "关系图谱低置信边", severity: "中", count: 1, detail: "关系风险库需要复核低置信关系，避免错误扩散到客户画像。" },
  { label: "待管理员确认资料包", severity: "中", count: 3, detail: "前台提交后需要确认权限范围、资料质量和 RAG 引擎策略。" },
  { label: "系统接入观察项", severity: "低", count: 2, detail: "MinerU 与关系图谱服务处于观察或需复核状态。" }
];

export const pipelineTimeline = [
  { stage: "接收资料", status: "done", message: "上传资料已登记为资产记录" },
  { stage: "抽取内容", status: "done", message: "文档、表格和关系对象已解析" },
  { stage: "建立来源", status: "running", message: "正在生成可引用来源和关系对象" },
  { stage: "生成知识对象", status: "queued", message: "等待前置阶段完成" }
];

export const adminPipelineWorkflowSteps = [
  { id: "verify", label: "资料核验", description: "确认文件、用途和完整性", state: "done" },
  { id: "strategy", label: "引擎策略", description: "选择真实 RAG 入库与检索引擎", state: "active" },
  { id: "publish", label: "权限与发布", description: "确认个人、团队、公司边界", state: "pending" },
  { id: "confirm", label: "入库确认", description: "执行入库并同步前台状态", state: "pending" }
];

export const adminActionableRequestStatuses = ["待管理员确认", "等待复核", "处理中"] as const;

export function isActionableAdminRequestStatus(status: string) {
  return adminActionableRequestStatuses.includes(status as (typeof adminActionableRequestStatuses)[number]);
}

export function resolveAdminFilePreview(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf") return { kind: "PDF", label: "PDF 文档", previewable: true, extension };
  if (["doc", "docx"].includes(extension)) return { kind: "DOC", label: "Word 文档", previewable: true, extension };
  if (["md", "markdown"].includes(extension)) return { kind: "MD", label: "Markdown", previewable: true, extension };
  if (["xls", "xlsx", "csv"].includes(extension)) return { kind: extension === "csv" ? "CSV" : "XLS", label: "表格数据", previewable: true, extension };
  if (extension === "json") return { kind: "JSON", label: "结构化数据", previewable: true, extension };
  if (["txt", "text"].includes(extension)) return { kind: "TXT", label: "文本资料", previewable: true, extension };
  if (["zip", "rar", "7z"].includes(extension)) return { kind: "ZIP", label: "压缩资料包", previewable: false, extension };
  return { kind: "FILE", label: "资料文件", previewable: false, extension };
}

export const adminIntakeRequests = [
  {
    id: "request-custom-001",
    scenarioName: "自建业务场景",
    requester: "木羽",
    visibility: "个人",
    submittedAt: "刚刚",
    status: "待管理员确认",
    files: ["业务说明.md", "资料包.zip"],
    requestedOutcome: "让后台确认资料结构，并选择适合的 RAG 入库与检索引擎。",
    recommendedModes: ["知识百科", "文档证据", "关系图谱"],
    recommendedEngines: ["Gbrain", "Naive RAG", "GraphRAG"] as FixtureEngine[],
    selectedMode: "待选择",
    selectedEngine: "待选择" as "待选择" | FixtureEngine,
    frontstageMapping: "发布到前台后映射为：知识百科 / 文档证据 / 关系图谱。",
    permissionImpact: "如果按个人范围入库，团队和公司级问答不会召回这批资料。",
    actions: ["查看资料", "配置引擎策略", "确认入库", "退回补充"]
  },
  {
    id: "request-contract-042",
    scenarioName: "软件订阅合同审阅",
    requester: "陈予",
    visibility: "公司",
    submittedAt: "今天 10:30",
    status: "等待复核",
    files: ["赋范科技订阅合同.pdf", "法务条款审阅清单.md"],
    requestedOutcome: "生成风险条款、缺失条款和替换建议。",
    recommendedModes: ["文档证据"],
    recommendedEngines: ["Naive RAG"] as FixtureEngine[],
    selectedMode: "文档证据",
    selectedEngine: "Naive RAG" as "待选择" | FixtureEngine,
    frontstageMapping: "发布到前台后映射为：文档证据。",
    permissionImpact: "公司级合同库可召回，但答案必须保留原文引用。",
    actions: ["打开证据切片", "复核引用", "发布场景"]
  },
  {
    id: "request-risk-017",
    scenarioName: "云启网络关系风险尽调",
    requester: "周琪",
    visibility: "团队",
    submittedAt: "今天 09:20",
    status: "处理中",
    files: ["云启供应商清单.csv", "历史风险事件.txt", "云启关系资料.json"],
    requestedOutcome: "抽取公司、人员、项目和风险事件关系，生成尽调报告。",
    recommendedModes: ["关系图谱", "文档证据"],
    recommendedEngines: ["GraphRAG", "Naive RAG"] as FixtureEngine[],
    selectedMode: "关系图谱",
    selectedEngine: "GraphRAG" as "待选择" | FixtureEngine,
    frontstageMapping: "发布到前台后映射为：关系图谱 / 文档证据。",
    permissionImpact: "风控团队可见，跨团队访问需要管理员授权。",
    actions: ["查看图谱抽取", "调整实体类型", "运行关系构建"]
  }
];

export const ragOperationModes = [
  {
    id: "nano-brain",
    label: "Gbrain",
    frontstageLabel: "知识百科",
    service: "编译式知识组织引擎",
    status: "可运行",
    purpose: "将个人、团队资料编译成结构化知识页、目录、事实卡片和可追问知识空间。",
    bestFor: ["个人知识库", "团队知识手册", "研究学习指南"],
    controls: ["页面粒度", "互链深度"],
    storage: "知识页 / 互链",
    reviewGate: "前台映射为知识百科；个人默认自动发布，团队手册需要负责人复核",
    stages: ["解析笔记和文档", "生成知识页", "建立互链"],
    inspector: ["适合知识沉淀、手册和个人知识库", "发布后前台以知识页和问答形态使用", "团队范围需要确认负责人和可见成员"],
    runtimeFlow: [
      { stage: "资料解析", description: "读取 Markdown、笔记和文档正文，保留标题层级和引用来源。", artifact: "解析文本" },
      { stage: "知识页生成", description: "按页面粒度生成可浏览知识页，合并重复段落。", artifact: "知识页草稿" },
      { stage: "互链构建", description: "建立主题、人物、项目和术语之间的互链。", artifact: "双向链接" }
    ],
    parameters: [
      { key: "page_granularity", label: "页面粒度", type: "select", value: "文档级", options: ["主题级", "文档级"], description: "决定一页知识内容的大小，越细越利于追问，越粗越利于阅读。" },
      { key: "link_depth", label: "互链深度", type: "number", value: "2", min: 1, max: 2, unit: "层", description: "问答时沿互链扩展的邻域跳数（影响全局问答，非某次上传）。" }
    ],
    qualityGates: [
      { label: "来源覆盖", value: "每个知识页至少保留一个可定位来源", status: "必须通过" },
      { label: "权限边界", value: "个人知识页不进入团队或公司召回", status: "必须通过" }
    ],
    previewOutputs: [
      { label: "知识页预览", description: "查看生成后的标题、摘要、正文和引用。" },
      { label: "事实卡片", description: "检查可被问答召回的关键事实。" },
      { label: "互链网络", description: "预览知识页之间的主题关联。" }
    ],
    assetViews: [
      { kind: "wiki", label: "知识页", metric: "18 页", description: "按主题生成可浏览 Wiki，保留标题、摘要、正文和来源。", action: "查看知识页" },
      { kind: "fact", label: "事实卡片", metric: "64 条", description: "沉淀可被问答召回的定义、结论、人物和项目事实。", action: "查看事实" },
      { kind: "link", label: "互链关系", metric: "42 条", description: "展示知识页之间的双向链接和引用路径。", action: "查看互链" },
      { kind: "source", label: "来源索引", metric: "6 个来源", description: "每个知识页都能追溯到原始资料段落。", action: "查看来源" }
    ]
  },
  {
    id: "traditional-rag",
    label: "Naive RAG",
    frontstageLabel: "文档证据",
    service: "文档切片与向量检索引擎",
    status: "可运行",
    purpose: "处理 PDF、Word、表格和制度文档，生成带引用的问答和审阅结果。",
    bestFor: ["制度问答", "合同审阅", "投标问卷响应"],
    controls: ["切片大小", "重叠窗口", "TopK", "引用阈值", "无依据拒答"],
    storage: "文档 / 切片 / 向量 / 引用",
    reviewGate: "前台映射为文档证据；公司级资料必须复核引用和拒答边界",
    stages: ["文档解析", "切片清洗", "向量化", "引用索引", "答案边界验证"],
    inspector: ["适合制度、合同、问卷和可引用答复", "必须保留原文来源和拒答边界", "公司级发布需要完成引用抽检"],
    runtimeFlow: [
      { stage: "文档解析", description: "解析 PDF、Word、表格正文和页码，形成可定位来源。", artifact: "解析正文" },
      { stage: "切片清洗", description: "按 chunk size 和 overlap 切分段落，去除页眉页脚和重复片段。", artifact: "文档切片" },
      { stage: "向量化", description: "调用 embedding 模型生成语义索引，保留文件、页码和段落位置信息。", artifact: "向量索引" },
      { stage: "引用索引", description: "建立答案可引用的来源片段，支持前台高亮原文。", artifact: "引用证据" },
      { stage: "边界验证", description: "用业务问题验证 TopK、阈值和无依据拒答策略。", artifact: "试问报告" }
    ],
    parameters: [
      { key: "chunk_size", label: "Chunk Size", type: "number", value: "800", min: 300, max: 1600, unit: "tokens", description: "单个切片大小，影响召回粒度和引用准确性。" },
      { key: "chunk_overlap", label: "Overlap", type: "number", value: "120", min: 0, max: 300, unit: "tokens", description: "相邻切片重叠长度，减少跨段答案丢失。" },
      { key: "top_k", label: "TopK", type: "number", value: "8", min: 3, max: 20, unit: "条", description: "每次检索召回的候选证据数量。" },
      { key: "citation_threshold", label: "引用阈值", type: "number", value: "0.78", min: 0.4, max: 0.95, unit: "", description: "低于阈值的片段不进入答案引用。" },
      { key: "no_answer_policy", label: "拒答策略", type: "select", value: "严格拒答", options: ["宽松回答", "提示不确定", "严格拒答"], description: "没有足够证据时前台如何响应。" },
      { key: "rerank", label: "Rerank", type: "boolean", value: "true", description: "启用重排，提高证据顺序稳定性。" }
    ],
    qualityGates: [
      { label: "引用抽检", value: "答案引用必须能打开原文位置", status: "必须通过" },
      { label: "拒答边界", value: "无证据问题不得生成确定结论", status: "必须通过" },
      { label: "切片覆盖", value: "核心章节必须全部进入索引", status: "建议复核" }
    ],
    previewOutputs: [
      { label: "切片段落", description: "查看切分后的段落、页码和来源。" },
      { label: "引用预览", description: "预览答案如何命中并高亮证据。" },
      { label: "试问报告", description: "比较 TopK、阈值和拒答策略效果。" }
    ],
    assetViews: [
      { kind: "chunk", label: "文档切片", metric: "126 段", description: "查看每个切片的正文、页码、文件来源和 overlap 边界。", action: "查看切片" },
      { kind: "embedding", label: "向量索引", metric: "126 条", description: "查看索引批次、模型维度和向量化状态。", action: "查看索引" },
      { kind: "citation", label: "引用证据", metric: "38 条", description: "预览答案可引用的高亮片段和原文定位。", action: "查看引用" },
      { kind: "eval", label: "试问命中", metric: "8 个问题", description: "检查 TopK、阈值和拒答策略在业务问题中的效果。", action: "查看试问" }
    ]
  },
  {
    id: "graph-rag",
    label: "GraphRAG",
    frontstageLabel: "关系图谱",
    service: "实体关系与多跳检索引擎",
    status: "需复核",
    purpose: "抽取实体、事件和关系，支持多跳推理、客户画像和风险尽调。",
    bestFor: ["客户 360", "关系风险尽调", "垂域关系知识库"],
    controls: ["实体类型", "关系类型", "低置信标记"],
    storage: "实体 / 关系 / 图索引",
    reviewGate: "前台映射为关系图谱；低置信关系必须人工确认后才能发布",
    stages: ["实体抽取", "关系抽取", "消歧合并", "图谱检索验证"],
    inspector: ["适合客户画像、关系风险和多跳分析", "低置信实体和关系进入人工复核", "跨团队发布需要确认关系来源和权限边界"],
    runtimeFlow: [
      { stage: "实体抽取", description: "识别公司、人员、项目、合同、事件和风险信号。", artifact: "实体候选" },
      { stage: "关系抽取", description: "抽取负责、参与、影响、风险、机会等关系，并绑定来源证据。", artifact: "关系候选" },
      { stage: "消歧合并", description: "合并同名对象，标记低置信实体和冲突关系。", artifact: "复核清单" },
      { stage: "图谱检索验证", description: "用多跳问题验证关系路径、证据链和权限边界。", artifact: "关系试问" }
    ],
    parameters: [
      { key: "entity_schema", label: "实体范围", type: "select", value: "客户/人员/项目/事件", options: ["通用实体", "客户/人员/项目/事件", "合同/条款/风险", "自定义 Schema"], description: "定义本次图谱需要识别的对象类型。" }
    ],
    qualityGates: [
      { label: "低置信复核", value: "低于阈值的实体和关系必须人工确认", status: "必须通过" },
      { label: "证据绑定", value: "每条关系至少关联一个来源片段", status: "必须通过" },
      { label: "权限传播", value: "关系边不得跨越提交范围泄露资料", status: "必须通过" }
    ],
    previewOutputs: [
      { label: "对象与关联", description: "查看识别到的实体、关系和证据。" },
      { label: "关系路径", description: "预览客户、项目和风险之间的多跳路径。" }
    ],
    assetViews: [
      { kind: "entity", label: "实体表", metric: "76 个对象", description: "查看客户、人员、项目、合同、事件和风险信号。", action: "查看实体" },
      { kind: "relationship", label: "关系边", metric: "132 条", description: "查看每条关系的类型、置信度和来源证据。", action: "查看关系" },
      { kind: "graph", label: "知识图谱", metric: "关系网络", description: "在图谱画布中查看多跳路径和低置信节点。", action: "打开图谱" },
      { kind: "review", label: "复核清单", metric: "11 项", description: "集中处理低置信实体、冲突关系和跨权限边界。", action: "查看复核" }
    ]
  }
];

export const evaluationRows = [
  { profile: "证据优先", score: 82, evidence: 6, latency: "1.4s" },
  { profile: "严格证据答复", score: 88, evidence: 9, latency: "1.8s" }
];
