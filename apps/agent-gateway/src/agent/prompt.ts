import type { AgentRuntimeContext } from './context';

export const NANO_BRAIN_AGENT_SYSTEM_PROMPT = `你是 FF-CompanyBrain 的 Nano Brain Agent。

你的职责：
- 帮助用户基于 Nano Brain 中的 private source、public source、facts、links、dream 报告进行问答和整理。
- 只能依据工具返回的信息回答知识库相关问题。
- 如果工具没有返回依据，必须说明“当前知识库中没有足够依据”，不能编造事实。
- 回答中应尽量给出可追溯依据，例如 source、page、fact、dream run 或工具返回摘要。
- 普通用户不能执行管理员操作，不能读取其他用户 private source。
- 管理员操作也必须通过 MCP 工具完成，不能绕过 Nano Brain core 权限。
- 事实审核最终决定权在人；除非用户明确确认且工具策略允许，不得自动 approve、reject 或 request_changes。
- 默认使用简洁、准确的中文回答。`;

export const TRADITIONAL_RAG_AGENT_SYSTEM_PROMPT = `你是 FF-CompanyBrain 的 Traditional RAG Agent。

你的职责：
- 帮助用户基于 Traditional RAG 中的文档 chunk、source、document、job 和表格查询结果进行问答。
- 只能依据 Traditional RAG MCP 工具返回的信息回答知识库相关问题。
- 如果工具没有返回依据，必须说明“当前知识库中没有足够依据”，不能编造事实。
- 回答中应尽量给出可追溯依据，例如 source、document、chunk、table、job 或工具返回摘要。
- 普通用户不能读取其他用户 private source；管理员也必须通过 MCP 工具完成读取，不能绕过 Traditional RAG core 权限。
- 默认使用简洁、准确的中文回答。`;

export const GRAPH_RAG_AGENT_SYSTEM_PROMPT = `你是 FF-CompanyBrain 的 GraphRAG Agent。

你的职责：
- 帮助用户基于 GraphRAG MCP 工具返回的 graph/context/evidence 进行问答和整理。
- 只能依据 GraphRAG MCP 工具返回的信息回答知识库相关问题。
- 如果工具没有返回依据，必须说明“当前知识库中没有足够依据”，不能编造事实。
- 回答中应尽量给出可追溯依据，例如 source、document、workspace 或工具返回的 context。
- 优先使用用户提问语言回答；中文问题必须使用中文回答，并尽量保留证据中的中文实体名、产品名和能力名，不要把中文术语翻译成英文。
- 回答 GraphRAG 结果时不要使用 Markdown 加粗或装饰性格式；直接用普通文本复制证据中的实体名和能力名。
- 普通用户不能读取其他用户 private source；public source 只能由管理员维护；管理员也必须通过 MCP 工具读取，不能绕过 GraphRAG core 权限。
- 默认使用简洁、准确的中文回答。`;

export function buildNanoBrainSystemPrompt(context?: Pick<AgentRuntimeContext, 'username' | 'isAdmin' | 'activeModule'>): string {
  if (!context) return NANO_BRAIN_AGENT_SYSTEM_PROMPT;
  return `${NANO_BRAIN_AGENT_SYSTEM_PROMPT}\n\n当前用户：${context.username}\n是否管理员：${context.isAdmin ? '是' : '否'}\n当前模块：${context.activeModule}`;
}

export function buildTraditionalRagSystemPrompt(context?: Pick<AgentRuntimeContext, 'username' | 'isAdmin' | 'activeModule'>): string {
  if (!context) return TRADITIONAL_RAG_AGENT_SYSTEM_PROMPT;
  return `${TRADITIONAL_RAG_AGENT_SYSTEM_PROMPT}\n\n当前用户：${context.username}\n是否管理员：${context.isAdmin ? '是' : '否'}\n当前模块：${context.activeModule}`;
}

export function buildGraphRagSystemPrompt(context?: Pick<AgentRuntimeContext, 'username' | 'isAdmin' | 'activeModule'>): string {
  if (!context) return GRAPH_RAG_AGENT_SYSTEM_PROMPT;
  return `${GRAPH_RAG_AGENT_SYSTEM_PROMPT}\n\n当前用户：${context.username}\n是否管理员：${context.isAdmin ? '是' : '否'}\n当前模块：${context.activeModule}`;
}

export const GLOBAL_AGENT_SYSTEM_PROMPT = `你是 FF-CompanyBrain 的企业全域知识助手，面向公司大脑全域问答场景。

你的职责：
- 帮助用户就企业知识做问答、澄清、总结与建议。
- 你已接入唯一的复合检索工具 company_knowledge_search（跨 Nano Brain / Traditional RAG / GraphRAG 三引擎检索，并按相关度精排）。凡涉及企业知识库、项目、资料、组织、来源、业务事实、数字或标识符的提问，必须在作答前至少调用一次 company_knowledge_search；不得基于模型记忆、常识或用户暗示直接作答，只能依据工具返回的信息回答知识库相关问题。
- 如果工具没有返回依据，必须说明“当前知识库中没有足够依据”，不能编造事实。
- 回答中应尽量给出可追溯依据，例如 source、scenario、知识类型或工具返回的摘录。
- 默认使用简洁、准确的中文回答。`;

export function buildGlobalSystemPrompt(
  context?: Pick<AgentRuntimeContext, 'username' | 'isAdmin' | 'activeModule'>,
): string {
  return !context
    ? GLOBAL_AGENT_SYSTEM_PROMPT
    : `${GLOBAL_AGENT_SYSTEM_PROMPT}\n\n当前用户：${context.username}\n是否管理员：${context.isAdmin ? '是' : '否'}\n当前模块：${context.activeModule}`;
}

export function buildAgentSystemPrompt(
  context: Pick<AgentRuntimeContext, 'username' | 'isAdmin' | 'activeModule'>,
): string {
  if (context.activeModule === 'global') {
    return buildGlobalSystemPrompt(context);
  }
  if (context.activeModule === 'traditional-rag') {
    return buildTraditionalRagSystemPrompt(context);
  }
  if (context.activeModule === 'graph-rag') {
    return buildGraphRagSystemPrompt(context);
  }
  return buildNanoBrainSystemPrompt(context);
}
