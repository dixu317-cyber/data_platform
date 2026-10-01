"use client";

import { useEffect, useState } from "react";

import { PanelHead } from "./admin-pages";

type LlmUsageResponse = {
  totalTokens: number;
  byUser: Array<{ userId: string; userName: string; totalTokens: number; chats: number }>;
  byDay: Array<{ day: string; totalTokens: number; chats: number }>;
};

const EMPTY_USAGE: LlmUsageResponse = { totalTokens: 0, byUser: [], byDay: [] };

// 025 T2：成本护栏用量面板——自取数(useEffect + fetch)，非服务端 props 透传，
// 独立于监控页整体数据加载，方便单独刷新/未来独立轮询。
export function LlmUsagePanel() {
  const [usage, setUsage] = useState<LlmUsageResponse>(EMPTY_USAGE);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/platform/admin/llm-usage", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setNotice(data?.message || "用量加载失败。");
          return;
        }
        setUsage(data.usage ?? EMPTY_USAGE);
      } catch {
        if (!cancelled) setNotice("用量加载失败，请检查网络。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isEmpty = !loading && usage.byUser.length === 0 && usage.byDay.length === 0;

  return (
    <section className="admin-panel">
      <PanelHead eyebrow="成本护栏 · Token 用量" title={`累计 Token 消耗 ${usage.totalTokens.toLocaleString()}`} />
      {notice ? <p className="monitoring-empty">{notice}</p> : null}
      {isEmpty ? (
        <p className="monitoring-empty" data-testid="llm-usage-empty">
          还没有用量数据。前台真实问答产生 token 消耗后，这里会按用户和按天展示统计，用于判断是否需要开启限流或配额护栏。
        </p>
      ) : (
        <div className="monitoring-deep-grid">
          <article className="monitoring-deep-card">
            <header><b>按用户</b><span>全量累计</span></header>
            <div className="monitoring-source-bars">
              {usage.byUser.map((u) => (
                <div key={u.userId} className="monitoring-source-bar">
                  <span title={u.userName}>{u.userName}</span>
                  <i style={{ width: `${Math.min(100, (u.totalTokens / Math.max(1, usage.totalTokens)) * 100)}%` }} />
                  <em>{u.totalTokens.toLocaleString()} tokens · {u.chats} 次问答</em>
                </div>
              ))}
            </div>
          </article>
          <article className="monitoring-deep-card">
            <header><b>按天</b><span>最近 14 天趋势</span></header>
            <div className="monitoring-source-bars">
              {usage.byDay.map((d) => (
                <div key={d.day} className="monitoring-source-bar">
                  <span>{d.day}</span>
                  <i style={{ width: `${Math.min(100, (d.totalTokens / Math.max(1, usage.totalTokens)) * 100)}%` }} />
                  <em>{d.totalTokens.toLocaleString()} tokens · {d.chats} 次问答</em>
                </div>
              ))}
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
