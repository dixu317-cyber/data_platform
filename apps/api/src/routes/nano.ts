import { Hono } from 'hono';
import { callModuleJson } from '@ff/gateway';
import { protectedRoute } from '../lib/route';

// Nano Brain 统一代理路由。
// apps/api 只负责平台鉴权与 UserContext 注入，具体业务由 modules/nano-brain 的 HTTP 服务处理。
export const nanoRouter = new Hono();

async function readOptionalJsonBody(c: any): Promise<unknown> {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;
  return c.req.json().catch(() => undefined);
}

nanoRouter.all(
  '/nano/*',
  protectedRoute('Nano Brain 模块调用失败', async (c, ctx) => {
    const url = new URL(c.req.url);
    const response = await callModuleJson('nano-brain', {
      method: c.req.method,
      path: c.req.path === '/nano/health' ? '/health' : c.req.path,
      queryString: url.search,
      body: await readOptionalJsonBody(c),
      user: ctx,
    });
    return c.json(response.body, response.status as any);
  }),
);
