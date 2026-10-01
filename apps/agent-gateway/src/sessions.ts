import type { ModuleId, UserContext } from '@ff/contracts';
import { getModuleMcpDescriptor } from './mcpRegistry';

export type McpSessionLaunchPlan = {
  moduleId: ModuleId;
  command: string;
  env: Record<string, string>;
};

export type AgentSessionInput = {
  user: UserContext;
  bearerToken: string;
  activeModule: ModuleId;
};

export function buildPerUserMcpLaunchPlan(input: AgentSessionInput): McpSessionLaunchPlan {
  const descriptor = getModuleMcpDescriptor(input.activeModule);

  // stdio MCP 是进程级连接，不能用一个长期进程承载多个用户的 token。
  // 因此当前方案是：Agent 会话按 active_module 启动独立 MCP 子进程，并通过模块约定的 env 注入当前用户 token。
  // 后续如果模块支持 Streamable HTTP MCP，可将这里替换为每请求签名/内部 JWT。
  return {
    moduleId: input.activeModule,
    command: descriptor.command,
    env: {
      [descriptor.envTokenName]: input.bearerToken,
      FF_USER_ID: input.user.userId,
      FF_USERNAME: input.user.username,
      FF_IS_ADMIN: String(input.user.isAdmin),
    },
  };
}
