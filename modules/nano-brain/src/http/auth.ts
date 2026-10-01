import type { Context } from 'hono';
import type { UserContext } from '@ff/contracts';

const INTERNAL_TOKEN_ENV = 'RAG_INTERNAL_TOKEN';

export class ModuleHttpAuthError extends Error {
  constructor(message: string, public readonly status = 401) {
    super(message);
    this.name = 'ModuleHttpAuthError';
  }
}

function requireHeader(c: Context, name: string): string {
  const value = c.req.header(name);
  if (!value) throw new ModuleHttpAuthError(`缺少内部用户上下文 header: ${name}`, 401);
  return value;
}

export function requireInternalUser(c: Context): UserContext {
  const expectedToken = process.env[INTERNAL_TOKEN_ENV];
  if (!expectedToken) {
    throw new ModuleHttpAuthError(`模块未配置 ${INTERNAL_TOKEN_ENV}`, 500);
  }
  if (process.env.FF_DEPLOY_MODE === "production" && expectedToken === "change-me-internal-token") {
    throw new ModuleHttpAuthError("RAG_INTERNAL_TOKEN 仍是出厂占位值，生产模式拒绝服务", 500);
  }
  const actualToken = c.req.header('x-ff-internal-token');
  if (!actualToken || actualToken !== expectedToken) {
    throw new ModuleHttpAuthError('内部调用 token 无效', 401);
  }

  return {
    userId: requireHeader(c, 'x-ff-user-id'),
    username: requireHeader(c, 'x-ff-username'),
    isAdmin: requireHeader(c, 'x-ff-is-admin') === 'true',
  };
}
