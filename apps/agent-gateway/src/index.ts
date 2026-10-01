import { getRegisteredModules } from '@ff/gateway';
import { getModuleMcpDescriptors } from './mcpRegistry';
import { startAgentGatewayHttpServer } from './http/server';

// Agent Gateway 是 LangChain/Agent 编排入口，不实现任何 RAG 工具业务逻辑。
// 生产 non-global runtime 通过受保护模块 HTTP 编排 native Tools；每个模块的
// MCP Server 仍作为外部 Agent/教学适配器保留，不是 Gateway 会话依赖。
export function describeAgentGateway() {
  return {
    role: 'agent-orchestrator',
    modules: getRegisteredModules(),
    mcpServers: getModuleMcpDescriptors(),
    http: {
      service: 'agent-gateway',
      port: Number(process.env.AGENT_GATEWAY_PORT ?? 3002),
      routes: [
        'POST /agent/conversations',
        'GET /agent/conversations',
        'GET /agent/conversations/:conversationId',
        'GET /agent/conversations/:conversationId/runs/:runId',
      ],
    },
  };
}

export { closeAgentGatewayPool, getAgentGatewayPool } from './db';
export { migrateAgentGatewayDatabase } from './migrations';
export { createAgentGatewayHttpApp, startAgentGatewayHttpServer } from './http/server';
export {
  ADMIN_REVIEW_AGENT_ALLOWED_TOOLS,
  ADMIN_REVIEW_AGENT_SYSTEM_PROMPT,
  ADMIN_REVIEW_HIGH_RISK_TOOLS,
  adminReviewContextSchema,
  adminReviewToolPolicyMiddleware,
  assertAdminReviewUser,
  buildAdminReviewToolPolicy,
  createAdminReviewAgent,
  type AdminReviewToolPolicy,
} from './agent/admin-review';
export {
  createAdminReviewModuleHttpTools,
  createModuleHttpTools,
  MODULE_HTTP_TOOL_MATRIX,
  type CreateAdminReviewModuleHttpToolsInput,
  type CreateModuleHttpToolsInput,
  type ModuleHttpCall,
} from './agent/module-http-tools';
export {
  closeAgentPostgresSaver,
  getAgentPostgresSaver,
  hasAgentModelEnv,
  readConversationCheckpointMessages,
  serializeCheckpointMessage,
  type CheckpointMessageDto,
} from './agent/checkpointer';
export { AgentConfigError, getAgentModelConfig, type AgentModelConfig, type AgentProvider } from './agent/config';
export { agentContextSchema, buildAgentRuntimeContext, type AgentRuntimeContext } from './agent/context';
export { createAgentChatModel, createCompanyBrainAgent } from './agent/factory';
export {
  AgentMcpError,
  NANO_BRAIN_MCP_SERVER_NAME,
  TRADITIONAL_RAG_MCP_SERVER_NAME,
  buildTraditionalRagMcpEnv,
  createTraditionalRagMcpClient,
  getAllowedTraditionalRagMcpToolNames,
  buildNanoBrainMcpEnv,
  createNanoBrainMcpClient,
  getAllowedNanoBrainMcpToolNames,
  loadCompanyBrainMcpTools,
  loadNanoBrainMcpTools,
  loadTraditionalRagMcpTools,
  type CompanyBrainMcpToolsSession,
  type NanoBrainMcpToolPolicy,
  type NanoBrainMcpToolsSession,
} from './agent/mcp';
export {
  NANO_BRAIN_AGENT_SYSTEM_PROMPT,
  TRADITIONAL_RAG_AGENT_SYSTEM_PROMPT,
  buildAgentSystemPrompt,
  buildNanoBrainSystemPrompt,
  buildTraditionalRagSystemPrompt,
} from './agent/prompt';
export { prepareAgentStream, type AgentStreamDependencies, type AgentStreamEvent, type AgentStreamEventName, type AgentStreamMode, type PreparedAgentStream } from './agent/stream';
export {
  AgentGatewayError,
  SUPPORTED_AGENT_MODULES,
  createAgentConversation,
  createAgentRun,
  createAgentRunForTest,
  createAgentToolCall,
  getAgentConversation,
  getAgentRun,
  listAgentConversations,
  updateAgentRun,
  updateAgentToolCall,
  toPublicConversation,
  toPublicRun,
  toPublicToolCall,
  type AgentConversation,
  type AgentConversationDetails,
  type AgentConversationStatus,
  type CheckpointMessage,
  type AgentRun,
  type AgentRunDetails,
  type AgentRunStatus,
  type AgentToolCall,
  type AgentToolCallStatus,
} from './core/conversations';

if (import.meta.main) {
  await startAgentGatewayHttpServer();
}
