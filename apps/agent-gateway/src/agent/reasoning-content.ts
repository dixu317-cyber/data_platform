import { AsyncLocalStorage } from 'node:async_hooks';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatGenerationChunk, ChatResult } from '@langchain/core/outputs';
import { ChatOpenAICompletions } from '@langchain/openai';

type CompletionMessage = Record<string, unknown>;
type CompletionRequest = Record<string, unknown> & { messages?: unknown[] };
const MAX_PENDING_REASONING_TOOL_CALLS = 64;

/**
 * A provider protocol failure is safer than silently sending an incomplete
 * thinking history. Callers can surface this as a failed run and retry with a
 * shorter history; they must never receive a cross-run or truncated mapping.
 */
export class ReasoningContentCapacityError extends Error {
  constructor(maxPendingToolCalls: number) {
    super(`reasoning_content protocol state exceeds the ${maxPendingToolCalls} tool-call limit`);
    this.name = 'ReasoningContentCapacityError';
  }
}

// 只在当前模型调用的异步上下文中保留 "tool call id -> provider reasoning_content" 映射。
// 它只用于下一次发往模型提供方的请求，不写日志、不进入 SSE，也不串到并发会话。
const reasoningContentContext = new AsyncLocalStorage<ReadonlyMap<string, string>>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function toolCallIdsFromMessage(message: BaseMessage): string[] {
  const candidate = message as BaseMessage & {
    tool_calls?: unknown;
    additional_kwargs?: { tool_calls?: unknown };
  };
  const directToolCalls = Array.isArray(candidate.tool_calls) && candidate.tool_calls.length > 0
    ? candidate.tool_calls
    : candidate.additional_kwargs?.tool_calls;
  if (!Array.isArray(directToolCalls)) return [];

  return directToolCalls
    .map((toolCall) => asRecord(toolCall)?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * LangChain 已把 provider 的 reasoning_content 放进 AIMessage.additional_kwargs；这里将它和
 * tool call id 绑定，供同一轮工具结果后的下一次 Chat Completions 请求使用。
 */
export function collectReasoningContentByToolCallId(messages: readonly BaseMessage[]): ReadonlyMap<string, string> {
  const reasoningByToolCallId = new Map<string, string>();
  for (const message of messages) {
    const reasoningContent = (message as BaseMessage & {
      additional_kwargs?: { reasoning_content?: unknown };
    }).additional_kwargs?.reasoning_content;
    if (typeof reasoningContent !== 'string') continue;

    for (const toolCallId of toolCallIdsFromMessage(message)) {
      reasoningByToolCallId.set(toolCallId, reasoningContent);
    }
  }
  return reasoningByToolCallId;
}

/**
 * `@langchain/openai` 目前的 completions 出站转换会丢弃 additional_kwargs.reasoning_content。
 * 仅在 assistant 工具调用消息的所有 tool call id 都精确命中同一段内容时补回，避免不确定匹配
 * 或跨消息混入。函数保持输入不可变，便于并发调用隔离。
 */
export function attachReasoningContentToCompletionRequest<T extends CompletionRequest>(
  request: T,
  reasoningByToolCallId: ReadonlyMap<string, string>,
): T {
  if (!Array.isArray(request.messages) || reasoningByToolCallId.size === 0) return request;

  let changed = false;
  const messages = request.messages.map((rawMessage) => {
    const message = asRecord(rawMessage);
    if (!message || message.role !== 'assistant' || 'reasoning_content' in message || !Array.isArray(message.tool_calls)) {
      return rawMessage;
    }

    const toolCallIds = message.tool_calls
      .map((toolCall) => asRecord(toolCall)?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (toolCallIds.length === 0) return rawMessage;

    const matchingReasoningContent = toolCallIds.map((toolCallId) => reasoningByToolCallId.get(toolCallId));
    if (matchingReasoningContent.some((value) => value === undefined)) return rawMessage;
    const distinctReasoningContent = new Set(matchingReasoningContent);
    if (distinctReasoningContent.size !== 1) return rawMessage;

    changed = true;
    return { ...message, reasoning_content: matchingReasoningContent[0] };
  });

  return changed ? { ...request, messages } as T : request;
}

function mergeReasoningContentMaps(
  persisted: ReadonlyMap<string, string>,
  currentRequest: ReadonlyMap<string, string> | undefined,
): ReadonlyMap<string, string> {
  const merged = new Map(persisted);
  for (const [toolCallId, reasoningContent] of currentRequest ?? []) {
    // 当前请求里未被 state 丢失的值优先，避免旧缓存覆盖同 ID 的即时消息。
    merged.set(toolCallId, reasoningContent);
  }
  return merged;
}

function assistantToolCallIds(request: CompletionRequest): ReadonlySet<string> {
  if (!Array.isArray(request.messages)) return new Set();
  const ids = new Set<string>();
  for (const rawMessage of request.messages) {
    const message = asRecord(rawMessage);
    if (!message || message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
    for (const toolCall of message.tool_calls) {
      const id = asRecord(toolCall)?.id;
      if (typeof id === 'string' && id.length > 0) ids.add(id);
    }
  }
  return ids;
}

function appendReasoningContent(current: string, next: unknown): string {
  if (typeof next !== 'string' || next.length === 0) return current;
  // 部分 OpenAI-compatible 实现返回增量，部分实现返回累计值；两种都保留原始语义且不重复拼接。
  if (next === current || current.endsWith(next)) return current;
  if (next.startsWith(current)) return next;
  return current + next;
}

export class ReasoningContentChatOpenAICompletions extends ChatOpenAICompletions {
  /**
   * LangGraph 的 state/checkpoint 可能只保留标准字段而丢掉 provider-specific kwargs。
   * 这是一份有界、进程内、按 tool call id 关联的短暂续传缓存：只跨越"模型工具调用 -> 工具结果
   * -> 后续仍携带该 assistant tool-call 历史的模型请求"；绝不写日志/DB/SSE。当前请求历史
   * 不再引用的条目会在成功请求后清理，实例随 run 释放。
   */
  private readonly pendingReasoningByToolCallId = new Map<string, string>();

  private rememberReasoningContent(messages: readonly BaseMessage[]): void {
    const nextPending = new Map(this.pendingReasoningByToolCallId);
    for (const [toolCallId, reasoningContent] of collectReasoningContentByToolCallId(messages)) {
      // 同一个 run 内新响应覆盖旧值；当前请求的即时值仍会在 merge 时优先。
      nextPending.delete(toolCallId);
      nextPending.set(toolCallId, reasoningContent);
    }
    if (nextPending.size > MAX_PENDING_REASONING_TOOL_CALLS) {
      throw new ReasoningContentCapacityError(MAX_PENDING_REASONING_TOOL_CALLS);
    }
    // 容量校验通过后再原子替换，避免 fail-closed 异常留下超限/半写状态。
    this.pendingReasoningByToolCallId.clear();
    for (const [toolCallId, reasoningContent] of nextPending) {
      this.pendingReasoningByToolCallId.set(toolCallId, reasoningContent);
    }
  }

  private retainReasoningContentForHistory(toolCallIds: ReadonlySet<string>): void {
    for (const toolCallId of this.pendingReasoningByToolCallId.keys()) {
      if (!toolCallIds.has(toolCallId)) this.pendingReasoningByToolCallId.delete(toolCallId);
    }
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const reasoningByToolCallId = collectReasoningContentByToolCallId(messages);
    return reasoningContentContext.run(
      reasoningByToolCallId,
      async () => {
        const result = await super._generate(messages, options, runManager);
        this.rememberReasoningContent(result.generations.map((generation) => generation.message as BaseMessage));
        return result;
      },
    );
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const reasoningByToolCallId = collectReasoningContentByToolCallId(messages);
    const iterator = super._streamResponseChunks(messages, options, runManager)[Symbol.asyncIterator]();
    let completed = false;
    let responseReasoningContent = '';
    const responseToolCallIds = new Set<string>();
    try {
      while (true) {
        // AsyncGenerator 的实际执行发生在 next()，所以每个 next 都在同一请求上下文中运行。
        const next = await reasoningContentContext.run(reasoningByToolCallId, () => iterator.next());
        if (next.done) {
          completed = true;
          if (responseReasoningContent.length > 0 && responseToolCallIds.size > 0) {
            this.rememberReasoningContent(
              [...responseToolCallIds].map((toolCallId) => ({
                additional_kwargs: { reasoning_content: responseReasoningContent },
                tool_calls: [{ id: toolCallId }],
              }) as unknown as BaseMessage),
            );
          }
          return;
        }
        const chunkMessage = next.value.message as BaseMessage & {
          additional_kwargs?: { reasoning_content?: unknown };
        };
        responseReasoningContent = appendReasoningContent(
          responseReasoningContent,
          chunkMessage.additional_kwargs?.reasoning_content,
        );
        for (const toolCallId of toolCallIdsFromMessage(chunkMessage)) responseToolCallIds.add(toolCallId);
        // `streamEvents` 的消费者可能在 `tool_calls` 终止帧后立即切入工具节点，未必会继续
        // 拉到 SSE 的 [DONE]。此时 reasoning 已完整、tool call id 已确定，必须在该语义边界
        // 立即落入本进程短暂缓存，而不能只依赖下方的 iterator.done。
        if (
          (next.value.generationInfo as Record<string, unknown> | undefined)?.finish_reason === 'tool_calls'
          && responseReasoningContent.length > 0
          && responseToolCallIds.size > 0
        ) {
          this.rememberReasoningContent(
            [...responseToolCallIds].map((toolCallId) => ({
              additional_kwargs: { reasoning_content: responseReasoningContent },
              tool_calls: [{ id: toolCallId }],
            }) as unknown as BaseMessage),
          );
        }
        yield next.value;
      }
    } finally {
      if (!completed && typeof iterator.return === 'function') {
        await reasoningContentContext.run(reasoningByToolCallId, () => iterator.return!(undefined));
      }
    }
  }

  completionWithRetry(request: any, requestOptions?: any): any {
    const outboundReasoningByToolCallId = mergeReasoningContentMaps(
      this.pendingReasoningByToolCallId,
      reasoningContentContext.getStore(),
    );
    const outboundRequest = attachReasoningContentToCompletionRequest(
      request as CompletionRequest,
      outboundReasoningByToolCallId,
    );
    const historyToolCallIds = assistantToolCallIds(outboundRequest);
    const pendingRequest = super.completionWithRetry(outboundRequest as any, requestOptions);
    // 成功不再删除所有已转发 ID：第三次及后续请求可能仍携带更早 assistant tool-call 历史。
    // 只删除当前完整历史已不再引用的 ID；若请求失败，保留映射供 SDK/调用方重试。
    return Promise.resolve(pendingRequest).then((result) => {
      this.retainReasoningContentForHistory(historyToolCallIds);
      return result;
    });
  }
}
