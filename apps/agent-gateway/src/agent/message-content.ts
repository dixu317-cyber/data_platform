// content-block 文本提取共享工具：stream.ts（SSE 答案）与 checkpointer.ts（DTO .text）共用，
// 避免两处逻辑漂移（见 memory feedback_message_type_normalize / feedback_single_source_of_truth_cascade）。

/** string 原样返回；content-block 数组拼接其中所有 type==='text' 块的 text；
 *  数组无任何文本块（如纯 tool_use）或其它类型 → 返回 null（不臆造内容）。 */
export function joinTextBlocks(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (
          block &&
          typeof block === 'object' &&
          (block as { type?: unknown }).type === 'text' &&
          typeof (block as { text?: unknown }).text === 'string'
        ) {
          return (block as { text: string }).text;
        }
        return '';
      })
      .join('');
    if (text) return text;
  }
  return null;
}

export function summarizeUnknown(value: unknown, maxLength = 2000): string {
  if (typeof value === 'string') return value.slice(0, maxLength);
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

/** SSE 答案专用：无文本块时兜底 summarizeUnknown（必须产出非空，保 BUG-2 修复语义不变）。 */
export function extractTextContent(content: unknown): string {
  return joinTextBlocks(content) ?? summarizeUnknown(content);
}
