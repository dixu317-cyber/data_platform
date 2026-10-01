import type { Context } from 'hono';
import { IdentityError } from '@ff/identity';
import { GatewayError } from '@ff/gateway';

// 把平台层错误映射为 HTTP 状态码与响应体。
// 模块领域错误由模块 HTTP 服务自行映射，apps/api 仅透传 gateway 返回的 JSON。

export function identityErrorResponse(error: IdentityError) {
  const status =
    error.code === 'username_taken'
      ? 409
      : error.code === 'invalid_credentials'
        ? 401
        : error.code === 'data_integrity'
          ? 500
          : 400;
  return { status, body: { error: error.code, message: error.message } };
}

export function gatewayErrorResponse(error: GatewayError) {
  return { status: error.status, body: { error: error.code, message: error.message } };
}

// 统一异常处理：已知平台错误按映射返回，未知错误打日志并返回 500。
export function handleError(c: Context, error: unknown, fallbackMessage: string): Response {
  if (error instanceof IdentityError) {
    const response = identityErrorResponse(error);
    return c.json(response.body, response.status as any);
  }
  if (error instanceof GatewayError) {
    const response = gatewayErrorResponse(error);
    return c.json(response.body, response.status as any);
  }
  console.error(error);
  return c.json({ error: 'internal_error', message: fallbackMessage }, 500);
}
