import { Hono } from 'hono';
import { graphQuery, listBacklinks, listOutgoingLinks } from '../../core/links';
import { internalRoute } from '../route';
import { toPublicLink } from '../serializers';

export const graphRouter = new Hono();

graphRouter.get(
  '/nano/links',
  internalRoute('读取链接失败', async (c, ctx) => {
    const sourceId = c.req.query('source_id');
    const slug = c.req.query('slug');
    if (!sourceId || !slug) {
      return c.json({ error: 'invalid_input', message: 'source_id 和 slug 不能为空' }, 400);
    }
    const links = await listOutgoingLinks(ctx, { sourceId, slug, linkType: c.req.query('link_type') });
    return c.json({ links: links.map(toPublicLink) });
  }),
);

graphRouter.get(
  '/nano/links/:sourceId/:slug',
  internalRoute('读取链接失败', async (c, ctx) => {
    const links = await listOutgoingLinks(ctx, {
      sourceId: c.req.param('sourceId')!,
      slug: c.req.param('slug')!,
      linkType: c.req.query('link_type'),
    });
    return c.json({ links: links.map(toPublicLink) });
  }),
);

graphRouter.get(
  '/nano/backlinks',
  internalRoute('读取反向链接失败', async (c, ctx) => {
    const slug = c.req.query('slug');
    if (!slug) {
      return c.json({ error: 'invalid_input', message: 'slug 不能为空' }, 400);
    }
    const links = await listBacklinks(ctx, { slug, linkType: c.req.query('link_type') });
    return c.json({ links: links.map(toPublicLink) });
  }),
);

graphRouter.get(
  '/nano/backlinks/:slug',
  internalRoute('读取反向链接失败', async (c, ctx) => {
    const links = await listBacklinks(ctx, { slug: c.req.param('slug')!, linkType: c.req.query('link_type') });
    return c.json({ links: links.map(toPublicLink) });
  }),
);

graphRouter.post(
  '/nano/graph/query',
  internalRoute('查询知识图谱失败', async (c, ctx) => {
    const body = await c.req.json();
    const result = await graphQuery(ctx, {
      slug: body.slug,
      depth: body.depth,
      direction: body.direction,
      linkType: body.link_type,
    });
    return c.json({
      root_slug: result.rootSlug,
      depth: result.depth,
      direction: result.direction,
      nodes: result.nodes,
      links: result.links.map(toPublicLink),
    });
  }),
);
