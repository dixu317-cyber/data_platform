import type { UserContext } from '@ff/contracts';
import type { StoreUser } from '@ff/platform/platform-store';

export type TrustedUserContext = UserContext & {
  organizationId: string;
  teamIds: string[];
};

export class AgentIdentityIntegrityError extends Error {
  constructor() {
    super('Agent 身份归属数据不完整');
    this.name = 'AgentIdentityIntegrityError';
  }
}

export function normalizeTrustedUserContext(user: UserContext): TrustedUserContext {
  const userId = typeof user.userId === 'string' ? user.userId.trim() : '';
  const username = typeof user.username === 'string' ? user.username.trim() : '';
  const organizationId =
    typeof user.organizationId === 'string' ? user.organizationId.trim() : '';
  if (
    !userId
    || !organizationId
    || typeof user.isAdmin !== 'boolean'
    || !Array.isArray(user.teamIds)
    || !user.teamIds.every((teamId) => typeof teamId === 'string')
  ) {
    throw new AgentIdentityIntegrityError();
  }
  const teamIds = Array.from(
    new Set(user.teamIds.map((teamId) => teamId.trim()).filter(Boolean)),
  );
  if (teamIds.length === 0) {
    throw new AgentIdentityIntegrityError();
  }
  return {
    userId,
    username: username || userId,
    isAdmin: user.isAdmin,
    organizationId,
    teamIds,
  };
}

// Identity DB 是组织/团队归属的唯一真相源；缺失归属属于数据完整性错误，不得在 Agent 运行时补默认值。
export function resolveStoreUser(user: UserContext): StoreUser {
  const trusted = normalizeTrustedUserContext(user);
  return {
    userId: trusted.userId,
    name: trusted.username,
    role: trusted.isAdmin ? 'admin' : 'member',
    organizationId: trusted.organizationId,
    teamIds: trusted.teamIds,
  };
}
