"use client";
import { Fragment, useEffect, useState, type ReactNode } from "react";

export type CurationRailItem = {
  id: string;
  primary: string;
  secondary?: string;
  badge?: string;
};

export function CurationSourceRail({
  items, activeId, onSelect, searchPlaceholder, sortOptions,
}: {
  items: CurationRailItem[];
  activeId: string;
  onSelect: (id: string) => void;
  searchPlaceholder: string;
  sortOptions?: { key: string; label: string; comparator: (a: CurationRailItem, b: CurationRailItem) => number }[];
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(sortOptions?.[0]?.key);
  if (items.length <= 1) {
    return (
      <div className="curation-rail-collapsed">
        <label>当前</label>
        <select value={activeId} onChange={(e) => onSelect(e.target.value)}>
          {items.map((item) => (<option key={item.id} value={item.id}>{item.primary}{item.badge ? ` · ${item.badge}` : ""}</option>))}
        </select>
      </div>
    );
  }
  const trimmed = query.trim().toLowerCase();
  const filtered = trimmed ? items.filter((item) => item.primary.toLowerCase().includes(trimmed) || (item.secondary ? item.secondary.toLowerCase().includes(trimmed) : false)) : items;
  const activeComparator = sortOptions?.find((o) => o.key === sortKey)?.comparator;
  const ordered = activeComparator ? [...filtered].sort(activeComparator) : filtered;
  return (
    <div className="curation-rail-full">
      <input type="text" className="curation-rail-search" placeholder={searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
      {sortOptions && sortOptions.length > 0 ? (
        <select className="curation-sort-select" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
          {sortOptions.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
        </select>
      ) : null}
      <div className="curation-rail-list">
        {ordered.length === 0 ? (<p className="monitoring-empty">无匹配结果</p>) : (
          ordered.map((item) => (
            <button key={item.id} type="button" className={`curation-rail-item${item.id === activeId ? " active" : ""}`} onClick={() => onSelect(item.id)}>
              <span className="curation-rail-primary">{item.primary}</span>
              {item.secondary ? (<span className="curation-rail-secondary">{item.secondary}</span>) : null}
              {item.badge ? <span className="curation-rail-badge">{item.badge}</span> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function CurationSearchList<T>({
  items, getKey, filterPredicate, searchPlaceholder, pageSize = 10, loading = false, emptyLabel, renderItem, countLabel, sortOptions,
}: {
  items: T[];
  getKey: (item: T) => string;
  filterPredicate: (item: T, lowerQuery: string) => boolean;
  searchPlaceholder: string;
  pageSize?: number;
  loading?: boolean;
  emptyLabel: string;
  renderItem: (item: T) => ReactNode;
  countLabel: (count: number) => string;
  sortOptions?: { key: string; label: string; comparator: (a: T, b: T) => number }[];
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState(sortOptions?.[0]?.key);
  useEffect(() => { setPage(0); }, [items, query, sortKey]);
  const trimmed = query.trim().toLowerCase();
  const filtered = trimmed ? items.filter((item) => filterPredicate(item, trimmed)) : items;
  const activeComparator = sortOptions?.find((o) => o.key === sortKey)?.comparator;
  const ordered = activeComparator ? [...filtered].sort(activeComparator) : filtered;
  const totalPages = Math.max(1, Math.ceil(ordered.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);
  const paged = ordered.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize);
  return (
    <>
      <div className="curation-search-bar">
        <input type="text" placeholder={searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
        {sortOptions && sortOptions.length > 0 ? (
          <select className="curation-sort-select" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            {sortOptions.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
          </select>
        ) : null}
      </div>
      <p className="curation-search-meta">{countLabel(ordered.length)}{loading ? " · 加载中…" : ""}</p>
      {!loading && paged.length === 0 ? (<p className="monitoring-empty">{emptyLabel}</p>) : null}
      {paged.map((item) => (<Fragment key={getKey(item)}>{renderItem(item)}</Fragment>))}
      {totalPages > 1 ? (
        <div className="curation-pagination">
          <button type="button" disabled={clampedPage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>上一页</button>
          <span>{clampedPage + 1} / {totalPages}</span>
          <button type="button" disabled={clampedPage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>下一页</button>
        </div>
      ) : null}
    </>
  );
}
