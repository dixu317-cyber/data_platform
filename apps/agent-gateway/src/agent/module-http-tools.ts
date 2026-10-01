import type { ModuleId, UserContext } from '@ff/contracts';
import {
  callModuleJson,
  type GatewayJsonResponse,
  type ModuleHttpRequest,
} from '@ff/gateway';
import { ToolMessage } from '@langchain/core/messages';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * M3 module-HTTP Tool compatibility inventory and native factory.
 *
 * MCP remains the external adapter. Gateway's non-global runtime reads this
 * matrix to create native LangChain Tools that call protected module HTTP only.
 */
export type ModuleHttpToolAdapterStatus = 'ready' | 'adapter_required' | 'intentionally_blocked';

export type ModuleHttpToolExposure =
  | 'user'
  | 'admin'
  | 'admin_review_allowlist'
  | 'never_exposed'
  | 'external_only';

export type ModuleHttpToolInputField = {
  readonly name: string;
  readonly schema: string;
  readonly required: boolean;
  readonly defaultValue?: string | number | boolean | null;
  readonly notes?: string;
};

export type ModuleHttpToolRequest = {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly pathParameters?: Readonly<Record<string, string>>;
  readonly queryParameters?: Readonly<Record<string, string>>;
  readonly bodyParameters?: Readonly<Record<string, string>>;
  /** Conditional request within a multi-request Tool plan. */
  readonly when?: string;
};

export type ModuleHttpToolHttpPlan = {
  /** Empty only when an adapter or a new endpoint is still required. */
  readonly requests: readonly ModuleHttpToolRequest[];
  readonly responseMapping: string;
};

export type ModuleHttpToolDefinition = {
  readonly moduleId: ModuleId;
  readonly mcpServerName: 'nano' | 'traditional' | 'graph';
  readonly sourceMcpToolName: string;
  readonly toolName: string;
  readonly inputSchema: readonly ModuleHttpToolInputField[];
  readonly http: ModuleHttpToolHttpPlan;
  readonly adapterStatus: ModuleHttpToolAdapterStatus;
  /** Required for adapter_required/intentionally_blocked entries. */
  readonly adapterReason?: string;
  /** A tool can be in the normal user/admin surface and the review allowlist. */
  readonly runtimeExposure: readonly ModuleHttpToolExposure[];
  readonly sourceAnchors: readonly string[];
};

const field = (
  name: string,
  schema: string,
  required: boolean,
  options: Omit<ModuleHttpToolInputField, 'name' | 'schema' | 'required'> = {},
): ModuleHttpToolInputField => ({ name, schema, required, ...options });

const request = (
  method: ModuleHttpToolRequest['method'],
  path: string,
  options: Omit<ModuleHttpToolRequest, 'method' | 'path'> = {},
): ModuleHttpToolRequest => ({ method, path, ...options });

const nanoMcp = 'modules/nano-brain/src/mcp/index.ts';
const nanoHttp = 'modules/nano-brain/src/http/routes';
const traditionalMcp = 'modules/traditional-rag/src/traditional_rag/mcp/server.py';
const traditionalHttp = 'modules/traditional-rag/src/traditional_rag/http/routes';
const graphMcp = 'modules/graph-rag/src/graph_rag/mcp/server.py';
const graphHttp = 'modules/graph-rag/src/graph_rag/http/routes';

/**
 * The M3 compatibility SSOT for external MCP tools and their protected module
 * HTTP counterparts. `adapter_required` means Phase 1 must not expose the Tool
 * until it implements the stated adapter or adds an equivalent module endpoint.
 */
export const MODULE_HTTP_TOOL_MATRIX: readonly ModuleHttpToolDefinition[] = [
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_search',
    toolName: 'nano_search',
    inputSchema: [
      field('query', 'string(min=1,max=500)', true),
      field('limit', 'integer(min=1,max=30)', false, { defaultValue: 10 }),
      field('source_id', 'string', false),
    ],
    http: {
      requests: [request('POST', '/nano/search', { bodyParameters: { query: 'query', limit: 'limit', source_id: 'source_id' } })],
      responseMapping: 'HTTP response { query, results } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${nanoMcp}:226`, `${nanoHttp}/search.ts:/nano/search`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_capture',
    toolName: 'nano_capture',
    inputSchema: [
      field('text', 'string(min=1,max=1000000)', false),
      field('markdown', 'string(min=1,max=1000000)', false),
      field('title', 'string(min=1,max=200)', false),
      field('format', 'enum(text|markdown)', false, { notes: 'Omitted format is inferred from text/markdown.' }),
      field('target', 'enum(private|public)', false, { notes: 'Core enforces public-target administrator permission.' }),
      field('source_id', 'string(min=1)', false),
      field('slug', 'string(min=1,max=96)', false),
    ],
    http: {
      requests: [request('POST', '/nano/capture', { bodyParameters: {
        text: 'text', markdown: 'markdown', title: 'title', format: 'format', target: 'target', source_id: 'source_id', slug: 'slug',
      } })],
      responseMapping: 'HTTP response { capture, source, page } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${nanoMcp}:252`, `${nanoHttp}/capture.ts:/nano/capture`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_run_my_source_dream',
    toolName: 'nano_run_my_source_dream',
    inputSchema: [
      field('source_id', 'string(min=1)', true),
      field('phases', 'array(enum(extract_links|refresh_embeddings|health_check|review_queue_summary),min=1)', false),
      field('dry_run', 'boolean', false, { defaultValue: false }),
    ],
    http: {
      requests: [request('POST', '/nano/agent-tools/dream/user-source', { bodyParameters: {
        source_id: 'source_id', phases: 'phases', dry_run: 'dry_run',
      } })],
      responseMapping: 'Protected adapter derives user_source userId from authenticated internal context and returns synchronous { run: DreamReport }.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${nanoMcp}:300`, `${nanoHttp}/agent-tool-adapters.ts:/nano/agent-tools/dream/user-source`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_admin_run_dream',
    toolName: 'nano_admin_run_dream',
    inputSchema: [
      field('target_type', 'enum(public_source|review_queue)', true),
      field('source_id', 'string(min=1)', false),
      field('target_source_id', 'string(min=1)', false),
      field('phases', 'array(enum(extract_links|refresh_embeddings|health_check|review_queue_summary),min=1)', false),
      field('dry_run', 'boolean', false, { defaultValue: false }),
    ],
    http: {
      requests: [request('POST', '/nano/agent-tools/dream/admin', { bodyParameters: {
        target_type: 'target_type', source_id: 'source_id', target_source_id: 'target_source_id', phases: 'phases', dry_run: 'dry_run',
      } })],
      responseMapping: 'Protected adapter preserves MCP admin target conversion and returns synchronous { run: DreamReport }.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['admin'],
    sourceAnchors: [`${nanoMcp}:331`, `${nanoHttp}/agent-tool-adapters.ts:/nano/agent-tools/dream/admin`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_get_dream_status',
    toolName: 'nano_get_dream_status',
    inputSchema: [field('limit', 'integer(min=1,max=50)', false, { defaultValue: 10 })],
    http: {
      requests: [request('GET', '/nano/dream/status', { queryParameters: { limit: 'limit' } })],
      responseMapping: 'HTTP response { status } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user', 'admin_review_allowlist'],
    sourceAnchors: [`${nanoMcp}:370`, `${nanoHttp}/dream.ts:/nano/dream/status`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_get_dream_run',
    toolName: 'nano_get_dream_run',
    inputSchema: [field('run_id', 'string(min=1)', true)],
    http: {
      requests: [request('GET', '/nano/dream/runs/:runId', { pathParameters: { runId: 'run_id' } })],
      responseMapping: 'HTTP response { run: DreamReport } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user', 'admin_review_allowlist'],
    sourceAnchors: [`${nanoMcp}:385`, `${nanoHttp}/dream.ts:/nano/dream/runs/:runId`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_submit_fact',
    toolName: 'nano_submit_fact',
    inputSchema: [
      field('target_source_id', 'string(min=1)', true),
      field('raw_claim', 'string(min=1,max=4000)', true),
      field('raw_evidence_text', 'string(max=12000)', false),
      field('raw_evidence_url', 'string(max=2048,http(s))', false),
      field('raw_context', 'string(max=12000)', false),
    ],
    http: {
      requests: [request('POST', '/nano/fact-submissions', { bodyParameters: {
        target_source_id: 'target_source_id', raw_claim: 'raw_claim', raw_evidence_text: 'raw_evidence_text', raw_evidence_url: 'raw_evidence_url', raw_context: 'raw_context',
      } })],
      responseMapping: 'HTTP response { submission } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${nanoMcp}:403`, `${nanoHttp}/fact-submissions.ts:/nano/fact-submissions`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_list_my_fact_submissions',
    toolName: 'nano_list_my_fact_submissions',
    inputSchema: [
      field('status', 'enum(pending_review|needs_changes|approved|rejected)', false),
      field('submitted_by', 'string', false, { notes: 'Core applies this filter only for administrators.' }),
      field('target_source_id', 'string', false),
      field('limit', 'integer(min=1,max=200)', false, { defaultValue: 50 }),
    ],
    http: {
      requests: [request('GET', '/nano/fact-submissions', { queryParameters: {
        status: 'status', submitted_by: 'submitted_by', target_source_id: 'target_source_id', limit: 'limit',
      } })],
      responseMapping: 'HTTP response { submissions } is MCP-equivalent and preserves core per-user filtering.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${nanoMcp}:431`, `${nanoHttp}/fact-submissions.ts:/nano/fact-submissions`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_admin_list_fact_submissions',
    toolName: 'nano_admin_list_fact_submissions',
    inputSchema: [
      field('status', 'enum(pending_review|needs_changes|approved|rejected)', false),
      field('submitted_by', 'string', false),
      field('target_source_id', 'string', false),
      field('limit', 'integer(min=1,max=200)', false, { defaultValue: 50 }),
    ],
    http: {
      requests: [request('GET', '/nano/fact-submissions', { queryParameters: {
        status: 'status', submitted_by: 'submitted_by', target_source_id: 'target_source_id', limit: 'limit',
      } })],
      responseMapping: 'HTTP route delegates to the same listFactSubmissions core; authenticated admin context preserves MCP semantics.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['admin', 'admin_review_allowlist'],
    sourceAnchors: [`${nanoMcp}:459`, `${nanoHttp}/fact-submissions.ts:/nano/fact-submissions`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_save_fact_candidates',
    toolName: 'nano_save_fact_candidates',
    inputSchema: [
      field('submission_id', 'string(min=1)', true),
      field('candidates', 'array(FactCandidate,min=1,max=20)', true, { notes: 'FactCandidate preserves the nested MCP candidate schema.' }),
      field('generated_by', 'string', false),
      field('generator', 'string', false),
    ],
    http: {
      requests: [request('POST', '/nano/fact-submissions/:submissionId/candidates', { pathParameters: { submissionId: 'submission_id' }, bodyParameters: {
        candidates: 'candidates', generated_by: 'generated_by', generator: 'generator',
      } })],
      responseMapping: 'HTTP response { submission } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['admin', 'admin_review_allowlist'],
    sourceAnchors: [`${nanoMcp}:487`, `${nanoHttp}/fact-submissions.ts:/nano/fact-submissions/:submissionId/candidates`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_get_fact_submission',
    toolName: 'nano_get_fact_submission',
    inputSchema: [field('submission_id', 'string(min=1)', true)],
    http: {
      requests: [request('GET', '/nano/fact-submissions/:submissionId', { pathParameters: { submissionId: 'submission_id' } })],
      responseMapping: 'HTTP response { submission } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user', 'admin_review_allowlist'],
    sourceAnchors: [`${nanoMcp}:538`, `${nanoHttp}/fact-submissions.ts:/nano/fact-submissions/:submissionId`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_admin_review_fact_submission',
    toolName: 'nano_admin_review_fact_submission',
    inputSchema: [
      field('submission_id', 'string(min=1)', true),
      field('action', 'enum(approve|reject|request_changes)', true),
      field('approved_fact', 'ApprovedFact object', false),
      field('review_comment', 'string', false),
    ],
    http: {
      requests: [request('POST', '/nano/fact-submissions/:submissionId/review', { pathParameters: { submissionId: 'submission_id' }, bodyParameters: {
        action: 'action', approved_fact: 'approved_fact', review_comment: 'review_comment',
      } })],
      responseMapping: 'HTTP response would be { submission, fact, audit_log }; it is deliberately not exposed to Gateway Agents.',
    },
    adapterStatus: 'intentionally_blocked',
    adapterReason: 'High-risk approval/rejection action is never exposed to normal or admin-review Agents; a human confirmation path remains required.',
    runtimeExposure: ['never_exposed'],
    sourceAnchors: [`${nanoMcp}:552`, `${nanoHttp}/fact-submissions.ts:/nano/fact-submissions/:submissionId/review`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_list_facts',
    toolName: 'nano_list_facts',
    inputSchema: [
      field('source_id', 'string', false),
      field('entity_slug', 'string', false),
      field('submitted_by', 'string', false),
      field('status', 'enum(pending_review|needs_changes|approved|rejected)', false),
      field('limit', 'integer(min=1,max=200)', false, { defaultValue: 50 }),
    ],
    http: {
      requests: [request('GET', '/nano/facts', { queryParameters: {
        source_id: 'source_id', entity_slug: 'entity_slug', submitted_by: 'submitted_by', status: 'status', limit: 'limit',
      } })],
      responseMapping: 'HTTP response { facts } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user', 'admin_review_allowlist'],
    sourceAnchors: [`${nanoMcp}:606`, `${nanoHttp}/facts.ts:/nano/facts`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_get_fact',
    toolName: 'nano_get_fact',
    inputSchema: [field('fact_id', 'string(min=1)', true)],
    http: {
      requests: [request('GET', '/nano/facts/:factId', { pathParameters: { factId: 'fact_id' } })],
      responseMapping: 'HTTP response { fact } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${nanoMcp}:634`, `${nanoHttp}/facts.ts:/nano/facts/:factId`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_get_entity_facts',
    toolName: 'nano_get_entity_facts',
    inputSchema: [
      field('entity_slug', 'string(min=1)', true),
      field('source_id', 'string', false),
      field('submitted_by', 'string', false),
      field('status', 'enum(pending_review|needs_changes|approved|rejected)', false),
      field('limit', 'integer(min=1,max=200)', false, { defaultValue: 50 }),
    ],
    http: {
      requests: [request('GET', '/nano/entities/:entitySlug/facts', { pathParameters: { entitySlug: 'entity_slug' }, queryParameters: {
        source_id: 'source_id', submitted_by: 'submitted_by', status: 'status', limit: 'limit',
      } })],
      responseMapping: 'HTTP response { facts } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${nanoMcp}:648`, `${nanoHttp}/facts.ts:/nano/entities/:entitySlug/facts`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_admin_list_audit_logs',
    toolName: 'nano_admin_list_audit_logs',
    inputSchema: [
      field('action', 'enum(fact_submission.approve|fact_submission.reject|fact_submission.request_changes)', false),
      field('target_type', 'string', false),
      field('target_id', 'string', false),
      field('actor_user_id', 'string', false),
      field('limit', 'integer(min=1,max=200)', false, { defaultValue: 50 }),
    ],
    http: {
      requests: [request('GET', '/nano/agent-tools/audit-logs', { queryParameters: {
        action: 'action', target_type: 'target_type', target_id: 'target_id', actor_user_id: 'actor_user_id', limit: 'limit',
      } })],
      responseMapping: 'Protected adapter delegates to listAuditLogs and returns MCP-equivalent { audit_logs }.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['admin'],
    sourceAnchors: [`${nanoMcp}:677`, `${nanoHttp}/agent-tool-adapters.ts:/nano/agent-tools/audit-logs`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_get_page',
    toolName: 'nano_get_page',
    inputSchema: [field('source_id', 'string(min=1)', true), field('slug', 'string(min=1)', true)],
    http: {
      requests: [request('GET', '/nano/pages/:sourceId/:slug', { pathParameters: { sourceId: 'source_id', slug: 'slug' } })],
      responseMapping: 'HTTP response { page } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${nanoMcp}:709`, `${nanoHttp}/pages.ts:/nano/pages/:sourceId/:slug`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_get_links',
    toolName: 'nano_get_links',
    inputSchema: [
      field('source_id', 'string(min=1)', true),
      field('slug', 'string(min=1)', true),
      field('link_type', 'string', false),
    ],
    http: {
      requests: [request('GET', '/nano/links/:sourceId/:slug', { pathParameters: { sourceId: 'source_id', slug: 'slug' }, queryParameters: { link_type: 'link_type' } })],
      responseMapping: 'HTTP response { links } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${nanoMcp}:723`, `${nanoHttp}/graph.ts:/nano/links/:sourceId/:slug`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_get_backlinks',
    toolName: 'nano_get_backlinks',
    inputSchema: [field('slug', 'string(min=1)', true), field('link_type', 'string', false)],
    http: {
      requests: [request('GET', '/nano/backlinks/:slug', { pathParameters: { slug: 'slug' }, queryParameters: { link_type: 'link_type' } })],
      responseMapping: 'HTTP response { links } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${nanoMcp}:741`, `${nanoHttp}/graph.ts:/nano/backlinks/:slug`],
  },
  {
    moduleId: 'nano-brain',
    mcpServerName: 'nano',
    sourceMcpToolName: 'nano_graph_query',
    toolName: 'nano_graph_query',
    inputSchema: [
      field('slug', 'string(min=1)', true),
      field('depth', 'integer(min=1,max=2)', false, { defaultValue: 1 }),
      field('direction', 'enum(out|in|both)', false, { defaultValue: 'both' }),
      field('link_type', 'string', false),
    ],
    http: {
      requests: [request('POST', '/nano/graph/query', { bodyParameters: { slug: 'slug', depth: 'depth', direction: 'direction', link_type: 'link_type' } })],
      responseMapping: 'HTTP response { root_slug, depth, direction, nodes, links } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${nanoMcp}:755`, `${nanoHttp}/graph.ts:/nano/graph/query`],
  },

  {
    moduleId: 'traditional-rag',
    mcpServerName: 'traditional',
    sourceMcpToolName: 'traditional_search',
    toolName: 'traditional_search',
    inputSchema: [
      field('query', 'string(min=1,max=500)', true),
      field('limit', 'integer(min=1,max=30)', false, { defaultValue: 10 }),
      field('source_id', 'string', false),
      field('document_id', 'string', false),
      field('file_types', 'array(string)', false),
    ],
    http: {
      requests: [request('POST', '/traditional/search', { bodyParameters: {
        query: 'query', limit: 'limit', source_id: 'source_id', document_id: 'document_id', file_types: 'file_types',
      } })],
      responseMapping: 'HTTP search response is the same core search result returned by MCP.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${traditionalMcp}:53`, `${traditionalHttp}/search.py:/traditional/search`],
  },
  {
    moduleId: 'traditional-rag',
    mcpServerName: 'traditional',
    sourceMcpToolName: 'search_structured_rows',
    toolName: 'search_structured_rows',
    inputSchema: [
      field('query', 'string(min=1,max=500)', true),
      field('limit', 'integer(min=1,max=50)', false, { defaultValue: 10 }),
      field('source_id', 'string', false),
      field('document_id', 'string', false),
    ],
    http: {
      requests: [request('POST', '/traditional/structured/search', { bodyParameters: {
        query: 'query', limit: 'limit', source_id: 'source_id', document_id: 'document_id',
      } })],
      responseMapping: 'HTTP route shares the MCP core implementation, but the MCP Tool remains an external-only teaching/client adapter.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['external_only'],
    sourceAnchors: [`${traditionalMcp}:77`, `${traditionalHttp}/documents.py:/traditional/structured/search`],
  },
  {
    moduleId: 'traditional-rag',
    mcpServerName: 'traditional',
    sourceMcpToolName: 'traditional_query_table',
    toolName: 'traditional_query_table',
    inputSchema: [
      field('query', 'string(max=500)', false), field('operation', 'string', false), field('aggregate', 'string', false),
      field('table_id', 'string', false), field('source_id', 'string', false), field('document_id', 'string', false),
      field('sheet_name', 'string', false), field('column', 'string', false), field('group_by', 'string', false),
      field('sort_column', 'string', false), field('sort_direction', 'string', false), field('filters', 'array(object)', false),
      field('columns', 'array(string)', false), field('limit', 'integer(min=1,max=200)', false),
    ],
    http: {
      requests: [request('POST', '/traditional/tables/query', { bodyParameters: {
        query: 'query', operation: 'operation', aggregate: 'aggregate', table_id: 'table_id', source_id: 'source_id', document_id: 'document_id',
        sheet_name: 'sheet_name', column: 'column', group_by: 'group_by', sort_column: 'sort_column', sort_direction: 'sort_direction',
        filters: 'filters', columns: 'columns', limit: 'limit',
      } })],
      responseMapping: 'HTTP response is the same query_tables result returned by MCP.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${traditionalMcp}:104`, `${traditionalHttp}/documents.py:/traditional/tables/query`],
  },
  {
    moduleId: 'traditional-rag',
    mcpServerName: 'traditional',
    sourceMcpToolName: 'traditional_get_document',
    toolName: 'traditional_get_document',
    inputSchema: [
      field('document_id', 'string', true),
      field('include_chunks', 'boolean', false, { defaultValue: true }),
      field('include_tables', 'boolean', false, { defaultValue: true }),
    ],
    http: {
      requests: [
        request('GET', '/traditional/documents/:documentId', { pathParameters: { documentId: 'document_id' } }),
        request('GET', '/traditional/documents/:documentId/chunks', { pathParameters: { documentId: 'document_id' }, when: 'include_chunks !== false' }),
        request('GET', '/traditional/documents/:documentId/tables', { pathParameters: { documentId: 'document_id' }, when: 'include_tables !== false' }),
      ],
      responseMapping: 'Phase 1 factory aggregates document plus conditional chunks/tables as { document, chunks?, tables? }, matching MCP defaults and response shape.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${traditionalMcp}:143`, `${traditionalHttp}/documents.py:/traditional/documents/{document_id}`, `${traditionalHttp}/documents.py:/chunks`, `${traditionalHttp}/documents.py:/tables`],
  },
  {
    moduleId: 'traditional-rag',
    mcpServerName: 'traditional',
    sourceMcpToolName: 'traditional_list_sources',
    toolName: 'traditional_list_sources',
    inputSchema: [],
    http: {
      requests: [request('GET', '/traditional/sources')],
      responseMapping: 'HTTP response { sources } is MCP-equivalent and initializes the private source under the same user context.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${traditionalMcp}:162`, `${traditionalHttp}/sources.py:/traditional/sources`],
  },
  {
    moduleId: 'traditional-rag',
    mcpServerName: 'traditional',
    sourceMcpToolName: 'traditional_get_job',
    toolName: 'traditional_get_job',
    inputSchema: [field('job_id', 'string', true)],
    http: {
      requests: [request('GET', '/traditional/jobs/:jobId', { pathParameters: { jobId: 'job_id' } })],
      responseMapping: 'HTTP response { job } is MCP-equivalent.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${traditionalMcp}:177`, `${traditionalHttp}/documents.py:/traditional/jobs/{job_id}`],
  },

  {
    moduleId: 'graph-rag',
    mcpServerName: 'graph',
    sourceMcpToolName: 'graph_search',
    toolName: 'graph_search',
    inputSchema: [
      field('query', 'string(min=1,max=2000)', true),
      field('limit', 'integer(min=1,max=30)', false, { defaultValue: 10 }),
      field('source_id', 'string', false),
      field('mode', 'enum(auto|local|global|hybrid|naive|mix)', false, { defaultValue: 'mix' }),
    ],
    http: {
      requests: [request('POST', '/graph/search', { bodyParameters: { query: 'query', limit: 'limit', source_id: 'source_id', mode: 'mode' } })],
      responseMapping: 'HTTP route calls the same graph search core; ignore HTTP-only optional tuning fields for this MCP-compatible Tool.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${graphMcp}:28`, `${graphHttp}/search.py:/graph/search`],
  },
  {
    moduleId: 'graph-rag',
    mcpServerName: 'graph',
    sourceMcpToolName: 'graph_list_sources',
    toolName: 'graph_list_sources',
    inputSchema: [],
    http: {
      requests: [request('GET', '/graph/sources')],
      responseMapping: 'HTTP response { sources } contains the MCP source fields and may include harmless extra public metadata.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${graphMcp}:33`, `${graphHttp}/sources.py:/graph/sources`],
  },
  {
    moduleId: 'graph-rag',
    mcpServerName: 'graph',
    sourceMcpToolName: 'graph_get_document',
    toolName: 'graph_get_document',
    inputSchema: [field('document_id', 'string', true)],
    http: {
      requests: [request('GET', '/graph/documents/:documentId', { pathParameters: { documentId: 'document_id' } })],
      responseMapping: 'HTTP response { document } includes every MCP context field; Phase 1 strips HTTP-only extra public fields if exact shape is required.',
    },
    adapterStatus: 'ready',
    runtimeExposure: ['user'],
    sourceAnchors: [`${graphMcp}:49`, `${graphHttp}/documents.py:/graph/documents/{document_id}`],
  },
];

export const ADMIN_REVIEW_MODULE_HTTP_TOOL_NAMES = [
  'nano_admin_list_fact_submissions',
  'nano_get_fact_submission',
  'nano_save_fact_candidates',
  'nano_get_dream_status',
  'nano_get_dream_run',
  'nano_list_facts',
] as const;

export const HIGH_RISK_MODULE_HTTP_TOOL_NAMES = ['nano_admin_review_fact_submission'] as const;

/** Narrow seam for tests; production defaults to the Gateway-owned HTTP caller. */
export type ModuleHttpCall = (
  moduleId: ModuleId,
  request: ModuleHttpRequest,
) => Promise<GatewayJsonResponse>;

/**
 * Native module HTTP Tools do not own a child-process or socket lifecycle, but
 * expose the same session shape that the stream owns and closes in `finally`.
 */
export type ModuleHttpToolsSession = {
  readonly tools: StructuredToolInterface[];
  readonly close: () => Promise<void>;
};

export type CreateModuleHttpToolsInput = {
  /** Authenticated Gateway session context. It is deliberately not a Tool argument. */
  user: UserContext;
  activeModule: ModuleId;
  /** Test seam. Production always uses @ff/gateway callModuleJson(). */
  callModuleJson?: ModuleHttpCall;
};

export type CreateAdminReviewModuleHttpToolsInput = Omit<CreateModuleHttpToolsInput, 'activeModule'>;

const dreamPhaseSchema = z.enum([
  'extract_links',
  'refresh_embeddings',
  'health_check',
  'review_queue_summary',
]);

const factCandidateSchema = z.object({
  entity_slug: z.string().nullable().optional(),
  fact: z.string().min(1).max(4_000),
  kind: z.enum(['fact', 'event', 'preference', 'commitment', 'belief']),
  confidence: z.number().min(0).max(1),
  notability: z.enum(['high', 'medium', 'low']),
  claim_metric: z.string().optional(),
  claim_value: z.number().optional(),
  claim_unit: z.string().optional(),
  claim_period: z.string().optional(),
  evidence_quote: z.string().optional(),
  normalization_confidence: z.number().min(0).max(1),
  warnings: z.array(z.union([
    z.string(),
    z.object({ code: z.string(), message: z.string() }).strict(),
  ])).optional(),
}).strict();

// `nano_admin_review_fact_submission` intentionally has no native Tool schema:
// it is never returned by either factory, so a model cannot reach this write path.
// The exposed nested candidate schema above mirrors the MCP source exactly.
// FastMCP and the protected FastAPI endpoint both declare `filters: list[dict]`.
// Keep arbitrary JSON records, rather than narrowing the historical Tool surface.
// This is a record schema, not z.any() or an empty object bypass.
const tableFilterSchema = z.record(z.string(), z.unknown());

const TOOL_SCHEMAS = {
  nano_search: z.object({
    query: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(30).optional().default(10),
    source_id: z.string().optional(),
  }).strict(),
  nano_capture: z.object({
    text: z.string().min(1).max(1_000_000).optional(),
    markdown: z.string().min(1).max(1_000_000).optional(),
    title: z.string().min(1).max(200).optional(),
    format: z.enum(['text', 'markdown']).optional(),
    target: z.enum(['private', 'public']).optional(),
    source_id: z.string().min(1).optional(),
    slug: z.string().min(1).max(96).optional(),
  }).strict(),
  nano_run_my_source_dream: z.object({
    source_id: z.string().min(1),
    phases: z.array(dreamPhaseSchema).min(1).optional(),
    dry_run: z.boolean().optional().default(false),
  }).strict(),
  nano_admin_run_dream: z.object({
    target_type: z.enum(['public_source', 'review_queue']),
    source_id: z.string().min(1).optional(),
    target_source_id: z.string().min(1).optional(),
    phases: z.array(dreamPhaseSchema).min(1).optional(),
    dry_run: z.boolean().optional().default(false),
  }).strict(),
  nano_get_dream_status: z.object({
    limit: z.number().int().min(1).max(50).optional().default(10),
  }).strict(),
  nano_get_dream_run: z.object({ run_id: z.string().min(1) }).strict(),
  nano_submit_fact: z.object({
    target_source_id: z.string().min(1),
    raw_claim: z.string().min(1).max(4_000),
    raw_evidence_text: z.string().max(12_000).optional(),
    raw_evidence_url: z.string().max(2_048).optional(),
    raw_context: z.string().max(12_000).optional(),
  }).strict(),
  nano_list_my_fact_submissions: z.object({
    status: z.enum(['pending_review', 'needs_changes', 'approved', 'rejected']).optional(),
    submitted_by: z.string().optional(),
    target_source_id: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional().default(50),
  }).strict(),
  nano_admin_list_fact_submissions: z.object({
    status: z.enum(['pending_review', 'needs_changes', 'approved', 'rejected']).optional(),
    submitted_by: z.string().optional(),
    target_source_id: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional().default(50),
  }).strict(),
  nano_save_fact_candidates: z.object({
    submission_id: z.string().min(1),
    candidates: z.array(factCandidateSchema).min(1).max(20),
    generated_by: z.string().optional(),
    generator: z.string().optional(),
  }).strict(),
  nano_get_fact_submission: z.object({ submission_id: z.string().min(1) }).strict(),
  nano_list_facts: z.object({
    source_id: z.string().optional(),
    entity_slug: z.string().optional(),
    submitted_by: z.string().optional(),
    status: z.enum(['pending_review', 'needs_changes', 'approved', 'rejected']).optional(),
    limit: z.number().int().min(1).max(200).optional().default(50),
  }).strict(),
  nano_get_fact: z.object({ fact_id: z.string().min(1) }).strict(),
  nano_get_entity_facts: z.object({
    entity_slug: z.string().min(1),
    source_id: z.string().optional(),
    submitted_by: z.string().optional(),
    status: z.enum(['pending_review', 'needs_changes', 'approved', 'rejected']).optional(),
    limit: z.number().int().min(1).max(200).optional().default(50),
  }).strict(),
  nano_admin_list_audit_logs: z.object({
    action: z.enum(['fact_submission.approve', 'fact_submission.reject', 'fact_submission.request_changes']).optional(),
    target_type: z.string().optional(),
    target_id: z.string().optional(),
    actor_user_id: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional().default(50),
  }).strict(),
  nano_get_page: z.object({ source_id: z.string().min(1), slug: z.string().min(1) }).strict(),
  nano_get_links: z.object({
    source_id: z.string().min(1),
    slug: z.string().min(1),
    link_type: z.string().optional(),
  }).strict(),
  nano_get_backlinks: z.object({ slug: z.string().min(1), link_type: z.string().optional() }).strict(),
  nano_graph_query: z.object({
    slug: z.string().min(1),
    depth: z.number().int().min(1).max(2).optional().default(1),
    direction: z.enum(['out', 'in', 'both']).optional().default('both'),
    link_type: z.string().optional(),
  }).strict(),
  traditional_search: z.object({
    query: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(30).optional().default(10),
    source_id: z.string().optional(),
    document_id: z.string().optional(),
    file_types: z.array(z.string()).optional(),
  }).strict(),
  traditional_query_table: z.object({
    query: z.string().max(500).optional(),
    operation: z.string().optional(),
    aggregate: z.string().optional(),
    table_id: z.string().optional(),
    source_id: z.string().optional(),
    document_id: z.string().optional(),
    sheet_name: z.string().optional(),
    column: z.string().optional(),
    group_by: z.string().optional(),
    sort_column: z.string().optional(),
    sort_direction: z.string().optional(),
    filters: z.array(tableFilterSchema).optional(),
    columns: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }).strict(),
  traditional_get_document: z.object({
    document_id: z.string().min(1),
    include_chunks: z.boolean().optional().default(true),
    include_tables: z.boolean().optional().default(true),
  }).strict(),
  traditional_list_sources: z.object({}).strict(),
  traditional_get_job: z.object({ job_id: z.string().min(1) }).strict(),
  graph_search: z.object({
    query: z.string().min(1).max(2_000),
    limit: z.number().int().min(1).max(30).optional().default(10),
    source_id: z.string().optional(),
    mode: z.enum(['auto', 'local', 'global', 'hybrid', 'naive', 'mix']).optional().default('mix'),
  }).strict(),
  graph_list_sources: z.object({}).strict(),
  graph_get_document: z.object({ document_id: z.string().min(1) }).strict(),
} as const;

type ToolArguments = Record<string, unknown>;
type ModuleToolOutput = { content: string; status: 'success' | 'error' };

function getToolSchema(name: string) {
  const schema = TOOL_SCHEMAS[name as keyof typeof TOOL_SCHEMAS];
  if (!schema) throw new Error(`M3 module HTTP Tool 缺少 Zod schema: ${name}`);
  return schema;
}

function definedFields(input: ToolArguments, fields: readonly string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const fieldName of fields) {
    if (input[fieldName] !== undefined) body[fieldName] = input[fieldName];
  }
  return body;
}

function queryString(input: ToolArguments, fields: readonly string[]): string | undefined {
  const params = new URLSearchParams();
  for (const fieldName of fields) {
    const value = input[fieldName];
    if (value !== undefined && value !== null) params.set(fieldName, String(value));
  }
  const result = params.toString();
  return result || undefined;
}

function requiredString(input: ToolArguments, fieldName: string): string {
  const value = input[fieldName];
  if (typeof value !== 'string' || !value) throw new Error(`validated Tool missing ${fieldName}`);
  return value;
}

function encodedPath(path: string, value: string): string {
  return `${path}/${encodeURIComponent(value)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSuccess(response: GatewayJsonResponse): boolean {
  return response.status >= 200 && response.status < 300;
}

function moduleErrorOutput(response: GatewayJsonResponse): ModuleToolOutput {
  const body = isRecord(response.body) ? response.body : {};
  const detail = isRecord(body.detail) ? body.detail : body;
  const fallbackCode = response.status === 401
    ? 'unauthorized'
    : response.status === 403
      ? 'forbidden'
      : response.status === 404
        ? 'not_found'
        : 'module_http_error';
  const error = typeof detail.error === 'string' ? detail.error : fallbackCode;
  const message = typeof detail.message === 'string' ? detail.message : `模块 HTTP 请求失败（${response.status}）`;
  return { content: JSON.stringify({ error, message, status: response.status }), status: 'error' };
}

function successOutput(response: GatewayJsonResponse): ModuleToolOutput {
  return { content: JSON.stringify(response.body ?? null), status: 'success' };
}

function callFailureOutput(error: unknown): ModuleToolOutput {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const code = typeof error.code === 'string' ? error.code : 'module_unavailable';
    const message = typeof error.message === 'string' ? error.message : '模块 HTTP 调用失败';
    return { content: JSON.stringify({ error: code, message }), status: 'error' };
  }
  return { content: JSON.stringify({ error: 'module_unavailable', message: '模块 HTTP 调用失败' }), status: 'error' };
}

async function callModule(
  call: ModuleHttpCall,
  moduleId: ModuleId,
  user: UserContext,
  request: Omit<ModuleHttpRequest, 'user'>,
): Promise<GatewayJsonResponse> {
  return call(moduleId, { ...request, user });
}

async function runSimpleRequest(
  call: ModuleHttpCall,
  moduleId: ModuleId,
  user: UserContext,
  request: Omit<ModuleHttpRequest, 'user'>,
): Promise<ModuleToolOutput> {
  try {
    const response = await callModule(call, moduleId, user, request);
    return isSuccess(response) ? successOutput(response) : moduleErrorOutput(response);
  } catch (error) {
    return callFailureOutput(error);
  }
}

function graphDocumentContext(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.document)) return body;
  const document = body.document;
  return {
    document: {
      id: document.id,
      source_id: document.source_id,
      original_filename: document.original_filename,
      file_type: document.file_type,
      status: document.status,
      metadata: document.metadata,
      content_text: document.content_text,
      created_at: document.created_at,
      updated_at: document.updated_at,
    },
  };
}

async function runTraditionalDocumentTool(
  input: ToolArguments,
  user: UserContext,
  call: ModuleHttpCall,
): Promise<ModuleToolOutput> {
  try {
    const documentId = requiredString(input, 'document_id');
    const documentPath = encodedPath('/traditional/documents', documentId);
    const documentResponse = await callModule(call, 'traditional-rag', user, { method: 'GET', path: documentPath });
    if (!isSuccess(documentResponse)) return moduleErrorOutput(documentResponse);

    const result: Record<string, unknown> = isRecord(documentResponse.body) ? { ...documentResponse.body } : { document: documentResponse.body };
    if (input.include_chunks !== false) {
      const chunksResponse = await callModule(call, 'traditional-rag', user, { method: 'GET', path: `${documentPath}/chunks` });
      if (!isSuccess(chunksResponse)) return moduleErrorOutput(chunksResponse);
      if (isRecord(chunksResponse.body) && 'chunks' in chunksResponse.body) result.chunks = chunksResponse.body.chunks;
    }
    if (input.include_tables !== false) {
      const tablesResponse = await callModule(call, 'traditional-rag', user, { method: 'GET', path: `${documentPath}/tables` });
      if (!isSuccess(tablesResponse)) return moduleErrorOutput(tablesResponse);
      if (isRecord(tablesResponse.body) && 'tables' in tablesResponse.body) result.tables = tablesResponse.body.tables;
    }
    return { content: JSON.stringify(result), status: 'success' };
  } catch (error) {
    return callFailureOutput(error);
  }
}

async function runGraphDocumentTool(
  input: ToolArguments,
  user: UserContext,
  call: ModuleHttpCall,
): Promise<ModuleToolOutput> {
  try {
    const response = await callModule(call, 'graph-rag', user, {
      method: 'GET',
      path: encodedPath('/graph/documents', requiredString(input, 'document_id')),
    });
    return isSuccess(response)
      ? { content: JSON.stringify(graphDocumentContext(response.body)), status: 'success' }
      : moduleErrorOutput(response);
  } catch (error) {
    return callFailureOutput(error);
  }
}

async function invokeModuleHttpTool(
  definition: ModuleHttpToolDefinition,
  input: ToolArguments,
  user: UserContext,
  call: ModuleHttpCall,
): Promise<ModuleToolOutput> {
  switch (definition.toolName) {
    case 'nano_search':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'POST', path: '/nano/search', body: definedFields(input, ['query', 'limit', 'source_id']) });
    case 'nano_capture':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'POST', path: '/nano/capture', body: definedFields(input, ['text', 'markdown', 'title', 'format', 'target', 'source_id', 'slug']) });
    case 'nano_run_my_source_dream':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'POST', path: '/nano/agent-tools/dream/user-source', body: definedFields(input, ['source_id', 'phases', 'dry_run']) });
    case 'nano_admin_run_dream':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'POST', path: '/nano/agent-tools/dream/admin', body: definedFields(input, ['target_type', 'source_id', 'target_source_id', 'phases', 'dry_run']) });
    case 'nano_get_dream_status':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'GET', path: '/nano/dream/status', queryString: queryString(input, ['limit']) });
    case 'nano_get_dream_run':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'GET', path: encodedPath('/nano/dream/runs', requiredString(input, 'run_id')) });
    case 'nano_submit_fact':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'POST', path: '/nano/fact-submissions', body: definedFields(input, ['target_source_id', 'raw_claim', 'raw_evidence_text', 'raw_evidence_url', 'raw_context']) });
    case 'nano_list_my_fact_submissions':
    case 'nano_admin_list_fact_submissions':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'GET', path: '/nano/fact-submissions', queryString: queryString(input, ['status', 'submitted_by', 'target_source_id', 'limit']) });
    case 'nano_save_fact_candidates':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'POST', path: encodedPath('/nano/fact-submissions', requiredString(input, 'submission_id')) + '/candidates', body: definedFields(input, ['candidates', 'generated_by', 'generator']) });
    case 'nano_get_fact_submission':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'GET', path: encodedPath('/nano/fact-submissions', requiredString(input, 'submission_id')) });
    case 'nano_list_facts':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'GET', path: '/nano/facts', queryString: queryString(input, ['source_id', 'entity_slug', 'submitted_by', 'status', 'limit']) });
    case 'nano_get_fact':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'GET', path: encodedPath('/nano/facts', requiredString(input, 'fact_id')) });
    case 'nano_get_entity_facts':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'GET', path: encodedPath('/nano/entities', requiredString(input, 'entity_slug')) + '/facts', queryString: queryString(input, ['source_id', 'submitted_by', 'status', 'limit']) });
    case 'nano_admin_list_audit_logs':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'GET', path: '/nano/agent-tools/audit-logs', queryString: queryString(input, ['action', 'target_type', 'target_id', 'actor_user_id', 'limit']) });
    case 'nano_get_page':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'GET', path: `${encodedPath('/nano/pages', requiredString(input, 'source_id'))}/${encodeURIComponent(requiredString(input, 'slug'))}` });
    case 'nano_get_links':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'GET', path: `${encodedPath('/nano/links', requiredString(input, 'source_id'))}/${encodeURIComponent(requiredString(input, 'slug'))}`, queryString: queryString(input, ['link_type']) });
    case 'nano_get_backlinks':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'GET', path: encodedPath('/nano/backlinks', requiredString(input, 'slug')), queryString: queryString(input, ['link_type']) });
    case 'nano_graph_query':
      return runSimpleRequest(call, 'nano-brain', user, { method: 'POST', path: '/nano/graph/query', body: definedFields(input, ['slug', 'depth', 'direction', 'link_type']) });
    case 'traditional_search':
      return runSimpleRequest(call, 'traditional-rag', user, { method: 'POST', path: '/traditional/search', body: definedFields(input, ['query', 'limit', 'source_id', 'document_id', 'file_types']) });
    case 'traditional_query_table':
      return runSimpleRequest(call, 'traditional-rag', user, { method: 'POST', path: '/traditional/tables/query', body: definedFields(input, ['query', 'operation', 'aggregate', 'table_id', 'source_id', 'document_id', 'sheet_name', 'column', 'group_by', 'sort_column', 'sort_direction', 'filters', 'columns', 'limit']) });
    case 'traditional_get_document':
      return runTraditionalDocumentTool(input, user, call);
    case 'traditional_list_sources':
      return runSimpleRequest(call, 'traditional-rag', user, { method: 'GET', path: '/traditional/sources' });
    case 'traditional_get_job':
      return runSimpleRequest(call, 'traditional-rag', user, { method: 'GET', path: encodedPath('/traditional/jobs', requiredString(input, 'job_id')) });
    case 'graph_search':
      return runSimpleRequest(call, 'graph-rag', user, { method: 'POST', path: '/graph/search', body: definedFields(input, ['query', 'limit', 'source_id', 'mode']) });
    case 'graph_list_sources':
      return runSimpleRequest(call, 'graph-rag', user, { method: 'GET', path: '/graph/sources' });
    case 'graph_get_document':
      return runGraphDocumentTool(input, user, call);
    default:
      throw new Error(`M3 module HTTP Tool has no invocation plan: ${definition.toolName}`);
  }
}

function createNativeTool(
  definition: ModuleHttpToolDefinition,
  user: UserContext,
  call: ModuleHttpCall,
): StructuredToolInterface {
  const schema = getToolSchema(definition.toolName);
  return tool(
    async (input: ToolArguments, ...runtimeArgs: unknown[]) => {
      const output = await invokeModuleHttpTool(definition, input, user, call);
      const runtime = runtimeArgs[0];
      const toolCall = isRecord(runtime) && isRecord(runtime.toolCall) ? runtime.toolCall : null;
      const toolCallId = toolCall && typeof toolCall.id === 'string' ? toolCall.id : null;
      if (output.status === 'error' && toolCallId) {
        return new ToolMessage({
          content: output.content,
          name: definition.toolName,
          status: 'error',
          tool_call_id: toolCallId,
        });
      }
      return output.content;
    },
    {
      name: definition.toolName,
      description: `通过受保护的 ${definition.mcpServerName} 模块 HTTP API 调用 ${definition.toolName}。`,
      schema,
    },
  ) as StructuredToolInterface;
}

function visibleModuleDefinitions(user: UserContext, activeModule: ModuleId): ModuleHttpToolDefinition[] {
  return MODULE_HTTP_TOOL_MATRIX.filter((definition) => (
    definition.moduleId === activeModule
    && definition.adapterStatus === 'ready'
    && (
      definition.runtimeExposure.includes('user')
      || (user.isAdmin && definition.runtimeExposure.includes('admin'))
    )
  )) as ModuleHttpToolDefinition[];
}

/**
 * Creates the regular non-global native Tool surface. User context is captured
 * from the authenticated Gateway session, never from model Tool input.
 */
export function createModuleHttpTools(input: CreateModuleHttpToolsInput): ModuleHttpToolsSession {
  const call = input.callModuleJson ?? callModuleJson;
  return {
    tools: visibleModuleDefinitions(input.user, input.activeModule)
      .map((definition) => createNativeTool(definition, input.user, call)),
    close: async () => {},
  };
}

/** Creates the fixed six-Tool admin-review surface; no caller policy is accepted. */
export function createAdminReviewModuleHttpTools(
  input: CreateAdminReviewModuleHttpToolsInput,
): ModuleHttpToolsSession {
  if (!input.user.isAdmin) throw new Error('只有管理员可以使用管理员审核辅助 Agent');
  const call = input.callModuleJson ?? callModuleJson;
  const allowed = new Set<string>(ADMIN_REVIEW_MODULE_HTTP_TOOL_NAMES);
  return {
    tools: MODULE_HTTP_TOOL_MATRIX
      .filter((definition) => (
        definition.moduleId === 'nano-brain'
        && definition.adapterStatus === 'ready'
        && definition.runtimeExposure.includes('admin_review_allowlist')
        && allowed.has(definition.toolName)
      ))
      .map((definition) => createNativeTool(definition, input.user, call)),
    close: async () => {},
  };
}
