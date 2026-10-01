import type { PlatformSnapshot } from "../components/app/platform-live";
import type { WorkspaceProfile } from "@ff/platform/frontstage";

export type WorkspaceRole = "member" | "admin" | "owner";

export type WorkspaceSettingRow = {
  label: string;
  value: string;
  status: "已启用" | "需管理员配置" | "建议复核";
};

export type WorkspaceSettingsModel = {
  identityRows: WorkspaceSettingRow[];
  permissionRows: WorkspaceSettingRow[];
  connectorRows: WorkspaceSettingRow[];
  auditRows: WorkspaceSettingRow[];
};

export function normalizeWorkspaceRole(role?: string): WorkspaceRole {
  if (role === "admin") return "admin";
  if (role === "owner") return "owner";
  return "member";
}

export function roleDisplayName(role: WorkspaceRole) {
  if (role === "owner") return "空间所有者";
  if (role === "admin") return "后台管理员";
  return "业务成员";
}

export function buildWorkspaceSettingsModel(input: {
  profile: WorkspaceProfile;
  role?: string;
  snapshot: PlatformSnapshot;
}): WorkspaceSettingsModel {
  const role = normalizeWorkspaceRole(input.role);
  const companyKnowledge = input.snapshot.knowledge.filter((item) => item.visibility === "company").length;
  const teamKnowledge = input.snapshot.knowledge.filter((item) => item.visibility === "team").length;
  const privateKnowledge = input.snapshot.knowledge.filter((item) => item.visibility === "private").length;
  const pendingTasks = input.snapshot.tasks.filter((task) => task.status !== "ready" && task.status !== "failed").length;

  return {
    identityRows: [
      { label: "当前组织", value: input.profile.organizationName, status: "已启用" },
      { label: "工作空间", value: input.profile.workspaceName, status: "已启用" },
      { label: "当前身份", value: roleDisplayName(role), status: role === "member" ? "建议复核" : "已启用" }
    ],
    permissionRows: [
      { label: "个人知识", value: `${privateKnowledge} 个资产，仅创建者可召回`, status: "已启用" },
      { label: "团队知识", value: `${teamKnowledge} 个资产，团队内可召回`, status: teamKnowledge > 0 ? "已启用" : "建议复核" },
      { label: "公司知识", value: `${companyKnowledge} 个资产，进入全域问答`, status: companyKnowledge > 0 ? "已启用" : "建议复核" }
    ],
    connectorRows: [
      { label: "文件上传", value: "PDF、Word、Markdown、表格、图片和音视频", status: "已启用" },
      { label: "业务系统连接器", value: "CRM、工单、会议和文档库接入", status: "需管理员配置" },
      { label: "模型与解析服务", value: "模型、Embedding、文档解析和多模态处理", status: "需管理员配置" }
    ],
    auditRows: [
      { label: "待处理任务", value: `${pendingTasks} 个资料处理或复核任务`, status: pendingTasks > 0 ? "建议复核" : "已启用" },
      { label: "业务场景", value: `${input.snapshot.scenarios.length} 个已创建场景`, status: "已启用" },
      { label: "知识资产", value: `${input.snapshot.knowledge.length} 个可见资产`, status: "已启用" }
    ]
  };
}
