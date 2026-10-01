// 进阶消费形态数据:原文阅读器(doc) / 图谱探索(relation) / Pages综述(compile)

/* ---------------- 原文阅读器(kotaemon/RAGFlow 形态) ---------------- */
export type DocPara = { t: string; hi?: boolean };
export type DocBody = { title: string; meta: string; paras: DocPara[] };

export const docBodies: Record<string, DocBody> = {
  "差旅与报销制度 v3": {
    title: "差旅与报销制度 v3",
    meta: "制度与流程库 · 第 4 条 · 第 2 段",
    paras: [
      { t: "第 4 条 差旅费用标准" },
      { t: "4.1 交通：因公出差应优先选择经济舱、二等座；里程超过 800 公里可乘坐飞机。" },
      { t: "4.2 市内交通凭实报销，单次单程不超过 80 元；一线城市住宿标准不超过 500 元/晚，二线城市不超过 350 元/晚。", hi: true },
      { t: "4.3 餐补按出差自然日计发，每人每日 100 元，不再另行报销正餐发票。" },
      { t: "第 5 条 审批流程" },
      { t: "5.1 超出第 4 条标准的费用，需由部门负责人在 OA 系统中审批通过后方可报销。" }
    ]
  },
  "报销操作指引": {
    title: "报销操作指引.pdf",
    meta: "制度与流程库 · 第 2 页",
    paras: [
      { t: "二、报销提交流程" },
      { t: "1）在 OA「费用报销」中新建单据，按费用类型逐项录入并上传发票影像。" },
      { t: "2）超出标准的部分，需部门负责人在 OA 系统中走审批流程后方可报销。", hi: true },
      { t: "3）财务复核通过后，款项于次月 15 日前打入工资卡。" }
    ]
  }
};

/* ---------------- 图谱探索(GraphRAG-Local-UI 形态:2D 图谱 + global/local/direct) ---------------- */
export type GNode = { id: string; label: string; cluster: string; x: number; y: number; core?: boolean };
export type GEdge = { a: string; b: string; label: string };

export const explorer: { nodes: GNode[]; edges: GEdge[]; clusters: { id: string; name: string; color: string }[] } = {
  clusters: [
    { id: "east", name: "华东高潜客户", color: "#b5722a" },
    { id: "people", name: "团队成员", color: "#2e7d6b" },
    { id: "asset", name: "项目与合同", color: "#3e5c86" }
  ],
  nodes: [
    { id: "ff", label: "赋范科技", cluster: "east", x: 300, y: 220, core: true },
    { id: "yq", label: "云启网络", cluster: "east", x: 150, y: 120 },
    { id: "zd", label: "中大物流", cluster: "east", x: 130, y: 320 },
    { id: "zl", label: "张磊", cluster: "people", x: 360, y: 90 },
    { id: "ln", label: "李娜", cluster: "people", x: 470, y: 180 },
    { id: "wh", label: "王皓·CTO", cluster: "people", x: 470, y: 300 },
    { id: "a", label: "A 项目", cluster: "asset", x: 230, y: 360 },
    { id: "ct1", label: "框架合同 ¥120万", cluster: "asset", x: 440, y: 400 },
    { id: "ct2", label: "增购 ¥45万", cluster: "asset", x: 300, y: 420 }
  ],
  edges: [
    { a: "ff", b: "zl", label: "负责" },
    { a: "ff", b: "wh", label: "关键人" },
    { a: "ff", b: "a", label: "关联" },
    { a: "ff", b: "ct1", label: "在谈" },
    { a: "ff", b: "ct2", label: "在谈" },
    { a: "yq", b: "zl", label: "负责" },
    { a: "zd", b: "zl", label: "负责" },
    { a: "ln", b: "ff", label: "协作" },
    { a: "yq", b: "ff", label: "同集群" }
  ]
};

export const explorerModes = [
  { id: "global", name: "全局", desc: "看整批资料的主题与集群:华东高潜客户是本季度重心,张磊为关系枢纽(负责 3 家),关系最密集。" },
  { id: "local", name: "局部", desc: "聚焦赋范科技的直接邻域:负责人张磊、决策人王皓、关联 A 项目、两份在谈合同(¥120万+¥45万)。" },
  { id: "direct", name: "直答", desc: "直接事实:赋范科技的续签框架合同金额为 ¥120 万,当前状态在谈,负责人张磊。" }
];

/* ---------------- Pages / 自动综述(STORM/Co-STORM 形态) ---------------- */
export type PageSection = { id: string; heading: string; paras: { t: string; cites?: number[] }[] };
export type PageDoc = {
  id: string;
  kicker: string;
  title: string;
  lead: string;
  outline: PageSection[];
  sources: { n: number; title: string; meta: string }[];
  mind: { root: string; branches: { label: string; children: string[] }[] };
};

export const pages: Record<string, PageDoc> = {
  medical: {
    id: "medical",
    kicker: "主题综述 · 自动编译",
    title: "医疗行业客户复购驱动因素",
    lead: "本综述基于团队知识库与客户档案自动编译,梳理医疗行业客户的复购驱动因素,供销售与客户成功团队参考。",
    outline: [
      {
        id: "s1",
        heading: "一、复购的三大驱动",
        paras: [
          { t: "医疗行业客户的复购主要由「一期交付满意度 + 决策人主动性 + 合规背书」三要素共同驱动,三者缺一则复购周期显著拉长。", cites: [1] },
          { t: "其中一期满意度是前提:满意度高的客户更愿意主动发起下一期洽谈,而非被动等待销售推进。", cites: [2] }
        ]
      },
      {
        id: "s2",
        heading: "二、标杆案例:恒生医疗",
        paras: [
          { t: "恒生医疗一期 NPS 9 分,决策人刘芳主动询问多院区方案,二期复购 ¥220 万进入洽谈,是医疗行业的正向标杆。", cites: [2] },
          { t: "建议争取案例授权,作为同集群客户(如仁和药业)的合规背书,降低其决策顾虑。", cites: [3] }
        ]
      },
      {
        id: "s3",
        heading: "三、对销售动作的建议",
        paras: [
          { t: "对合规要求高、决策链长的客户(如仁和药业),以同行标杆案例 + 合规交付经验加速,由对应负责人牵线对标参访。", cites: [3] }
        ]
      }
    ],
    sources: [
      { n: 1, title: "知识条目:医疗客户成功经验", meta: "团队知识库 · 溯源 4 份资料" },
      { n: 2, title: "恒生医疗 · 客户档案与一期验收", meta: "关系 + 文档库 · NPS 9" },
      { n: 3, title: "仁和药业 · 客户档案", meta: "关系知识库" }
    ],
    mind: {
      root: "复购驱动",
      branches: [
        { label: "一期满意度", children: ["NPS", "主动洽谈"] },
        { label: "决策人主动性", children: ["刘芳", "多院区"] },
        { label: "合规背书", children: ["标杆案例", "对标参访"] }
      ]
    }
  },
  dd: {
    id: "dd",
    kicker: "尽调简报 · 自动编译",
    title: "赋范科技 · 客户尽调简报",
    lead: "本简报基于客户与关系库自动编译,聚焦赋范科技的续约风险与扩容机会,供本周跟进决策参考。",
    outline: [
      {
        id: "s1",
        heading: "一、结论",
        paras: [{ t: "续约风险偏高、扩容机会明确。建议本周由张磊直接触达 CTO 王皓,以二期扩容方案撬动 ¥120 万框架续签。", cites: [1] }]
      },
      {
        id: "s2",
        heading: "二、关键发现",
        paras: [
          { t: "框架续签 ¥120 万在谈,叠加数据模块增购 ¥45 万,两者绑定;但近 14 天无互动,窗口剩约 3 周。", cites: [1, 2] },
          { t: "CTO 王皓近期公开提到要扩建数据团队,扩容时机成熟。", cites: [3] }
        ]
      },
      {
        id: "s3",
        heading: "三、下一步",
        paras: [{ t: "① 本周约王皓带二期方案;② 以 POC 成果对齐其扩团队诉求;③ 增购并入续签一并推进。", cites: [] }]
      }
    ],
    sources: [
      { n: 1, title: "赋范科技 · 框架合同与关系链", meta: "关系知识库" },
      { n: 2, title: "互动时间线 · 近 14 天无互动", meta: "信号 · 窗口剩 3 周" },
      { n: 3, title: "客户档案:王皓(CTO)", meta: "关系知识库 · 公开信号" }
    ],
    mind: {
      root: "赋范科技",
      branches: [
        { label: "续约", children: ["¥120万", "窗口3周"] },
        { label: "扩容", children: ["二期方案", "王皓诉求"] },
        { label: "推进", children: ["张磊", "本周"] }
      ]
    }
  }
};
