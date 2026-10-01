// 前台 · 三栏对话工作台 内置业务数据(赋范科技)
// 真实产品结构(Onyx 三栏 / kotaemon 引用高亮 / AnythingLLM 工作区 / GraphRAG-Local-UI 图谱证据)。

export type Rag = "doc" | "relation" | "compile";

export type KB = { id: string; name: string; type: Rag; desc: string; count: string };

export const knowledgeBases: KB[] = [
  { id: "kb-doc", name: "制度与流程库", type: "doc", desc: "制度、合同、报告、表格等正式文档", count: "128 篇" },
  { id: "kb-rel", name: "客户与关系库", type: "relation", desc: "客户、项目、合同、关键人的关联", count: "64 个对象" },
  { id: "kb-wiki", name: "团队知识库", type: "compile", desc: "沉淀的经验与主题知识条目", count: "36 条" }
];

export type EvChunk = { kind: "chunk"; title: string; snippet: string; score: number; doc: string };
export type EvChain = { kind: "chain"; items: string[] };
export type EvGraph = {
  kind: "graph";
  nodes: { id: string; label: string; x: number; y: number; core?: boolean }[];
  edges: { a: string; b: string; label: string }[];
};
export type EvNote = { kind: "note"; title: string; meta: string };
export type EvEntry = { kind: "entry"; title: string; meta: string };
export type Evidence = EvChunk | EvChain | EvGraph | EvNote | EvEntry;

export type ChatAction = {
  id: string;
  label: string;
  taskId: string;
  description: string;
};

export type Answer = {
  text: string; // 含 [n] 行内引用
  rag: Rag;
  kb: string;
  evidence: Evidence[];
  action?: string; // 兼容旧 UI：超出问答的下一步(如 整理成综述)
  actions?: ChatAction[];
};

export type TaskStepStatus = "done" | "active" | "pending";
export type TaskStep = {
  id: string;
  title: string;
  description: string;
  status: TaskStepStatus;
};

export type TaskArtifact = {
  title: string;
  kind: string;
  summary: string;
  sections: string[];
};

export type TaskCanvas = {
  id: string;
  title: string;
  scenarioName: string;
  status: "draft" | "running" | "needs_input" | "ready";
  sourceQuestion: string;
  actionLabel: string;
  inputs: { label: string; value: string }[];
  evidence: { label: string; detail: string }[];
  steps: TaskStep[];
  artifact: TaskArtifact;
  followUps: string[];
};

export type Starter = { label: string; q: string };
export const starters: Starter[] = [
  { label: "制度问答", q: "差旅报销标准是多少？" },
  { label: "客户关系", q: "赋范科技值不值得续约？" },
  { label: "经验沉淀", q: "怎么做检索效果调优？" },
  { label: "主题综述", q: "整理一份医疗行业客户复购的综述" }
];

export type Agent = { id: string; name: string; desc: string; kbs: string[]; starters: Starter[] };
export const agents: Agent[] = [
  {
    id: "all",
    name: "公司大脑",
    desc: "全部知识库 · 通用问答",
    kbs: ["kb-doc", "kb-rel", "kb-wiki"],
    starters
  },
  {
    id: "sales",
    name: "销售助手",
    desc: "客户关系库 · 续约 / 尽调 / 洞察",
    kbs: ["kb-rel"],
    starters: [
      { label: "续约判断", q: "赋范科技值不值得续约？" },
      { label: "客户洞察", q: "恒生医疗的复购机会怎么样？" }
    ]
  },
  {
    id: "policy",
    name: "制度助手",
    desc: "制度与流程库 · 制度 / 报销 / 合同",
    kbs: ["kb-doc"],
    starters: [
      { label: "制度问答", q: "差旅报销标准是多少？" },
      { label: "合同条款", q: "框架合同的付款节奏是怎样的？" }
    ]
  },
  {
    id: "research",
    name: "研究助手",
    desc: "团队知识库 · 综述 / 经验沉淀",
    kbs: ["kb-wiki"],
    starters: [
      { label: "经验沉淀", q: "怎么做检索效果调优？" },
      { label: "主题综述", q: "整理一份医疗行业客户复购的综述" }
    ]
  }
];

export type Session = { id: string; title: string; when: string; q: string };
export const sessions: Session[] = [
  { id: "s1", title: "赋范科技续约风险", when: "今天", q: "赋范科技值不值得续约？" },
  { id: "s2", title: "差旅报销标准", when: "今天", q: "差旅报销标准是多少？" },
  { id: "s3", title: "检索效果调优经验", when: "昨天", q: "怎么做检索效果调优？" },
  { id: "s4", title: "医疗行业客户复购", when: "06-21", q: "整理一份医疗行业客户复购的综述" }
];

export const taskCanvases: TaskCanvas[] = [
  {
    id: "renewal-brief",
    title: "续约风险简报",
    scenarioName: "客户 360 / 关系风险尽调",
    status: "draft",
    sourceQuestion: "赋范科技值不值得续约？",
    actionLabel: "生成续约风险简报",
    inputs: [
      { label: "客户对象", value: "赋范科技" },
      { label: "会议目标", value: "续约推进" },
      { label: "输出对象", value: "销售负责人 + 客户成功" }
    ],
    evidence: [
      { label: "关系链", detail: "赋范科技 - 框架合同 ¥120 万 - 张磊 - 王皓 CTO" },
      { label: "风险信号", detail: "近 14 天无互动，续签窗口剩约 3 周" },
      { label: "机会信号", detail: "王皓近期公开提到扩建数据团队" }
    ],
    steps: [
      { id: "confirm", title: "确认对象", description: "锁定客户、目标会议和输出接收人。", status: "done" },
      { id: "evidence", title: "收集证据", description: "汇总合同、互动、关键人和项目关系依据。", status: "done" },
      { id: "draft", title: "生成草稿", description: "生成可分享的风险简报和下一步动作。", status: "active" },
      { id: "save", title: "保存成品", description: "保存到任务中心，并可沉淀为团队场景。", status: "pending" }
    ],
    artifact: {
      title: "赋范科技续约风险简报",
      kind: "客户简报",
      summary: "续约风险偏高，但存在扩容机会。建议本周由张磊触达 CTO 王皓，以二期扩容方案作为续签抓手。",
      sections: ["结论", "风险信号", "机会信号", "关系链依据", "下一步行动"]
    },
    followUps: ["把语气改成给销售总监看的版本", "补充近 30 天互动记录", "沉淀为团队续约风险场景"]
  },
  {
    id: "policy-answer",
    title: "制度答复",
    scenarioName: "制度政策证据问答",
    status: "ready",
    sourceQuestion: "差旅报销标准是多少？",
    actionLabel: "整理成制度答复",
    inputs: [
      { label: "适用对象", value: "全体员工" },
      { label: "答复口径", value: "可转发给提问员工" }
    ],
    evidence: [
      { label: "制度来源", detail: "《差旅与报销制度 v3》第 4 条" },
      { label: "操作来源", detail: "报销操作指引.pdf 第 2 页" }
    ],
    steps: [
      { id: "confirm", title: "确认对象", description: "确认员工问题和适用制度。", status: "done" },
      { id: "evidence", title: "收集证据", description: "引用制度条款和操作指引。", status: "done" },
      { id: "draft", title: "生成草稿", description: "整理成可转发答复。", status: "done" },
      { id: "save", title: "保存成品", description: "保存到任务中心。", status: "active" }
    ],
    artifact: {
      title: "差旅报销标准答复",
      kind: "制度答复",
      summary: "一线城市住宿不超过 ¥500/晚，市内交通凭实报销；超出标准需部门负责人在 OA 审批。",
      sections: ["答复结论", "适用标准", "审批例外", "制度依据"]
    },
    followUps: ["改成 HR 公告口径", "补充三线城市标准", "分享给财务群"]
  },
  {
    id: "research-brief",
    title: "主题综述",
    scenarioName: "资料到知识手册",
    status: "draft",
    sourceQuestion: "整理一份医疗行业客户复购的综述",
    actionLabel: "打开完整综述",
    inputs: [
      { label: "主题", value: "医疗行业客户复购" },
      { label: "受众", value: "销售团队" }
    ],
    evidence: [
      { label: "知识条目", detail: "医疗行业客户复购驱动因素" },
      { label: "客户案例", detail: "恒生医疗 / 仁和药业客户档案" }
    ],
    steps: [
      { id: "confirm", title: "确认对象", description: "确认主题和读者。", status: "done" },
      { id: "evidence", title: "收集证据", description: "汇总客户档案和团队知识条目。", status: "done" },
      { id: "draft", title: "生成草稿", description: "生成带引用的综述草稿。", status: "active" },
      { id: "save", title: "保存成品", description: "保存到任务中心和知识空间。", status: "pending" }
    ],
    artifact: {
      title: "医疗行业客户复购综述",
      kind: "主题综述",
      summary: "复购主要由一期满意度、决策人主动性和合规背书三类信号驱动。",
      sections: ["核心结论", "驱动因素", "标杆案例", "可复用话术"]
    },
    followUps: ["改成新人学习手册", "加入竞品比较", "保存为知识条目"]
  }
];

export function taskForAction(taskId: string): TaskCanvas | undefined {
  return taskCanvases.find((task) => task.id === taskId);
}

const ANSWERS: { match: string[]; answer: Answer }[] = [
  {
    match: ["报销", "差旅", "住宿", "交通", "标准"],
    answer: {
      rag: "doc",
      kb: "kb-doc",
      text:
        "一线城市住宿不超过 ¥500/晚，市内交通凭实报销[1]；单次单程超过 ¥80、或住宿超标的，需由部门负责人在 OA 审批[2]。",
      action: "整理成制度答复",
      actions: [
        {
          id: "act-policy-answer",
          label: "整理成制度答复",
          taskId: "policy-answer",
          description: "把答案整理成可转发给员工的标准口径。"
        }
      ],
      evidence: [
        { kind: "chunk", title: "《差旅与报销制度 v3》第 4 条 · 第 2 段", snippet: "市内交通凭实报销，单次单程不超过 80 元；一线城市住宿标准不超过 500 元/晚……", score: 0.92, doc: "差旅与报销制度 v3" },
        { kind: "chunk", title: "报销操作指引.pdf · 第 2 页", snippet: "超出标准的部分，需部门负责人在 OA 系统中走审批流程后方可报销……", score: 0.86, doc: "报销操作指引" }
      ]
    }
  },
  {
    match: ["赋范", "续约", "续签", "客户", "风险", "尽调", "值不值"],
    answer: {
      rag: "relation",
      kb: "kb-rel",
      text:
        "续约风险偏高。赋范科技 2024 年度框架续签 ¥120 万仍在谈，但近 14 天无互动、决策窗口仅剩约 3 周[1]；不过关键决策人 CTO 王皓近期公开提到要扩建数据团队，是明确的扩容机会[2]。建议本周由张磊直接触达王皓推进，并以二期扩容方案作为抓手[3]。",
      action: "生成完整尽调简报",
      actions: [
        {
          id: "act-renewal-brief",
          label: "生成续约风险简报",
          taskId: "renewal-brief",
          description: "把当前答案扩展成销售可分享的续约判断材料。"
        }
      ],
      evidence: [
        {
          kind: "graph",
          nodes: [
            { id: "ff", label: "赋范科技", x: 130, y: 90, core: true },
            { id: "zl", label: "张磊", x: 40, y: 34 },
            { id: "wh", label: "王皓·CTO", x: 232, y: 36 },
            { id: "a", label: "A 项目", x: 36, y: 150 },
            { id: "ct", label: "框架¥120万", x: 236, y: 148 }
          ],
          edges: [
            { a: "ff", b: "zl", label: "负责" },
            { a: "ff", b: "wh", label: "决策人" },
            { a: "ff", b: "a", label: "关联" },
            { a: "ff", b: "ct", label: "在谈" }
          ]
        },
        { kind: "chain", items: ["赋范科技 —续签— 框架合同(¥120万)", "赋范科技 —负责— 张磊", "赋范科技 —关键人— 王皓(CTO)"] },
        { kind: "note", title: "互动时间线 · 近 14 天无互动", meta: "信号 · 续签窗口剩约 3 周" }
      ]
    }
  },
  {
    match: ["调优", "切分", "检索效果", "粒度", "经验"],
    answer: {
      rag: "compile",
      kb: "kb-wiki",
      text:
        "团队沉淀的经验条目给出三条原则：先按语义边界切分、再把单段控制在可独立理解的长度[1]，最后用真实业务问题回测并微调粒度[2]。可在该条目上继续追问，或一键整理成一篇带引用的综述。",
      action: "整理成主题综述",
      actions: [
        {
          id: "act-research-brief",
          label: "整理成主题综述",
          taskId: "research-brief",
          description: "把经验问答扩展成带引用的团队知识条目。"
        }
      ],
      evidence: [
        { kind: "entry", title: "知识条目：检索效果调优 · 团队经验", meta: "团队知识库 · 溯源 4 份原始资料" },
        { kind: "entry", title: "A 项目复盘纪要", meta: "实践来源 · 可浏览" }
      ]
    }
  },
  {
    match: ["医疗", "复购", "综述", "整理"],
    answer: {
      rag: "compile",
      kb: "kb-wiki",
      text:
        "已为你整理「医疗行业客户复购」综述要点：复购主要由「一期满意度 + 决策人主动性 + 合规背书」三要素驱动[1]；恒生医疗一期 NPS 9 分后主动推进多院区复购，可作标杆案例反哺仁和药业[2]。点右侧可展开完整综述与引用。",
      action: "打开完整综述",
      actions: [
        {
          id: "act-research-brief",
          label: "打开完整综述",
          taskId: "research-brief",
          description: "进入任务画布继续改写、保存或沉淀为知识条目。"
        }
      ],
      evidence: [
        { kind: "entry", title: "综述草稿：医疗行业客户复购驱动因素", meta: "团队知识库 · 自动编译 · 6 处引用" },
        { kind: "note", title: "恒生医疗 / 仁和药业 客户档案", meta: "关系 + 团队知识库" }
      ]
    }
  }
];

export function answerFor(q: string): Answer {
  const t = q.trim();
  for (const a of ANSWERS) {
    if (a.match.some((m) => t.includes(m))) return a.answer;
  }
  // fallback: 文档型通用
  return {
    rag: "doc",
    kb: "kb-doc",
    text: `已跨已挂载的知识库检索「${t}」，并核对依据后作答[1]。如果想要一份成稿(简报/综述)，可在右侧选择对应动作。`,
    evidence: [{ kind: "chunk", title: "命中资料 · 最相关片段", snippet: "系统从已挂载知识库中检索到与该问题最相关的资料片段，并据此作答……", score: 0.78, doc: "知识库" }]
  };
}

export const ragMeta: Record<Rag, { label: string; c: string; soft: string }> = {
  doc: { label: "文档资料库", c: "var(--c-document)", soft: "var(--c-document-soft)" },
  relation: { label: "关系知识库", c: "var(--c-relation)", soft: "var(--c-relation-soft)" },
  compile: { label: "个人知识库", c: "var(--c-personal)", soft: "var(--c-personal-soft)" }
};
