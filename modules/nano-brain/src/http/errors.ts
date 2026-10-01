import type { Context } from 'hono';
import { NanoBrainError } from '../core/sources';
import { NanoBrainPermissionError } from '../core/permissions';
import { ModuleHttpAuthError } from './auth';

export function nanoErrorResponse(error: NanoBrainError | NanoBrainPermissionError) {
  if (error instanceof NanoBrainPermissionError) {
    return { status: 403, body: { error: 'forbidden', message: error.message } };
  }
  const status = error.code === 'not_found' ? 404 : error.code === 'duplicate_source' ? 409 : 400;
  return { status, body: { error: error.code, message: error.message } };
}

export function handleModuleHttpError(c: Context, error: unknown, fallbackMessage: string): Response {
  if (error instanceof ModuleHttpAuthError) {
    return c.json({ error: 'unauthorized', message: error.message }, error.status as any);
  }
  if (error instanceof NanoBrainError || error instanceof NanoBrainPermissionError) {
    const response = nanoErrorResponse(error);
    return c.json(response.body, response.status as any);
  }
  console.error(error);
  return c.json({ error: 'internal_error', message: fallbackMessage }, 500);
}
