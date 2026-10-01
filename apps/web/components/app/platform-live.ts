import type { KnowledgeSpaceObject, ProcessingTask, ScenarioInstance, Visibility } from "@ff/platform/frontstage";

export type AdminEngine = "Gbrain" | "Naive RAG" | "GraphRAG";

export type LiveScenarioRecord = {
  id: string;
  templateId: string;
  name: string;
  description: string;
  visibility: Visibility;
  ownerName: string;
  status: ScenarioInstance["status"];
  sourceCount: number;
  processingGoal: string;
  updatedAt: string;
};

export type LiveKnowledgeRecord = {
  id: string;
  scenarioId: string;
  title: string;
  content: string;
  visibility: Visibility;
  ownerName: string;
  ragEngine: AdminEngine;
  sourceOriginalName: string;
  createdAt: string;
};

export type PlatformSnapshot = {
  scenarios: LiveScenarioRecord[];
  tasks: ProcessingTask[];
  knowledge: LiveKnowledgeRecord[];
};

export type PlatformSnapshotMetrics = {
  scenarioCount: number;
  readyScenarioCount: number;
  pendingTaskCount: number;
  readyKnowledgeCount: number;
};

export function toScenarioInstance(record: LiveScenarioRecord): ScenarioInstance {
  return {
    id: record.id,
    templateId: record.templateId,
    name: record.name,
    description: record.description || record.processingGoal || "这个场景正在等待后台确认资料和入库策略。",
    owner: record.ownerName,
    visibility: record.visibility,
    status: record.status,
    sourceCount: record.sourceCount,
    updatedAt: displayTime(record.updatedAt),
    readyActions: actionsForScenarioStatus(record.status),
    recommendedQuestions: recommendedQuestionsForScenario(record)
  };
}

export function toKnowledgeSpaceObject(record: LiveKnowledgeRecord): KnowledgeSpaceObject {
  return {
    id: record.id,
    mode: modeForEngine(record.ragEngine),
    title: record.title,
    summary: record.content.replace(/\s+/g, " ").trim().slice(0, 180) || "后台已完成入库，但当前知识对象没有可展示摘要。",
    sourceLabel: record.sourceOriginalName,
    linkedScenarioId: record.scenarioId,
    visibility: record.visibility,
    owner: record.ownerName,
    permissionNote: permissionNote(record.visibility, record.ownerName),
    updatedAt: displayTime(record.createdAt),
    actions: ["打开场景", "查看来源", "申请更新"]
  };
}

export function computePlatformSnapshotMetrics(snapshot: PlatformSnapshot): PlatformSnapshotMetrics {
  return {
    scenarioCount: snapshot.scenarios.length,
    readyScenarioCount: snapshot.scenarios.filter((scenario) => scenario.status === "ready").length,
    pendingTaskCount: snapshot.tasks.filter((task) => task.status !== "ready" && task.status !== "failed").length,
    readyKnowledgeCount: snapshot.knowledge.length
  };
}

export function sortScenariosByStatusAndTime(records: LiveScenarioRecord[]) {
  const rank: Record<LiveScenarioRecord["status"], number> = {
    ready: 0,
    processing: 1,
    waiting_review: 2,
    submitted: 3,
    failed: 4,
    draft: 5
  };
  return [...records].sort((a, b) => {
    const rankDiff = rank[a.status] - rank[b.status];
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function modeForEngine(engine: AdminEngine): KnowledgeSpaceObject["mode"] {
  if (engine === "Naive RAG") return "document";
  if (engine === "GraphRAG") return "relationship";
  return "wiki";
}

function actionsForScenarioStatus(status: ScenarioInstance["status"]) {
  if (status === "ready") return ["直接提问", "查看资料", "生成业务成品"];
  if (status === "failed") return ["查看退回原因", "补充资料", "重新提交"];
  return ["查看处理进度", "补充资料", "等待后台发布"];
}

function recommendedQuestionsForScenario(record: LiveScenarioRecord) {
  const subject = record.name || "这个场景";
  if (record.status === "ready") {
    return [
      `${subject}里最关键的信息是什么？`,
      `${subject}有哪些风险和机会？`,
      `基于${subject}生成一份业务摘要。`
    ];
  }
  return [
    `${subject}当前处理到哪一步？`,
    `${subject}还需要补充什么资料？`,
    `${subject}发布后可以解决什么问题？`
  ];
}

function permissionNote(visibility: Visibility, ownerName: string) {
  if (visibility === "private") return `仅创建者 ${ownerName} 可见，不会被团队或公司级场景召回。`;
  if (visibility === "team") return "仅同团队成员可见，不会自动进入公司级知识空间。";
  return "公司范围可见，必须经过管理员发布后才能被全局问答召回。";
}

function displayTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value || "刚刚";
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Date(value).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
