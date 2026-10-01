import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function createBearerToken(): string {
  return `ff_${randomUUID()}_${randomBytes(32).toString('base64url')}`;
}

export function hashBearerToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function getSessionExpiry(ttlSeconds = DEFAULT_SESSION_TTL_SECONDS): Date {
  return new Date(Date.now() + ttlSeconds * 1000);
}
