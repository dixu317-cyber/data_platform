import { serve } from '@hono/node-server';
import { assertInternalTokenValid } from '@ff/contracts';
import { createApp } from './app';

// A5：监听前校验，占位/空/过短 RAG_INTERNAL_TOKEN 直接拒绝启动（不限 FF_DEPLOY_MODE）。
assertInternalTokenValid(process.env.RAG_INTERNAL_TOKEN);

// 进程入口：创建 app 并启动 HTTP 服务。
const app = createApp();
const port = Number(process.env.API_PORT ?? 3001);

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });

console.log(`FF-CompanyBrain API listening on http://0.0.0.0:${port}`);
