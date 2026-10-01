import path from 'node:path';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { UserContext } from '@ff/contracts';
import { buildPerUserMcpLaunchPlan } from '../sessions';

export const NANO_BRAIN_MCP_SERVER_NAME = 'nano';
export const TRADITIONAL_RAG_MCP_SERVER_NAME = 'traditional';
export const GRAPH_RAG_MCP_SERVER_NAME = process.env.GRAPH_RAG_MCP_SERVER_NAME ?? 'graph';

const USER_NANO_TOOLS = new Set([
  'nano_search',
  'nano_capture',
  'nano_run_my_source_dream',
  'nano_get_dream_status',
  'nano_get_dream_run',
  'nano_submit_fact',
  'nano_list_my_fact_submissions',
  'nano_get_fact_submission',
  'nano_list_facts',
  'nano_get_fact',
  'nano_get_entity_facts',
  'nano_get_page',
  'nano_get_links',
  'nano_get_backlinks',
  'nano_graph_query',
]);

const ADMIN_NANO_TOOLS = new Set([
  'nano_admin_run_dream',
  'nano_admin_list_fact_submissions',
  'nano_save_fact_candidates',
  'nano_admin_list_audit_logs',
]);

const HIGH_RISK_NANO_TOOLS = new Set([
  // M30 之前默认不暴露；后续必须加 confirmation token / 二次确认。
  'nano_admin_review_fact_submission',
]);

const TRADITIONAL_RAG_TOOLS = new Set([
  'traditional_search',
  'traditional_query_table',
  'traditional_get_document',
  'traditional_list_sources',
  'traditional_get_job',
]);

const GRAPH_RAG_TOOLS = new Set([
  'graph_search',
  'graph_list_sources',
  'graph_get_document',
]);

const GRAPH_RAG_MCP_TOOL_TIMEOUT_MS = Number(process.env.GRAPH_RAG_MCP_TOOL_TIMEOUT_MS ?? 300_000);

export class AgentMcpError extends Error {
  constructor(
    message: string,
    public readonly code: 'missing_config' | 'unsupported_module' | 'tool_load_failed' = 'tool_load_failed',
  ) {
    super(message);
    this.name = 'AgentMcpError';
  }
}

export type NanoBrainMcpToolPolicy = {
  includeAdminTools?: boolean;
  includeHighRiskTools?: boolean;
  allowedTools?: string[];
};

export type CompanyBrainMcpToolsSession = {
  client: MultiServerMCPClient;
  tools: StructuredToolInterface[];
  close: () => Promise<void>;
};

export type NanoBrainMcpToolsSession = CompanyBrainMcpToolsSession;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new AgentMcpError(`未配置 ${name}，无法启动 MCP`, 'missing_config');
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name];
}

function resolveRepoRoot(input?: { repoRoot?: string }): string {
  if (input?.repoRoot) return input.repoRoot;
  if (process.env.AGENT_REPO_ROOT) return process.env.AGENT_REPO_ROOT;
  const cwd = process.cwd();
  if (path.basename(cwd) === 'agent-gateway' && path.basename(path.dirname(cwd)) === 'apps') {
    return path.resolve(cwd, '../..');
  }
  return cwd;
}

function resolveBunCommand(): string {
  return process.env.BUN_PATH ?? (process.versions.bun ? process.execPath : 'bun');
}

function resolveUvCommand(): string {
  return process.env.UV_PATH ?? 'uv';
}

export function getAllowedNanoBrainMcpToolNames(input: {
  user: UserContext;
  policy?: NanoBrainMcpToolPolicy;
}): Set<string> {
  const allowed = new Set<string>(USER_NANO_TOOLS);
  if (input.user.isAdmin && input.policy?.includeAdminTools !== false) {
    for (const toolName of ADMIN_NANO_TOOLS) allowed.add(toolName);
  }
  if (input.user.isAdmin && input.policy?.includeHighRiskTools) {
    for (const toolName of HIGH_RISK_NANO_TOOLS) allowed.add(toolName);
  }
  if (input.policy?.allowedTools?.length) {
    const explicit = new Set(input.policy.allowedTools);
    for (const toolName of [...allowed]) {
      if (!explicit.has(toolName)) allowed.delete(toolName);
    }
  }
  return allowed;
}

export function getAllowedTraditionalRagMcpToolNames(): Set<string> {
  return new Set(TRADITIONAL_RAG_TOOLS);
}

export function getAllowedGraphRagMcpToolNames(): Set<string> {
  return new Set(GRAPH_RAG_TOOLS);
}

export function buildNanoBrainMcpEnv(input: { user: UserContext; bearerToken: string }): Record<string, string> {
  const plan = buildPerUserMcpLaunchPlan({
    user: input.user,
    bearerToken: input.bearerToken,
    activeModule: 'nano-brain',
  });

  return {
    PATH: optionalEnv('PATH') ?? '',
    HOME: optionalEnv('HOME') ?? '',
    NODE_ENV: optionalEnv('NODE_ENV') ?? 'test',
    IDENTITY_DATABASE_URL: requiredEnv('IDENTITY_DATABASE_URL'),
    NANO_BRAIN_DATABASE_URL: requiredEnv('NANO_BRAIN_DATABASE_URL'),
    RAG_INTERNAL_TOKEN: optionalEnv('RAG_INTERNAL_TOKEN') ?? '',
    EMBEDDING_PROVIDER: optionalEnv('EMBEDDING_PROVIDER') ?? '',
    EMBEDDING_BASE_URL: optionalEnv('EMBEDDING_BASE_URL') ?? '',
    EMBEDDING_API_KEY: optionalEnv('EMBEDDING_API_KEY') ?? '',
    EMBEDDING_MODEL: optionalEnv('EMBEDDING_MODEL') ?? '',
    ...plan.env,
  };
}

export function buildTraditionalRagMcpEnv(input: { user: UserContext; bearerToken: string }): Record<string, string> {
  const plan = buildPerUserMcpLaunchPlan({
    user: input.user,
    bearerToken: input.bearerToken,
    activeModule: 'traditional-rag',
  });

  return {
    PATH: optionalEnv('PATH') ?? '',
    HOME: optionalEnv('HOME') ?? '',
    TRADITIONAL_RAG_DATABASE_URL: requiredEnv('TRADITIONAL_RAG_DATABASE_URL'),
    TRADITIONAL_RAG_STORAGE_DIR: optionalEnv('TRADITIONAL_RAG_STORAGE_DIR') ?? '',
    RAG_INTERNAL_TOKEN: optionalEnv('RAG_INTERNAL_TOKEN') ?? '',
    EMBEDDING_PROVIDER: optionalEnv('EMBEDDING_PROVIDER') ?? '',
    EMBEDDING_BASE_URL: optionalEnv('EMBEDDING_BASE_URL') ?? '',
    EMBEDDING_API_KEY: optionalEnv('EMBEDDING_API_KEY') ?? '',
    EMBEDDING_MODEL: optionalEnv('EMBEDDING_MODEL') ?? '',
    ...plan.env,
  };
}

export function buildGraphRagMcpEnv(input: { user: UserContext; bearerToken: string }): Record<string, string> {
  const plan = buildPerUserMcpLaunchPlan({
    user: input.user,
    bearerToken: input.bearerToken,
    activeModule: 'graph-rag',
  });

  return {
    PATH: optionalEnv('PATH') ?? '',
    HOME: optionalEnv('HOME') ?? '',
    GRAPH_RAG_DATABASE_URL: requiredEnv('GRAPH_RAG_DATABASE_URL'),
    GRAPH_RAG_WORKING_DIR: optionalEnv('GRAPH_RAG_WORKING_DIR') ?? '',
    RAG_INTERNAL_TOKEN: optionalEnv('RAG_INTERNAL_TOKEN') ?? '',
    EMBEDDING_PROVIDER: optionalEnv('EMBEDDING_PROVIDER') ?? '',
    EMBEDDING_BASE_URL: optionalEnv('EMBEDDING_BASE_URL') ?? '',
    EMBEDDING_API_KEY: optionalEnv('EMBEDDING_API_KEY') ?? '',
    EMBEDDING_MODEL: optionalEnv('EMBEDDING_MODEL') ?? '',
    EMBEDDING_DIMENSIONS: optionalEnv('EMBEDDING_DIMENSIONS') ?? '1024',
    AGENT_BASE_URL: optionalEnv('AGENT_BASE_URL') ?? '',
    AGENT_API_KEY: optionalEnv('AGENT_API_KEY') ?? '',
    AGENT_MODEL: optionalEnv('AGENT_MODEL') ?? '',
    ...plan.env,
  };
}

export function createNanoBrainMcpClient(input: {
  user: UserContext;
  bearerToken: string;
  repoRoot?: string;
}): MultiServerMCPClient {
  const repoRoot = resolveRepoRoot(input);
  return new MultiServerMCPClient({
    throwOnLoadError: true,
    prefixToolNameWithServerName: false,
    useStandardContentBlocks: true,
    mcpServers: {
      [NANO_BRAIN_MCP_SERVER_NAME]: {
        transport: 'stdio',
        command: resolveBunCommand(),
        args: ['run', 'mcp'],
        cwd: path.join(repoRoot, 'modules/nano-brain'),
        env: buildNanoBrainMcpEnv({ user: input.user, bearerToken: input.bearerToken }),
        stderr: 'pipe',
      },
    },
  });
}

export function createTraditionalRagMcpClient(input: {
  user: UserContext;
  bearerToken: string;
  repoRoot?: string;
}): MultiServerMCPClient {
  const repoRoot = resolveRepoRoot(input);
  return new MultiServerMCPClient({
    throwOnLoadError: true,
    prefixToolNameWithServerName: false,
    useStandardContentBlocks: true,
    mcpServers: {
      [TRADITIONAL_RAG_MCP_SERVER_NAME]: {
        transport: 'stdio',
        command: resolveUvCommand(),
        args: ['run', '--project', path.join(repoRoot, 'modules/traditional-rag'), 'python', '-m', 'traditional_rag.mcp.server'],
        cwd: repoRoot,
        env: buildTraditionalRagMcpEnv({ user: input.user, bearerToken: input.bearerToken }),
        stderr: 'pipe',
      },
    },
  });
}

export function createGraphRagMcpClient(input: {
  user: UserContext;
  bearerToken: string;
  repoRoot?: string;
}): MultiServerMCPClient {
  const repoRoot = resolveRepoRoot(input);
  return new MultiServerMCPClient({
    throwOnLoadError: true,
    prefixToolNameWithServerName: false,
    useStandardContentBlocks: true,
    mcpServers: {
      [GRAPH_RAG_MCP_SERVER_NAME]: {
        transport: 'stdio',
        command: resolveUvCommand(),
        args: ['run', '--project', path.join(repoRoot, 'modules/graph-rag'), 'python', '-m', 'graph_rag.mcp.server'],
        cwd: repoRoot,
        env: buildGraphRagMcpEnv({ user: input.user, bearerToken: input.bearerToken }),
        defaultToolTimeout: GRAPH_RAG_MCP_TOOL_TIMEOUT_MS,
        stderr: 'pipe',
      },
    },
  });
}

export async function loadNanoBrainMcpTools(input: {
  user: UserContext;
  bearerToken: string;
  repoRoot?: string;
  policy?: NanoBrainMcpToolPolicy;
}): Promise<NanoBrainMcpToolsSession> {
  const client = createNanoBrainMcpClient(input);
  try {
    const tools = (await client.getTools(NANO_BRAIN_MCP_SERVER_NAME)) as StructuredToolInterface[];
    const allowed = getAllowedNanoBrainMcpToolNames({ user: input.user, policy: input.policy });
    const filtered = tools.filter((tool) => allowed.has(tool.name));
    return {
      client,
      tools: filtered,
      close: () => client.close(),
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw new AgentMcpError(
      `加载 Nano Brain MCP tools 失败：${error instanceof Error ? error.message : String(error)}`,
      'tool_load_failed',
    );
  }
}

export async function loadTraditionalRagMcpTools(input: {
  user: UserContext;
  bearerToken: string;
  repoRoot?: string;
}): Promise<CompanyBrainMcpToolsSession> {
  const client = createTraditionalRagMcpClient(input);
  try {
    const tools = (await client.getTools(TRADITIONAL_RAG_MCP_SERVER_NAME)) as StructuredToolInterface[];
    const allowed = getAllowedTraditionalRagMcpToolNames();
    const filtered = tools.filter((tool) => allowed.has(tool.name));
    return {
      client,
      tools: filtered,
      close: () => client.close(),
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw new AgentMcpError(
      `加载 Traditional RAG MCP tools 失败：${error instanceof Error ? error.message : String(error)}`,
      'tool_load_failed',
    );
  }
}

export async function loadGraphRagMcpTools(input: {
  user: UserContext;
  bearerToken: string;
  repoRoot?: string;
}): Promise<CompanyBrainMcpToolsSession> {
  const client = createGraphRagMcpClient(input);
  try {
    const tools = (await client.getTools(GRAPH_RAG_MCP_SERVER_NAME)) as StructuredToolInterface[];
    const allowed = getAllowedGraphRagMcpToolNames();
    const filtered = tools.filter((tool) => allowed.has(tool.name));
    return {
      client,
      tools: filtered,
      close: () => client.close(),
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw new AgentMcpError(
      `加载 GraphRAG MCP tools 失败：${error instanceof Error ? error.message : String(error)}`,
      'tool_load_failed',
    );
  }
}

export async function loadCompanyBrainMcpTools(input: {
  user: UserContext;
  bearerToken: string;
  repoRoot?: string;
}): Promise<CompanyBrainMcpToolsSession> {
  const sessions: CompanyBrainMcpToolsSession[] = [];
  try {
    const nano = await loadNanoBrainMcpTools(input);
    sessions.push(nano);
    const traditional = await loadTraditionalRagMcpTools(input);
    sessions.push(traditional);
    const graph = await loadGraphRagMcpTools(input);
    sessions.push(graph);
    return {
      client: nano.client,
      tools: sessions.flatMap((session) => session.tools),
      close: async () => {
        await Promise.all(sessions.map((session) => session.close().catch(() => undefined)));
      },
    };
  } catch (error) {
    await Promise.all(sessions.map((session) => session.close().catch(() => undefined)));
    throw error;
  }
}
