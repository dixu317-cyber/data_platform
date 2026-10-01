import { Hono } from 'hono';
import { ensureDefaultPrivateSource } from '../../core/sources';
import { internalRoute } from '../route';
import { toPublicSource } from '../serializers';

export const internalRouter = new Hono();

internalRouter.post(
  '/internal/users/default-source',
  internalRoute('初始化 Nano Brain 用户失败', async (c, ctx) => {
    const source = await ensureDefaultPrivateSource({ userId: ctx.userId, username: ctx.username });
    return c.json({ source: toPublicSource(source) });
  }),
);
