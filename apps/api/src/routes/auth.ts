import { Hono } from 'hono';
import {
  createUser,
  IdentityError,
  listRegistrationTeams,
  login,
  revokeBearerSession,
} from '@ff/identity';
import { initializeModuleUser } from '@ff/gateway';
import { getBearerToken } from '../lib/auth';
import { protectedRoute } from '../lib/route';
import { handleError } from '../lib/errors';
import { toPublicUser } from '../lib/serializers';

// 认证与用户路由。
export const authRouter = new Hono();

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseRegisterBody(value: unknown): {
  username: string;
  password: string;
  teamId?: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IdentityError('注册请求体必须是 JSON 对象', 'invalid_input');
  }
  for (const field of ['organization_id', 'team_ids', 'is_admin']) {
    if (hasOwn(value, field)) {
      throw new IdentityError(`注册请求不允许字段 ${field}`, 'invalid_input');
    }
  }

  const body = value as Record<string, unknown>;
  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    throw new IdentityError('用户名和密码必须是字符串', 'invalid_input');
  }
  if (
    body.team_id !== undefined
    && body.team_id !== null
    && typeof body.team_id !== 'string'
  ) {
    throw new IdentityError('team_id 必须是字符串', 'invalid_input');
  }
  const teamId =
    typeof body.team_id === 'string' && body.team_id.trim()
      ? body.team_id.trim()
      : undefined;
  return { username: body.username, password: body.password, teamId };
}

authRouter.get('/auth/registration-teams', async (c) => {
  try {
    return c.json({ teams: await listRegistrationTeams() });
  } catch (error) {
    return handleError(c, error, '读取注册团队失败');
  }
});

authRouter.post('/auth/register', async (c) => {
  try {
    const rawBody = await c.req.json().catch(() => {
      throw new IdentityError('注册请求体必须是有效 JSON', 'invalid_input');
    });
    const body = parseRegisterBody(rawBody);
    const user = await createUser({
      username: body.username,
      password: body.password,
      isAdmin: false,
      teamId: body.teamId,
    });
    const userContext = {
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      organizationId: user.organizationId,
      teamIds: user.teamIds,
    };
    await initializeModuleUser('nano-brain', userContext);
    await initializeModuleUser('traditional-rag', userContext);
    return c.json({ user: toPublicUser(user) }, 201);
  } catch (error) {
    return handleError(c, error, '注册失败');
  }
});

authRouter.post('/auth/login', async (c) => {
  try {
    const body = await c.req.json();
    const result = await login({ username: body.username, password: body.password });
    return c.json({ token: result.token, token_type: 'Bearer', user: toPublicUser(result.user) });
  } catch (error) {
    return handleError(c, error, '登录失败');
  }
});

authRouter.get(
  '/auth/me',
  protectedRoute('读取用户失败', async (c, ctx) =>
    c.json({
      user: {
        id: ctx.userId,
        username: ctx.username,
        is_admin: ctx.isAdmin,
        organization_id: ctx.organizationId,
        team_ids: ctx.teamIds,
      },
    }),
  ),
);

authRouter.post(
  '/auth/logout',
  protectedRoute('退出登录失败', async (c) => {
    const token = getBearerToken(c.req.header('authorization'));
    // protectedRoute 已拒绝缺失或无效 bearer；这里重新读取只为把 DELETE
    // 精确绑定到刚刚通过认证的当前凭据，而不是按 user 批量删除 session。
    if (!token || !(await revokeBearerSession(token))) {
      return c.json({ error: 'unauthorized', message: '未登录或登录已过期' }, 401);
    }
    return c.json({ ok: true });
  }),
);
