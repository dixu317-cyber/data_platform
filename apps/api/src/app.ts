import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { systemRouter } from './routes/system';
import { authRouter } from './routes/auth';
import { nanoRouter } from './routes/nano';
import { ragRouter } from './routes/rag';

// 组装统一 HTTP API：挂载中间件与各领域路由。
// 各路由自带完整路径前缀，统一挂在根上即可保持路径不变。
export function createApp(): Hono {
  const app = new Hono();

  app.use('*', cors());

  app.route('/', systemRouter);
  app.route('/', authRouter);
  app.route('/', nanoRouter);
  app.route('/', ragRouter);

  return app;
}
