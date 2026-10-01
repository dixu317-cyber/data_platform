import type { User } from "./api";
import type { PlatformSnapshot } from "../components/app/platform-live";

const organizationLabels: Record<string, string> = {
  "org-main": "赋范企业组织",
  org_companybrain: "赋范企业组织"
};

const teamLabels: Record<string, string> = {
  sales: "销售团队",
  product: "产品团队",
  "default-team": "默认团队",
  "platform-admin": "平台管理员"
};

export type AccountPermissionViewModel = {
  identity: {
    username: string;
    displayName: string;
    organizationId: string;
    organizationLabel: string;
    teamIds: string[];
    teamLabels: string[];
    role: "member" | "admin";
    roleLabel: "业务成员" | "后台管理员";
  };
  knowledgeCounts: {
    private: number;
    team: number;
    company: number;
  };
  links: Array<{
    id: "knowledge" | "tasks" | "admin";
    href: string;
    visible: boolean;
  }>;
};

/**
 * Builds the account page from the authenticated identity and its already
 * permission-filtered snapshot. It deliberately has no workspace-profile
 * fallback: identity data is owned by the authentication boundary.
 */
export function buildAccountPermissionViewModel(input: {
  user: User;
  snapshot: PlatformSnapshot;
}): AccountPermissionViewModel {
  const teamIds = Array.from(new Set(input.user.team_ids)).sort();
  const role = input.user.is_admin ? "admin" : "member";

  return {
    identity: {
      username: input.user.username,
      displayName: input.user.display_name?.trim() || input.user.username,
      organizationId: input.user.organization_id,
      organizationLabel: organizationLabels[input.user.organization_id] ?? input.user.organization_id,
      teamIds,
      teamLabels: teamIds.map((id) => teamLabels[id] ?? id),
      role,
      roleLabel: role === "admin" ? "后台管理员" : "业务成员"
    },
    knowledgeCounts: {
      private: input.snapshot.knowledge.filter((item) => item.visibility === "private").length,
      team: input.snapshot.knowledge.filter((item) => item.visibility === "team").length,
      company: input.snapshot.knowledge.filter((item) => item.visibility === "company").length
    },
    links: [
      { id: "knowledge", href: "/app/knowledge", visible: true },
      { id: "tasks", href: "/app/tasks", visible: true },
      { id: "admin", href: "/admin", visible: input.user.is_admin }
    ]
  };
}
