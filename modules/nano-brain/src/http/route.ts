import type { Context } from 'hono';
import type { UserContext } from '@ff/contracts';
import { requireInternalUser } from './auth';
import { handleModuleHttpError } from './errors';

export function internalRoute(
  fallbackMessage: string,
  handler: (c: Context, ctx: UserContext) => Promise<Response>,
) {
  return async (c: Context): Promise<Response> => {
    try {
      const ctx = requireInternalUser(c);
      return await handler(c, ctx);
    } catch (error) {
      return handleModuleHttpError(c, error, fallbackMessage);
    }
  };
}
