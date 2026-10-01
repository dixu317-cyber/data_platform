import { z } from 'zod';
import { createMiddleware } from 'langchain';
import type { AIMessage, ModelRequest } from 'langchain';
import { HumanMessage, RemoveMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { KEPT_TURNS, splitIntoTurns, tagProtectedSegment } from './short-term-memory';

/**
 * P36c 阶段2：自研滚动摘要 middleware（三层 state 之 ② working state channel）。
 *
 * spike 结论（P36C_SPIKE.md §1）已实测证实内置 `summarizationMiddleware` 不满足业务规则
 * （摘要包成 HumanMessage 直接覆盖默认 messages channel、零 JSON schema、零 fail-closed），
 * 必须自研。本 middleware 与阶段1 `shortTermMemoryMiddleware` 协作，装配顺序**硬约束**：
 *
 *     middleware: [summarizerMiddleware, shortTermMemoryMiddleware]
 *
 * 这条顺序同时决定两件事（langchain 1.4.4 源码已读，非凭空断言）：
 * 1. **afterModel 按注册数组逆序执行**（ReactAgent.js：lastAfterModelNode = afterModelNodes.at(-1)
 *    先跑，向前连边）——上面顺序下 shortTermMemoryMiddleware.afterModel 先跑（先记 transcript），
 *    summarizerMiddleware.afterModel 后跑（可能这一轮就把已记录消息从 messages channel 物理裁
 *    掉），transcript 不会漏记。若装反，summarizer 先裁、transcript 后记，会漏记被裁消息。
 * 2. **wrapModelCall 按注册数组正序组合、第一个是最外层**（AgentNode.js "Build composed handler
 *    from last to first so first middleware becomes outermost"）——上面顺序下 summarizer 的
 *    wrapModelCall 最先执行，可以在 shortTermMemoryMiddleware 处理之前，把 request.messages 的
 *    前缀替换成「摘要段 + 未压缩 delta 段」；shortTermMemoryMiddleware 再对**剩余区间**（原始
 *    "最近轮次" 消息）应用既有截断逻辑。见 short-term-memory.ts 的 splitProtectedPrefix 注释：
 *    这是两个 middleware "各管一段" 的协调点，避免 shortTerm 把 summarizer 组装好的摘要/delta
 *    段当成"更早轮次"重新按 splitIntoTurns 截断丢弃。
 *
 * ② working state（本 middleware 私有 channel，checkpoint 持久化，扁平字段——不用嵌套对象，
 * 避免阶段1 spike 曾踩过的 ReducedValue/嵌套 default 初始化坑）：
 * - summaryVersion：每次摘要成功更新 +1（version）。
 * - summaryThroughMessageIndex：累计已折叠进摘要的原始消息条数（throughMessageIndex，语义是
 *   "自会话开始以来一共有多少条消息被摘要吸收"，而非某个数组下标——因为 messages channel 会被
 *   本 middleware 物理裁剪而不断缩短，用绝对下标会在裁剪后失真，累计计数法不受影响）。
 * - summaryUpdatedAt：ISO 时间戳（updatedAt）。
 * - summaryText：程序渲染好的定文本（含 SUMMARY_TEXT_PREFIX），fail-closed 校验通过后才写入；
 *   校验失败则整个 state 不更新（旧值原样保留），下一轮 afterModel 用更大的窗口重试。
 *
 * 触发：COMPRESS_STEP=6（累计"未在最近 KEPT_TURNS 轮内、也未被摘要覆盖"的消息条数达到 6 条）。
 * cutoff 永远落在完整轮次边界（复用 splitIntoTurns，同阶段1 tool_call/ToolMessage 配对不拆的
 * 保证），且永远排除最近 KEPT_TURNS 轮（与阶段1 shortTermMemoryMiddleware 用同一常量、同一
 * 算法计算"最近轮次"边界，保证 delta 段与最近轮次段严丝合缝、不重不漏）。
 *
 * 摘要 schema + fail-closed：LLM 必须产出 JSON {intent, entities, comparisonDimensions,
 * outputPreference, openQuestions}；机械拒绝含 URL/引用标记/数字金额的输出；JSON 解析失败/
 * zod 校验失败/机械拒绝命中/模型调用异常，四类情况统一 fail-closed——不更新 state（保留旧摘要），
 * messages channel 也不裁剪（避免"摘要没生效但历史已经被删"的数据丢失）。
 *
 * 🔶 provenance 边界（codex 阶段3 二轮审提出，如实划界，非遗漏）：摘要**不是证据展示出口**，
 * 因此不接入 provenance 撤权过滤——理由是设计上摘要就是"意图与偏好的结构化提炼、非证据来源"
 * （P36 §三 4 记忆机制）：{@link FORBIDDEN_PATTERNS} 机械拒绝 URL / 引用标记 [1] / 数字金额，
 * 撤权来源的**证据细节（原始 excerpt、金额、引用编号）结构上进不了摘要**——真正被 codex 判 HIGH 的
 * 泄露载体（ToolMessage excerpt）已在两个证据出口（wrapModelCall 注入 + readConversation 读取）
 * 各自 provenance 过滤。残留边界：摘要可能保留对某个"后来被撤权"来源的**高层意图/实体名**引用
 * （非 excerpt），因为摘要文本无来源归属、无法反查 citationRef 做选择性抹除。彻底根治需要
 * "来源归属化摘要 + 撤权即失效重算"，成本高且属边缘收益，本期显式延后，不做过度工程。
 */

export const COMPRESS_STEP = 6;
export const SUMMARY_TEXT_PREFIX = '[以下是之前对话的摘要]';
/**
 * 熔断硬上限（codex 第3-a）：fail-closed 的初衷是"摘要失败保留旧摘要、下轮窗口更大重试"，但
 * 若摘要模型**长期**不可用（非法输出/持续抛错），before（未压缩、未纳入最近轮次的旧消息）会
 * 每轮增长，wrapModelCall 把不断变大的 before 全打 protected 透传 → 上下文无限膨胀、请求最终
 * 失败。故设硬上限：一旦 before 条数超过此值且摘要仍不可用，即使没有摘要也**强制降级**——丢弃
 * 最早的整轮旧消息（transcript 私有 channel 仍保真，不丢历史），把 before 压回上限内，并在 ②state
 * 记降级次数（可观测）。取 COMPRESS_STEP 的 4 倍作为默认；可经工厂入参覆盖（测试用小值快速触发）。
 */
export const DEFAULT_MAX_UNCOMPRESSED_BEFORE = COMPRESS_STEP * 4;

const summaryPayloadSchema = z.object({
  intent: z.string().min(1),
  entities: z.array(z.string()),
  comparisonDimensions: z.array(z.string()),
  outputPreference: z.string().min(1),
  openQuestions: z.array(z.string()),
});
export type SummaryPayload = z.infer<typeof summaryPayloadSchema>;

// 机械拒绝清单：URL / 数字型引用标记 / 数字金额。摘要是"意图与偏好的结构化提炼"，不是证据
// 来源，混入这些内容说明模型把原文细节泄漏进了摘要，必须拒绝（宁可保留旧摘要，不可让不可控
// 内容悄悄进入下一轮注入视图）。codex 第3-b：补漏网（www./裸域名/币种前缀），去误杀（放行
// 中文书名号标题【】《》与普通词 "citation"，引用标记只拦数字型）。
const FORBIDDEN_PATTERNS: RegExp[] = [
  /https?:\/\//i, // 协议 URL
  /\bwww\.\S+/i, // www. 开头（漏网：www.example.com）
  /\b[a-z0-9-]+\.(com|cn|net|org|io|gov|edu|co|ai|dev)\b/i, // 裸域名（漏网：example.com）
  /\[\s*\d+\s*\]/, // 数字型引用标记 [1]（放行普通中括号文字）
  /【\s*\d+\s*】/, // 数字型中文脚注 【1】（放行【公司制度】等非数字标题）
  /[¥$€£]\s?\d/, // 货币符号 + 数字
  /\b(USD|EUR|CNY|RMB|GBP|JPY)\s?\d/i, // 币种前缀 + 数字（漏网：USD 500）
  /\d[\d,]*(\.\d+)?\s?(元|美元|人民币|块钱|USD|CNY|RMB)/i, // 数字 + 币种后缀
];

function containsForbiddenContent(value: unknown): boolean {
  if (typeof value === 'string') return FORBIDDEN_PATTERNS.some((re) => re.test(value));
  if (Array.isArray(value)) return value.some((item) => containsForbiddenContent(item));
  if (value && typeof value === 'object') return Object.values(value).some((item) => containsForbiddenContent(item));
  return false;
}

type SummaryValidation = { ok: true; payload: SummaryPayload } | { ok: false; reason: string };

/** 从模型原始文本中剥掉可能的 ```json ... ``` 代码围栏，取出待解析的 JSON 候选文本。 */
function extractJsonText(rawText: string): string {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * 摘要 schema + fail-closed 校验（导出供单测直接验证四类拒绝路径）。
 * 顺序：JSON 解析 → zod schema → 机械内容拒绝。任一步失败即 ok:false，调用方必须保留旧摘要。
 */
export function validateSummaryOutput(rawText: string): SummaryValidation {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJsonText(rawText));
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const zodResult = summaryPayloadSchema.safeParse(parsedJson);
  if (!zodResult.success) return { ok: false, reason: 'schema_mismatch' };
  if (containsForbiddenContent(zodResult.data)) return { ok: false, reason: 'forbidden_content' };
  return { ok: true, payload: zodResult.data };
}

/** 程序渲染定文本（导出供单测验证确定性渲染，不依赖 LLM 自由文本格式）。 */
export function renderSummaryText(payload: SummaryPayload): string {
  return [
    SUMMARY_TEXT_PREFIX,
    `意图：${payload.intent}`,
    `实体：${payload.entities.join('、') || '无'}`,
    `对比维度：${payload.comparisonDimensions.join('、') || '无'}`,
    `输出偏好：${payload.outputPreference}`,
    `待澄清问题：${payload.openQuestions.join('、') || '无'}`,
  ].join('\n');
}

function contentToPlainText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: unknown) => {
        const b = block as { text?: unknown } | string;
        if (typeof b === 'string') return b;
        return typeof b?.text === 'string' ? b.text : '';
      })
      .join('\n');
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function messageRoleLabel(message: BaseMessage): string {
  const getType = (message as unknown as { getType?: () => string })?.getType;
  const type = typeof getType === 'function' ? getType.call(message) : 'unknown';
  if (type === 'human') return '用户';
  if (type === 'ai') return '助手';
  if (type === 'tool') return '工具结果';
  return type;
}

function bufferString(messages: BaseMessage[]): string {
  return messages.map((m) => `${messageRoleLabel(m)}：${contentToPlainText(m.content)}`).join('\n');
}

function buildSummaryPrompt(priorSummaryText: string | null, messagesToSummarize: BaseMessage[]): string {
  return [
    '你是对话摘要提取助手。只输出一个 JSON 对象，不要输出 JSON 之外的任何文字、不要用代码围栏。',
    'JSON 字段：intent(string) / entities(string[]) / comparisonDimensions(string[]) / ' +
      'outputPreference(string) / openQuestions(string[])。',
    '严禁在任何字段中出现 URL、引用标记（如 [1]、【1】）、具体数字金额——这些属于证据细节，不属于摘要。',
    priorSummaryText ? `此前摘要（需要延续/更新，不要丢弃其中仍然有效的信息）：\n${priorSummaryText}` : '（此前没有摘要）',
    `需要吸收进摘要的新对话内容：\n${bufferString(messagesToSummarize)}`,
  ].join('\n\n');
}

function getMessageId(message: BaseMessage): string | null {
  return (message as unknown as { id?: string })?.id ?? null;
}

/**
 * 以「最近 KEPT_TURNS 个完整轮次」为界，把 messages 切成 before（更早、候选被摘要吸收的区间）
 * 与 recent（最近轮次，原样交给 shortTermMemoryMiddleware 处理）。与阶段1 buildInjectedHistoryView
 * 用同一 splitIntoTurns + 同一 KEPT_TURNS 常量，边界定义完全一致。
 */
export function splitBeforeRecentWindow(messages: BaseMessage[]): { before: BaseMessage[]; recent: BaseMessage[] } {
  const turns = splitIntoTurns(messages);
  const recentTurns = turns.slice(-KEPT_TURNS);
  const recentFlatLength = recentTurns.reduce((sum, turn) => sum + turn.length, 0);
  const recentStartIndex = messages.length - recentFlatLength;
  return { before: messages.slice(0, recentStartIndex), recent: messages.slice(recentStartIndex) };
}

export type SummarizerWorkingState = {
  summaryVersion: number;
  summaryThroughMessageIndex: number;
  summaryUpdatedAt: string | null;
  summaryText: string | null;
  /** 熔断降级触发次数（codex 第3-a 可观测状态）：>0 表示曾因摘要长期不可用而强制丢弃过旧消息。 */
  summaryDegradedCount: number;
};

const DEFAULT_SUMMARY_TEXT: string | null = null;

// 扁平字段的 plain zod object（非 StateSchema/ReducedValue）——每次 afterModel 命中即整体覆盖
// 写入（不是阶段1 transcript 那种"追加去重"语义），createMiddleware 官方示例本身就用 plain
// zod object 承载"整体覆盖"型 state，无需 ReducedValue，规避阶段1 spike 记录过的嵌套 default
// 初始化坑。
const summarizerStateSchema = z.object({
  summaryVersion: z.number().default(0),
  summaryThroughMessageIndex: z.number().default(0),
  summaryUpdatedAt: z.string().nullable().default(null),
  summaryText: z.string().nullable().default(DEFAULT_SUMMARY_TEXT),
  summaryDegradedCount: z.number().default(0),
});

type SummarizerState = SummarizerWorkingState & { messages: BaseMessage[] };

/**
 * 熔断降级：从 before（最早的旧消息在前）按**完整轮次**边界丢弃最早的整轮，直到累计丢弃条数
 * 达到 minDrop。按轮次丢弃保证不拆散 tool_call/ToolMessage 配对（同 splitIntoTurns 语义）。
 * 返回被丢弃消息的 ID 列表（无 ID 的消息无法 RemoveMessage，跳过）。
 */
export function collectDegradeDropIds(before: BaseMessage[], minDrop: number): string[] {
  const turns = splitIntoTurns(before);
  const dropped: string[] = [];
  let count = 0;
  for (const turn of turns) {
    if (count >= minDrop) break;
    for (const message of turn) {
      const id = getMessageId(message);
      if (id) dropped.push(id);
    }
    count += turn.length;
  }
  return dropped;
}

export type CreateSummarizerMiddlewareInput = {
  /** 摘要 LLM。只需实现 `.invoke(prompt: string): Promise<{content: unknown}>`（BaseChatModel 满足）。 */
  model: { invoke: (input: string) => Promise<{ content: unknown }> };
  /** 熔断硬上限（codex 第3-a）：before 条数超过此值且摘要不可用时强制降级丢弃。默认 24，测试可传小值。 */
  maxUncompressedBefore?: number;
};

export function createSummarizerMiddleware(input: CreateSummarizerMiddlewareInput) {
  const maxUncompressedBefore = input.maxUncompressedBefore ?? DEFAULT_MAX_UNCOMPRESSED_BEFORE;
  const config = {
    name: 'SummarizerMiddleware',
    stateSchema: summarizerStateSchema,
    afterModel: async (state: SummarizerState) => {
      const messages = state.messages ?? [];
      const { before } = splitBeforeRecentWindow(messages);
      if (before.length < COMPRESS_STEP) return undefined;

      const priorSummaryText = state.summaryText ?? null;
      const prompt = buildSummaryPrompt(priorSummaryText, before);

      // 摘要不可用（模型抛错 / 校验失败）统一走 fail-closed；成功才裁剪+更新摘要。
      let validation: SummaryValidation | null = null;
      try {
        const response = await input.model.invoke(prompt);
        validation = validateSummaryOutput(contentToPlainText(response?.content));
      } catch {
        validation = null; // 模型调用异常，与校验失败同等对待
      }

      if (validation && validation.ok) {
        const removable = before.filter((m) => getMessageId(m) != null);
        return {
          summaryVersion: (state.summaryVersion ?? 0) + 1,
          summaryThroughMessageIndex: (state.summaryThroughMessageIndex ?? 0) + before.length,
          summaryUpdatedAt: new Date().toISOString(),
          summaryText: renderSummaryText(validation.payload),
          // ①transcript 私有 channel（阶段1）与本次裁剪完全独立，不受影响——裁剪只动默认
          // messages channel；transcript 由 shortTermMemoryMiddleware.afterModel 记录，且按装配
          // 顺序硬约束先于本 middleware 的 afterModel 执行，此刻要移除的消息已经完整入 transcript。
          messages: removable.map((m) => new RemoveMessage({ id: getMessageId(m) as string })),
        };
      }

      // fail-closed：摘要不可用。未触及熔断上限 → 保留旧摘要、不裁剪，下一轮窗口更大重试。
      if (before.length <= maxUncompressedBefore) return undefined;

      // 🔴 熔断降级（codex 第3-a）：before 已超硬上限且摘要长期不可用 → 强制丢弃最早的整轮旧消息，
      // 把 before 压回上限内，防止上下文无限膨胀。transcript 私有 channel 仍保留这些消息的真相
      // （只动 messages channel），完整历史读取走 transcript 不受影响；记 summaryDegradedCount 供观测。
      const dropIds = collectDegradeDropIds(before, before.length - maxUncompressedBefore);
      if (dropIds.length === 0) return undefined; // 无可裁（都无 ID）保守不动
      return {
        summaryDegradedCount: (state.summaryDegradedCount ?? 0) + 1,
        summaryUpdatedAt: new Date().toISOString(),
        messages: dropIds.map((id) => new RemoveMessage({ id })),
      };
    },
    wrapModelCall: async (
      request: ModelRequest<SummarizerState>,
      handler: (request: ModelRequest<SummarizerState>) => Promise<AIMessage>,
    ) => {
      // summarizer 是 wrapModelCall 洋葱结构的最外层：此刻 request.messages 就是原始
      // state.messages（尚未被任何 middleware 改写），可以安全地按"最近轮次"边界切出
      // before（未压缩 delta）与 recent（最近轮次，原样交给内层 shortTermMemoryMiddleware）。
      const workingState = request.state as SummarizerState | undefined;
      const summaryText = workingState?.summaryText ?? null;
      const degradedCount = workingState?.summaryDegradedCount ?? 0;
      const { before, recent } = splitBeforeRecentWindow(request.messages);

      const segments: BaseMessage[] = [];
      if (summaryText) segments.push(tagProtectedSegment(new HumanMessage({ content: summaryText })));
      // 熔断降级标记（codex 第3-a）：曾强制丢弃过旧消息、且没有可用摘要时，给模型一个明确提示，
      // 说明更早的上下文已因摘要不可用被省略（完整历史仍在 transcript，可经会话历史 API 读取）。
      else if (degradedCount > 0) {
        segments.push(tagProtectedSegment(new HumanMessage({ content: `${SUMMARY_TEXT_PREFIX}（部分较早对话因摘要暂不可用已省略）` })));
      }
      for (const message of before) segments.push(tagProtectedSegment(message));

      return handler({ ...request, messages: [...segments, ...recent] });
    },
  };
  return createMiddleware(config as Parameters<typeof createMiddleware>[0]);
}
