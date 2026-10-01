// 前台 · 场景解决方案库 内置业务数据(赋范科技)
// 只露业务名,机制全藏。rag 字段仅用于前台配色家族(doc/relation/compile),不在 UI 露出引擎名。

export type Rag = "doc" | "relation" | "compile";

export type SolInput =
  | { key: string; label: string; type: "select"; options: string[] }
  | { key: string; label: string; type: "text"; placeholder: string };

export type Block =
  | { type: "lead"; text: string }
  | { type: "section"; heading: string; body: string }
  | { type: "bullets"; heading: string; items: { text: string; cite?: string }[] }
  | { type: "risk"; heading: string; items: { level: "high" | "mid" | "low"; title: string; note: string; cite: string }[] }
  | { type: "answer"; text: string; highlight?: string }
  | { type: "sources"; items: { title: string; meta: string }[] };

export type Solution = {
  id: string;
  name: string;
  category: string; // 部门/场景
  rag: Rag;
  tagline: string; // 它替你做什么
  outputTag: string; // 成品类型
  icon: string; // key
  inputs: SolInput[];
  cta: string;
  deliverableTitle: string;
  deliverable: Block[];
};

export const categories = ["全部", "销售", "法务", "HR · 行政", "研究 · 知识", "通用"];

export const ragColor: Record<Rag, { c: string; soft: string }> = {
  doc: { c: "var(--c-document)", soft: "var(--c-document-soft)" },
  relation: { c: "var(--c-relation)", soft: "var(--c-relation-soft)" },
  compile: { c: "var(--c-personal)", soft: "var(--c-personal-soft)" }
};

export const solutions: Solution[] = [
  /* ---------------- 关系型(图谱后台驱动,前台只给业务成品) ---------------- */
  {
    id: "due-diligence",
    name: "客户尽调简报",
    category: "销售",
    rag: "relation",
    tagline: "输入客户名，一键生成一份带依据的尽调简报。",
    outputTag: "简报",
    icon: "brief",
    cta: "生成尽调简报",
    inputs: [
      { key: "account", label: "选择客户", type: "select", options: ["赋范科技", "恒生医疗", "云启网络"] },
      { key: "focus", label: "侧重", type: "select", options: ["续约风险", "新签评估", "全面尽调"] }
    ],
    deliverableTitle: "赋范科技 · 客户尽调简报",
    deliverable: [
      { type: "lead", text: "结论：赋范科技续约风险偏高、但扩容机会明确。建议本周由张磊直接触达 CTO 王皓，以二期扩容方案撬动 ¥120 万框架续签。" },
      {
        type: "section",
        heading: "关系与背景",
        body: "企业软件 / SaaS，约 200 人。当前处于 2024 年度框架续签在谈阶段，由张磊负责；A 项目（数据中台）已上线、二期扩容评估中，智能问答 POC 反馈正向。"
      },
      {
        type: "bullets",
        heading: "关键发现",
        items: [
          { text: "续签框架合同 ¥120 万在谈，叠加数据模块增购 ¥45 万，两者绑定。", cite: "合同记录" },
          { text: "CTO 王皓为关键决策人，近期公开表达扩建数据团队意向。", cite: "客户档案 · 王皓" },
          { text: "采购陈敏已确认年度预算，决策链清晰。", cite: "互动时间线 05-18" }
        ]
      },
      {
        type: "risk",
        heading: "风险提示",
        items: [
          { level: "high", title: "互动停滞", note: "近 14 天无互动，续签窗口仅剩约 3 周。", cite: "互动时间线" },
          { level: "mid", title: "增购依赖续签", note: "数据模块增购依赖框架续签先落定。", cite: "合同记录" }
        ]
      },
      {
        type: "section",
        heading: "建议下一步",
        body: "① 本周内由张磊约 CTO 王皓，带二期扩容方案；② 以 POC 成果对齐其扩团队诉求；③ 把增购并入续签一并推进，缩短决策周期。"
      },
      {
        type: "sources",
        items: [
          { title: "客户档案：赋范科技（关系链：续签/负责/关键人）", meta: "关系知识库 · 跨 3 份资料聚合" },
          { title: "互动时间线 · 近 14 天无互动", meta: "信号 · 续签窗口剩 3 周" },
          { title: "《2024 年度框架合同》草拟稿", meta: "金额 ¥120 万 · 在谈" }
        ]
      }
    ]
  },
  {
    id: "account-insight",
    name: "客户洞察",
    category: "销售",
    rag: "relation",
    tagline: "快速看清一个客户的关键人、在谈与风险要点。",
    outputTag: "要点",
    icon: "insight",
    cta: "生成客户洞察",
    inputs: [{ key: "account", label: "选择客户", type: "select", options: ["赋范科技", "恒生医疗", "云启网络"] }],
    deliverableTitle: "恒生医疗 · 客户洞察",
    deliverable: [
      { type: "lead", text: "恒生医疗是医疗行业难得的正向客户：一期满意度高、决策人主动推进多院区复购，建议争取为行业标杆案例。" },
      {
        type: "bullets",
        heading: "要点",
        items: [
          { text: "二期多院区复购 ¥220 万洽谈中，复购意愿强。", cite: "合同记录" },
          { text: "决策人刘芳（信息科主任）主动询问多院区方案。", cite: "互动 06-18" },
          { text: "一期 NPS 9 分，可争取案例授权反哺仁和药业。", cite: "项目验收" }
        ]
      },
      { type: "sources", items: [{ title: "客户档案：恒生医疗", meta: "关系知识库" }, { title: "院内知识库一期验收", meta: "NPS 9" }] }
    ]
  },

  /* ---------------- 文档型(检索 + 证据) ---------------- */
  {
    id: "contract-review",
    name: "合同审阅",
    category: "法务",
    rag: "doc",
    tagline: "选一份合同，一键列出风险点与关键条款，附原文。",
    outputTag: "风险清单",
    icon: "contract",
    cta: "审阅合同",
    inputs: [
      { key: "file", label: "选择合同", type: "select", options: ["赋范科技 · 框架合同 v2", "供应商采购协议", "云启网络订阅合同"] }
    ],
    deliverableTitle: "赋范科技 · 框架合同 v2 · 审阅结果",
    deliverable: [
      { type: "lead", text: "整体风险中等。3 处需重点关注：自动续约条款、违约金上限、数据条款与公司模板有出入。" },
      {
        type: "risk",
        heading: "风险点",
        items: [
          { level: "high", title: "自动续约未设提醒期", note: "第 9 条到期自动续约，但未约定提前通知期，存在被动续约风险。", cite: "第 9 条" },
          { level: "mid", title: "违约金上限偏低", note: "第 12 条违约金封顶为合同额 5%，低于公司标准 10%。", cite: "第 12 条" },
          { level: "low", title: "数据条款措辞偏弱", note: "第 7 条数据归属表述与公司模板不一致，建议替换。", cite: "第 7 条" }
        ]
      },
      {
        type: "bullets",
        heading: "关键条款摘要",
        items: [
          { text: "合同期限 12 个月，金额 ¥120 万。", cite: "第 2 条" },
          { text: "付款节奏：签约 30% / 上线 40% / 验收 30%。", cite: "第 5 条" }
        ]
      },
      { type: "sources", items: [{ title: "《赋范科技框架合同 v2》", meta: "文档资料库 · 原文段落已高亮" }, { title: "公司合同模板 · 标准条款", meta: "对照基准" }] }
    ]
  },
  {
    id: "policy-qa",
    name: "制度政策问答",
    category: "HR · 行政",
    rag: "doc",
    tagline: "问一句公司制度，拿到带原文出处的答案。",
    outputTag: "答案",
    icon: "policy",
    cta: "提问",
    inputs: [{ key: "q", label: "你的问题", type: "text", placeholder: "例如：差旅报销标准是多少？" }],
    deliverableTitle: "差旅报销标准",
    deliverable: [
      {
        type: "answer",
        text: "一线城市住宿不超过 ¥500/晚，市内交通凭实报销；单次单程超过 ¥80 或住宿超标的，需部门负责人审批。",
        highlight: "¥500/晚"
      },
      { type: "sources", items: [{ title: "《差旅与报销制度 v3》第 4 条 · 第 2 段", meta: "文档资料库 · 原文已高亮" }, { title: "报销操作指引.pdf · 第 2 页", meta: "审批流程" }] }
    ]
  },
  {
    id: "meeting-minutes",
    name: "会议纪要生成",
    category: "通用",
    rag: "doc",
    tagline: "把会议记录整理成结构化纪要与待办。",
    outputTag: "纪要",
    icon: "minutes",
    cta: "生成纪要",
    inputs: [{ key: "raw", label: "粘贴会议记录", type: "text", placeholder: "粘贴原始记录，或选择已上传的录音转写…" }],
    deliverableTitle: "赋范科技二期方案评审 · 会议纪要",
    deliverable: [
      { type: "section", heading: "结论", body: "评审通过二期扩容方案，本周内发送客户；增购并入续签一并推进。" },
      {
        type: "bullets",
        heading: "待办",
        items: [
          { text: "张磊：本周约 CTO 王皓，带二期方案。", cite: "负责人 张磊" },
          { text: "方案组：补充扩容报价明细。", cite: "—" },
          { text: "法务：核对增购合同条款。", cite: "—" }
        ]
      }
    ]
  },

  /* ---------------- 编译型(主题→成品文章/百科) ---------------- */
  {
    id: "topic-review",
    name: "主题综述",
    category: "研究 · 知识",
    rag: "compile",
    tagline: "给一个主题，生成带章节与引用的综述，可选受众。",
    outputTag: "综述",
    icon: "review",
    cta: "生成综述",
    inputs: [
      { key: "topic", label: "主题", type: "text", placeholder: "例如：企业检索效果调优" },
      { key: "audience", label: "面向受众", type: "select", options: ["团队成员", "公司高管", "新人"] }
    ],
    deliverableTitle: "企业检索效果调优 · 主题综述",
    deliverable: [
      { type: "lead", text: "本综述汇总了团队在企业检索效果调优上的实践，面向团队成员，给出可直接套用的三条原则与落地清单。" },
      { type: "section", heading: "为什么重要", body: "检索效果直接决定问答可信度。团队过去半年的项目反复表明，粒度与回测策略比模型选择更影响最终体验。" },
      {
        type: "bullets",
        heading: "三条核心原则",
        items: [
          { text: "先按语义边界切分，别按固定字数硬切。", cite: "知识条目 · 调优经验" },
          { text: "单段控制在可独立理解的长度。", cite: "知识条目 · 调优经验" },
          { text: "用真实业务问题回测，再微调粒度。", cite: "A 项目复盘" }
        ]
      },
      { type: "section", heading: "落地清单", body: "① 建库前先收集 20 个真实问题做基准；② 切分后抽样人工校验；③ 上线后用问答质量回看持续微调。" },
      { type: "sources", items: [{ title: "知识条目：检索效果调优 · 团队经验", meta: "个人知识库 · 溯源 4 份原始资料" }, { title: "A 项目复盘纪要", meta: "实践来源" }] }
    ]
  },
  {
    id: "onboarding",
    name: "新人上手手册",
    category: "HR · 行政",
    rag: "compile",
    tagline: "为某个岗位一键生成新人上手手册。",
    outputTag: "手册",
    icon: "onboard",
    cta: "生成手册",
    inputs: [{ key: "role", label: "岗位", type: "select", options: ["销售", "解决方案工程师", "研发"] }],
    deliverableTitle: "销售 · 新人上手手册",
    deliverable: [
      { type: "lead", text: "这份手册帮助销售新人在第一周内跑通从认识产品到独立跟进客户的关键路径。" },
      { type: "section", heading: "第 1-2 天 · 认识产品与客户", body: "通读三大解决方案与典型客户画像；在「客户洞察」里熟悉在跟客户。" },
      { type: "section", heading: "第 3-5 天 · 跟一个真实客户", body: "选一个客户用「客户尽调简报」做功课，跟着负责人参加一次客户沟通。" },
      { type: "sources", items: [{ title: "销售部 · 新人 onboarding 资料", meta: "个人知识库 · 自动汇编" }] }
    ]
  },
  {
    id: "research-report",
    name: "研究报告",
    category: "研究 · 知识",
    rag: "compile",
    tagline: "围绕一个问题，生成带数据与引用的研究报告。",
    outputTag: "报告",
    icon: "report",
    cta: "生成报告",
    inputs: [{ key: "q", label: "研究问题", type: "text", placeholder: "例如：医疗行业客户的复购驱动因素" }],
    deliverableTitle: "医疗行业客户复购驱动因素 · 研究报告",
    deliverable: [
      { type: "lead", text: "基于现有医疗行业客户资料，复购主要由「一期满意度 + 决策人主动性 + 合规背书」三要素驱动。" },
      { type: "section", heading: "发现", body: "恒生医疗一期 NPS 9 分后主动询问多院区复购；仁和药业因合规顾虑推进偏慢，需同行背书加速。" },
      { type: "sources", items: [{ title: "恒生医疗 / 仁和药业 客户档案", meta: "关系 + 个人知识库" }] }
    ]
  }
];

export const solutionById = (id: string) => solutions.find((s) => s.id === id);
