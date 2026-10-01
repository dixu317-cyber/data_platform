import { listScenarioTemplates } from "./templates";

export type AdminTemplateGovernance = {
  id: string;
  name: string;
  owner: string;
  templateState: "official" | "candidate" | "experimental" | "custom" | "paused" | "archived";
  evidenceCoverage: number;
  evidenceSources: string[];
  productForms: string[];
  limitations: string[];
  demoReadiness: number;
  demoScenarioName: string;
  sampleQuestion: string;
  defaultStrategyProfileId: string;
  reviewPolicy: "none" | "sample" | "required";
  acceptedInputs: string[];
  publishState: "published" | "reviewing" | "paused";
  impact: string;
};

export type StrategyProfile = {
  id: string;
  name: string;
  scope: "traditional-rag" | "graph-rag" | "nano-brain" | "company-brain";
  description: string;
  controls: string[];
  status: "active" | "draft" | "archived";
};

export type AdminSummary = {
  area: "templates" | "knowledge_bases" | "strategies" | "pipelines" | "graph" | "evaluations" | "settings" | "audit";
  label: string;
  status: "healthy" | "watch" | "blocked";
  count: number;
};

export type AdminGraphSnapshot = {
  nodes: Array<{ id: string; label: string; type: string; health: "good" | "watch" | "risk" }>;
  edges: Array<{ id: string; source: string; target: string; label: string; confidence: number; evidence: string }>;
  filters: {
    entityTypes: string[];
    relationTypes: string[];
    confidenceThreshold: number;
  };
};

export type AdminAuditEvent = {
  id: string;
  actor: string;
  area: string;
  summary: string;
  impact: string;
  time: string;
};

export function buildAdminTemplateGovernance(): AdminTemplateGovernance[] {
  return listScenarioTemplates().map((template, index) => ({
    id: template.id,
    name: template.name,
    owner: ownerFor(template.id),
    templateState: template.state,
    evidenceCoverage: template.evidenceSources.length >= 2 ? 100 : 60,
    evidenceSources: template.evidenceSources,
    productForms: template.productForms,
    limitations: template.limitations,
    demoReadiness: template.demoWalkthrough.sampleInputs.length >= 2 && template.demoWalkthrough.citations.length >= 2 ? 100 : 55,
    demoScenarioName: template.demoWalkthrough.scenarioName,
    sampleQuestion: template.demoWalkthrough.sampleQuestion,
    defaultStrategyProfileId: defaultStrategyFor(template.id),
    reviewPolicy: template.needsAdminReview ? "required" : index % 3 === 0 ? "none" : "sample",
    acceptedInputs: template.requiredInputs,
    publishState: "published",
    impact: template.outputCapabilities.join(" / ")
  }));
}

export function buildStrategyProfiles(): StrategyProfile[] {
  return [
    profile("traditional-evidence-first", "证据优先", "traditional-rag", "正式文档优先，回答必须带来源。", ["引用严格", "正式文档优先", "结果 8 条"], "active"),
    profile("graph-risk-expansion", "关系风险扩展", "graph-rag", "从目标对象向合同、供应商、人员和风险事件扩展。", ["最大 3 跳", "低置信标记", "证据必需"], "active"),
    profile("nano-wiki-navigation", "知识页导航", "nano-brain", "优先浏览已整理页面和可信事实。", ["页面深度 2", "互链导航", "事实优先"], "active"),
    profile("company-strict-evidence", "严格证据答复", "company-brain", "无依据则拒答或提示缺资料。", ["高置信门槛", "无依据拒答", "引用优先"], "active")
  ];
}

export function buildAdminOperationSummary(): AdminSummary[] {
  return [
    { area: "templates", label: "模板治理", status: "healthy", count: listScenarioTemplates().length },
    { area: "knowledge_bases", label: "知识库资产", status: "healthy", count: 38 },
    { area: "strategies", label: "检索策略", status: "healthy", count: 12 },
    { area: "pipelines", label: "处理管线", status: "watch", count: 7 },
    { area: "graph", label: "关系图谱", status: "watch", count: 1 },
    { area: "evaluations", label: "质量评估", status: "healthy", count: 24 },
    { area: "settings", label: "系统接入", status: "watch", count: 5 },
    { area: "audit", label: "审计记录", status: "healthy", count: 96 }
  ];
}

export function buildAdminGraphSnapshot(): AdminGraphSnapshot {
  return {
    nodes: [
      { id: "ff", label: "赋范科技", type: "客户", health: "watch" },
      { id: "zl", label: "张磊", type: "负责人", health: "good" },
      { id: "wh", label: "王皓 CTO", type: "关键人", health: "good" },
      { id: "contract-main", label: "年度框架合同", type: "合同", health: "watch" },
      { id: "expansion", label: "二期扩容", type: "机会", health: "good" },
      { id: "risk-gap", label: "互动停滞", type: "风险", health: "risk" }
    ],
    edges: [
      edge("ff", "zl", "负责人", 0.86, "客户关系表"),
      edge("ff", "wh", "关键决策人", 0.91, "会议纪要"),
      edge("ff", "contract-main", "续签中", 0.88, "合同记录"),
      edge("contract-main", "expansion", "绑定增购", 0.81, "销售机会表"),
      edge("ff", "risk-gap", "存在风险", 0.76, "互动时间线"),
      edge("wh", "expansion", "推动", 0.72, "公开信号")
    ],
    filters: {
      entityTypes: ["客户", "人员", "合同", "机会", "风险"],
      relationTypes: ["负责人", "关键决策人", "续签中", "绑定增购", "存在风险"],
      confidenceThreshold: 0.7
    }
  };
}

export function buildAdminAuditEvents(): AdminAuditEvent[] {
  return [
    audit("admin@muyu.ai", "模板治理", "发布客户 360 分析模板", "前台可创建客户分析场景"),
    audit("ops@muyu.ai", "检索策略", "启用严格证据答复", "高风险问题必须保留引用"),
    audit("qa@muyu.ai", "质量验证", "完成客服策略对比验证", "客服模板继续使用证据优先策略"),
    audit("risk@muyu.ai", "关系图谱", "调整风险关系阈值", "低置信关系进入人工复核"),
    audit("system@muyu.ai", "处理管线", "重试安全问卷处理任务", "问卷答案包重新生成")
  ];
}

function profile(id: StrategyProfile["id"], name: string, scope: StrategyProfile["scope"], description: string, controls: string[], status: StrategyProfile["status"]): StrategyProfile {
  return { id, name, scope, description, controls, status };
}

function edge(source: string, target: string, label: string, confidence: number, evidence: string) {
  return { id: `${source}-${target}-${label}`, source, target, label, confidence, evidence };
}

function audit(actor: string, area: string, summary: string, impact: string): AdminAuditEvent {
  return { id: `${area}-${summary}`, actor, area, summary, impact, time: "2026-06-25 10:30" };
}

function ownerFor(id: string): string {
  if (id.includes("customer") || id.includes("rfp")) return "销售运营";
  if (id.includes("support")) return "客户成功";
  if (id.includes("risk") || id.includes("domain")) return "风控";
  if (id.includes("contract")) return "法务";
  return "知识运营";
}

function defaultStrategyFor(id: string): string {
  if (id.includes("risk") || id.includes("domain") || id.includes("customer")) return "graph-risk-expansion";
  if (id.includes("wiki") || id.includes("handbook") || id.includes("research")) return "nano-wiki-navigation";
  if (id.includes("support")) return "company-strict-evidence";
  return "traditional-evidence-first";
}
