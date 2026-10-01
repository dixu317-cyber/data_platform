import { createMiddleware, ToolMessage } from 'langchain';
import type { UserContext } from '@ff/contracts';
import { z } from 'zod';
import { createCompanyBrainAgent, type CreateCompanyBrainAgentInput } from './factory';

export const ADMIN_REVIEW_AGENT_ALLOWED_TOOLS = [
  'nano_admin_list_fact_submissions',
  'nano_get_fact_submission',
  'nano_save_fact_candidates',
  'nano_get_dream_status',
  'nano_get_dream_run',
  'nano_list_facts',
] as const;

export const ADMIN_REVIEW_HIGH_RISK_TOOLS = ['nano_admin_review_fact_submission'] as const;

export const ADMIN_REVIEW_AGENT_SYSTEM_PROMPT = `你是 FF-CompanyBrain 的管理员事实审核辅助 Agent。

你可以：
- 读取事实提交队列和单条提交。
- 读取公共 facts 和 dream 报告。
- 总结审核风险、缺失证据、疑似重复和疑似冲突。
- 将结构化事实候选保存到 submission.normalized_candidates，供管理员查看。
- 给出 approve_candidate / reject_candidate / request_changes_candidate 等建议。

你绝不能：
- 自动 approve、reject 或 request_changes。
- 声称已经完成审核决定。
- 调用或尝试调用 nano_admin_review_fact_submission。
- 绕过 Nano Brain core 权限。

如果你认为应该通过，请只说：建议 approve_candidate，必须由人类管理员在审核 UI 或显式后端确认流程中点击通过。`;

export type AdminReviewToolPolicy = {
  allowedTools: string[];
  highRiskTools: string[];
  allowAutoApprove: false;
};

export const adminReviewContextSchema = z.object({
  userId: z.string().min(1),
  username: z.string().min(1),
  isAdmin: z.boolean(),
  activeModule: z.literal('nano-brain'),
  conversationId: z.string().min(1),
  runId: z.string().min(1),
  requestId: z.string().optional(),
  locale: z.string().default('zh-CN'),
  permissions: z.array(z.string()).default([]),
  toolPolicy: z.object({
    allowedTools: z.array(z.string()),
    highRiskTools: z.array(z.string()),
    allowAutoApprove: z.literal(false),
  }),
});

export function buildAdminReviewToolPolicy(): AdminReviewToolPolicy {
  return {
    allowedTools: [...ADMIN_REVIEW_AGENT_ALLOWED_TOOLS],
    highRiskTools: [...ADMIN_REVIEW_HIGH_RISK_TOOLS],
    allowAutoApprove: false,
  };
}

export function assertAdminReviewUser(user: UserContext): void {
  if (!user.isAdmin) {
    throw new Error('只有管理员可以使用管理员审核辅助 Agent');
  }
}

function getAllowedToolsFromRuntime(): string[] {
  // The policy object in runtime context is observability metadata only. Tool
  // visibility must be sourced from this server-side constant, never caller or
  // model-controlled runtime input.
  return [...ADMIN_REVIEW_AGENT_ALLOWED_TOOLS];
}

export const adminReviewToolPolicyMiddleware = createMiddleware({
  name: 'AdminReviewToolPolicy',
  contextSchema: adminReviewContextSchema,
  wrapModelCall: async (request: any, handler: any) => {
    const allowedTools = new Set(getAllowedToolsFromRuntime());
    const tools = (request.tools ?? []).filter((tool: any) => allowedTools.has(tool.name));
    return handler({ ...request, tools });
  },
  wrapToolCall: async (request: any, handler: any) => {
    const allowedTools = new Set(getAllowedToolsFromRuntime());
    const name = request.toolCall?.name;
    const toolCallId = request.toolCall?.id ?? 'unknown_tool_call';

    if (ADMIN_REVIEW_HIGH_RISK_TOOLS.includes(name as any)) {
      return new ToolMessage({
        tool_call_id: toolCallId,
        content: 'DENIED: 自动审核动作被禁止。请让人类管理员在审核 UI 或显式确认流程中执行 approve/reject/request_changes。',
      });
    }

    if (!allowedTools.has(name)) {
      return new ToolMessage({
        tool_call_id: toolCallId,
        content: `DENIED: tool '${name}' 不在管理员审核辅助 Agent 的允许工具列表中。`,
      });
    }

    return handler(request);
  },
} as any);

export function createAdminReviewAgent(input: CreateCompanyBrainAgentInput = {}) {
  return createCompanyBrainAgent({
    ...input,
    systemPrompt: input.systemPrompt ?? ADMIN_REVIEW_AGENT_SYSTEM_PROMPT,
    middleware: [...(input.middleware ?? []), adminReviewToolPolicyMiddleware],
  });
}
