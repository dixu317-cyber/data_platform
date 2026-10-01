import type { KnowledgeSpaceObject, Visibility } from "@ff/platform/frontstage";

export type KnowledgeAssetScope = "all" | Visibility;
export type KnowledgeAssetKind = KnowledgeSpaceObject["mode"];
export type KnowledgeAssetKindFilter = "all" | KnowledgeAssetKind;

export type KnowledgeAssetFilters = {
  scope: KnowledgeAssetScope;
  kind: KnowledgeAssetKindFilter;
  query: string;
};

export type KnowledgeAssetStats = {
  total: number;
  private: number;
  team: number;
  company: number;
  wiki: number;
  document: number;
  relationship: number;
  artifact: number;
};

export const knowledgeAssetScopes: Array<{ id: KnowledgeAssetScope; label: string; description: string }> = [
  { id: "all", label: "全部权限", description: "查看当前账号可见的个人、团队和公司知识。" },
  { id: "private", label: "个人知识", description: "只允许创建者本人和后台管理员召回。" },
  { id: "team", label: "团队知识", description: "仅团队成员可在业务场景中使用。" },
  { id: "company", label: "公司知识", description: "通过发布复核后进入全域问答。" }
];

export const knowledgeAssetKinds: Array<{ id: KnowledgeAssetKindFilter; label: string; description: string }> = [
  { id: "all", label: "全部类型", description: "统一查看所有可召回知识资产。" },
  { id: "document", label: "文档证据", description: "PDF、Word、表格、制度和合同原文证据。" },
  { id: "relationship", label: "关系图谱", description: "客户、人员、供应商、事件和风险关系。" },
  { id: "wiki", label: "知识百科", description: "沉淀后的 Wiki、手册、事实卡和复用结论。" },
  { id: "artifact", label: "业务产物", description: "报告、纪要、审阅结果和可下载成品。" }
];

export function knowledgeModeLabel(mode: KnowledgeAssetKind) {
  const labels: Record<KnowledgeAssetKind, string> = {
    wiki: "知识百科",
    document: "文档证据",
    relationship: "关系图谱",
    artifact: "业务产物"
  };
  return labels[mode];
}

export function knowledgeVisibilityLabel(visibility: Visibility) {
  const labels: Record<Visibility, string> = {
    private: "仅自己可用",
    team: "团队内可用",
    company: "公司级知识"
  };
  return labels[visibility];
}

export function buildKnowledgeAssetStats(objects: KnowledgeSpaceObject[]): KnowledgeAssetStats {
  return objects.reduce<KnowledgeAssetStats>((stats, object) => {
    stats.total += 1;
    stats[object.visibility] += 1;
    stats[object.mode] += 1;
    return stats;
  }, { total: 0, private: 0, team: 0, company: 0, wiki: 0, document: 0, relationship: 0, artifact: 0 });
}

export function filterKnowledgeAssets(objects: KnowledgeSpaceObject[], filters: KnowledgeAssetFilters) {
  const query = filters.query.trim().toLowerCase();
  return objects.filter((object) => {
    if (filters.scope !== "all" && object.visibility !== filters.scope) return false;
    if (filters.kind !== "all" && object.mode !== filters.kind) return false;
    if (!query) return true;
    return [object.title, object.summary, object.sourceLabel, object.owner, knowledgeModeLabel(object.mode), knowledgeVisibilityLabel(object.visibility)]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

export function knowledgeGovernanceActions(object: KnowledgeSpaceObject) {
  const actions = ["查看场景", "查看来源", "申请更新"];
  if (object.visibility === "private") return [...actions, "申请团队共享"];
  if (object.visibility === "team") return [...actions, "申请公司发布"];
  return [...actions, "查看召回范围"];
}

export function knowledgeAssetRiskNote(object: KnowledgeSpaceObject) {
  if (object.visibility === "private") return "个人知识不会被团队或公司级场景召回，适合草稿、个人资料和未发布资料。";
  if (object.visibility === "team") return "团队知识只在团队场景中召回，发布到公司级前需要负责人确认资料边界。";
  return "公司级知识可被全域问答检索，需要保留来源、复核记录和可追溯引用。";
}
