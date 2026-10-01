import type { Visibility } from "./types";
import type { TemplateDemoWalkthrough } from "./types";

export const PRODUCT_FACING_FORBIDDEN_WORDS = ["mock", "fake", "fixture", "synthetic", "伪造", "虚构"];

export type DemoAssetFormat = "md" | "pdf" | "csv" | "txt" | "json";

export type DemoAsset = {
  id: string;
  scenarioId: string;
  templateId: string;
  title: string;
  fileName: string;
  format: DemoAssetFormat;
  mimeType: string;
  text: string;
};

export type DemoScenario = {
  id: string;
  templateId: string;
  name: string;
  description: string;
  visibility: Visibility;
  department: string;
  ownerUsername: string;
  question: string;
};

export type DeliveryDemoDataPlan = {
  generatedAt: string;
  scenarios: DemoScenario[];
  assets: DemoAsset[];
};

export type TemplateDemoWalkthroughRecord = TemplateDemoWalkthrough & {
  templateId: string;
};

export type IngestFile = {
  name: string;
  text: string;
  mimeType?: string;
};

type TemplateSeed = {
  templateId: string;
  department: string;
  visibility: Visibility;
  ownerUsername: string;
  scenarioNames: string[];
  question: string;
  assetFormats: DemoAssetFormat[];
};

const TEMPLATE_SEEDS: TemplateSeed[] = [
  seed("personal-wiki", "销售", "private", "张磊", ["张磊销售笔记 Wiki", "华东客户复盘资料库", "售前异议处理知识本"], "把这些 Markdown 做成个人知识 Wiki，并总结常见客户异议。", ["md", "md", "csv", "pdf"]),
  seed("team-handbook", "销售运营", "team", "林澄", ["销售新人上手手册", "客户成功交接手册", "售前交付协作手册"], "把团队资料整理成新人可以按章节学习的手册。", ["md", "pdf", "csv", "txt"]),
  seed("policy-evidence", "HR · 财务", "company", "周琪", ["差旅报销制度问答", "采购审批制度问答", "IT 权限申请制度问答"], "一线城市住宿报销标准是多少，需要什么审批？", ["pdf", "pdf", "csv", "md"]),
  seed("contract-playbook", "法务", "team", "陈予", ["SaaS 订阅合同审阅", "渠道合作协议审阅", "数据处理协议审阅"], "这份合同有哪些高风险条款，应该怎么改？", ["pdf", "txt", "csv", "md"]),
  seed("rfp-security", "售前", "team", "许宁", ["华东银行安全问卷响应", "制造集团 RFP 响应", "医疗客户合规问卷响应"], "把客户安全问卷生成标准答案草稿，并标出待确认项。", ["csv", "pdf", "md", "txt"]),
  seed("customer-360", "销售", "team", "张磊", ["赋范科技续约简报", "恒生医疗复购简报", "云启网络风险简报"], "生成会前客户简报、关系路径和下一步推进建议。", ["csv", "json", "pdf", "md"]),
  seed("risk-investigation", "风控", "team", "刘洋", ["云启网络关系风险尽调", "北辰云服供应链尽调", "星桥投资关联关系核验"], "追踪多跳关系、风险事件和证据链。", ["json", "pdf", "csv", "txt"]),
  seed("domain-relationship", "行业研究", "team", "孟然", ["医疗客户关系知识库", "制造供应链对象库", "金融风控关系知识库"], "建立领域对象关系，并回答对象之间的影响路径。", ["json", "pdf", "csv", "md"]),
  seed("support-agent", "客服", "team", "何晴", ["售后知识客服代理", "订单与发票客服代理", "退换货流程客服代理"], "把帮助中心和售后流程做成可嵌入网页的客服知识代理。", ["csv", "txt", "pdf", "md"]),
  seed("research-guide", "研究 · 知识", "private", "顾问团队", ["医疗行业复购研究指南", "企业知识库建设研究", "AI 客服落地案例综述"], "把资料包整理成研究报告和学习指南。", ["md", "pdf", "csv", "txt"]),
  seed("data-analyst", "经营分析", "team", "沈知夏", ["华东销售季度指标分析", "渠道转化异常诊断", "续约收入波动分析"], "过去三个季度华东区收入波动最大的原因是什么？", ["csv", "md", "json", "pdf"]),
  seed("it-runbook", "IT 运维", "team", "陆衡", ["支付网关故障排查手册", "数据同步告警处置手册", "客户门户登录异常排障"], "出现支付回调超时，值班同学应该先检查什么？", ["md", "csv", "txt", "pdf"]),
  seed("meeting-media-memory", "客户成功", "team", "秦知予", ["赋范科技续约会议纪要", "华南制造客户复盘纪要", "产品评审会决策记录"], "这次会议确认了哪些风险、决策和行动项？", ["md", "txt", "pdf", "csv"]),
  seed("voice-of-customer", "产品运营", "team", "何清宁", ["企业版权限需求洞察", "客服工单需求聚类", "重点客户反馈分析"], "哪些权限相关需求最影响企业版续约？", ["csv", "md", "json", "txt"])
];

function seed(templateId: string, department: string, visibility: Visibility, ownerUsername: string, scenarioNames: string[], question: string, assetFormats: DemoAssetFormat[]): TemplateSeed {
  return { templateId, department, visibility, ownerUsername, scenarioNames, question, assetFormats };
}

let cachedPlan: DeliveryDemoDataPlan | null = null;

export function buildDeliveryDemoDataPlan(): DeliveryDemoDataPlan {
  if (cachedPlan) return cachedPlan;
  const scenarios = TEMPLATE_SEEDS.flatMap((templateSeed) =>
    templateSeed.scenarioNames.map((name, index) => ({
      id: `${templateSeed.templateId}-${index + 1}`,
      templateId: templateSeed.templateId,
      name,
      description: descriptionFor(templateSeed.templateId, name),
      visibility: templateSeed.visibility,
      department: templateSeed.department,
      ownerUsername: templateSeed.ownerUsername,
      question: templateSeed.question
    }))
  );
  const assets = scenarios.flatMap((scenario) => {
    const templateSeed = TEMPLATE_SEEDS.find((item) => item.templateId === scenario.templateId)!;
    return templateSeed.assetFormats.flatMap((format, assetIndex) =>
      [0, 1].map((copyIndex) => buildAsset(scenario, format, assetIndex * 2 + copyIndex + 1))
    );
  });
  cachedPlan = { generatedAt: "2026-06-25T00:00:00.000Z", scenarios, assets };
  return cachedPlan;
}

export function buildTemplateDemoWalkthroughs(): TemplateDemoWalkthroughRecord[] {
  const plan = buildDeliveryDemoDataPlan();
  return TEMPLATE_SEEDS.map((templateSeed) => {
    const scenario = plan.scenarios.find((item) => item.templateId === templateSeed.templateId)!;
    const assets = plan.assets.filter((item) => item.scenarioId === scenario.id).slice(0, 3);
    return {
      templateId: templateSeed.templateId,
      scenarioName: scenario.name,
      sampleInputs: assets.slice(0, 2).map((asset) => ({
        title: asset.title,
        fileName: asset.fileName,
        fileType: asset.format,
        description: `${scenario.department}资料，用于回答「${scenario.question}」。`
      })),
      processingPreview: ["读取业务资料", "整理知识结构", "生成答案、引用和成品预览"],
      sampleQuestion: scenario.question,
      sampleAnswer: `${scenario.name}已经整理完成。系统会给出业务结论、下一步建议和可核查来源，用户可以继续追问细节或创建正式场景。`,
      citations: assets.slice(0, 2).map((asset) => ({
        label: asset.title,
        source: asset.fileName,
        excerpt: asset.text.slice(0, 100)
      })),
      resultHighlights: ["参考答案", "引用来源", "成品预览"]
    };
  });
}

export function buildDemoScenarioSeedRequests() {
  const plan = buildDeliveryDemoDataPlan();
  return plan.scenarios.map((scenario) => {
    const assets = plan.assets.filter((asset) => asset.scenarioId === scenario.id);
    return {
      template_id: scenario.templateId,
      name: scenario.name,
      description: scenario.description,
      visibility: scenario.visibility,
      uploaded_files: assets.map((asset) => ({
        name: asset.fileName,
        type: asset.mimeType,
        size: asset.text.length
      })),
      business_options: {
        department: scenario.department,
        owner_username: scenario.ownerUsername,
        seed_question: scenario.question,
        seed_asset_ids: assets.map((asset) => asset.id)
      }
    };
  });
}

export function buildScenarioIngestFiles(input: {
  scenarioName: string;
  scenarioDescription: string;
  businessOptions?: Record<string, unknown>;
}): IngestFile[] {
  const candidateIds = input.businessOptions?.seed_asset_ids;
  const ids = Array.isArray(candidateIds)
    ? candidateIds.map(String)
    : [];
  const assetsById = new Map(buildDeliveryDemoDataPlan().assets.map((asset) => [asset.id, asset]));
  const files = ids.map((id) => assetsById.get(id)).filter((asset): asset is DemoAsset => Boolean(asset));
  if (files.length > 0) {
    return files.map((asset) => ({ name: asset.fileName, text: asset.text, mimeType: asset.mimeType }));
  }
  return [{
    name: `${input.scenarioName}.md`,
    text: `# ${input.scenarioName}\n\n${input.scenarioDescription}\n\n该资料由场景创建流程提交，用于建立初始知识来源。\n\n## 业务问题\n\n需要给出结论、依据、风险和下一步动作。`,
    mimeType: "text/markdown"
  }];
}

function buildAsset(scenario: DemoScenario, format: DemoAssetFormat, index: number): DemoAsset {
  const title = assetTitle(scenario, format, index);
  return {
    id: `${scenario.id}-${format}-${index}`,
    scenarioId: scenario.id,
    templateId: scenario.templateId,
    title,
    fileName: `${title}.${format}`,
    format,
    mimeType: mimeType(format),
    text: assetText(scenario, title, format, index)
  };
}

function descriptionFor(templateId: string, name: string): string {
  const map: Record<string, string> = {
    "personal-wiki": "把个人笔记、Markdown 和资料包整理成可浏览、可追问的个人知识空间。",
    "team-handbook": "把团队资料、会议纪要和项目复盘整理成可分享的团队手册。",
    "policy-evidence": "基于正式制度、审批流程和操作指引回答员工高频问题，并保留依据。",
    "contract-playbook": "将合同模板、审阅规则和历史风险条款整理成审阅 playbook。",
    "rfp-security": "导入客户问卷，生成可信答案草稿、待确认项和引用依据。",
    "customer-360": "生成会前客户简报、风险信号、机会信号和下一步建议。",
    "risk-investigation": "围绕公司、供应商或项目追踪关系链、风险事件和证据链。",
    "domain-relationship": "为垂域资料建立关键对象和关系问答能力。",
    "support-agent": "把帮助中心和售后流程封装成可嵌入网页的客服知识代理。",
    "research-guide": "把资料包整理成研究报告、学习指南、摘要和带引用版本。",
    "data-analyst": "把经营表格、指标口径和历史复盘整理成可追问的分析助手。",
    "it-runbook": "把运维手册、历史工单和告警说明整理成可执行排障路径。",
    "meeting-media-memory": "把会议转写、附件和行动项沉淀成可追问的会议知识资产。",
    "voice-of-customer": "汇总工单、访谈和反馈，识别高频需求、影响客户和证据链。"
  };
  return `${name}：${map[templateId]}`;
}

function assetTitle(scenario: DemoScenario, format: DemoAssetFormat, index: number): string {
  const suffix: Record<DemoAssetFormat, string> = {
    md: "业务笔记",
    pdf: "正式资料",
    csv: "结构化记录",
    txt: "访谈纪要",
    json: "关系对象"
  };
  return `${scenario.name}-${suffix[format]}-${index}`;
}

function assetText(scenario: DemoScenario, title: string, format: DemoAssetFormat, index: number): string {
  if (format === "csv") return csvText(scenario);
  if (format === "json") return JSON.stringify(graphText(scenario), null, 2);
  const paragraphs = [
    `# ${title}`,
    "",
    `场景：${scenario.name}`,
    `部门：${scenario.department}`,
    `负责人：${scenario.ownerUsername}`,
    `目标问题：${scenario.question}`,
    "",
    scenario.description,
    "",
    "## 关键资料",
    "- 当前资料包含业务背景、对象状态、风险信号和可引用依据。",
    "- 处理后需要保留来源，避免只给泛化建议。",
    "- 输出需要覆盖结论、证据、下一步动作和待复核项。",
    "",
    "## 业务事实",
    ...businessFactsFor(scenario),
    `1. ${scenario.name} 的主对象由 ${scenario.ownerUsername} 负责跟进。`,
    `2. 当前记录批次 ${index} 包含最近一次会议、结构化字段和业务备注。`,
    "3. 若证据不足，系统应该标记待确认，而不是直接给出确定结论。",
    "",
    "## 待回答问题",
    `1. ${scenario.question}`,
    "2. 哪些依据可以直接引用给业务负责人？",
    "3. 哪些内容需要人工复核或管理员确认？",
    "",
    "## 处理要求",
    "输出需要包含结论、依据、风险、下一步动作和可沉淀的知识条目。"
  ];
  return paragraphs.join("\n");
}

function csvText(scenario: DemoScenario): string {
  const rows = structuredRowsFor(scenario);
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function graphText(scenario: DemoScenario) {
  const base = {
    nodes: [
      { id: "company", label: scenario.name, type: "company" },
      { id: "owner", label: scenario.ownerUsername, type: "person" },
      { id: "contract", label: "框架合同", type: "contract" },
      { id: "risk", label: "待确认风险", type: "risk" }
    ],
    edges: [
      { from: "owner", to: "company", label: "负责" },
      { from: "company", to: "contract", label: "关联" },
      { from: "contract", to: "risk", label: "包含" }
    ]
  };
  if (scenario.templateId === "customer-360") {
    return {
      nodes: [
        ...base.nodes,
        { id: "cto", label: "技术负责人王皓", type: "person" },
        { id: "expansion", label: "二期数据治理扩容", type: "opportunity" }
      ],
      edges: [
        ...base.edges,
        { from: "cto", to: "risk", label: "担心集成成本" },
        { from: "company", to: "expansion", label: "存在扩容机会" },
        { from: "owner", to: "cto", label: "需确认排期" }
      ]
    };
  }
  if (scenario.templateId === "voice-of-customer") {
    return {
      nodes: [
        ...base.nodes,
        { id: "role-template", label: "角色模板", type: "feature" },
        { id: "audit-export", label: "审计导出", type: "feature" }
      ],
      edges: [
        ...base.edges,
        { from: "company", to: "role-template", label: "高频需求" },
        { from: "company", to: "audit-export", label: "续约影响项" }
      ]
    };
  }
  return base;
}

function businessFactsFor(scenario: DemoScenario): string[] {
  const map: Record<string, string[]> = {
    "personal-wiki": [
      "- 客户异议主要集中在预算冻结、系统集成排期和上线培训成本。",
      "- 已成交案例显示，先提供小范围试点和二期扩容路径更容易获得预算审批。",
      "- 销售需要把异议沉淀成问答卡片，并关联到对应客户复盘。"
    ],
    "team-handbook": [
      "- 新人第一周需要完成产品定位、客户画像、报价规则和会议准备四个章节。",
      "- 团队复盘中反复出现的错误是未确认客户决策链和下一步责任人。",
      "- 手册发布后需要由销售运营维护版本，并开放团队内检索。"
    ],
    "policy-evidence": [
      "- 一线城市普通员工住宿标准为每晚 650 元以内，超标需要直属负责人和财务复核。",
      "- 客户会议或展会导致价格异常时，需要在报销申请中补充原因说明。",
      "- 制度答案必须引用制度版本、条款位置和审批流程。"
    ],
    "contract-playbook": [
      "- 自动续约条款需要提前 30 天书面提醒，否则容易造成客户争议。",
      "- 违约赔偿应设置年度服务费上限，避免无限责任。",
      "- 客户数据只能用于交付、支持和合同约定范围，不能用于二次训练。"
    ],
    "rfp-security": [
      "- 身份认证支持 SAML 2.0 和 OIDC，并可对接企业 IdP。",
      "- 日志留存默认 180 天，金融客户可申请延长到 365 天。",
      "- 数据驻留和专属部署需要安全负责人确认项目配置。"
    ],
    "customer-360": [
      "- 续约风险来自采购审批延迟和技术负责人对集成成本的担忧。",
      "- 机会来自二期扩容需求已被业务负责人确认，预计影响下半年数据治理预算。",
      "- 下一步由客户成功同步上线成效，销售负责人约技术负责人确认集成排期。"
    ],
    "risk-investigation": [
      "- 关键服务集中在同一供应商，且与历史延期项目存在人员交集。",
      "- 低置信关系需要风控负责人复核后才能进入正式尽调结论。",
      "- 关系链应同时展示合同、项目、人员和风险事件来源。"
    ],
    "domain-relationship": [
      "- 医疗采购决策受临床科室需求、设备科评估和信息科集成要求共同影响。",
      "- 同类设备落地案例可以缩短评估周期，但仍需要院内流程证据。",
      "- 领域实体需要区分科室、设备、供应商、项目和监管要求。"
    ],
    "support-agent": [
      "- 订单延迟三天时，客服应先查询物流状态，再说明补发或延迟原因。",
      "- 超过承诺时效时可提供补偿规则，并在高风险情绪下转人工。",
      "- 上线前需要验证拒答、知识缺口和人工接管规则。"
    ],
    "research-guide": [
      "- 医疗行业复购通常由上线成效、科室扩展需求和信息科集成稳定性共同驱动。",
      "- 学习指南应按客户阶段组织：已上线客户看成效证明，扩容客户看跨科室案例。",
      "- 研究资料需要保留引用来源，避免把内部判断当作公开结论。"
    ],
    "data-analyst": [
      "- 二季度收入波动主要来自大客户续约延期，三季度来自渠道订单集中确认。",
      "- 分析维度需要包括客户阶段、渠道来源、合同状态和财务确认口径。",
      "- 输出应包含异常解释、下钻维度和下一步数据补充建议。"
    ],
    "it-runbook": [
      "- 支付回调超时应先检查外部网关状态、回调队列积压和最近发布记录。",
      "- 若错误集中在单一商户，应检查回调签名、重试次数和商户配置。",
      "- 值班建议必须保留告警规则、历史工单和升级路径。"
    ],
    "meeting-media-memory": [
      "- 会议确认采购审批延期是核心风险，技术负责人需要复核集成排期。",
      "- 销售负责人负责发送上线成效材料，客户成功负责同步二期扩容范围。",
      "- 行动项需要按责任人、截止时间和依赖资料沉淀。"
    ],
    "voice-of-customer": [
      "- 高频需求集中在角色模板、审批日志和跨团队数据隔离。",
      "- 受影响客户以金融和制造企业为主，续约影响高于普通功能优化。",
      "- 产品负责人需要把客户影响面、证据来源和路线图建议一起复核。"
    ]
  };
  return map[scenario.templateId] ?? [
    "- 资料包含业务背景、对象状态、风险信号和可引用依据。",
    "- 处理结果需要覆盖结论、证据、下一步动作和待复核项。",
    "- 权限范围会决定资料能否进入个人、团队或公司级召回。"
  ];
}

function structuredRowsFor(scenario: DemoScenario): string[][] {
  if (scenario.templateId === "data-analyst") {
    return [
      ["季度", "区域", "收入", "客户阶段", "渠道来源", "合同状态", "备注"],
      ["2025Q4", "华东", "3180000", "续约", "直销", "已确认", "收入稳定"],
      ["2026Q1", "华东", "2760000", "续约", "渠道", "待确认", "大客户审批延迟"],
      ["2026Q2", "华东", "3920000", "扩容", "直销", "已确认", "渠道订单集中确认"]
    ];
  }
  if (scenario.templateId === "support-agent") {
    return [
      ["工单ID", "问题类型", "客户情绪", "订单状态", "建议动作", "知识缺口"],
      ["CS-1842", "订单延迟", "焦急", "华东仓盘点延迟", "解释原因并提供补偿", "无"],
      ["CS-1917", "发票重开", "中性", "已开具", "引导提交抬头变更", "电子发票规则需更新"],
      ["CS-2033", "退换货", "不满", "超过承诺时效", "转人工并标记高优先级", "补偿规则需确认"]
    ];
  }
  if (scenario.templateId === "voice-of-customer") {
    return [
      ["需求", "影响客户数", "行业", "续约影响", "证据来源", "建议优先级"],
      ["角色模板", "18", "金融/制造", "高", "工单与访谈", "P0"],
      ["审批日志", "12", "金融", "高", "安全问卷", "P0"],
      ["跨团队隔离", "9", "制造", "中", "客户访谈", "P1"]
    ];
  }
  return [
    ["记录ID", "对象", "类型", "负责人", "金额", "状态", "最近更新", "备注"],
    ["R-001", scenario.name, "主对象", scenario.ownerUsername, "1200000", "推进中", "2026-06-12", "需要跟进关键人"],
    ["R-002", "二期扩容", "机会", scenario.ownerUsername, "450000", "评估中", "2026-06-14", "与主合同绑定"],
    ["R-003", "审批确认", "流程", "运营团队", "0", "待确认", "2026-06-15", "需要补充附件"]
  ];
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function mimeType(format: DemoAssetFormat): string {
  const map: Record<DemoAssetFormat, string> = {
    md: "text/markdown",
    pdf: "application/pdf",
    csv: "text/csv",
    txt: "text/plain",
    json: "application/json"
  };
  return map[format];
}
