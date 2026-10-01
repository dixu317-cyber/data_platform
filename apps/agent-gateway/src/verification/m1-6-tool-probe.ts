import { requireUserByBearerToken } from '@ff/identity';
import type { GlobalChatScope, StoreUser } from '@ff/platform/platform-store';
import { buildGlobalKnowledgeTool } from '../agent/global-knowledge-tool';

const token = process.env.M1_6_PROBE_TOKEN?.trim();
const query = process.env.M1_6_PROBE_QUERY?.trim();
const scope = process.env.M1_6_PROBE_SCOPE?.trim();

if (!token || !query || !['private', 'team', 'company'].includes(scope ?? '')) {
  throw new Error('M1_6_PROBE_TOKEN, M1_6_PROBE_QUERY and a valid M1_6_PROBE_SCOPE are required');
}

const identity = await requireUserByBearerToken(token);
const user: StoreUser = {
  userId: identity.id,
  name: identity.username,
  role: identity.isAdmin ? 'admin' : 'member',
  organizationId: identity.organizationId,
  teamIds: identity.teamIds,
};
const tool = buildGlobalKnowledgeTool({
  user,
  scope: scope as GlobalChatScope,
  routingQuery: query,
});
const raw = await tool.invoke({ query } as any);
let results: Array<{ scenario?: string }> = [];
try {
  const parsed = JSON.parse(String(raw));
  if (Array.isArray(parsed)) results = parsed;
} catch {
  // The no-hit result is intentionally a plain-language string.
}

console.log(`M1_6_TOOL_PROBE=${JSON.stringify({
  hit: results.length > 0,
  scenarios: results.map(({ scenario }) => scenario).filter(Boolean),
})}`);
