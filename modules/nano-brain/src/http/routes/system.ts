import { Hono } from 'hono';

export const systemRouter = new Hono();

systemRouter.get('/health', (c) => c.json({ status: 'ok', service: 'nano-brain' }));
