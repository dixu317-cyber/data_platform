import { Hono } from 'hono';
import { listPageChunks } from '../../core/chunks';
import { archivePage, getPage, listPages, putMarkdownPage } from '../../core/pages';
import { internalRoute } from '../route';
import { toPublicChunk, toPublicPage } from '../serializers';

export const pagesRouter = new Hono();

pagesRouter.post(
  '/nano/pages',
  internalRoute('写入页面失败', async (c, ctx) => {
    const body = await c.req.json();
    const page = await putMarkdownPage(ctx, {
      sourceId: body.source_id,
      slug: body.slug,
      title: body.title,
      body: body.body,
      contentType: body.content_type,
    });
    return c.json({ page: toPublicPage(page) }, 201);
  }),
);

pagesRouter.get(
  '/nano/sources/:sourceId/pages',
  internalRoute('读取页面列表失败', async (c, ctx) => {
    const pages = await listPages(ctx, { sourceId: c.req.param('sourceId')! });
    return c.json({ pages: pages.map(toPublicPage) });
  }),
);

pagesRouter.get(
  '/nano/pages/:sourceId/:slug',
  internalRoute('读取页面失败', async (c, ctx) => {
    const page = await getPage(ctx, { sourceId: c.req.param('sourceId')!, slug: c.req.param('slug')! });
    return c.json({ page: toPublicPage(page) });
  }),
);

pagesRouter.put(
  '/nano/pages/:sourceId/:slug',
  internalRoute('更新页面失败', async (c, ctx) => {
    const body = await c.req.json();
    const page = await putMarkdownPage(ctx, {
      sourceId: c.req.param('sourceId')!,
      slug: c.req.param('slug')!,
      title: body.title,
      body: body.body,
      contentType: body.content_type,
    });
    return c.json({ page: toPublicPage(page) });
  }),
);

pagesRouter.delete(
  '/nano/pages/:sourceId/:slug',
  internalRoute('归档页面失败', async (c, ctx) => {
    const page = await archivePage(ctx, { sourceId: c.req.param('sourceId')!, slug: c.req.param('slug')! });
    return c.json({ page: toPublicPage(page), archived: true });
  }),
);

pagesRouter.get(
  '/nano/pages/:sourceId/:slug/chunks',
  internalRoute('读取 chunk 失败', async (c, ctx) => {
    const chunks = await listPageChunks(ctx, { sourceId: c.req.param('sourceId')!, slug: c.req.param('slug')! });
    return c.json({ chunks: chunks.map(toPublicChunk) });
  }),
);
