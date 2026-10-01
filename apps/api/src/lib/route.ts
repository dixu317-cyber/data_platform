import type { Context } from 'hono';
import type { UserContext } from '@ff/contracts';
import { getRequiredUser, isResponse } from './auth';
import { handleError } from './errors';

// 受保护路由包装器：先校验身份，再执行处理器，并统一捕获异常。
// 消除每个路由重复的"鉴权 + try/catch + 错误映射"样板。
export function protectedRoute(
  fallbackMessage: string,
  handler: (c: Context, ctx: UserContext) => Promise<Response>,
) {
  return async (c: Context): Promise<Response> => {
    const ctx = await getRequiredUser(c);
    if (isResponse(ctx)) return ctx;
    try {
      return await handler(c, ctx);
    } catch (error) {
      return handleError(c, error, fallbackMessage);
    }
  };
}
