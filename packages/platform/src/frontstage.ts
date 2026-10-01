export type TemplateState = "official" | "candidate" | "experimental" | "custom" | "paused" | "archived";
export type TemplateProductForm = "chat" | "embedded_assistant" | "knowledge_portal" | "document_review" | "report_generator" | "graph_explorer" | "task_workflow" | "hybrid";
export type Visibility = "private" | "team" | "company";
export type ProcessingStatus = "draft" | "submitted" | "waiting_review" | "processing" | "ready" | "failed";
export type TaskKind = "资料接入" | "管理员确认" | "知识入库" | "发布复核";
export type RagEngine = "知识百科" | "文档证据" | "关系图谱" | "混合处理";

export type FrontstageNavItem = {
  label: "全域问答" | "方案模板" | "业务场景" | "处理任务" | "知识资产";
  href: string;
};

export type TemplateDemoWalkthrough = {
  scenarioName: string;
  sampleInputs: Array<{ title: string; fileName: string; fileType: "md" | "pdf" | "csv" | "txt" | "json"; description: string }>;
  processingPreview: string[];
  sampleQuestion: string;
  sampleAnswer: string;
  citations: Array<{ label: string; source: string; excerpt: string }>;
  resultHighlights: string[];
};

export type ScenarioTemplate = {
  id: string;
  name: string;
  category: string;
  templateState: TemplateState;
  evidenceLevel: "validated" | "partial" | "internal_only";
  evidenceSources: string[];
  productForm: TemplateProductForm[];
  limitations: string[];
  headline: string;
  bestFor: string[];
  inputExamples: string[];
  acceptedFiles: string[];
  setupTime: string;
  reviewRequirement: "无需管理员确认" | "需要管理员确认" | "建议管理员确认";
  processingExplanation: string[];
  outputCapabilities: string[];
  demoWalkthrough: TemplateDemoWalkthrough;
  suggestedQuestions: string[];
};

export type ScenarioInstance = {
  id: string;
  templateId: string;
  name: string;
  description: string;
  owner: string;
  visibility: Visibility;
  status: ProcessingStatus;
  sourceCount: number;
  updatedAt: string;
  readyActions: string[];
  recommendedQuestions: string[];
};

export type ProcessingTask = {
  id: string;
  scenarioId: string;
  title: string;
  status: ProcessingStatus;
  kind: TaskKind;
  ragMode: RagEngine;
  visibility: Visibility;
  owner: string;
  submittedAt: string;
  updatedAt: string;
  files: string[];
  waitingFor: "用户补充资料" | "后台管理员" | "处理管线" | "场景负责人";
  progress: number;
  currentStep: string;
  userMessage: string;
  nextActions: string[];
  adminEntry: string;
};

export type KnowledgeSpaceObject = {
  id: string;
  mode: "wiki" | "document" | "relationship" | "artifact";
  title: string;
  summary: string;
  sourceLabel: string;
  linkedScenarioId: string;
  visibility: Visibility;
  owner: string;
  permissionNote: string;
  updatedAt: string;
  actions: string[];
};

export type WorkspaceProfile = {
  organizationName: string;
  workspaceName: string;
  currentUser: string;
  role: string;
  plan: string;
};

export type WorkspaceNavItem = {
  label: "应用总览" | "全域问答" | "方案模板" | "业务场景" | "处理任务" | "知识资产" | "空间设置";
  href: string;
  description: string;
};

export type WorkspaceDashboard = {
  recentScenarioIds: string[];
  pendingTaskIds: string[];
  quickActions: Array<{ label: string; href: string; description: string }>;
  knowledgeHealth: {
    readyObjects: number;
    processingObjects: number;
    reviewRequired: number;
  };
};

export type ScenarioLifecycleStage = {
  key: "template" | "sources" | "processing" | "validation" | "published";
  label: string;
  description: string;
};

export type ScenarioWorkbenchTab = {
  key: "overview" | "data" | "tasks" | "ask" | "outputs" | "settings";
  label: string;
  href: string;
};

export type ScenarioAvailability = {
  label: "资料待接入" | "等待入库" | "后台处理中" | "待复核" | "可使用" | "处理失败";
  description: string;
  nextAction: string;
};

export type ScenarioDataSource = {
  id: string;
  scenarioId: string;
  title: string;
  sourceType: string;
  fileName: string;
  status: "已入库" | "处理中" | "待复核";
  owner: string;
  updatedAt: string;
  evidencePolicy: string;
};

export type ScenarioOutput = {
  id: string;
  scenarioId: string;
  type: string;
  title: string;
  summary: string;
  status: "可使用" | "待复核";
  updatedAt: string;
};

export type ScenarioSettings = {
  scenarioId: string;
  publicationMode: "仅自己可用" | "团队内可用" | "公司内可用";
  retrievalPolicy: string;
  answerPolicy: string;
  reviewPolicy: string;
  connectedSources: string[];
};

export type ScenarioWorkbench = {
  scenario: ScenarioInstance;
  template: ScenarioTemplate;
  tabs: ScenarioWorkbenchTab[];
  lifecycle: ScenarioLifecycleStage[];
  dataSources: ScenarioDataSource[];
  tasks: ProcessingTask[];
  knowledgeObjects: KnowledgeSpaceObject[];
  outputs: ScenarioOutput[];
  settings: ScenarioSettings;
};

export const frontstageNav: FrontstageNavItem[] = [
  { label: "全域问答", href: "/app" },
  { label: "方案模板", href: "/app/templates" },
  { label: "业务场景", href: "/app/my-scenarios" },
  { label: "处理任务", href: "/app/tasks" },
  { label: "知识资产", href: "/app/knowledge" }
];

export const workspaceProfile: WorkspaceProfile = {
  organizationName: "赋范",
  workspaceName: "企业知识应用工作区",
  currentUser: "木羽",
  role: "产品负责人",
  plan: "企业版"
};

export const workspaceNav: WorkspaceNavItem[] = [
  { label: "应用总览", href: "/app", description: "查看可用场景、待处理资料和常用入口。" },
  { label: "全域问答", href: "/app/ask", description: "从统一入口追问已有知识资产和业务场景。" },
  { label: "方案模板", href: "/app/templates", description: "从最佳实践模板创建可落地的知识应用。" },
  { label: "业务场景", href: "/app/scenarios", description: "管理个人、团队和公司级知识应用。" },
  { label: "处理任务", href: "/app/tasks", description: "跟踪资料接入、后台入库、复核和发布进度。" },
  { label: "知识资产", href: "/app/knowledge", description: "浏览沉淀出的知识条目、证据、图谱和业务成品。" }
];

export const scenarioLifecycle: ScenarioLifecycleStage[] = [
  { key: "template", label: "选择模板", description: "确认业务目标、输入资料和输出形态。" },
  { key: "sources", label: "接入资料", description: "上传文件或选择已有数据源，形成可处理资料包。" },
  { key: "processing", label: "处理入库", description: "抽取、切分、索引、关系构建和质量检查。" },
  { key: "validation", label: "验证复核", description: "用业务问题验证答案、引用、拒答和边界。" },
  { key: "published", label: "发布使用", description: "开放给个人、团队或公司，并持续观察效果。" }
];

export const scenarioWorkbenchTabs: ScenarioWorkbenchTab[] = [
  { key: "overview", label: "概览", href: "" },
  { key: "data", label: "数据源", href: "/data" },
  { key: "tasks", label: "处理任务", href: "/tasks" },
  { key: "ask", label: "问答验证", href: "/ask" },
  { key: "outputs", label: "产物", href: "/outputs" },
  { key: "settings", label: "设置", href: "/settings" }
];

export const readyScenarioWorkbenchTabs: ScenarioWorkbenchTab[] = [
  { key: "overview", label: "使用", href: "" },
  { key: "data", label: "资料", href: "/data" },
  { key: "tasks", label: "业务任务", href: "/tasks" },
  { key: "ask", label: "问答", href: "/ask" },
  { key: "outputs", label: "成品", href: "/outputs" },
  { key: "settings", label: "管理", href: "/settings" }
];

export const productDataForbiddenWords = [
  "mock",
  "fake",
  "fixture",
  "synthetic",
  "伪造",
  "虚构",
  "样例答案",
  "样例资料",
  "样例问题",
  "演示数据",
  "演示入口",
  "演示卡片",
  "模拟数据",
  "模拟场景",
  "模拟记录"
];

const evidenceSources = [
  "_research/official-template-best-practice-research.md",
  "https://docs.dify.ai/en/use-dify/knowledge/readme",
  "https://docs.dify.ai/en/use-dify/knowledge/knowledge-pipeline/create-knowledge-pipeline",
  "https://aws.amazon.com/bedrock/knowledge-bases/",
  "https://learn.microsoft.com/en-us/azure/search/retrieval-augmented-generation-overview",
  "https://github.com/Azure-Samples/chat-with-your-data-solution-accelerator",
  "https://ragflow.io/",
  "https://www.glean.com/",
  "https://support.atlassian.com/rovo/docs/agents/",
  "https://www.servicenow.com/community/knowledge-management-articles/best-practices-to-use-your-knowledge-articles-with-now-assist/ta-p/2824219"
];

const processingPreview = ["读取案例资料并识别可用来源", "整理成当前模板需要的知识结构", "生成可追问答案、引用依据和成品预览"];

export const officialTemplates: ScenarioTemplate[] = [
  template("personal-wiki", "个人知识库", "个人", ["knowledge_portal", "chat"], "把个人笔记和资料包整理成可浏览、可追问的个人知识空间。", ["个人笔记沉淀", "学习资料整理", "项目记录复用"], ["笔记文档", "资料文件", "网页摘录"], ["笔记文档", "纯文本", "文档资料"], "无需管理员确认", "张磊销售笔记知识库", ["华东客户复盘.md", "续约销售打法.pdf"], "这批笔记里最常见的客户异议是什么？", "最常见的异议集中在预算周期、系统集成成本和上线周期。建议先用已完成案例说明实施节奏，再拆分续约保留、二期扩容和服务包。"),
  template("team-handbook", "团队知识手册", "团队", ["knowledge_portal", "task_workflow"], "把团队资料、会议纪要和项目复盘整理成可分享的团队手册。", ["新人上手", "项目复盘", "销售流程"], ["会议纪要", "项目复盘", "常见问题文档"], ["笔记文档", "文档资料", "办公文档"], "建议管理员确认", "销售新人上手手册", ["销售新人第一周.md", "客户会议准备清单.pdf"], "新人第一周应该先看哪些材料？", "第一天先阅读产品定位和典型客户画像，第二天完成客户会议准备清单，第三到五天跟读复盘案例并提交客户会议计划。"),
  template("policy-evidence", "制度政策证据问答", "制度", ["chat", "knowledge_portal"], "让员工获得带原文依据的制度、流程和报销答复。", ["人事制度查询", "财务报销答疑", "行政流程问答"], ["制度文档", "流程文档", "公告"], ["制度文档", "办公文档", "表格资料"], "建议管理员确认", "差旅报销制度问答", ["2026差旅报销制度.pdf", "费用审批流程.csv"], "一线城市住宿报销标准是多少，需要什么审批？", "一线城市普通员工住宿标准为每晚 650 元以内；超过标准需要直属负责人和财务复核。"),
  template("contract-playbook", "合同条款审阅", "法务", ["document_review", "task_workflow"], "上传合同并按公司审阅规则生成风险条款、缺失条款和替换建议。", ["销售合同审阅", "采购协议审阅", "框架协议复核"], ["合同文本", "条款库", "风险清单"], ["合同文档", "办公文档", "纯文本"], "需要管理员确认", "软件订阅合同审阅", ["赋范科技订阅合同.pdf", "法务条款审阅清单.md"], "这份合同有哪些高风险条款，应该怎么改？", "主要风险是自动续约通知期过短、违约赔偿上限缺失、客户数据使用边界不清。建议补充续约提醒、赔偿上限和数据使用边界。"),
  template("rfp-security", "投标与安全问卷响应", "售前", ["document_review", "report_generator"], "导入客户问卷，生成可信答案草稿、待确认项和引用依据。", ["售前投标", "安全问卷", "合规问卷"], ["客户问卷", "历史答案库", "安全白皮书"], ["表格资料", "办公表格", "文档资料"], "需要管理员确认", "华东银行安全问卷响应", ["华东银行安全问卷.csv", "平台安全白皮书.pdf"], "把客户安全问卷生成标准答案草稿，并标出待确认项。", "已生成可复核的答案草稿。身份认证、权限控制和日志留存可引用安全白皮书；数据驻留和专属部署条款需要安全负责人确认。"),
  template("customer-360", "客户 360 简报", "销售", ["report_generator", "graph_explorer", "hybrid"], "输入客户名，生成会前客户简报、风险信号、机会信号和下一步建议。", ["销售会前准备", "客户成功续约", "客户画像", "扩容判断"], ["客户档案", "会议记录", "合同", "项目记录"], ["表格资料", "关系数据", "文档资料", "笔记文档"], "建议管理员确认", "赋范科技续约简报", ["赋范科技客户档案.csv", "赋范科技关系图.json", "续约会议纪要.md"], "赋范科技这个客户当前续约风险和机会是什么？", "续约风险来自采购审批延迟和技术负责人对集成成本的担忧；机会来自二期扩容需求已被业务负责人确认。建议本周由客户成功同步上线成效，销售负责人约技术负责人确认集成排期。"),
  template("risk-investigation", "关系风险尽调", "风控", ["graph_explorer", "report_generator"], "围绕公司、供应商或项目追踪关系链、风险事件和证据链。", ["投资尽调", "供应商风险", "客户风险"], ["尽调报告", "合同", "访谈记录"], ["关系数据", "文档资料", "表格资料"], "需要管理员确认", "云启网络关系风险尽调", ["云启供应商清单.csv", "历史风险事件.txt", "云启关系资料.json"], "这家供应商有哪些关联风险？", "主要风险是关键服务集中在同一供应商，且该供应商与历史延期项目存在人员交集。低置信关系需要人工确认后才能形成正式结论。"),
  template("domain-relationship", "垂域关系知识库", "行业", ["graph_explorer", "knowledge_portal", "hybrid"], "为医疗、金融、制造、供应链等领域资料建立关键对象和关系问答能力。", ["医疗领域知识", "金融风险分析", "制造供应链"], ["领域文档", "标准文档", "项目资料"], ["关系数据", "文档资料", "表格资料"], "需要管理员确认", "医疗客户关系知识库", ["医疗客户项目资料.pdf", "医疗对象关系.csv"], "这个领域里哪些关系最影响采购决策？", "采购决策主要受临床科室需求、设备科评估和信息科集成要求共同影响。已有同类设备落地案例通常能缩短评估周期。"),
  template("support-agent", "智能客服知识代理", "客服", ["embedded_assistant", "chat", "task_workflow"], "把帮助中心和售后流程封装成可嵌入网页的客服知识代理。", ["帮助中心", "订单售后", "产品咨询", "人工接管"], ["帮助文档", "售后流程", "常见问题"], ["帮助文档", "表格资料", "文档资料"], "建议管理员确认", "订单与发票客服代理", ["订单售后帮助中心.md", "近30天客服工单.csv"], "客户说订单延迟三天，应该怎么回复？", "可以先说明已按订单号查询物流状态，并告知预计补发或延迟原因；如果订单超过承诺时效，应提供补偿规则或转人工处理。"),
  template("research-guide", "研究报告与学习指南", "研究", ["report_generator", "knowledge_portal"], "把资料包整理成研究报告、学习指南、摘要和带引用版本。", ["市场研究", "行业分析", "内部学习"], ["研究资料包", "网页摘录", "报告"], ["笔记文档", "文档资料", "表格资料"], "无需管理员确认", "医疗行业复购研究指南", ["医疗行业复购资料包.pdf", "复购客户案例.md"], "把资料整理成给销售团队看的学习指南。", "复购通常由上线成效、科室扩展需求和信息科集成稳定性共同驱动。学习指南建议按客户阶段组织材料。"),
  template("data-analyst", "经营指标分析助手", "运营", ["report_generator", "chat", "hybrid"], "把表格、BI 导出和业务说明整理成可追问的指标分析、异常解释和行动建议。", ["经营复盘", "销售指标分析", "财务费用分析", "业务异常定位"], ["指标表格", "业务口径说明", "历史复盘"], ["CSV", "Excel", "JSON", "业务说明"], "建议管理员确认", "华东销售季度指标分析", ["华东季度销售.csv", "指标口径说明.md", "重点客户名单.xlsx"], "过去三个季度华东区收入波动最大的原因是什么？", "收入波动主要来自二季度大客户续约延期和三季度渠道订单集中确认。建议把客户阶段、渠道来源和合同状态作为下钻维度，并补充财务确认口径。"),
  template("it-runbook", "运维服务台故障排查", "运维", ["chat", "task_workflow", "knowledge_portal"], "把运维手册、历史工单和故障记录整理成可追问的排障助手和升级路径。", ["信息技术服务台", "值班排障", "应用运维", "历史工单复用"], ["运行手册", "历史工单", "告警说明", "日志摘要"], ["Markdown", "工单导出", "日志文本", "Runbook"], "建议管理员确认", "支付网关故障排查手册", ["支付网关Runbook.md", "近90天故障工单.csv", "告警规则说明.txt"], "出现支付回调超时，值班同学应该先检查什么？", "先确认外部网关状态、回调队列积压和最近发布记录；如果错误集中在单一商户，应按商户维度查回调签名和重试次数，必要时升级给支付平台负责人。"),
  template("meeting-media-memory", "会议音视频知识纪要", "协作", ["report_generator", "knowledge_portal", "task_workflow"], "把会议录音、视频、转写稿和附件沉淀成可追问纪要、决策记录和行动项。", ["项目例会", "客户访谈", "培训复盘", "管理会议"], ["录音视频", "转写稿", "会议附件", "演示文稿"], ["音频", "视频", "转写文本", "PPT", "PDF"], "建议管理员确认", "赋范科技续约会议纪要", ["续约会议转写稿.md", "会议录音.mp3", "续约方案.pdf"], "这次会议确认了哪些风险、决策和行动项？", "会议确认采购审批延期是核心风险，技术负责人需要复核集成排期；销售负责人负责下周发送上线成效材料，客户成功负责同步二期扩容范围。"),
  template("voice-of-customer", "产品反馈与需求洞察", "产品", ["report_generator", "graph_explorer", "hybrid"], "汇总客服工单、访谈、问卷和社区反馈，识别高频需求、影响客户和证据链。", ["需求池治理", "客户反馈分析", "产品路线图", "流失原因复盘"], ["客服工单", "用户访谈", "问卷数据", "社区反馈"], ["CSV", "访谈文本", "Markdown", "表格资料"], "建议管理员确认", "企业版权限需求洞察", ["近30天客服工单.csv", "重点客户访谈.md", "需求池导出.xlsx"], "哪些权限相关需求最影响企业版续约？", "高频需求集中在角色模板、审批日志和跨团队数据隔离。受影响客户以金融和制造企业为主，建议先推进角色模板和审计导出能力。")
];

export const customScenarioTemplate: ScenarioTemplate = template(
  "custom-scenario",
  "自建业务场景",
  "自定义",
  ["hybrid", "task_workflow"],
  "从业务目标和资料包开始创建场景，后台管理员会根据资料结构选择合适的知识处理方式。",
  ["没有合适官方模板", "需要先验证业务资料", "需要管理员判断处理方式"],
  ["业务说明", "文档资料", "表格资料", "关系数据"],
  ["PDF", "Word", "Markdown", "表格", "JSON"],
  "需要管理员确认",
  "自建业务场景",
  ["业务说明.md", "资料包.zip"],
  "这些资料适合做成什么知识应用？",
  "后台会先确认资料类型、业务目标和发布范围，再选择文档证据、关系图谱、知识汇编或组合处理方式。"
);

function template(
  id: string,
  name: string,
  category: string,
  productForm: TemplateProductForm[],
  headline: string,
  bestFor: string[],
  inputExamples: string[],
  acceptedFiles: string[],
  reviewRequirement: ScenarioTemplate["reviewRequirement"],
  scenarioName: string,
  fileNames: string[],
  sampleQuestion: string,
  sampleAnswer: string
): ScenarioTemplate {
  const sampleInputs = fileNames.map((fileName, index) => ({
    title: index === 0 ? "主要业务资料" : index === 1 ? "结构化补充资料" : "过程资料",
    fileName,
    fileType: fileName.endsWith(".json") ? "json" as const : fileName.endsWith(".csv") ? "csv" as const : fileName.endsWith(".md") ? "md" as const : fileName.endsWith(".txt") ? "txt" as const : "pdf" as const,
    description: "用于展示该模板如何读取业务资料、形成答案和保留依据。"
  }));
  return {
    id,
    name,
    category,
    templateState: "official",
    evidenceLevel: "validated",
    evidenceSources,
    productForm,
    limitations: ["需要按资料质量和复核要求判断是否可以对外使用。"],
    headline,
    bestFor,
    inputExamples,
    acceptedFiles,
    setupTime: reviewRequirement === "需要管理员确认" ? "约 15-40 分钟" : "约 5-20 分钟",
    reviewRequirement,
    processingExplanation: processingPreview,
    outputCapabilities: capabilityFor(productForm),
    demoWalkthrough: {
      scenarioName,
      sampleInputs,
      processingPreview,
      sampleQuestion,
      sampleAnswer,
      citations: sampleInputs.slice(0, 2).map((input) => ({
        label: input.title,
        source: input.fileName,
        excerpt: `依据来自${displaySourceName(input.fileName)}，用于支撑当前结论。`
      })),
      resultHighlights: ["参考答案", "引用来源", "可复用成品"]
    },
    suggestedQuestions: [sampleQuestion, "把结果整理成可分享版本。"]
  };
}

function capabilityFor(forms: TemplateProductForm[]): string[] {
  if (forms.includes("graph_explorer")) return ["关系图谱", "风险信号", "行动建议"];
  if (forms.includes("document_review")) return ["答案草稿", "待审核清单", "引用依据"];
  if (forms.includes("embedded_assistant")) return ["客服问答组件", "转人工建议", "知识缺口"];
  if (forms.includes("report_generator")) return ["结构化报告", "摘要洞察", "引用依据"];
  if (forms.includes("task_workflow")) return ["处理建议", "行动清单", "升级路径"];
  return ["知识条目", "来源问答", "成品摘要"];
}

function ragModeForTemplate(template: ScenarioTemplate): RagEngine {
  if (template.productForm.includes("hybrid")) return "混合处理";
  if (template.productForm.includes("graph_explorer")) return "关系图谱";
  if (template.productForm.includes("document_review")) return "文档证据";
  return "知识百科";
}

function taskKindForScenario(scenario: ScenarioInstance): TaskKind {
  if (scenario.status === "submitted") return "管理员确认";
  if (scenario.status === "waiting_review") return "发布复核";
  if (scenario.status === "ready") return "发布复核";
  return "知识入库";
}

function permissionNoteForVisibility(visibility: Visibility) {
  if (visibility === "private") return "仅创建者可见，团队成员和公司级问答不会召回。";
  if (visibility === "team") return "团队空间可见，公司级问答需管理员提升权限后才能召回。";
  return "公司空间可见，可被公司大脑和授权业务场景召回。";
}

function displaySourceName(value: string) {
  return value
    .replace(/\.(json|csv|md|txt|pdf|docx|xlsx)$/i, "")
    .replace(/RFP/gi, "投标问卷")
    .replace(/FAQ/gi, "常见问题");
}

export const scenarioInstances: ScenarioInstance[] = officialTemplates.map((template, index) => ({
  id: `scenario-${template.id}`,
  templateId: template.id,
  name: template.demoWalkthrough.scenarioName,
  description: template.headline,
  owner: ["张磊", "林澄", "周琪", "陈予"][index % 4],
  visibility: template.id === "customer-360" ? "team" : index % 3 === 0 ? "private" : index % 3 === 1 ? "team" : "company",
  status: template.id === "customer-360" ? "ready" : index % 5 === 0 ? "processing" : "ready",
  sourceCount: template.demoWalkthrough.sampleInputs.length + 2,
  updatedAt: index < 3 ? "今天" : "昨天",
  readyActions: template.outputCapabilities,
  recommendedQuestions: template.suggestedQuestions
}));

export const processingTasks: ProcessingTask[] = scenarioInstances.map((scenario, index) => ({
  id: `task-${scenario.id}`,
  scenarioId: scenario.id,
  title: `处理${scenario.name}`,
  status: scenario.status === "ready" ? "ready" : "processing",
  kind: taskKindForScenario(scenario),
  ragMode: ragModeForTemplate(templateById(scenario.templateId)!),
  visibility: scenario.visibility,
  owner: scenario.owner,
  submittedAt: index < 2 ? "今天 10:40" : index < 5 ? "今天 09:20" : "昨天 18:10",
  updatedAt: scenario.status === "ready" ? "今天 11:20" : "刚刚",
  files: (templateById(scenario.templateId)?.demoWalkthrough.sampleInputs ?? []).map((item) => item.fileName),
  waitingFor: scenario.status === "ready" ? "场景负责人" : "处理管线",
  progress: scenario.status === "ready" ? 100 : 68,
  currentStep: scenario.status === "ready" ? "已生成知识对象" : "整理资料并建立来源",
  userMessage: scenario.status === "ready" ? "后台已完成资料入库、知识构建和发布，当前账号可直接使用。" : "系统正在整理资料、建立来源和生成知识对象。",
  nextActions: scenario.status === "ready" ? ["打开场景", "查看知识空间"] : ["查看任务中心", "补充资料"],
  adminEntry: scenario.status === "ready" ? "已发布，可在后台查看处理记录" : "后台正在执行资料解析、索引和质量检查"
}));

export const knowledgeSpaceObjects: KnowledgeSpaceObject[] = scenarioInstances.map((scenario) => {
  const template = templateById(scenario.templateId)!;
  return {
    id: `knowledge-${scenario.id}`,
    mode: template.productForm.includes("graph_explorer") ? "relationship" : template.productForm.includes("document_review") ? "artifact" : "wiki",
    title: scenario.name,
    summary: `${template.name}已经整理完成，可用于问答、溯源和成品复用。`,
    sourceLabel: template.name,
    linkedScenarioId: scenario.id,
    visibility: scenario.visibility,
    owner: scenario.owner,
    permissionNote: permissionNoteForVisibility(scenario.visibility),
    updatedAt: scenario.updatedAt,
    actions: template.outputCapabilities
  };
});

export const scenarioDataSources: ScenarioDataSource[] = scenarioInstances.flatMap((scenario) => {
  const template = templateById(scenario.templateId)!;
  return template.demoWalkthrough.sampleInputs.map((asset, index) => ({
    id: `source-${scenario.id}-${index + 1}`,
    scenarioId: scenario.id,
    title: asset.title,
    sourceType: asset.fileType.toUpperCase(),
    fileName: asset.fileName,
    status: scenario.status === "ready" ? "已入库" : index === 0 ? "处理中" : "待复核",
    owner: scenario.owner,
    updatedAt: scenario.updatedAt,
    evidencePolicy: template.productForm.includes("graph_explorer") ? "保留实体、关系和来源证据" : "保留引用片段和原文位置"
  }));
});

export const scenarioOutputs: ScenarioOutput[] = scenarioInstances.flatMap((scenario) => {
  const template = templateById(scenario.templateId)!;
  const preferredOutputs =
    template.id === "customer-360"
      ? ["客户简报", "关系图谱", "下一步行动"]
      : template.outputCapabilities;

  return preferredOutputs.slice(0, 3).map((capability, index) => ({
    id: `output-${scenario.id}-${index + 1}`,
    scenarioId: scenario.id,
    type: capability,
    title: `${scenario.name} · ${capability}`,
    summary: `基于${template.name}生成，可在场景内继续追问、复核和分享。`,
    status: scenario.status === "ready" ? "可使用" : "待复核",
    updatedAt: scenario.updatedAt
  }));
});

export const scenarioSettings: ScenarioSettings[] = scenarioInstances.map((scenario, index) => {
  const template = templateById(scenario.templateId)!;
  const isHybrid = template.productForm.includes("hybrid") || template.productForm.includes("graph_explorer");
  return {
    scenarioId: scenario.id,
    publicationMode: scenario.visibility === "private" ? "仅自己可用" : scenario.visibility === "company" ? "公司内可用" : "团队内可用",
    retrievalPolicy: isHybrid ? "混合检索：关键词、向量、关系路径联合排序" : "证据优先：召回片段后按引用可信度排序",
    answerPolicy: template.productForm.includes("document_review") ? "必须输出引用和待确认项" : "优先回答业务结论，并展示来源依据",
    reviewPolicy: template.reviewRequirement,
    connectedSources: scenarioDataSources
      .filter((source) => source.scenarioId === scenario.id)
      .map((source) => source.fileName)
      .concat(index % 2 === 0 ? ["客户系统连接器"] : [])
  };
});

export const workspaceDashboard: WorkspaceDashboard = {
  recentScenarioIds: ["scenario-customer-360", ...scenarioInstances.filter((scenario) => scenario.id !== "scenario-customer-360").slice(0, 4).map((scenario) => scenario.id)],
  pendingTaskIds: processingTasks.filter((task) => task.status !== "ready").map((task) => task.id),
  quickActions: [
    { label: "创建业务场景", href: "/app/templates", description: "从官方模板开始搭建可复用知识应用。" },
    { label: "直接提问", href: "/app/ask", description: "先用公司大脑定位答案和相关场景。" },
    { label: "查看处理任务", href: "/app/tasks", description: "确认资料入库、复核和发布进度。" }
  ],
  knowledgeHealth: {
    readyObjects: knowledgeSpaceObjects.filter((object) => scenarioById(object.linkedScenarioId)?.status === "ready").length,
    processingObjects: knowledgeSpaceObjects.filter((object) => scenarioById(object.linkedScenarioId)?.status !== "ready").length,
    reviewRequired: scenarioInstances.filter((scenario) => templateById(scenario.templateId)?.reviewRequirement !== "无需管理员确认").length
  }
};

export function templateById(id: string): ScenarioTemplate | undefined {
  return officialTemplates.find((template) => template.id === id);
}

export function scenarioById(id: string): ScenarioInstance | undefined {
  return scenarioInstances.find((scenario) => scenario.id === id);
}

export function scenarioAvailability(scenario: ScenarioInstance): ScenarioAvailability {
  if (scenario.status === "ready") {
    return {
      label: "可使用",
      description: "后台已完成资料入库、知识构建和发布，当前账号可直接使用。",
      nextAction: "直接使用场景"
    };
  }
  if (scenario.status === "processing") {
    return {
      label: "后台处理中",
      description: "资料已提交，后台正在解析、入库、索引并构建知识对象。",
      nextAction: "查看处理进度"
    };
  }
  if (scenario.status === "waiting_review") {
    return {
      label: "待复核",
      description: "知识构建已完成，等待管理员复核后发布给当前使用范围。",
      nextAction: "查看复核要求"
    };
  }
  if (scenario.status === "submitted") {
    return {
      label: "等待入库",
      description: "资料已提交，等待后台开始处理或管理员确认入口配置。",
      nextAction: "查看提交记录"
    };
  }
  if (scenario.status === "failed") {
    return {
      label: "处理失败",
      description: "后台处理未完成，需要补充资料或重新发起处理。",
      nextAction: "查看失败原因"
    };
  }
  return {
    label: "资料待接入",
    description: "场景已经创建，但还没有形成可处理的资料包。",
    nextAction: "接入资料"
  };
}

export function scenarioWorkbenchById(id: string): ScenarioWorkbench | undefined {
  const scenario = scenarioById(id);
  if (!scenario) return undefined;
  const template = templateById(scenario.templateId) ?? officialTemplates[0];
  const baseHref = `/app/scenarios/${scenario.id}`;
  const tabs = scenario.status === "ready" ? readyScenarioWorkbenchTabs : scenarioWorkbenchTabs;
  return {
    scenario,
    template,
    tabs: tabs.map((tab) => ({ ...tab, href: `${baseHref}${tab.href}` })),
    lifecycle: scenarioLifecycle,
    dataSources: scenarioDataSources.filter((source) => source.scenarioId === scenario.id),
    tasks: processingTasks.filter((task) => task.scenarioId === scenario.id),
    knowledgeObjects: knowledgeSpaceObjects.filter((object) => object.linkedScenarioId === scenario.id),
    outputs: scenarioOutputs.filter((output) => output.scenarioId === scenario.id),
    settings: scenarioSettings.find((setting) => setting.scenarioId === scenario.id) ?? scenarioSettings[0]
  };
}

export function createScenarioDraft(input: { templateId: string; name: string; visibility: Visibility; fileNames: string[]; description?: string; processingGoal?: string }) {
  const template = templateById(input.templateId) ?? customScenarioTemplate;
  const instance: ScenarioInstance = {
    id: `draft-${input.templateId}`,
    templateId: template.id,
    name: input.name,
    description: input.description?.trim() || template.headline,
    owner: "当前用户",
    visibility: input.visibility,
    status: "submitted",
    sourceCount: input.fileNames.length,
    updatedAt: "刚刚",
    readyActions: template.outputCapabilities,
    recommendedQuestions: template.suggestedQuestions
  };
  const task: ProcessingTask = {
    id: `task-${instance.id}`,
    scenarioId: instance.id,
    title: `创建${template.name}`,
    status: "submitted",
    kind: "管理员确认",
    ragMode: ragModeForTemplate(template),
    visibility: input.visibility,
    owner: "当前用户",
    submittedAt: "刚刚",
    updatedAt: "刚刚",
    files: input.fileNames,
    waitingFor: input.fileNames.length > 0 ? "后台管理员" : "用户补充资料",
    progress: 18,
    currentStep: "等待后台确认处理方式",
    userMessage: input.fileNames.length > 0
      ? `场景资料包已提交，后台将确认资料质量并选择处理方式。处理诉求：${input.processingGoal?.trim() || "生成可追问答案、引用依据和业务产物。"}`
      : "场景已创建，但还需要补充资料包后才能进入后台处理。",
    nextActions: ["查看任务中心", "继续上传资料", "等待后台确认"],
    adminEntry: input.fileNames.length > 0 ? "待管理员选择 RAG 处理模式并确认入库" : "等待用户补充资料"
  };
  const knowledge: KnowledgeSpaceObject = {
    id: `knowledge-${instance.id}`,
    mode: "wiki",
    title: instance.name,
    summary: "处理完成后会出现在知识空间。",
    sourceLabel: template.name,
    linkedScenarioId: instance.id,
    visibility: instance.visibility,
    owner: instance.owner,
    permissionNote: permissionNoteForVisibility(instance.visibility),
    updatedAt: "刚刚",
    actions: template.outputCapabilities
  };
  return { instance, task, knowledge };
}

export function visibleFrontendText(): string {
  return [
    ...frontstageNav.map((item) => item.label),
    ...workspaceNav.flatMap((item) => [item.label, item.description]),
    workspaceProfile.organizationName,
    workspaceProfile.workspaceName,
    ...officialTemplates.flatMap((template) => [
      template.name,
      template.headline,
      ...template.bestFor,
      ...template.inputExamples,
      template.demoWalkthrough.scenarioName,
      template.demoWalkthrough.sampleQuestion,
      template.demoWalkthrough.sampleAnswer
    ]),
    ...scenarioInstances.flatMap((scenario) => [scenario.name, scenario.description]),
    ...scenarioOutputs.flatMap((output) => [output.type, output.title, output.summary])
  ].join("\n");
}
