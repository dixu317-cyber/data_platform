import type { ScenarioTemplate, TemplateDemoWalkthrough, TemplateModulePlan, TemplateProductForm } from "./types";

export const OFFICIAL_TEMPLATE_IDS = [
  "personal-wiki",
  "team-handbook",
  "policy-evidence",
  "contract-playbook",
  "rfp-security",
  "customer-360",
  "risk-investigation",
  "domain-relationship",
  "support-agent",
  "research-guide",
  "data-analyst",
  "it-runbook",
  "meeting-media-memory",
  "voice-of-customer"
] as const;

const now = new Date("2026-06-25T00:00:00.000Z");

const evidenceSources = [
  "_research/official-template-best-practice-research.md",
  "https://docs.dify.ai/en/use-dify/knowledge/knowledge-pipeline/create-knowledge-pipeline",
  "https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html"
];

const plans: Record<string, TemplateModulePlan[]> = {
  "personal-wiki": [{ moduleId: "nano-brain", sourcePurpose: "wiki", createSourceName: "scenario/personal-wiki", ingestMode: "nano_page", required: true }],
  "team-handbook": [{ moduleId: "nano-brain", sourcePurpose: "wiki", createSourceName: "scenario/team-handbook", ingestMode: "nano_page", required: true }],
  "policy-evidence": [{ moduleId: "traditional-rag", sourcePurpose: "evidence", createSourceName: "scenario/policy-evidence", ingestMode: "traditional_document", required: true }],
  "contract-playbook": [{ moduleId: "traditional-rag", sourcePurpose: "evidence", createSourceName: "scenario/contract-playbook", ingestMode: "traditional_document", required: true }],
  "rfp-security": [
    { moduleId: "traditional-rag", sourcePurpose: "evidence", createSourceName: "scenario/rfp-security", ingestMode: "traditional_document", required: true },
    { moduleId: "nano-brain", sourcePurpose: "wiki", createSourceName: "scenario/rfp-approved-answers", ingestMode: "nano_page", required: false }
  ],
  "customer-360": [
    { moduleId: "graph-rag", sourcePurpose: "relationship", createSourceName: "scenario/customer-360-relations", ingestMode: "graph_document", required: true },
    { moduleId: "traditional-rag", sourcePurpose: "evidence", createSourceName: "scenario/customer-360-docs", ingestMode: "traditional_document", required: false },
    { moduleId: "nano-brain", sourcePurpose: "wiki", createSourceName: "scenario/customer-360-notes", ingestMode: "nano_page", required: false }
  ],
  "risk-investigation": [
    { moduleId: "graph-rag", sourcePurpose: "relationship", createSourceName: "scenario/risk-investigation", ingestMode: "graph_document", required: true },
    { moduleId: "traditional-rag", sourcePurpose: "evidence", createSourceName: "scenario/risk-evidence", ingestMode: "traditional_document", required: false }
  ],
  "domain-relationship": [{ moduleId: "graph-rag", sourcePurpose: "relationship", createSourceName: "scenario/domain-relationship", ingestMode: "graph_document", required: true }],
  "support-agent": [
    { moduleId: "traditional-rag", sourcePurpose: "evidence", createSourceName: "scenario/support-docs", ingestMode: "traditional_document", required: true },
    { moduleId: "graph-rag", sourcePurpose: "relationship", createSourceName: "scenario/support-objects", ingestMode: "graph_document", required: false }
  ],
  "research-guide": [
    { moduleId: "nano-brain", sourcePurpose: "wiki", createSourceName: "scenario/research-guide", ingestMode: "nano_page", required: true },
    { moduleId: "traditional-rag", sourcePurpose: "evidence", createSourceName: "scenario/research-sources", ingestMode: "traditional_document", required: false }
  ],
  "data-analyst": [
    { moduleId: "traditional-rag", sourcePurpose: "evidence", createSourceName: "scenario/data-analyst-tables", ingestMode: "traditional_document", required: true },
    { moduleId: "nano-brain", sourcePurpose: "wiki", createSourceName: "scenario/data-analyst-metrics", ingestMode: "nano_page", required: false }
  ],
  "it-runbook": [
    { moduleId: "traditional-rag", sourcePurpose: "evidence", createSourceName: "scenario/it-runbook-docs", ingestMode: "traditional_document", required: true },
    { moduleId: "nano-brain", sourcePurpose: "wiki", createSourceName: "scenario/it-runbook-playbook", ingestMode: "nano_page", required: false }
  ],
  "meeting-media-memory": [
    { moduleId: "traditional-rag", sourcePurpose: "evidence", createSourceName: "scenario/meeting-media-transcripts", ingestMode: "traditional_document", required: true },
    { moduleId: "nano-brain", sourcePurpose: "wiki", createSourceName: "scenario/meeting-decisions", ingestMode: "nano_page", required: false }
  ],
  "voice-of-customer": [
    { moduleId: "traditional-rag", sourcePurpose: "evidence", createSourceName: "scenario/voc-feedback", ingestMode: "traditional_document", required: true },
    { moduleId: "graph-rag", sourcePurpose: "relationship", createSourceName: "scenario/voc-demand-graph", ingestMode: "graph_document", required: false },
    { moduleId: "nano-brain", sourcePurpose: "wiki", createSourceName: "scenario/voc-insights", ingestMode: "nano_page", required: false }
  ]
};

function officialEvidence(productForms: TemplateProductForm[], limitations: string[]) {
  return {
    state: "official" as const,
    evidenceLevel: "validated" as const,
    evidenceSources,
    productForms,
    limitations
  };
}

function demoWalkthroughForTemplate(id: string): TemplateDemoWalkthrough {
  const map: Record<string, TemplateDemoWalkthrough> = {
    "personal-wiki": demo("张磊销售笔记知识 Wiki", ["华东客户复盘.md", "续约销售打法.pdf"], "这批笔记里最常见的客户异议是什么？", "最常见的异议集中在预算周期、系统集成成本和上线周期。建议先用已完成案例说明实施节奏，再把预算问题拆成续约保留、二期扩容和服务包三类处理。"),
    "team-handbook": demo("销售新人上手手册", ["销售新人第一周.md", "客户会议准备清单.pdf"], "新人第一周应该先看哪些材料？", "第一天先阅读产品定位和典型客户画像，第二天完成客户会议准备清单，第三到五天跟读三个复盘案例并提交一次客户会议计划。"),
    "policy-evidence": demo("差旅报销制度问答", ["2026差旅报销制度.pdf", "费用审批流程.csv"], "一线城市住宿报销标准是多少，需要什么审批？", "一线城市普通员工住宿标准为每晚 650 元以内；超过标准需要直属负责人和财务复核。若因客户会议或展会导致价格异常，需要在申请中补充说明。"),
    "contract-playbook": demo("SaaS 订阅合同审阅", ["赋范科技订阅合同.pdf", "法务条款审阅清单.md"], "这份合同有哪些高风险条款，应该怎么改？", "主要风险是自动续约通知期过短、违约赔偿上限缺失、客户数据使用边界不清。建议补充 30 天续约提醒、设置年度服务费上限，并明确数据仅用于交付和支持。"),
    "rfp-security": demo("华东银行安全问卷响应", ["华东银行安全问卷.csv", "平台安全白皮书.pdf"], "把客户安全问卷生成标准答案草稿，并标出待确认项。", "已生成可直接复核的答案草稿。身份认证、权限控制和日志留存可引用安全白皮书；数据驻留和专属部署条款缺少当前项目配置，需要安全负责人确认。"),
    "customer-360": demo("赋范科技续约简报", ["赋范科技CRM.csv", "赋范科技关系图.json", "续约会议纪要.md"], "赋范科技这个客户当前续约风险和机会是什么？", "续约风险来自采购审批延迟和技术负责人对集成成本的担忧；机会来自二期扩容需求已被业务负责人确认。建议本周由客户成功同步上线成效，销售负责人约 CTO 确认集成排期。"),
    "risk-investigation": demo("云启网络关系风险尽调", ["云启供应商清单.csv", "历史风险事件.txt", "云启关系资料.json"], "这家供应商有哪些关联风险？", "主要风险是关键服务集中在同一供应商，且该供应商与历史延期项目存在人员交集。当前证据足以提示复核，但低置信关系需要人工确认后才能形成正式结论。"),
    "domain-relationship": demo("医疗客户关系知识库", ["医疗客户项目资料.pdf", "医疗对象关系.csv"], "这个领域里哪些关系最影响采购决策？", "采购决策主要受临床科室需求、设备科评估和信息科集成要求共同影响。若供应商已有同类设备落地案例，通常能缩短评估周期。"),
    "support-agent": demo("订单与发票客服代理", ["订单售后帮助中心.md", "近30天客服工单.csv"], "客户说订单延迟三天，应该怎么回复？", "可以先说明已按订单号查询物流状态，并告知预计补发或延迟原因；如果订单超过承诺时效，应提供补偿规则或转人工处理。"),
    "research-guide": demo("医疗行业复购研究指南", ["医疗行业复购资料包.pdf", "复购客户案例.md"], "把资料整理成给销售团队看的学习指南。", "复购通常由上线成效、科室扩展需求和信息科集成稳定性共同驱动。学习指南建议按客户阶段组织：已上线客户看成效证明，扩容客户看跨科室案例，新客户看采购路径。"),
    "data-analyst": demo("华东销售季度指标分析", ["华东季度销售.csv", "指标口径说明.md", "重点客户名单.xlsx"], "过去三个季度华东区收入波动最大的原因是什么？", "收入波动主要来自二季度大客户续约延期和三季度渠道订单集中确认。建议把客户阶段、渠道来源和合同状态作为下钻维度，并补充财务确认口径。"),
    "it-runbook": demo("支付网关故障排查手册", ["支付网关Runbook.md", "近90天故障工单.csv", "告警规则说明.txt"], "出现支付回调超时，值班同学应该先检查什么？", "先确认外部网关状态、回调队列积压和最近发布记录；如果错误集中在单一商户，应按商户维度查回调签名和重试次数，必要时升级给支付平台负责人。"),
    "meeting-media-memory": demo("赋范科技续约会议纪要", ["续约会议转写稿.md", "会议录音.mp3", "续约方案.pdf"], "这次会议确认了哪些风险、决策和行动项？", "会议确认采购审批延期是核心风险，技术负责人需要复核集成排期；销售负责人负责下周发送上线成效材料，客户成功负责同步二期扩容范围。"),
    "voice-of-customer": demo("企业版权限需求洞察", ["近30天客服工单.csv", "重点客户访谈.md", "需求池导出.xlsx"], "哪些权限相关需求最影响企业版续约？", "高频需求集中在角色模板、审批日志和跨团队数据隔离。受影响客户以金融和制造企业为主，建议先推进角色模板和审计导出能力。")
  };
  return map[id] ?? demo("业务场景案例", [`${id}-source.pdf`, `${id}-records.csv`], "这个模板创建后能回答什么问题？", "系统会基于已处理资料给出业务结论、下一步建议和引用来源。");
}

function demo(scenarioName: string, fileNames: string[], sampleQuestion: string, sampleAnswer: string): TemplateDemoWalkthrough {
  const sampleInputs = fileNames.slice(0, 3).map((fileName, index) => ({
    title: index === 0 ? "主要业务资料" : index === 1 ? "结构化补充资料" : "会议与过程资料",
    fileName,
    fileType: fileName.endsWith(".json") ? "json" as const : fileName.endsWith(".csv") ? "csv" as const : fileName.endsWith(".md") ? "md" as const : fileName.endsWith(".txt") ? "txt" as const : "pdf" as const,
    description: "用于说明该模板如何读取业务资料、生成答案并保留来源。"
  }));
  return {
    scenarioName,
    sampleInputs,
    processingPreview: ["读取案例资料并识别可用来源", "整理成当前模板需要的知识结构", "生成可追问答案、引用依据和成品预览"],
    sampleQuestion,
    sampleAnswer,
    citations: sampleInputs.slice(0, 2).map((input) => ({
      label: input.title,
      source: input.fileName,
      excerpt: `依据来自 ${input.fileName}，用于支撑当前结论。`
    })),
    resultHighlights: ["展示参考答案", "展示引用来源", "展示可复用成品"]
  };
}

const rows: Array<Omit<ScenarioTemplate, "state" | "evidenceLevel" | "evidenceSources" | "productForms" | "limitations" | "demoWalkthrough" | "modulePlan" | "createdAt" | "updatedAt"> & {
  productForms: TemplateProductForm[];
  limitations: string[];
}> = [
  row("personal-wiki", "个人知识 Wiki", "compiled_knowledge", "把个人笔记、Markdown 和资料包整理成可浏览、可追问的个人知识空间。", ["Markdown 笔记", "PDF 资料", "网页摘录"], ["md", "txt", "pdf"], ["Wiki 条目", "来源问答", "主题综述"], false, "private", ["knowledge_portal", "chat"], ["不适合直接生成未经复核的对外正式文件。"]),
  row("team-handbook", "团队知识手册", "compiled_knowledge", "把团队资料、会议纪要和项目复盘整理成可分享的团队手册。", ["会议纪要", "项目复盘", "FAQ 文档"], ["md", "docx", "pdf"], ["章节手册", "按章节提问", "团队分享"], true, "team", ["knowledge_portal", "task_workflow"], ["需要管理员复核后再作为团队统一口径发布。"]),
  row("policy-evidence", "制度政策证据问答", "document_evidence", "让员工获得带原文依据的制度、流程和报销答复。", ["制度 PDF", "流程文档", "公告"], ["pdf", "docx", "xlsx"], ["制度答复", "原文依据", "审批提示"], true, "company", ["chat", "knowledge_portal"], ["制度类答案必须保留引用，不应替代 HR 或法务最终解释。"]),
  row("contract-playbook", "合同 Playbook 审阅", "document_evidence", "上传合同并按公司审阅规则生成风险条款、缺失条款和替换建议。", ["合同文本", "条款库", "风险清单"], ["pdf", "docx", "txt"], ["风险条款", "替换建议", "审阅报告"], true, "team", ["document_review", "task_workflow"], ["只能作为合同初筛和条款建议，不能替代法律审阅。"]),
  row("rfp-security", "RFP / 安全问卷响应", "document_evidence", "导入客户问卷，生成可信答案草稿、待确认项和引用依据。", ["客户问卷", "历史答案库", "安全白皮书"], ["xlsx", "csv", "pdf", "docx"], ["答案草稿", "待审核清单", "答案导出"], true, "team", ["document_review", "report_generator"], ["客户问卷答案需要责任人确认后才能对外发送。"]),
  row("customer-360", "客户 360 简报", "hybrid", "输入客户名，生成会前客户简报、风险信号、机会信号和下一步建议。", ["客户档案", "会议记录", "合同", "项目记录"], ["pdf", "docx", "xlsx", "txt"], ["客户简报", "关系线索", "行动建议"], true, "team", ["report_generator", "graph_explorer", "hybrid"], ["客户判断依赖数据新鲜度，过期 CRM 或会议记录会降低可靠性。"]),
  row("risk-investigation", "关系风险尽调", "relationship_knowledge", "围绕公司、供应商或项目追踪关系链、风险事件和证据链。", ["尽调报告", "合同", "访谈记录"], ["pdf", "docx", "xlsx", "txt"], ["关系链", "风险清单", "尽调报告"], true, "team", ["graph_explorer", "report_generator"], ["关系线索需要证据支撑，低置信关系不能直接作为结论。"]),
  row("domain-relationship", "垂域关系知识库", "relationship_knowledge", "为医疗、金融、制造、供应链等领域资料建立关键对象和关系问答能力。", ["领域 PDF", "标准文档", "项目资料"], ["pdf", "docx", "xlsx", "csv", "txt"], ["领域对象", "关系线索", "分析报告"], true, "team", ["graph_explorer", "knowledge_portal", "hybrid"], ["垂域实体和关系类型需要管理员按领域配置后效果更稳定。"]),
  row("support-agent", "智能客服知识代理", "hybrid", "把帮助中心和售后流程封装成可嵌入网页的客服知识代理。", ["帮助文档", "售后流程", "FAQ"], ["pdf", "docx", "txt", "html"], ["客服问答组件", "转人工建议", "知识缺口"], true, "team", ["embedded_assistant", "chat", "task_workflow"], ["上线前需要验证拒答、转人工和知识缺口处理。"]),
  row("research-guide", "研究报告 / 学习指南", "compiled_knowledge", "把资料包整理成研究报告、学习指南、摘要和带引用版本。", ["研究资料包", "网页摘录", "报告"], ["pdf", "docx", "md", "txt", "html"], ["研究报告", "学习指南", "引用来源"], false, "private", ["report_generator", "knowledge_portal"], ["适合内部研究和学习材料，不应直接当作无引用的正式报告。"]),
  row("data-analyst", "经营指标分析助手", "hybrid", "把表格、BI 导出和业务说明整理成可追问的指标分析、异常解释和行动建议。", ["指标表格", "业务口径说明", "历史复盘"], ["csv", "xlsx", "json", "md", "pdf"], ["指标分析", "异常解释", "行动建议"], true, "team", ["report_generator", "chat", "hybrid"], ["指标口径和数据时效需要在发布前确认，避免跨部门口径冲突。"]),
  row("it-runbook", "运维服务台故障排查", "document_evidence", "把运维手册、历史工单和故障记录整理成可追问的排障助手和升级路径。", ["运行手册", "历史工单", "告警说明", "日志摘要"], ["md", "csv", "txt", "docx", "pdf"], ["排障步骤", "升级路径", "历史工单依据"], true, "team", ["chat", "task_workflow", "knowledge_portal"], ["故障处理建议需要结合当前监控状态，不能替代值班人员判断。"]),
  row("meeting-media-memory", "会议音视频知识纪要", "hybrid", "把会议录音、视频、转写稿和附件沉淀成可追问纪要、决策记录和行动项。", ["录音视频", "转写稿", "会议附件", "演示文稿"], ["mp3", "mp4", "m4a", "wav", "md", "pdf", "pptx"], ["会议纪要", "决策记录", "行动项"], true, "team", ["report_generator", "knowledge_portal", "task_workflow"], ["音视频需要真实转写或人工校对，未校对内容不能作为正式会议纪要。"]),
  row("voice-of-customer", "产品反馈与需求洞察", "hybrid", "汇总客服工单、访谈、问卷和社区反馈，识别高频需求、影响客户和证据链。", ["客服工单", "用户访谈", "问卷数据", "社区反馈"], ["csv", "xlsx", "md", "txt", "json"], ["需求洞察", "客户影响面", "优先级建议"], true, "team", ["report_generator", "graph_explorer", "hybrid"], ["需求聚类和客户影响面需要产品负责人复核后进入路线图。"])
];

function row(
  id: string,
  name: string,
  kind: ScenarioTemplate["kind"],
  headline: string,
  requiredInputs: string[],
  acceptedFileTypes: string[],
  outputCapabilities: string[],
  needsAdminReview: boolean,
  defaultVisibility: ScenarioTemplate["defaultVisibility"],
  productForms: TemplateProductForm[],
  limitations: string[]
) {
  return {
    id,
    name,
    kind,
    headline,
    description: headline,
    requiredInputs,
    acceptedFileTypes,
    outputCapabilities,
    needsAdminReview,
    defaultVisibility,
    productForms,
    limitations
  };
}

const templates: ScenarioTemplate[] = rows.map((item) => ({
  ...item,
  ...officialEvidence(item.productForms, item.limitations),
  demoWalkthrough: demoWalkthroughForTemplate(item.id),
  modulePlan: plans[item.id] ?? [],
  createdAt: now,
  updatedAt: now
}));

export function listScenarioTemplates(): ScenarioTemplate[] {
  return templates;
}

export function getScenarioTemplate(id: string): ScenarioTemplate | undefined {
  return templates.find((item) => item.id === id);
}

export function modulePlanForTemplate(id: string): TemplateModulePlan[] {
  return getScenarioTemplate(id)?.modulePlan ?? [];
}

export function validateOfficialTemplateEvidence(template: ScenarioTemplate): true {
  if (template.state !== "official") return true;
  if (template.evidenceLevel !== "validated") throw new Error(`${template.id} official template must be validated`);
  if (template.evidenceSources.length < 2) throw new Error(`${template.id} official template needs at least two evidence sources`);
  if (template.productForms.length < 1) throw new Error(`${template.id} official template needs product form metadata`);
  if (template.limitations.length < 1) throw new Error(`${template.id} official template needs limitation metadata`);
  if (template.demoWalkthrough.sampleInputs.length < 2) throw new Error(`${template.id} official template needs demo sample inputs`);
  if (template.demoWalkthrough.citations.length < 2) throw new Error(`${template.id} official template needs demo citations`);
  if (template.modulePlan.length < 1) throw new Error(`${template.id} official template needs a module plan`);
  return true;
}

export function seedScenarioTemplatesSqlRows() {
  return templates.map((item) => ({
    id: item.id,
    name: item.name,
    kind: item.kind,
    state: item.state,
    evidenceLevel: item.evidenceLevel,
    evidenceSourcesJson: JSON.stringify(item.evidenceSources),
    productFormsJson: JSON.stringify(item.productForms),
    limitationsJson: JSON.stringify(item.limitations),
    demoWalkthroughJson: JSON.stringify(item.demoWalkthrough),
    headline: item.headline,
    description: item.description,
    requiredInputsJson: JSON.stringify(item.requiredInputs),
    acceptedFileTypesJson: JSON.stringify(item.acceptedFileTypes),
    outputCapabilitiesJson: JSON.stringify(item.outputCapabilities),
    needsAdminReview: item.needsAdminReview,
    defaultVisibility: item.defaultVisibility,
    modulePlanJson: JSON.stringify(item.modulePlan)
  }));
}
