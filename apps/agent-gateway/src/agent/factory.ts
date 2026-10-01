import { createAgent } from 'langchain';
import { ChatOpenAI } from '@langchain/openai';
import { agentContextSchema } from './context';
import { getAgentModelConfig, type AgentModelConfig } from './config';
import { NANO_BRAIN_AGENT_SYSTEM_PROMPT } from './prompt';
import { ReasoningContentChatOpenAICompletions } from './reasoning-content';

export type CreateCompanyBrainAgentInput = {
  model?: unknown;
  tools?: unknown[];
  systemPrompt?: string;
  checkpointer?: unknown;
  middleware?: unknown[];
};

export function createAgentChatModel(config: AgentModelConfig = getAgentModelConfig()): ChatOpenAI {
  const fields = {
    model: config.model,
    apiKey: config.apiKey,
    temperature: config.temperature,
    streamUsage: config.streamUsage,
    configuration: {
      baseURL: config.baseUrl,
    },
  };

  return new ChatOpenAI({
    ...fields,
    // F04：推理模型在工具结果后的下一轮要求原样回传 reasoning_content。自有 completions
    // 适配层只补齐提供方请求，不改变 AGENT_* 配置来源，也不向用户侧暴露该内容。
    completions: new ReasoningContentChatOpenAICompletions(fields),
  });
}

export function createCompanyBrainAgent(input: CreateCompanyBrainAgentInput = {}) {
  return createAgent({
    model: input.model ?? createAgentChatModel(),
    tools: input.tools ?? [],
    systemPrompt: input.systemPrompt ?? NANO_BRAIN_AGENT_SYSTEM_PROMPT,
    contextSchema: agentContextSchema,
    checkpointer: input.checkpointer,
    middleware: input.middleware,
  } as any);
}
