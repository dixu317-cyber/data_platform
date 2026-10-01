import type { Context } from 'hono';
import type { UserContext } from '@ff/contracts';
import { getUserByBearerToken } from '@ff/identity';

// 从 Authorization 头解析 Bearer Token。
export function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

export function toUserContext(user: {
  id: string;
  username: string;
  isAdmin: boolean;
  organizationId: string;
  teamIds: string[];
}): UserContext {
  return {
    userId: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    organizationId: user.organizationId,
    teamIds: user.teamIds,
  };
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

// 校验请求身份：成功返回 UserContext，失败返回 401 响应。
export async function getRequiredUser(c: Context): Promise<UserContext | Response> {
  const token = getBearerToken(c.req.header('authorization'));
  if (!token) {
    return c.json({ error: 'unauthorized', message: '缺少 Bearer Token' }, 401);
  }
  const user = await getUserByBearerToken(token);
  if (!user) {
    return c.json({ error: 'unauthorized', message: '未登录或登录已过期' }, 401);
  }
  return toUserContext(user);
}
