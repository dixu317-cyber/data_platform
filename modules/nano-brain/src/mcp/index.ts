import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getUserByBearerToken } from '@ff/identity';
import type { UserContext } from '@ff/contracts';
import { listAuditLogs, type AuditLog, type AuditAction } from '../core/audit';
import { captureContent } from '../core/capture';
import { saveFactCandidates } from '../core/fact-candidates';
import { getDreamStatus, getReadableDreamRunReport, runDream } from '../core/dream/runner';
import { type DreamPhase } from '../core/dream/types';
import { reviewFactSubmission, type FactReviewAction } from '../core/fact-review';
import { getFact, listEntityFacts, listFacts, type NanoFact } from '../core/facts';
import {
  getFactSubmission,
  listAdminFactSubmissions,
  listFactSubmissions,
  submitFactSubmission,
  type FactSubmission,
  type FactSubmissionStatus,
} from '../core/fact-submissions';
import { getPage, type NanoPage } from '../core/pages';
import { searchNanoBrain, type NanoSearchResult } from '../core/search';
import {
  graphQuery,
  listBacklinks,
  listOutgoingLinks,
  type NanoLink,
} from '../core/links';
import { NanoBrainError, type NanoSource } from '../core/sources';
import { NanoBrainPermissionError } from '../core/permissions';
import { toPublicDreamReport, toPublicDreamStatus } from '../http/serializers';

// Nano Brain 自带的 MCP Server，与 HTTP API（apps/api）并列的入口适配层。
// 业务逻辑全部复用本模块 core；本文件只做：鉴权、参数适配、序列化、错误映射。

const SERVER_NAME = 'nano-brain';
const SERVER_VERSION = '0.1.0';
const TOKEN_ENV = 'NANO_BRAIN_MCP_TOKEN';

class McpAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpAuthError';
  }
}

// 与 HTTP API 一致：每次工具调用都按当前 Bearer Token 解析用户，尊重 token 过期。
async function resolveUserContext(): Promise<UserContext> {
  const token = process.env[TOKEN_ENV];
  if (!token) {
    throw new McpAuthError(`未配置 ${TOKEN_ENV}，MCP Server 无法确定调用者身份`);
  }
  const user = await getUserByBearerToken(token);
  if (!user) {
    throw new McpAuthError('Token 无效或已过期');
  }
  return { userId: user.id, username: user.username, isAdmin: user.isAdmin };
}

function toPublicLink(link: NanoLink) {
  return {
    id: link.id,
    source_id: link.sourceId,
    from_page_id: link.fromPageId,
    from_slug: link.fromSlug,
    to_source_id: link.toSourceId,
    to_slug: link.toSlug,
    link_type: link.linkType,
    context: link.context,
    confidence: link.confidence,
    created_by: link.createdBy,
    created_at: link.createdAt,
  };
}

function toPublicSource(source: NanoSource) {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    owner_user_id: source.ownerUserId,
    created_by: source.createdBy,
    created_at: source.createdAt,
    updated_at: source.updatedAt,
  };
}

function toPublicFact(fact: NanoFact) {
  return {
    id: fact.id,
    source_id: fact.sourceId,
    submission_id: fact.submissionId,
    entity_slug: fact.entitySlug,
    fact: fact.fact,
    kind: fact.kind,
    confidence: fact.confidence,
    notability: fact.notability,
    context: fact.context,
    valid_from: fact.validFrom,
    valid_until: fact.validUntil,
    claim_metric: fact.claimMetric,
    claim_value: fact.claimValue,
    claim_unit: fact.claimUnit,
    claim_period: fact.claimPeriod,
    evidence_url: fact.evidenceUrl,
    evidence_quote: fact.evidenceQuote,
    approved_by: fact.approvedBy,
    approved_at: fact.approvedAt,
    submitted_by: fact.submittedBy,
    submission_status: fact.submissionStatus,
    created_at: fact.createdAt,
    updated_at: fact.updatedAt,
  };
}

function toPublicAuditLog(log: AuditLog) {
  return {
    id: log.id,
    actor_user_id: log.actorUserId,
    action: log.action,
    target_type: log.targetType,
    target_id: log.targetId,
    previous_status: log.previousStatus,
    next_status: log.nextStatus,
    review_comment: log.reviewComment,
    payload: log.payload,
    created_at: log.createdAt,
  };
}

function toPublicFactSubmission(submission: FactSubmission) {
  return {
    id: submission.id,
    target_source_id: submission.targetSourceId,
    submitted_by: submission.submittedBy,
    raw_claim: submission.rawClaim,
    raw_evidence_text: submission.rawEvidenceText,
    raw_evidence_url: submission.rawEvidenceUrl,
    raw_context: submission.rawContext,
    warnings: submission.warnings,
    status: submission.status,
    normalized_candidates: submission.normalizedCandidates,
    created_at: submission.createdAt,
    updated_at: submission.updatedAt,
  };
}

function toPublicPage(page: NanoPage) {
  return {
    id: page.id,
    source_id: page.sourceId,
    slug: page.slug,
    title: page.title,
    body: page.body,
    content_hash: page.contentHash,
    created_by: page.createdBy,
    updated_by: page.updatedBy,
    created_at: page.createdAt,
    updated_at: page.updatedAt,
  };
}

function toPublicSearchResult(result: NanoSearchResult) {
  return {
    chunk_id: result.chunkId,
    page_id: result.pageId,
    source_id: result.sourceId,
    source_kind: result.sourceKind,
    source_name: result.sourceName,
    slug: result.slug,
    title: result.title,
    chunk_index: result.chunkIndex,
    snippet: result.snippet,
    score: result.score,
    match_types: result.matchTypes,
  };
}

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown): ToolResult {
  let code = 'internal_error';
  let message = '工具执行失败';
  if (error instanceof McpAuthError) {
    code = 'unauthorized';
    message = error.message;
  } else if (error instanceof NanoBrainPermissionError) {
    code = 'forbidden';
    message = error.message;
  } else if (error instanceof NanoBrainError) {
    code = error.code;
    message = error.message;
  } else if (error instanceof Error) {
    message = error.message;
  }
  if (code === 'internal_error') {
    console.error(error);
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: code, message }, null, 2) }],
    isError: true,
  };
}

// 把"鉴权 + 业务 + 序列化 + 错误映射"统一包装，工具处理器只关注核心调用。
function tool<Args>(handler: (ctx: UserContext, args: Args) => Promise<unknown>) {
  return async (args: Args): Promise<ToolResult> => {
    try {
      const ctx = await resolveUserContext();
      return ok(await handler(ctx, args));
    } catch (error) {
      return fail(error);
    }
  };
}

const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

server.registerTool(
  'nano_search',
  {
    title: '检索 Nano Brain',
    description:
      '在当前用户可读的 source 内做关键词 + 向量混合检索，返回带引用的 chunk 列表。用于"找内容/找相似段落"。',
    inputSchema: {
      query: z.string().min(1).max(500).describe('检索查询文本'),
      limit: z.number().int().min(1).max(30).optional().describe('返回结果数量上限，默认 10'),
      source_id: z.string().optional().describe('可选：限定只在该 source 内做查询级检索；不传则在全部可读 source 内检索'),
    },
  },
  tool<{ query: string; limit?: number; source_id?: string }>(async (ctx, args) => {
    const response = await searchNanoBrain(ctx, { query: args.query, limit: args.limit, source_id: args.source_id });
    return {
      query: response.query,
      results: response.results.map(toPublicSearchResult),
    };
  }),
);

server.registerTool(
  'nano_capture',
  {
    title: 'Capture 内容',
    description:
      '把一段文本或 Markdown 以低认知负担方式写入 Nano Brain。普通用户默认写入自己的私有 source；管理员可显式写入公共 source。写入后会复用 page pipeline 生成 chunk、embedding 与 Markdown links。',
    inputSchema: {
      text: z.string().min(1).max(1_000_000).optional().describe('普通文本内容；format 为 text 时使用'),
      markdown: z.string().min(1).max(1_000_000).optional().describe('Markdown 内容；format 为 markdown 时使用'),
      title: z.string().min(1).max(200).optional().describe('可选标题；不提供时从 Markdown H1 或时间生成'),
      format: z.enum(['text', 'markdown']).optional().describe('输入格式，默认根据 markdown/text 字段推断'),
      target: z.enum(['private', 'public']).optional().describe('目标范围，普通用户只能 private；管理员可 public'),
      source_id: z.string().min(1).optional().describe('管理员 capture 到公共 source 时必填'),
      slug: z.string().min(1).max(96).optional().describe('可选 slug；不提供时自动生成唯一 slug'),
    },
  },
  tool<{
    text?: string;
    markdown?: string;
    title?: string;
    format?: 'text' | 'markdown';
    target?: 'private' | 'public';
    source_id?: string;
    slug?: string;
  }>(async (ctx, args) => {
    const result = await captureContent(ctx, {
      text: args.text,
      markdown: args.markdown,
      title: args.title,
      format: args.format,
      target: args.target,
      sourceId: args.source_id,
      slug: args.slug,
    });
    return {
      capture: { target: result.target, format: result.format },
      source: toPublicSource(result.source),
      page: toPublicPage(result.page),
    };
  }),
);

server.registerTool(
  'nano_run_my_source_dream',
  {
    title: '运行我的 private source dream',
    description:
      '触发当前用户自己的 private source dream。普通用户只能运行自己的 user_source；权限和 HTTP Dream API 一致。',
    inputSchema: {
      source_id: z.string().min(1).describe('当前用户自己的 private source id'),
      phases: z.array(z.enum(['extract_links', 'refresh_embeddings', 'health_check', 'review_queue_summary'])).min(1).optional().describe('可选 dream phases；不提供时使用 source 默认 phases'),
      dry_run: z.boolean().optional().describe('是否 dry-run；dry-run 只写执行报告，不写派生数据'),
    },
  },
  tool<{ source_id: string; phases?: DreamPhase[]; dry_run?: boolean }>(async (ctx, args) => {
    const report = await runDream(ctx, {
      target: { type: 'user_source', sourceId: args.source_id, userId: ctx.userId },
      phases: args.phases,
      dryRun: args.dry_run,
    });
    return { run: toPublicDreamReport(report) };
  }),
);

server.registerTool(
  'nano_admin_run_dream',
  {
    title: '管理员运行 dream',
    description:
      '管理员工具：触发 public source dream 或审核队列 review_queue dream。普通用户调用会返回 forbidden。',
    inputSchema: {
      target_type: z.enum(['public_source', 'review_queue']).describe('dream 目标类型'),
      source_id: z.string().min(1).optional().describe('public_source 的 source id；也可作为 review_queue 的目标 public source id'),
      target_source_id: z.string().min(1).optional().describe('review_queue 可选：只汇总指定 public source 的审核队列'),
      phases: z.array(z.enum(['extract_links', 'refresh_embeddings', 'health_check', 'review_queue_summary'])).min(1).optional().describe('可选 dream phases；不提供时使用目标默认 phases'),
      dry_run: z.boolean().optional().describe('是否 dry-run'),
    },
  },
  tool<{
    target_type: 'public_source' | 'review_queue';
    source_id?: string;
    target_source_id?: string;
    phases?: DreamPhase[];
    dry_run?: boolean;
  }>(async (ctx, args) => {
    const target = args.target_type === 'public_source'
      ? { type: 'public_source' as const, sourceId: args.source_id ?? '' }
      : { type: 'review_queue' as const, targetSourceId: args.target_source_id ?? args.source_id };
    const report = await runDream(ctx, { target, phases: args.phases, dryRun: args.dry_run });
    return { run: toPublicDreamReport(report) };
  }),
);

server.registerTool(
  'nano_get_dream_status',
  {
    title: '查询 dream 状态',
    description: '查询当前可见的 dream 锁、最近 runs 和最近失败 runs。普通用户只会看到自己的 user_source dream。',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe('返回数量，默认 10'),
    },
  },
  tool<{ limit?: number }>(async (ctx, args) => {
    const status = await getDreamStatus(ctx, { limit: args.limit });
    return { status: toPublicDreamStatus(status) };
  }),
);

server.registerTool(
  'nano_get_dream_run',
  {
    title: '查询 dream run 报告',
    description: '按 run id 查询 dream 执行报告。普通用户只能读取自己的 user_source dream run。',
    inputSchema: {
      run_id: z.string().min(1).describe('dream run id'),
    },
  },
  tool<{ run_id: string }>(async (ctx, args) => {
    const report = await getReadableDreamRunReport(ctx, args.run_id);
    if (!report) throw new NanoBrainError('dream run 不存在', 'not_found');
    return { run: toPublicDreamReport(report) };
  }),
);

server.registerTool(
  'nano_submit_fact',
  {
    title: '提交事实线索',
    description:
      '把一条自然语言事实线索提交到公共 source 的审核队列。它不会直接写入公共 facts，也不会修改公共页面。证据可为空，但会产生 missing_evidence warning。',
    inputSchema: {
      target_source_id: z.string().min(1).describe('目标公共 source id'),
      raw_claim: z.string().min(1).max(4000).describe('用户提交的自然语言事实线索'),
      raw_evidence_text: z.string().max(12000).optional().describe('可选证据文本'),
      raw_evidence_url: z.string().max(2048).optional().describe('可选证据 URL，仅支持 http(s)'),
      raw_context: z.string().max(12000).optional().describe('可选上下文'),
    },
  },
  tool<{
    target_source_id: string;
    raw_claim: string;
    raw_evidence_text?: string;
    raw_evidence_url?: string;
    raw_context?: string;
  }>(async (ctx, args) => {
    const submission = await submitFactSubmission(ctx, {
      targetSourceId: args.target_source_id,
      rawClaim: args.raw_claim,
      rawEvidenceText: args.raw_evidence_text,
      rawEvidenceUrl: args.raw_evidence_url,
      rawContext: args.raw_context,
    });
    return { submission: toPublicFactSubmission(submission) };
  }),
);

server.registerTool(
  'nano_list_my_fact_submissions',
  {
    title: '列出我的事实提交',
    description: '列出当前用户自己的事实提交。管理员调用时默认列出全部提交，可按 submitted_by 过滤。',
    inputSchema: {
      status: z.enum(['pending_review', 'needs_changes', 'approved', 'rejected']).optional().describe('可选状态过滤'),
      submitted_by: z.string().optional().describe('管理员可选：按提交人过滤'),
      target_source_id: z.string().optional().describe('可选目标 source 过滤'),
      limit: z.number().int().min(1).max(200).optional().describe('返回数量，默认 50'),
    },
  },
  tool<{
    status?: FactSubmissionStatus;
    submitted_by?: string;
    target_source_id?: string;
    limit?: number;
  }>(async (ctx, args) => {
    const submissions = await listFactSubmissions(ctx, {
      status: args.status,
      submittedBy: args.submitted_by,
      targetSourceId: args.target_source_id,
      limit: args.limit,
    });
    return { submissions: submissions.map(toPublicFactSubmission) };
  }),
);

server.registerTool(
  'nano_admin_list_fact_submissions',
  {
    title: '管理员列出事实提交队列',
    description: '管理员工具：列出全部事实提交，可按 status / submitted_by / target_source_id 过滤。普通用户调用会返回 forbidden。',
    inputSchema: {
      status: z.enum(['pending_review', 'needs_changes', 'approved', 'rejected']).optional().describe('可选状态过滤'),
      submitted_by: z.string().optional().describe('可选提交人过滤'),
      target_source_id: z.string().optional().describe('可选目标 source 过滤'),
      limit: z.number().int().min(1).max(200).optional().describe('返回数量，默认 50'),
    },
  },
  tool<{
    status?: FactSubmissionStatus;
    submitted_by?: string;
    target_source_id?: string;
    limit?: number;
  }>(async (ctx, args) => {
    const submissions = await listAdminFactSubmissions(ctx, {
      status: args.status,
      submittedBy: args.submitted_by,
      targetSourceId: args.target_source_id,
      limit: args.limit,
    });
    return { submissions: submissions.map(toPublicFactSubmission) };
  }),
);

server.registerTool(
  'nano_save_fact_candidates',
  {
    title: '保存结构化事实候选',
    description:
      '管理员/Agent 工具：将 Agent 生成的结构化 candidates 保存回 fact submission.normalized_candidates。core 会做权限和 schema 校验。',
    inputSchema: {
      submission_id: z.string().min(1).describe('事实提交 id'),
      candidates: z
        .array(
          z.object({
            entity_slug: z.string().nullable().optional().describe('可选实体 slug'),
            fact: z.string().min(1).max(4000).describe('人类可读原子事实'),
            kind: z.enum(['fact', 'event', 'preference', 'commitment', 'belief']).describe('事实类型'),
            confidence: z.number().min(0).max(1).describe('事实可信度 0-1'),
            notability: z.enum(['high', 'medium', 'low']).describe('重要性'),
            claim_metric: z.string().optional().describe('可选指标名'),
            claim_value: z.number().optional().describe('可选数值'),
            claim_unit: z.string().optional().describe('可选单位'),
            claim_period: z.string().optional().describe('可选周期'),
            evidence_quote: z.string().optional().describe('可选证据摘录'),
            normalization_confidence: z.number().min(0).max(1).describe('候选结构化置信度 0-1'),
            warnings: z
              .array(z.union([z.string(), z.object({ code: z.string(), message: z.string() })]))
              .optional()
              .describe('可选候选 warning'),
          }),
        )
        .min(1)
        .max(20)
        .describe('Agent 生成的结构化候选列表'),
      generated_by: z.string().optional().describe('可选生成者类型，例如 agent'),
      generator: z.string().optional().describe('可选生成器名称，例如 admin-agent'),
    },
  },
  tool<{
    submission_id: string;
    candidates: unknown[];
    generated_by?: string;
    generator?: string;
  }>(async (ctx, args) => {
    const submission = await saveFactCandidates(ctx, {
      submissionId: args.submission_id,
      candidates: args.candidates,
      generatedBy: args.generated_by,
      generator: args.generator,
    });
    return { submission: toPublicFactSubmission(submission) };
  }),
);

server.registerTool(
  'nano_get_fact_submission',
  {
    title: '读取事实提交',
    description: '读取单条事实提交。普通用户只能读取自己的提交，管理员可读取全部。',
    inputSchema: {
      submission_id: z.string().min(1).describe('事实提交 id'),
    },
  },
  tool<{ submission_id: string }>(async (ctx, args) => {
    const submission = await getFactSubmission(ctx, args.submission_id);
    return { submission: toPublicFactSubmission(submission) };
  }),
);

server.registerTool(
  'nano_admin_review_fact_submission',
  {
    title: '管理员审核事实提交',
    description:
      '管理员工具：对事实提交执行 approve、reject 或 request_changes。通过时写入事实表并记录审计；驳回或要求补充不写事实表。',
    inputSchema: {
      submission_id: z.string().min(1).describe('事实提交 id'),
      action: z.enum(['approve', 'reject', 'request_changes']).describe('审核动作'),
      approved_fact: z
        .object({
          entity_slug: z.string().nullable().optional().describe('可选实体 slug'),
          fact: z.string().min(1).max(4000).describe('最终批准的事实文本'),
          kind: z.enum(['fact', 'event', 'preference', 'commitment', 'belief']).describe('事实类型'),
          confidence: z.number().min(0).max(1).describe('可信度 0-1'),
          notability: z.enum(['high', 'medium', 'low']).describe('重要性'),
          context: z.string().optional().describe('可选上下文'),
          valid_from: z.string().optional().describe('可选生效日期，格式 YYYY-MM-DD'),
          valid_until: z.string().optional().describe('可选失效日期，格式 YYYY-MM-DD'),
          claim_metric: z.string().optional().describe('可选指标名'),
          claim_value: z.number().optional().describe('可选数值'),
          claim_unit: z.string().optional().describe('可选单位'),
          claim_period: z.string().optional().describe('可选周期'),
          evidence_url: z.string().optional().describe('可选证据 URL，仅支持 http(s)'),
          evidence_quote: z.string().optional().describe('可选证据摘录'),
        })
        .optional()
        .describe('通过时必填的最终批准事实；可为候选的修改版'),
      review_comment: z.string().optional().describe('审核说明；驳回或要求补充时必填'),
    },
  },
  tool<{
    submission_id: string;
    action: FactReviewAction;
    approved_fact?: unknown;
    review_comment?: string;
  }>(async (ctx, args) => {
    const result = await reviewFactSubmission(ctx, {
      submissionId: args.submission_id,
      action: args.action,
      approvedFact: args.approved_fact,
      reviewComment: args.review_comment,
    });
    return {
      submission: toPublicFactSubmission(result.submission),
      fact: result.fact ? toPublicFact(result.fact) : null,
      audit_log: toPublicAuditLog(result.auditLog),
    };
  }),
);

server.registerTool(
  'nano_list_facts',
  {
    title: '列出公共 facts',
    description:
      '列出当前用户可读 source 中已审核通过的 facts。普通用户可读公共 source 的 approved facts；管理员可读全部 facts，并可按 source/submitted_by/status 过滤。',
    inputSchema: {
      source_id: z.string().optional().describe('可选 source id 过滤'),
      entity_slug: z.string().optional().describe('可选实体 slug 过滤'),
      submitted_by: z.string().optional().describe('可选提交人过滤；管理员常用'),
      status: z.enum(['pending_review', 'needs_changes', 'approved', 'rejected']).optional().describe('可选 submission 状态过滤'),
      limit: z.number().int().min(1).max(200).optional().describe('返回数量，默认 50'),
    },
  },
  tool<{
    source_id?: string;
    entity_slug?: string;
    submitted_by?: string;
    status?: FactSubmissionStatus;
    limit?: number;
  }>(async (ctx, args) => {
    const facts = await listFacts(ctx, {
      sourceId: args.source_id,
      entitySlug: args.entity_slug,
      submittedBy: args.submitted_by,
      status: args.status,
      limit: args.limit,
    });
    return { facts: facts.map(toPublicFact) };
  }),
);

server.registerTool(
  'nano_get_fact',
  {
    title: '读取 fact',
    description: '按 fact id 读取单条已审核 fact。结果按当前用户可读 source 过滤。',
    inputSchema: {
      fact_id: z.string().min(1).describe('fact id'),
    },
  },
  tool<{ fact_id: string }>(async (ctx, args) => {
    const fact = await getFact(ctx, args.fact_id);
    return { fact: toPublicFact(fact) };
  }),
);

server.registerTool(
  'nano_get_entity_facts',
  {
    title: '读取实体 facts',
    description: '按 entity_slug 列出当前用户可读 source 中已审核通过的 facts。',
    inputSchema: {
      entity_slug: z.string().min(1).describe('实体 slug'),
      source_id: z.string().optional().describe('可选 source id 过滤'),
      submitted_by: z.string().optional().describe('可选提交人过滤；管理员常用'),
      status: z.enum(['pending_review', 'needs_changes', 'approved', 'rejected']).optional().describe('可选 submission 状态过滤'),
      limit: z.number().int().min(1).max(200).optional().describe('返回数量，默认 50'),
    },
  },
  tool<{
    entity_slug: string;
    source_id?: string;
    submitted_by?: string;
    status?: FactSubmissionStatus;
    limit?: number;
  }>(async (ctx, args) => {
    const facts = await listEntityFacts(ctx, args.entity_slug, {
      sourceId: args.source_id,
      submittedBy: args.submitted_by,
      status: args.status,
      limit: args.limit,
    });
    return { facts: facts.map(toPublicFact) };
  }),
);

server.registerTool(
  'nano_admin_list_audit_logs',
  {
    title: '管理员列出审计日志',
    description: '管理员工具：列出审计日志，可按 action、target_type、target_id、actor_user_id 过滤。',
    inputSchema: {
      action: z
        .enum(['fact_submission.approve', 'fact_submission.reject', 'fact_submission.request_changes'])
        .optional()
        .describe('可选审计动作过滤'),
      target_type: z.string().optional().describe('可选目标类型过滤，例如 fact_submission'),
      target_id: z.string().optional().describe('可选目标 id 过滤'),
      actor_user_id: z.string().optional().describe('可选操作者过滤'),
      limit: z.number().int().min(1).max(200).optional().describe('返回数量，默认 50'),
    },
  },
  tool<{
    action?: AuditAction;
    target_type?: string;
    target_id?: string;
    actor_user_id?: string;
    limit?: number;
  }>(async (ctx, args) => {
    const logs = await listAuditLogs(ctx, {
      action: args.action,
      targetType: args.target_type,
      targetId: args.target_id,
      actorUserId: args.actor_user_id,
      limit: args.limit,
    });
    return { audit_logs: logs.map(toPublicAuditLog) };
  }),
);

server.registerTool(
  'nano_get_page',
  {
    title: '读取页面',
    description: '按 source_id 与 slug 读取单个 Markdown 页面全文。无权读取该 source 时返回 forbidden。',
    inputSchema: {
      source_id: z.string().min(1).describe('页面所属 source 的 id'),
      slug: z.string().min(1).describe('页面 slug'),
    },
  },
  tool<{ source_id: string; slug: string }>(async (ctx, args) => {
    const page = await getPage(ctx, { sourceId: args.source_id, slug: args.slug });
    return toPublicPage(page);
  }),
);

server.registerTool(
  'nano_get_links',
  {
    title: '正向链接',
    description: '列出某页面（source_id + slug）指向的所有出链。可选按 link_type 过滤。需要对该 source 有读权限。',
    inputSchema: {
      source_id: z.string().min(1).describe('页面所属 source 的 id'),
      slug: z.string().min(1).describe('页面 slug'),
      link_type: z.string().optional().describe('可选关系类型过滤，例如 mentions'),
    },
  },
  tool<{ source_id: string; slug: string; link_type?: string }>(async (ctx, args) => {
    const links = await listOutgoingLinks(ctx, {
      sourceId: args.source_id,
      slug: args.slug,
      linkType: args.link_type,
    });
    return { links: links.map(toPublicLink) };
  }),
);

server.registerTool(
  'nano_get_backlinks',
  {
    title: '反向链接',
    description:
      '列出所有指向该 slug 的页面（反链）。结果在数据库层按当前用户可读 source 过滤，不会泄露无权访问的私有页面。',
    inputSchema: {
      slug: z.string().min(1).describe('被指向的目标 slug'),
      link_type: z.string().optional().describe('可选关系类型过滤，例如 mentions'),
    },
  },
  tool<{ slug: string; link_type?: string }>(async (ctx, args) => {
    const links = await listBacklinks(ctx, { slug: args.slug, linkType: args.link_type });
    return { links: links.map(toPublicLink) };
  }),
);

server.registerTool(
  'nano_graph_query',
  {
    title: '图谱遍历',
    description:
      '从某个 slug 出发做广度遍历，返回节点与关系边。depth 第一阶段支持 1-2，direction 取 out/in/both。结果按当前用户可读 source 过滤。',
    inputSchema: {
      slug: z.string().min(1).describe('起始节点 slug'),
      depth: z.number().int().min(1).max(2).optional().describe('遍历深度，1 或 2，默认 1'),
      direction: z.enum(['out', 'in', 'both']).optional().describe('遍历方向，默认 both'),
      link_type: z.string().optional().describe('可选关系类型过滤，例如 mentions'),
    },
  },
  tool<{ slug: string; depth?: number; direction?: 'out' | 'in' | 'both'; link_type?: string }>(
    async (ctx, args) => {
      const result = await graphQuery(ctx, {
        slug: args.slug,
        depth: args.depth,
        direction: args.direction,
        linkType: args.link_type,
      });
      return {
        root_slug: result.rootSlug,
        depth: result.depth,
        direction: result.direction,
        nodes: result.nodes,
        links: result.links.map(toPublicLink),
      };
    },
  ),
);

export async function startNanoBrainMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio 模式下不能往 stdout 写非协议内容，日志走 stderr。
  console.error(`[${SERVER_NAME}] MCP Server 已启动（stdio），版本 ${SERVER_VERSION}`);
}

if (import.meta.main) {
  startNanoBrainMcpServer().catch((error) => {
    console.error('MCP Server 启动失败：', error);
    process.exit(1);
  });
}
