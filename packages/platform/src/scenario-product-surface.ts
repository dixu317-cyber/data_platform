import { officialTemplates, type ScenarioTemplate, type TemplateProductForm } from "./frontstage";

export type ScenarioProductSurfaceKind = Exclude<TemplateProductForm, "chat" | "hybrid"> | "chat" | "hybrid";

export type ScenarioProductSurface = {
  kind: ScenarioProductSurfaceKind;
  label: string;
  headline: string;
  description: string;
  workspaceTitle: string;
  contextPanelTitle: string;
  rightRailMode: "sources" | "document" | "graph" | "widget" | "tasks" | "report";
  primaryAction: {
    label: string;
    prompt: string;
  };
  secondaryActions: Array<{
    label: string;
    prompt: string;
  }>;
  quickPrompts: string[];
  emptyState: string;
};

const surfaceCopy: Record<ScenarioProductSurfaceKind, Omit<ScenarioProductSurface, "kind" | "label">> = {
  embedded_assistant: {
    headline: "把知识发布成可嵌入业务入口的智能助手。",
    description: "适合客服、售后、帮助中心等单入口场景，核心不是连续聊天，而是回答问题、识别知识缺口并触发转人工。",
    workspaceTitle: "客服代理工作台",
    contextPanelTitle: "命中知识与转人工",
    rightRailMode: "widget",
    primaryAction: { label: "打开客服代理", prompt: "输入一个真实客户咨询，给出答复、引用依据和是否需要转人工。" },
    secondaryActions: [
      { label: "检查知识缺口", prompt: "分析当前资料里哪些高频问题还缺少可回答依据。" },
      { label: "生成转人工规则", prompt: "根据当前知识库生成需要转人工的边界和话术。" }
    ],
    quickPrompts: ["客户说订单延迟三天，应该怎么回复？", "哪些问题应该转人工？", "当前帮助中心还缺哪些知识？"],
    emptyState: "发布后可以在这里验证网页助手、拒答边界、引用依据和转人工规则。"
  },
  document_review: {
    headline: "在文档旁边完成审阅、风险识别和修改建议。",
    description: "适合合同、制度、投标问卷、安全问卷等文档密集型场景，界面应该围绕文件、条款、证据和待确认项组织。",
    workspaceTitle: "文档审阅工作台",
    contextPanelTitle: "条款与原文依据",
    rightRailMode: "document",
    primaryAction: { label: "开始审阅文档", prompt: "列出高风险条款并给出修改建议。" },
    secondaryActions: [
      { label: "生成审阅清单", prompt: "按风险等级生成审阅清单，并标出每条依据。" },
      { label: "找缺失条款", prompt: "检查当前文档缺少哪些关键条款和合规说明。" }
    ],
    quickPrompts: ["列出高风险条款并给出修改建议。", "哪些条款需要法务复核？", "把审阅结论整理成可发给业务的摘要。"],
    emptyState: "发布后可以围绕原文片段做审阅、批注、风险清单和报告草稿。"
  },
  graph_explorer: {
    headline: "围绕对象、关系、事件和证据链做图谱分析。",
    description: "适合客户关系、供应商风险、尽调、垂域对象关系等场景，界面要突出关系路径、证据强度和风险解释。",
    workspaceTitle: "关系分析工作台",
    contextPanelTitle: "关系与证据",
    rightRailMode: "graph",
    primaryAction: { label: "打开关系分析", prompt: "围绕当前对象梳理关键关系、风险路径和证据来源。" },
    secondaryActions: [
      { label: "生成风险路径", prompt: "找出当前资料中最需要关注的关系链和风险事件。" },
      { label: "输出尽调摘要", prompt: "把关系分析结果整理成尽调摘要和待确认问题。" }
    ],
    quickPrompts: ["这家客户当前的关键关系和风险是什么？", "哪些关系需要人工确认？", "生成一份关系风险摘要。"],
    emptyState: "发布后可以在这里查看关系线索、风险路径、证据链和可追问解释。"
  },
  report_generator: {
    headline: "把多源资料组织成业务简报、报告和下一步行动。",
    description: "适合客户 360、经营分析、研究报告和会议纪要，核心产物是结构化结论、来源依据和可执行行动。",
    workspaceTitle: "业务简报工作台",
    contextPanelTitle: "简报依据",
    rightRailMode: "report",
    primaryAction: { label: "生成业务简报", prompt: "生成一份结构化业务简报，包含结论、风险、机会、依据和下一步建议。" },
    secondaryActions: [
      { label: "提炼风险机会", prompt: "只提炼当前资料里的风险信号、机会信号和下一步行动。" },
      { label: "生成分享版", prompt: "把结论整理成可以分享给团队的简洁版本。" }
    ],
    quickPrompts: ["生成一份业务简报。", "当前最大的风险和机会是什么？", "给出下一步行动建议。"],
    emptyState: "发布后可以在这里生成简报、报告草稿、经营分析和行动建议。"
  },
  task_workflow: {
    headline: "把知识转成可跟踪的流程、行动项和处理任务。",
    description: "适合运维排障、会议行动项、团队手册和服务流程，界面要突出步骤、负责人、状态和升级路径。",
    workspaceTitle: "流程任务工作台",
    contextPanelTitle: "步骤与行动项",
    rightRailMode: "tasks",
    primaryAction: { label: "生成任务清单", prompt: "把当前资料整理成可执行步骤、负责人建议和升级路径。" },
    secondaryActions: [
      { label: "查看升级路径", prompt: "当前流程遇到异常时应该如何升级处理？" },
      { label: "沉淀行动项", prompt: "从当前资料中提取行动项、负责人和截止时间。" }
    ],
    quickPrompts: ["生成可执行任务清单。", "异常时应该如何升级？", "提取负责人和截止时间。"],
    emptyState: "发布后可以在这里生成步骤、行动项、升级路径和任务复盘。"
  },
  knowledge_portal: {
    headline: "把资料沉淀成可浏览、可检索、可追问的知识门户。",
    description: "适合个人 Wiki、团队手册、研究指南和知识库，界面要突出目录、主题、来源和复用入口。",
    workspaceTitle: "知识门户工作台",
    contextPanelTitle: "目录与来源",
    rightRailMode: "sources",
    primaryAction: { label: "浏览知识目录", prompt: "把当前知识库整理成主题目录，并给出每个主题的摘要。" },
    secondaryActions: [
      { label: "按主题提问", prompt: "按当前资料主题回答一个可追溯问题。" },
      { label: "生成知识摘要", prompt: "把当前知识空间整理成一页摘要。" }
    ],
    quickPrompts: ["把当前知识库整理成主题目录。", "这个知识空间里最重要的内容是什么？", "生成一份学习摘要。"],
    emptyState: "发布后可以在这里浏览目录、按主题检索、追问来源和生成知识摘要。"
  },
  chat: {
    headline: "围绕特定知识范围进行可追溯多轮问答。",
    description: "适合确实以问答为主的制度、流程和 FAQ 场景，但仍然要展示来源、权限和可沉淀产物。",
    workspaceTitle: "场景问答工作台",
    contextPanelTitle: "问答依据",
    rightRailMode: "sources",
    primaryAction: { label: "开始提问", prompt: "基于当前场景资料回答这个问题，并给出来源依据。" },
    secondaryActions: [
      { label: "追问依据", prompt: "解释这条回答分别来自哪些资料。" },
      { label: "保存答案", prompt: "把本轮答案整理成可复用的知识条目。" }
    ],
    quickPrompts: ["基于当前场景资料回答这个问题。", "给出来源依据。", "把答案整理成可复用条目。"],
    emptyState: "发布后可以在这里做多轮问答、溯源和答案沉淀。"
  },
  hybrid: {
    headline: "组合文档证据、关系图谱和知识门户的复合业务工作台。",
    description: "适合同时需要检索、图谱、报告和流程的复杂场景，界面按当前模板的主业务目标组织。",
    workspaceTitle: "复合业务工作台",
    contextPanelTitle: "混合依据",
    rightRailMode: "report",
    primaryAction: { label: "生成综合结论", prompt: "并行检索文档证据、关系图谱和知识百科，生成综合结论和来源依据。" },
    secondaryActions: [
      { label: "拆分证据类型", prompt: "按文档证据、关系图谱和知识百科拆分本轮依据。" },
      { label: "沉淀业务场景", prompt: "判断这个问题适合沉淀成什么业务场景。" }
    ],
    quickPrompts: ["生成综合结论和依据。", "按证据类型拆分来源。", "推荐可以沉淀的业务场景。"],
    emptyState: "发布后可以组合多种知识形态，生成综合结论、报告和业务动作。"
  }
};

export function buildScenarioProductSurface(templateId: string, templateOverride?: Pick<ScenarioTemplate, "productForm">): ScenarioProductSurface {
  const template = templateOverride ?? officialTemplates.find((item) => item.id === templateId);
  const kind = choosePrimarySurface(template?.productForm ?? []);
  return {
    kind,
    label: scenarioProductFormLabel(kind),
    ...surfaceCopy[kind]
  };
}

export function choosePrimarySurface(productForms: TemplateProductForm[]): ScenarioProductSurfaceKind {
  for (const item of productForms) {
    if (item in surfaceCopy) return item;
  }
  return "hybrid";
}

export function scenarioProductFormLabel(kind: ScenarioProductSurfaceKind): string {
  const labels: Record<ScenarioProductSurfaceKind, string> = {
    embedded_assistant: "嵌入式业务助手",
    document_review: "文档审阅工作台",
    graph_explorer: "关系分析工作台",
    report_generator: "业务简报工作台",
    task_workflow: "流程任务工作台",
    knowledge_portal: "知识门户",
    chat: "场景问答",
    hybrid: "复合业务工作台"
  };
  return labels[kind];
}
