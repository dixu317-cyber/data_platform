import { Hono } from 'hono';
import type { ModuleId } from '@ff/contracts';
import { callModuleJson } from '@ff/gateway';
import { protectedRoute } from '../lib/route';

export const ragRouter = new Hono();

async function readOptionalModuleBody(c: any): Promise<{ body?: unknown; rawBody?: ArrayBuffer; contentType?: string }> {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return {};
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    return { rawBody: await c.req.arrayBuffer(), contentType };
  }
  return { body: await c.req.json().catch(() => undefined) };
}

function proxyModule(moduleId: ModuleId, fallbackMessage: string) {
  return protectedRoute(fallbackMessage, async (c, ctx) => {
    const url = new URL(c.req.url);
    const moduleBody = await readOptionalModuleBody(c);
    const response = await callModuleJson(moduleId, {
      method: c.req.method,
      path: c.req.path,
      queryString: url.search,
      ...moduleBody,
      user: ctx,
    });
    return c.json(response.body, response.status as any);
  });
}

// Python RAG services reserve their own HTTP namespace behind the unified API.
ragRouter.all('/traditional/*', proxyModule('traditional-rag', 'Traditional RAG 模块调用失败'));
ragRouter.all('/graph/*', proxyModule('graph-rag', 'GraphRAG 模块调用失败'));
