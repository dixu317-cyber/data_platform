export type AgentProvider = 'openai-compatible';

export type AgentModelConfig = {
  provider: AgentProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  streamUsage: boolean;
};

export class AgentConfigError extends Error {
  constructor(
    message: string,
    public readonly code: 'missing_config' | 'unsupported_provider' | 'invalid_config' = 'missing_config',
  ) {
    super(message);
    this.name = 'AgentConfigError';
  }
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new AgentConfigError(`未配置 ${name}，无法初始化 Agent 模型`, 'missing_config');
  }
  return value;
}

function readTemperature(env: NodeJS.ProcessEnv): number {
  const raw = env.AGENT_TEMPERATURE?.trim();
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    throw new AgentConfigError('AGENT_TEMPERATURE 必须是 0 到 2 之间的数字', 'invalid_config');
  }
  return value;
}

export function getAgentModelConfig(env: NodeJS.ProcessEnv = process.env): AgentModelConfig {
  const provider = readRequiredEnv(env, 'AGENT_PROVIDER');
  if (provider !== 'openai-compatible') {
    throw new AgentConfigError(
      `AGENT_PROVIDER=${provider} 暂不支持；M26 仅支持 openai-compatible`,
      'unsupported_provider',
    );
  }

  return {
    provider,
    baseUrl: readRequiredEnv(env, 'AGENT_BASE_URL'),
    apiKey: readRequiredEnv(env, 'AGENT_API_KEY'),
    model: readRequiredEnv(env, 'AGENT_MODEL'),
    temperature: readTemperature(env),
    // OpenAI-compatible proxy / router 常不支持 stream_options；默认关闭 usage streaming。
    streamUsage: env.AGENT_STREAM_USAGE === 'true',
  };
}
