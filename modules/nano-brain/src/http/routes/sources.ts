import { Hono } from 'hono';
import { createPublicSource, getReadableSource, listReadableSources, updateSourceName } from '../../core/sources';
import { internalRoute } from '../route';
import { toPublicSource } from '../serializers';

export const sourcesRouter = new Hono();

sourcesRouter.get(
  '/nano/sources',
  internalRoute('读取 source 列表失败', async (c, ctx) => {
    const sources = await listReadableSources(ctx);
    return c.json({ sources: sources.map(toPublicSource) });
  }),
);

sourcesRouter.post(
  '/nano/sources',
  internalRoute('创建 source 失败', async (c, ctx) => {
    const body = await c.req.json();
    const source = await createPublicSource(ctx, { name: body.name });
    return c.json({ source: toPublicSource(source) }, 201);
  }),
);

sourcesRouter.get(
  '/nano/sources/:sourceId',
  internalRoute('读取 source 失败', async (c, ctx) => {
    const source = await getReadableSource(ctx, c.req.param('sourceId')!);
    return c.json({ source: toPublicSource(source) });
  }),
);

sourcesRouter.patch(
  '/nano/sources/:sourceId',
  internalRoute('更新 source 失败', async (c, ctx) => {
    const body = await c.req.json();
    const source = await updateSourceName(ctx, c.req.param('sourceId')!, { name: body.name });
    return c.json({ source: toPublicSource(source) });
  }),
);
