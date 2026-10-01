import { Hono } from 'hono';
import { captureContent } from '../../core/capture';
import { internalRoute } from '../route';
import { toPublicPage, toPublicSource } from '../serializers';

export const captureRouter = new Hono();

captureRouter.post(
  '/nano/capture',
  internalRoute('Capture 内容失败', async (c, ctx) => {
    const body = await c.req.json();
    const result = await captureContent(ctx, {
      text: body.text,
      markdown: body.markdown,
      title: body.title,
      target: body.target,
      sourceId: body.source_id,
      slug: body.slug,
      format: body.format,
    });
    return c.json(
      {
        capture: {
          target: result.target,
          format: result.format,
        },
        source: toPublicSource(result.source),
        page: toPublicPage(result.page),
      },
      201,
    );
  }),
);
