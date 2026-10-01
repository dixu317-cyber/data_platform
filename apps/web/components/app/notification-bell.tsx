"use client";

// 024 T2 · FR-555：前台通知铃铛——未读数 badge + 下拉列表 + 点击标已读真调 API + 空态引导。
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth-context";

type NotificationKind = "approval-result" | "ingest-terminal" | "review-pending";

type NotificationItem = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  scenarioId?: string;
  taskId?: string;
};

export function NotificationBell() {
  const auth = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  function requestHeaders(json = false) {
    return {
      ...(json ? { "content-type": "application/json" } : {}),
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {})
    };
  }

  // 真调后端：列表 + 未读数一起拉，挂载时和每次展开下拉都刷新。
  const loadNotifications = useCallback(async () => {
    try {
      const [listResponse, countResponse] = await Promise.all([
        fetch("/api/platform/notifications", { headers: requestHeaders(), cache: "no-store" }),
        fetch("/api/platform/notifications/unread-count", { headers: requestHeaders(), cache: "no-store" })
      ]);
      const listBody = await listResponse.json().catch(() => ({}));
      const countBody = await countResponse.json().catch(() => ({}));
      setItems(listResponse.ok && Array.isArray(listBody.notifications) ? listBody.notifications : []);
      setUnreadCount(countResponse.ok && typeof countBody.count === "number" ? countBody.count : 0);
    } catch {
      setItems([]);
      setUnreadCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token]);

  useEffect(() => {
    if (auth.state === "loading") return;
    void loadNotifications();
  }, [auth.state, auth.token, loadNotifications]);

  // 零死按钮：标已读真调 markNotificationsRead API，成功后拉真实未读数重刷（非本地假装归零）。
  async function markRead(ids?: string[]) {
    try {
      const response = await fetch("/api/platform/notifications/mark-read", {
        method: "POST",
        headers: requestHeaders(true),
        body: JSON.stringify(ids ? { ids } : { all: true })
      });
      if (!response.ok) throw new Error();
    } finally {
      await loadNotifications();
    }
  }

  return (
    <details
      className="ux-notif-menu"
      data-testid="notification-bell"
      onToggle={(event) => {
        if ((event.target as HTMLDetailsElement).open) void loadNotifications();
      }}
    >
      <summary aria-label="通知">
        <i aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </i>
        {unreadCount > 0 ? (
          <span className="ux-notif-badge" data-testid="notification-badge">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </summary>
      <div className="ux-notif-popover">
        <header>
          <span>通知</span>
          <button
            type="button"
            data-testid="notification-mark-read"
            disabled={unreadCount === 0}
            onClick={() => void markRead()}
          >
            全部已读
          </button>
        </header>
        <div className="ux-notif-list" data-testid="notification-list">
          {items.length === 0 ? (
            <p className="ux-notif-empty" data-testid="notification-empty">暂无通知</p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ux-notif-item ${item.read ? "read" : "unread"}`}
                data-testid="notification-item"
                onClick={() => { if (!item.read) void markRead([item.id]); }}
              >
                <b>{item.title}</b>
                <span>{item.body}</span>
                <small>{formatNotificationTime(item.createdAt)}</small>
              </button>
            ))
          )}
        </div>
      </div>
    </details>
  );
}

function formatNotificationTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
