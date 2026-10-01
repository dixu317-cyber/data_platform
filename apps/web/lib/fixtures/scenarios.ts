export type Capability = "document-evidence" | "relationship-insight" | "compiled-knowledge";
export type ScenarioRuntime =
  | "evidence-chat"
  | "account-brief"
  | "investigation-brief"
  | "document-review"
  | "questionnaire-grid"
  | "notebook-report"
  | "embedded-widget"
  | "service-desk"
  | "content-workspace"
  | "data-analysis";
export type ScenarioVisibility = "private" | "team" | "company" | "official";
export type ScenarioStatus = "draft" | "testing" | "published" | "needs_review" | "disabled";

export type ScenarioInput =
  | { key: string; label: string; type: "text"; placeholder: string; sample: string }
  | { key: string; label: string; type: "select"; options: string[]; sample: string }
  | { key: string; label: string; type: "file"; sample: string };

export type EvidencePolicy = "source-citations" | "document-highlights" | "relationship-paths" | "approval-trail";

export type KnowledgeBinding = {
  id: string;
  name: string;
  capability: Capability;
  scope: string;
  freshness: "fresh" | "watch" | "stale";
};

export type DeliverableBlock =
  | { type: "lead"; text: string }
  | { type: "section"; heading: string; body: string }
  | { type: "bullets"; heading: string; items: { text: string; cite?: string }[] }
  | { type: "risk"; heading: string; items: { level: "high" | "mid" | "low"; title: string; note: string; cite: string }[] }
  | { type: "sources"; items: { title: string; meta: string }[] };

export type ScenarioApp = {
  id: string;
  templateId?: string;
  name: string;
  description: string;
  department: string;
  owner: string;
  ownerRole: string;
  visibility: ScenarioVisibility;
  status: ScenarioStatus;
  verified: boolean;
  runtime: ScenarioRuntime;
  capabilities: Capability[];
  inputs: ScenarioInput[];
  outputTypes: string[];
  evidencePolicy: EvidencePolicy;
  actions: string[];
  qualitySignals: string[];
  usage: {
    runs: number;
    successRate: number;
    lastRun: string;
  };
  knowledgeBindings: KnowledgeBinding[];
  deliverable: {
    id: string;
    title: string;
    kind: string;
    createdAt: string;
    owner: string;
    status: "approved" | "needs_review" | "draft";
    blocks: DeliverableBlock[];
  };
};

export const capabilityLabel: Record<Capability, string> = {
  "document-evidence": "文档证据",
  "relationship-insight": "关系洞察",
  "compiled-knowledge": "知识沉淀"
};

export const capabilityTone: Record<Capability, { color: string; soft: string }> = {
  "document-evidence": { color: "var(--c-document)", soft: "var(--c-document-soft)" },
  "relationship-insight": { color: "var(--c-relation)", soft: "var(--c-relation-soft)" },
  "compiled-knowledge": { color: "var(--c-personal)", soft: "var(--c-personal-soft)" }
};

export const runtimeLabel: Record<ScenarioRuntime, string> = {
  "evidence-chat": "证据问答",
  "account-brief": "客户简报",
  "investigation-brief": "关系尽调",
  "document-review": "文档审阅",
  "questionnaire-grid": "问卷响应",
  "notebook-report": "知识手册",
  "embedded-widget": "嵌入式助手",
  "service-desk": "服务台",
  "content-workspace": "内容工作台",
  "data-analysis": "数据分析"
};

export const visibilityLabel: Record<ScenarioVisibility, string> = {
  private: "私有",
  team: "团队",
  company: "全公司",
  official: "官方"
};

export const statusLabel: Record<ScenarioStatus, string> = {
  draft: "草稿",
  testing: "试运行",
  published: "已发布",
  needs_review: "需审核",
  disabled: "已停用"
};

export const departments = ["全部", "销售", "法务", "售前", "客服", "HR · IT", "研究 · 知识", "市场", "风控"];

export const knowledgeSources: KnowledgeBinding[] = [
  { id: "kb-crm", name: "客户关系库", capability: "relationship-insight", scope: "客户、联系人、机会、合同、项目关系", freshness: "fresh" },
  { id: "kb-sales-docs", name: "销售资料库", capability: "document-evidence", scope: "方案书、会议纪要、报价、历史邮件", freshness: "fresh" },
  { id: "kb-contracts", name: "合同与条款库", capability: "document-evidence", scope: "合同模板、历史合同、法务 playbook", freshness: "watch" },
  { id: "kb-security", name: "安全合规资料库", capability: "document-evidence", scope: "SOC2、ISO、DPA、加密与权限策略", freshness: "fresh" },
  { id: "kb-company-wiki", name: "团队知识百科", capability: "compiled-knowledge", scope: "知识条目、研究综述、新人手册", freshness: "fresh" },
  { id: "kb-support", name: "客服知识库", capability: "document-evidence", scope: "帮助中心、FAQ、退换货与售后规则", freshness: "watch" },
  { id: "kb-policy", name: "制度政策库", capability: "document-evidence", scope: "差旅、报销、采购、IT、HR 制度", freshness: "fresh" },
  { id: "kb-risk", name: "关系风险库", capability: "relationship-insight", scope: "公司、供应商、人物、合同、风险事件", freshness: "stale" }
];

function kb(...ids: string[]) {
  return ids.map((id) => knowledgeSources.find((item) => item.id === id)!).filter(Boolean);
}

export const scenarioApps: ScenarioApp[] = [
  {
    id: "customer-360",
    templateId: "tpl-account-brief",
    name: "客户 360 简报",
    description: "输入客户名和会议目标，生成会前客户简报、关系路径、风险信号与下一步建议。",
    department: "销售",
    owner: "销售增长团队",
    ownerRole: "官方模板",
    visibility: "official",
    status: "published",
    verified: true,
    runtime: "account-brief",
    capabilities: ["relationship-insight", "document-evidence", "compiled-knowledge"],
    inputs: [
      { key: "account", label: "客户名称", type: "select", options: ["赋范科技", "恒生医疗", "云启网络"], sample: "赋范科技" },
      { key: "goal", label: "会议目标", type: "text", placeholder: "例如：续约推进、二期扩容、竞品替换", sample: "续约推进" }
    ],
    outputTypes: ["客户简报", "关系路径", "下一步行动"],
    evidencePolicy: "relationship-paths",
    actions: ["导出会前简报", "生成跟进邮件", "保存到 CRM"],
    qualitySignals: ["关系路径完整", "近 30 天互动已纳入", "2 条风险需人工确认"],
    usage: { runs: 128, successRate: 92, lastRun: "今天 10:24" },
    knowledgeBindings: kb("kb-crm", "kb-sales-docs", "kb-company-wiki"),
    deliverable: {
      id: "out-customer-360",
      title: "赋范科技 · 续约会前简报",
      kind: "客户简报",
      createdAt: "今天 10:24",
      owner: "张磊",
      status: "approved",
      blocks: [
        { type: "lead", text: "结论：赋范科技续约风险偏高，但二期扩容机会明确。建议本周由张磊约 CTO 王皓，以 POC 成果和扩容路线推进 ¥120 万框架续签。" },
        { type: "section", heading: "客户背景", body: "赋范科技约 200 人，当前由张磊负责续约推进。A 项目已上线，智能问答 POC 反馈正向，二期数据模块扩容正在评估。" },
        {
          type: "bullets",
          heading: "关键关系",
          items: [
            { text: "张磊负责赋范科技续约，关键决策人是 CTO 王皓。", cite: "客户关系库" },
            { text: "采购陈敏已确认年度预算，但等待框架续签先落定。", cite: "互动时间线" },
            { text: "二期扩容与续签合同绑定，预计增购 ¥45 万。", cite: "合同记录" }
          ]
        },
        {
          type: "risk",
          heading: "风险信号",
          items: [
            { level: "high", title: "互动停滞", note: "近 14 天没有有效互动，续签窗口仅剩约 3 周。", cite: "互动时间线" },
            { level: "mid", title: "增购依赖续签", note: "数据模块扩容需等框架合同确认后才能推进。", cite: "合同记录" }
          ]
        },
        { type: "sources", items: [{ title: "客户档案：赋范科技", meta: "客户关系库 · 关系路径 7 条" }, { title: "《2024 年度框架合同》草拟稿", meta: "销售资料库 · 金额 ¥120 万" }] }
      ]
    }
  },
  {
    id: "risk-investigation",
    templateId: "tpl-investigation",
    name: "关系风险尽调",
    description: "从公司、供应商或项目出发，追踪多跳关系、风险事件和影响范围。",
    department: "风控",
    owner: "风控分析组",
    ownerRole: "官方模板",
    visibility: "official",
    status: "published",
    verified: true,
    runtime: "investigation-brief",
    capabilities: ["relationship-insight", "document-evidence"],
    inputs: [
      { key: "entity", label: "尽调对象", type: "text", placeholder: "公司、供应商、客户或项目", sample: "云启网络" },
      { key: "scope", label: "排查范围", type: "select", options: ["股权与关联方", "供应链依赖", "合同与诉讼", "全面排查"], sample: "全面排查" }
    ],
    outputTypes: ["风险清单", "关系路径", "待核验问题"],
    evidencePolicy: "relationship-paths",
    actions: ["导出尽调报告", "标记待核验", "转交法务"],
    qualitySignals: ["命中 4 条关系路径", "1 个来源过期", "建议人工核验工商变更"],
    usage: { runs: 46, successRate: 88, lastRun: "昨天 17:40" },
    knowledgeBindings: kb("kb-risk", "kb-contracts", "kb-sales-docs"),
    deliverable: {
      id: "out-risk",
      title: "云启网络 · 关系风险尽调",
      kind: "尽调报告",
      createdAt: "昨天 17:40",
      owner: "刘洋",
      status: "needs_review",
      blocks: [
        { type: "lead", text: "结论：云启网络整体风险中等。主要风险来自上游供应商集中和一笔历史诉讼关联，需要法务核验。" },
        {
          type: "bullets",
          heading: "关系路径",
          items: [
            { text: "云启网络 → 采购服务 → 北辰云服 → 历史 SLA 违约事件。", cite: "关系风险库" },
            { text: "云启网络 → 共同高管 → 星桥投资 → 未披露关联交易传闻。", cite: "工商关系" }
          ]
        },
        {
          type: "risk",
          heading: "待处理风险",
          items: [
            { level: "high", title: "供应商集中", note: "核心云服务依赖北辰云服，替代方案未明确。", cite: "采购合同" },
            { level: "mid", title: "关联交易疑点", note: "星桥投资关系需法务核验。", cite: "工商关系" }
          ]
        },
        { type: "sources", items: [{ title: "关系风险库：云启网络", meta: "多跳关系路径" }, { title: "采购合同与 SLA 附件", meta: "文档证据" }] }
      ]
    }
  },
  {
    id: "contract-playbook",
    templateId: "tpl-contract",
    name: "合同 Playbook 审阅",
    description: "上传或选择合同，按公司 playbook 自动检查风险条款、缺失条款和替换建议。",
    department: "法务",
    owner: "法务运营组",
    ownerRole: "官方模板",
    visibility: "official",
    status: "published",
    verified: true,
    runtime: "document-review",
    capabilities: ["document-evidence", "relationship-insight"],
    inputs: [
      { key: "contract", label: "合同文件", type: "file", sample: "赋范科技 · 框架合同 v2.pdf" },
      { key: "type", label: "合同类型", type: "select", options: ["销售框架合同", "采购协议", "NDA", "SaaS 订阅合同"], sample: "销售框架合同" }
    ],
    outputTypes: ["风险清单", "条款建议", "审阅报告"],
    evidencePolicy: "document-highlights",
    actions: ["生成审阅报告", "导出修改建议", "转交法务复核"],
    qualitySignals: ["3 条风险", "2 条建议替换", "需法务确认违约上限"],
    usage: { runs: 73, successRate: 91, lastRun: "今天 09:18" },
    knowledgeBindings: kb("kb-contracts", "kb-crm"),
    deliverable: {
      id: "out-contract",
      title: "赋范科技框架合同 v2 · 审阅结果",
      kind: "合同审阅",
      createdAt: "今天 09:18",
      owner: "陈晴",
      status: "needs_review",
      blocks: [
        { type: "lead", text: "整体风险中等。自动续约、违约金上限、数据归属条款与公司 playbook 存在偏差。" },
        {
          type: "risk",
          heading: "风险条款",
          items: [
            { level: "high", title: "自动续约未设提醒期", note: "第 9 条没有提前通知期，建议加入到期前 30 天通知。", cite: "第 9 条" },
            { level: "mid", title: "违约金上限偏低", note: "第 12 条封顶 5%，低于公司标准 10%。", cite: "第 12 条" },
            { level: "low", title: "数据归属措辞偏弱", note: "建议替换为公司标准数据归属条款。", cite: "第 7 条" }
          ]
        },
        { type: "sources", items: [{ title: "赋范科技框架合同 v2", meta: "原文高亮 3 处" }, { title: "公司销售合同 playbook", meta: "标准条款对照" }] }
      ]
    }
  },
  {
    id: "rfp-security",
    templateId: "tpl-rfp",
    name: "RFP / 安全问卷响应台",
    description: "导入 RFP、DDQ 或安全问卷，批量生成可信答案并分配审核人。",
    department: "售前",
    owner: "售前解决方案组",
    ownerRole: "团队场景",
    visibility: "team",
    status: "published",
    verified: false,
    runtime: "questionnaire-grid",
    capabilities: ["document-evidence", "compiled-knowledge"],
    inputs: [
      { key: "file", label: "问卷文件", type: "file", sample: "华东银行安全问卷.xlsx" },
      { key: "tone", label: "回答口径", type: "select", options: ["标准", "保守", "销售友好"], sample: "标准" }
    ],
    outputTypes: ["答案表", "审批清单", "缺口知识"],
    evidencePolicy: "approval-trail",
    actions: ["导出 Excel", "请求 SME 审核", "补充到答案库"],
    qualitySignals: ["42/48 已生成", "6 个需 SME 审核", "2 个知识缺口"],
    usage: { runs: 58, successRate: 86, lastRun: "今天 14:12" },
    knowledgeBindings: kb("kb-security", "kb-company-wiki"),
    deliverable: {
      id: "out-rfp",
      title: "华东银行安全问卷 · 答案包",
      kind: "问卷答案包",
      createdAt: "今天 14:12",
      owner: "周然",
      status: "needs_review",
      blocks: [
        { type: "lead", text: "已为 48 个问题生成 42 个建议答案，其中 6 个需要安全 SME 审核，2 个问题暴露知识库缺口。" },
        {
          type: "bullets",
          heading: "参考答案",
          items: [
            { text: "是否支持 SSO：支持 SAML 2.0 和 OIDC，并可与企业 IdP 集成。", cite: "身份认证白皮书" },
            { text: "数据是否加密：传输层使用 TLS 1.2+，静态数据使用 AES-256。", cite: "安全白皮书" },
            { text: "是否有供应商审计机制：需 SME 补充最新审计周期。", cite: "待审核" }
          ]
        },
        { type: "sources", items: [{ title: "安全白皮书 v4", meta: "已批准来源" }, { title: "SOC2 控制项映射表", meta: "已批准来源" }] }
      ]
    }
  },
  {
    id: "knowledge-manual",
    templateId: "tpl-notebook",
    name: "资料到知识手册",
    description: "把资料包、会议纪要和项目文档编译成可浏览、带引用的知识手册。",
    department: "研究 · 知识",
    owner: "知识运营组",
    ownerRole: "官方模板",
    visibility: "official",
    status: "published",
    verified: true,
    runtime: "notebook-report",
    capabilities: ["compiled-knowledge", "document-evidence"],
    inputs: [
      { key: "topic", label: "手册主题", type: "text", placeholder: "例如：销售新人上手、项目复盘、竞品研究", sample: "销售新人上手" },
      { key: "audience", label: "面向受众", type: "select", options: ["新人", "管理层", "项目组", "客户"], sample: "新人" }
    ],
    outputTypes: ["知识手册", "大纲", "引用来源"],
    evidencePolicy: "source-citations",
    actions: ["发布为知识条目", "导出 PDF", "分配维护人"],
    qualitySignals: ["引用 8 份资料", "3 个章节已生成", "1 个来源建议更新"],
    usage: { runs: 91, successRate: 90, lastRun: "昨天 11:05" },
    knowledgeBindings: kb("kb-company-wiki", "kb-sales-docs"),
    deliverable: {
      id: "out-manual",
      title: "销售新人上手手册",
      kind: "知识手册",
      createdAt: "昨天 11:05",
      owner: "知识运营组",
      status: "approved",
      blocks: [
        { type: "lead", text: "这份手册帮助销售新人在第一周内跑通从认识产品到独立准备客户会议的关键路径。" },
        { type: "section", heading: "第 1-2 天：认识产品与客户", body: "通读三类解决方案、典型客户画像和报价规则；通过客户 360 简报熟悉在跟客户。" },
        { type: "section", heading: "第 3-5 天：跟一个真实客户", body: "选择一个客户生成会前简报，跟随负责人参加一次客户沟通，并完成复盘记录。" },
        { type: "sources", items: [{ title: "销售部 onboarding 资料", meta: "团队知识百科" }, { title: "客户简报模板说明", meta: "销售资料库" }] }
      ]
    }
  },
  {
    id: "policy-evidence",
    templateId: "tpl-policy",
    name: "制度政策证据问答",
    description: "员工问制度、流程或报销标准，获得直接答案、原文段落和审批依据。",
    department: "HR · IT",
    owner: "HR 共享服务",
    ownerRole: "官方模板",
    visibility: "official",
    status: "published",
    verified: true,
    runtime: "evidence-chat",
    capabilities: ["document-evidence", "compiled-knowledge"],
    inputs: [
      { key: "question", label: "制度问题", type: "text", placeholder: "例如：一线城市住宿报销标准是多少？", sample: "差旅报销标准是多少？" }
    ],
    outputTypes: ["答案", "原文依据", "审批提示"],
    evidencePolicy: "document-highlights",
    actions: ["收藏答案", "打开原文", "反馈制度缺口"],
    qualitySignals: ["来源有效", "命中 2 份制度", "无需人工审核"],
    usage: { runs: 264, successRate: 95, lastRun: "今天 15:01" },
    knowledgeBindings: kb("kb-policy", "kb-company-wiki"),
    deliverable: {
      id: "out-policy",
      title: "差旅报销标准 · 证据答案",
      kind: "制度答案",
      createdAt: "今天 15:01",
      owner: "李敏",
      status: "approved",
      blocks: [
        { type: "lead", text: "一线城市住宿不超过 ¥500/晚，市内交通凭实报销；单次单程超过 ¥80 或住宿超标，需要部门负责人审批。" },
        { type: "sources", items: [{ title: "《差旅与报销制度 v3》第 4 条", meta: "制度政策库 · 原文高亮" }, { title: "报销操作指引.pdf", meta: "审批流程" }] }
      ]
    }
  },
  {
    id: "support-agent",
    templateId: "tpl-support",
    name: "智能客服知识代理",
    description: "把帮助中心和订单资料封装成可嵌入网站的客服小组件，并保留人工接管依据。",
    department: "客服",
    owner: "客户体验组",
    ownerRole: "团队草稿",
    visibility: "team",
    status: "testing",
    verified: false,
    runtime: "embedded-widget",
    capabilities: ["document-evidence", "relationship-insight"],
    inputs: [
      { key: "scenario", label: "业务场景", type: "select", options: ["售前咨询", "订单售后", "退换货", "发票问题"], sample: "订单售后" }
    ],
    outputTypes: ["客户回复", "接管摘要", "知识缺口"],
    evidencePolicy: "source-citations",
    actions: ["生成嵌入代码", "转人工", "补充帮助文档"],
    qualitySignals: ["试运行中", "退换货来源需更新", "接管规则未发布"],
    usage: { runs: 19, successRate: 78, lastRun: "今天 11:42" },
    knowledgeBindings: kb("kb-support", "kb-crm"),
    deliverable: {
      id: "out-support",
      title: "订单售后 · 客服处理记录",
      kind: "客服运行摘要",
      createdAt: "今天 11:42",
      owner: "赵洁",
      status: "draft",
      blocks: [
        { type: "lead", text: "客户询问订单延迟，系统已基于订单状态和配送规则给出解释，并准备好人工接管摘要。" },
        { type: "bullets", heading: "接管摘要", items: [{ text: "订单 20240618-8842 延迟 1 天，原因是华东仓盘点。", cite: "订单状态" }, { text: "可提供 15 元运费券作为补偿。", cite: "售后规则" }] },
        { type: "sources", items: [{ title: "售后政策 v2", meta: "客服知识库" }, { title: "订单状态记录", meta: "客户关系库" }] }
      ]
    }
  }
];

export const featuredScenarioIds = ["customer-360", "contract-playbook", "rfp-security", "knowledge-manual"];
export const recentScenarioIds = ["customer-360", "policy-evidence", "rfp-security"];

export function scenarioById(id: string) {
  return scenarioApps.find((item) => item.id === id);
}

export function officialScenarios() {
  return scenarioApps.filter((item) => item.visibility === "official");
}

export function teamScenarios() {
  return scenarioApps.filter((item) => item.visibility === "team" || item.visibility === "company");
}

export function myScenarios() {
  return scenarioApps.filter((item) => item.owner === "张磊" || item.visibility === "team" || item.status === "draft" || item.status === "testing");
}

export function scenarioOutputs() {
  return scenarioApps.map((scenario) => ({
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    capability: scenario.capabilities[0],
    ...scenario.deliverable
  }));
}
