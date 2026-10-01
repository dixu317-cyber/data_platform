import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Stream } from 'node:stream';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const timeoutMs = Number(process.env.FF_MCP_DISCOVERY_TIMEOUT_MS ?? '20000');

if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
  throw new Error('FF_MCP_DISCOVERY_TIMEOUT_MS must be a positive integer');
}

const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);

type McpProbe = {
  label: string;
  command: string;
  args: string[];
  tokenEnv: string;
  expectedTools: string[];
  extraEnv?: Record<string, string>;
};

const probes: McpProbe[] = [
  {
    label: 'Nano',
    command: 'bun',
    args: ['run', '--cwd', 'modules/nano-brain', 'mcp'],
    tokenEnv: 'NANO_BRAIN_MCP_TOKEN',
    expectedTools: ['nano_search', 'nano_get_page'],
  },
  {
    label: 'Traditional',
    command: 'uv',
    args: ['run', '--project', 'modules/traditional-rag', 'python', '-m', 'traditional_rag.mcp.server'],
    tokenEnv: 'TRADITIONAL_RAG_MCP_TOKEN',
    expectedTools: ['traditional_search', 'traditional_get_document'],
  },
  {
    label: 'Graph',
    command: 'uv',
    args: ['run', '--project', 'modules/graph-rag', 'python', '-m', 'graph_rag.mcp.server'],
    tokenEnv: 'GRAPH_RAG_MCP_TOKEN',
    expectedTools: ['graph_search', 'graph_get_document'],
    // Discovery registers tools only; this intentionally unreachable local
    // endpoint proves no Graph database call is required for tools/list.
    extraEnv: {
      NEO4J_URI: 'bolt://127.0.0.1:9',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'stage4_mcp_probe_password',
      NEO4J_DATABASE: 'neo4j',
    },
  },
];

function collectStderr(stream: Stream | null): () => string {
  let output = '';
  stream?.on('data', (chunk) => {
    output = `${output}${String(chunk)}`.slice(-2000);
  });
  return () => output.trim();
}

async function within<T>(label: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolvePromise, rejectPromise) => {
      timer = setTimeout(() => rejectPromise(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      promise.then(resolvePromise, rejectPromise);
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function assertChildExited(pid: number | null, label: string): Promise<void> {
  if (pid === null) return;
  await Bun.sleep(250);
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    throw error;
  }
  process.kill(pid, 'SIGTERM');
  throw new Error(`${label} MCP child ${pid} remained alive after client close`);
}

async function runProbe(probe: McpProbe): Promise<void> {
  const transport = new StdioClientTransport({
    command: probe.command,
    args: probe.args,
    cwd: repositoryRoot,
    stderr: 'pipe',
    env: {
      ...inheritedEnv,
      FF_USER_ID: 'm3-mcp-discovery-user',
      FF_USERNAME: 'm3-mcp-discovery-user',
      FF_IS_ADMIN: 'false',
      [probe.tokenEnv]: 'm3-stage4-external-mcp-discovery-token',
      ...probe.extraEnv,
    },
  });
  const readStderr = collectStderr(transport.stderr);
  const client = new Client({ name: 'm3-phase4-external-mcp-probe', version: '1.0.0' });
  let pid: number | null = null;

  try {
    await within(`${probe.label} MCP initialize`, client.connect(transport));
    pid = transport.pid;
    const result = await within(`${probe.label} MCP tools/list`, client.listTools());
    const names = result.tools.map((tool) => tool.name);
    for (const expectedTool of probe.expectedTools) {
      if (!names.includes(expectedTool)) {
        throw new Error(`${probe.label} MCP tools/list is missing ${expectedTool}`);
      }
    }
    console.log(`${probe.label} external MCP discovery passed (${names.length} tools)`);
  } catch (error) {
    const stderr = readStderr();
    const suffix = stderr ? `; stderr: ${stderr}` : '';
    throw new Error(`${probe.label} external MCP discovery failed: ${error instanceof Error ? error.message : String(error)}${suffix}`);
  } finally {
    await client.close().catch(() => undefined);
    await assertChildExited(pid, probe.label);
  }
}

for (const probe of probes) {
  await runProbe(probe);
}

console.log('All external stdio MCP discovery probes passed; no Gateway runtime process was used.');
