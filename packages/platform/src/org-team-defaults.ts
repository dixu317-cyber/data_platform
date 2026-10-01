// P36b T1（gateway org/team resolver 硬前置）：web `mapApiUser` 与 gateway `resolveStoreUser`
// 共用的默认 org/team 规则，消除此前两处硬编码 org_companybrain / platform-admin / default-team
// 各自维护导致的漂移风险。真 identity（packages/identity）尚无组织/团队字段，这里只提供统一默认值；
// 一旦真 identity 补上 org/team，调用方应优先用真实值，只在缺失时回落到这里。
export function defaultOrgTeamFor(isAdmin: boolean): { organizationId: string; teamIds: string[] } {
  return {
    organizationId: "org_companybrain",
    teamIds: isAdmin ? ["platform-admin"] : ["default-team"],
  };
}
