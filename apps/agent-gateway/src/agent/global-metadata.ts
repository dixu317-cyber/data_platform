import type { GlobalChatScope } from '@ff/platform/platform-store';

// P36d 阶段1a 冻结契约（PKP/specs/P36d/阶段0-勘察结论.md 勘察3）：agent_conversations.metadata
// 顶层平铺 { scope }，不校验枚举值（normalizeMetadata 只查对象类型）——读取侧在此
// 做枚举校验 + fallback，保 P36a/b/c 已建的 global 会话（metadata 里没有 scope 键）
// 零回归：非法/缺失值一律 fallback 到与旧硬编码行为一致的默认值。

const VALID_SCOPES: readonly GlobalChatScope[] = ['company', 'team', 'private'];

/** 从 agent_conversations.metadata 读 scope；非法/缺失 fallback 'company'（旧硬编码值）。 */
export function resolveGlobalChatScope(metadata: Record<string, unknown> | undefined): GlobalChatScope {
  const value = metadata?.scope;
  return typeof value === 'string' && (VALID_SCOPES as readonly string[]).includes(value)
    ? (value as GlobalChatScope)
    : 'company';
}
