/**
 * P36c 阶段3：同 thread_id 并发串行化。
 *
 * 问题（阶段1/2 codex 已标注遗留）：`PostgresSaver` 的主键含 `checkpoint_id`，不是 thread 级锁；
 * 短期历史 middleware 的 transcript 记录靠 messageId 去重部分缓解，但两个并发 run 若同时读到
 * 同一份 recordedIds 基线、各自计算 delta 再各自写回，仍可能产生乱序 cursor 或者其中一个 run
 * 的 delta 被后写入的另一个 run 覆盖（LangGraph checkpoint 的 update 语义按 run 各自计算，不是
 * 数据库行级 CAS）。根治手段是让同一 thread_id 的多个 run 顺序执行，不并发写同一 thread 的
 * checkpoint。
 *
 * 落地选型：进程内 per-thread promise 链（不是 PG `pg_advisory_lock`）。CLAUDE.md 明确本平台
 * "运行方式：纯本地进程"，agent-gateway 当前只有单进程部署，不存在跨进程并发场景；进程内互斥
 * 已经完整覆盖"同一 thread_id 的并发 SSE 请求互相踩踏"这一验收要求，比引入 PG advisory lock
 * （需要额外连接、跨进程释放语义、连接异常释放兜底）更简单，符合"不过度工程"。
 *
 * 诚实划界：若 agent-gateway 未来水平扩容为多进程/多实例部署，本实现不再覆盖跨进程并发，
 * 需要换成 `pg_advisory_lock(hashtext(thread_id))`（或等价的跨进程互斥）。
 *
 * 实现与 packages/platform/src/platform-store.ts 的 `withDbLock` 同一 promise 链式互斥思路，
 * 只是从"全局单链"变成"按 thread_id 分链"，外加一条防止 Map 无界增长的收尾清理。
 */
const threadChains = new Map<string, Promise<unknown>>();

/**
 * 排队获取某 thread_id 的独占执行权，返回值为释放函数——调用方必须在临界区结束后调用
 * （建议 try/finally），否则同一 thread_id 的后续请求会永久卡住。
 *
 * 语义：同一 thread_id 的多次调用严格按调用顺序串行——第 N 次调用返回的 promise，只在第
 * N-1 次调用的释放函数被调用之后才会 resolve。不同 thread_id 之间完全并发，互不影响。
 */
export async function acquireThreadLock(threadId: string): Promise<() => void> {
  const previousChain = threadChains.get(threadId) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // 下一个排队者要等的是"前面的链 + 我们这次持有锁的整个区间"都结束。
  const nextChain = previousChain.then(() => held);
  threadChains.set(threadId, nextChain);
  nextChain.finally(() => {
    // 只有当自己仍是该 thread 最新的链尾（无人排在自己后面）时才清理，
    // 否则会删掉后来排队者刚设置的新链尾。
    if (threadChains.get(threadId) === nextChain) threadChains.delete(threadId);
  });

  await previousChain; // 轮到我们了（前面所有排队者都已释放锁）

  let released = false;
  return () => {
    if (released) return; // 防重复 release（调用方 finally 误触发两次时的兜底）
    released = true;
    release();
  };
}

/** 测试/可观测用：当前仍有未释放锁的 thread 数（正常应随请求完成回落到 0）。 */
export function debugPendingThreadLockCount(): number {
  return threadChains.size;
}
