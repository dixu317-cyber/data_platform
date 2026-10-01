"use client";

import { useEffect, useMemo, useState } from "react";
import { docBodies, explorer, explorerModes, pages } from "../../lib/fixtures/consume";

function Shell({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ov-root">
      <div className="ov-bd" onClick={onClose} />
      <div className={`ov-panel ${wide ? "wide" : ""}`}>{children}</div>
    </div>
  );
}

function CloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <button className="ov-x" onClick={onClose} aria-label="关闭">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
  );
}

/* ---------------- 原文阅读器 ---------------- */
export function DocReader({ docName, onClose }: { docName: string; onClose: () => void }) {
  const doc = docBodies[docName] ?? Object.values(docBodies)[0];
  return (
    <Shell onClose={onClose}>
      <div className="ov-head">
        <div>
          <span className="ov-kicker">原文 · 高亮支撑段</span>
          <h2 className="ov-title">{doc.title}</h2>
          <span className="ov-meta">{doc.meta}</span>
        </div>
        <CloseBtn onClose={onClose} />
      </div>
      <div className="ov-body doc-reader">
        {doc.paras.map((p, i) => (
          <p key={i} className={p.hi ? "doc-para hi" : "doc-para"}>
            {p.hi && <span className="doc-hi-tag">支撑答案的原文</span>}
            {p.t}
          </p>
        ))}
      </div>
    </Shell>
  );
}

/* ---------------- 图谱探索(global/local/direct) ---------------- */
export function GraphExplorer({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState("global");
  const [hover, setHover] = useState<string | null>(null);
  const { nodes, edges, clusters } = explorer;
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const color = (c: string) => clusters.find((x) => x.id === c)?.color ?? "var(--accent)";
  const neigh = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    edges.forEach((e) => { (m[e.a] ??= new Set()).add(e.b); (m[e.b] ??= new Set()).add(e.a); });
    return m;
  }, [edges]);

  const lit = (id: string) => {
    if (hover) return id === hover || neigh[hover]?.has(id);
    if (mode === "global") return true;
    if (mode === "local") return id === "ff" || neigh["ff"]?.has(id);
    return id === "ff" || id === "ct1"; // direct
  };
  const modeDesc = explorerModes.find((m) => m.id === mode)!.desc;

  return (
    <Shell onClose={onClose} wide>
      <div className="ov-head">
        <div>
          <span className="ov-kicker">图谱探索 · 关系知识库</span>
          <h2 className="ov-title">赋范科技 关系网络</h2>
          <span className="ov-meta">节点大小=关系中心度 · 颜色=集群 · 由问答检索驱动</span>
        </div>
        <CloseBtn onClose={onClose} />
      </div>
      <div className="ov-body gx">
        <div className="gx-canvas">
          <svg viewBox="0 0 600 470" className="gx-svg">
            {edges.map((e, i) => {
              const a = byId[e.a], b = byId[e.b];
              const on = lit(e.a) && lit(e.b);
              return (
                <g key={i} opacity={on ? 0.5 : 0.08}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent)" strokeWidth="1.3" />
                  {on && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 3} fontSize="9.5" fill="var(--text-3)" textAnchor="middle">{e.label}</text>}
                </g>
              );
            })}
            {nodes.map((n) => (
              <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={lit(n.id) ? 1 : 0.22}
                 onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
                <circle r={n.core ? 30 : 21} fill={n.core ? color(n.cluster) : "var(--surface)"} stroke={color(n.cluster)} strokeWidth="1.6" />
                <text dy="3.5" fontSize={n.core ? "11" : "9.5"} fontWeight="600" textAnchor="middle" fill={n.core ? "#fff" : "var(--text)"}>
                  {n.label.length > 6 ? n.label.slice(0, 6) : n.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
        <div className="gx-side">
          <div className="gx-modes">
            {explorerModes.map((m) => (
              <button key={m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)}>{m.name}</button>
            ))}
          </div>
          <p className="gx-desc">{modeDesc}</p>
          <div className="gx-legend">
            {clusters.map((c) => (
              <span key={c.id}><i style={{ background: c.color }} />{c.name}</span>
            ))}
          </div>
          <div className="gx-tip">悬停节点高亮其关联 · 切换全局/局部/直答查看不同检索视角</div>
        </div>
      </div>
    </Shell>
  );
}

/* ---------------- Pages / 综述 ---------------- */
export function PagesView({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const doc = pages[pageId] ?? pages.medical;
  const [mind, setMind] = useState(false);
  return (
    <Shell onClose={onClose} wide>
      <div className="ov-head">
        <div>
          <span className="ov-kicker">{doc.kicker}</span>
          <h2 className="ov-title">{doc.title}</h2>
        </div>
        <div className="ov-head-actions">
          <button className={`ov-toggle ${mind ? "on" : ""}`} onClick={() => setMind((v) => !v)}>
            {mind ? "看正文" : "思维导图"}
          </button>
          <button className="ov-toggle">导出</button>
          <CloseBtn onClose={onClose} />
        </div>
      </div>
      <div className={`ov-body ${mind ? "pg-mindwrap" : "pg"}`}>
        {mind ? (
          <MindMap doc={doc} />
        ) : (
          <>
            <aside className="pg-outline">
              <span className="pg-outline-label">大纲</span>
              {doc.outline.map((s) => (
                <a key={s.id} href={`#${s.id}`} className="pg-outline-item">{s.heading}</a>
              ))}
              <div className="pg-sources">
                <span className="pg-outline-label">引用 {doc.sources.length}</span>
                {doc.sources.map((s) => (
                  <div key={s.n} className="pg-src"><span>{s.n}</span><div><b>{s.title}</b><em>{s.meta}</em></div></div>
                ))}
              </div>
            </aside>
            <article className="pg-article">
              <p className="pg-lead">{doc.lead}</p>
              {doc.outline.map((s) => (
                <section key={s.id} id={s.id} className="pg-sec">
                  <h3>{s.heading}</h3>
                  {s.paras.map((p, i) => (
                    <p key={i}>
                      {p.t}
                      {p.cites?.map((c) => <sup key={c} className="pg-cite">{c}</sup>)}
                    </p>
                  ))}
                </section>
              ))}
            </article>
          </>
        )}
      </div>
    </Shell>
  );
}

function MindMap({ doc }: { doc: (typeof pages)[string] }) {
  const bs = doc.mind.branches;
  const W = 900, H = 460, cx = 150, cy = H / 2;
  const step = H / (bs.length + 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pg-mind">
      {bs.map((b, i) => {
        const by = step * (i + 1);
        const bx = 420;
        return (
          <g key={i}>
            <path d={`M${cx + 60},${cy} C 280,${cy} 300,${by} ${bx - 70},${by}`} stroke="var(--accent)" strokeWidth="1.5" fill="none" opacity="0.5" />
            <g transform={`translate(${bx},${by})`}>
              <rect x="-70" y="-16" width="140" height="32" rx="9" fill="var(--accent-soft)" stroke="var(--accent-line)" />
              <text textAnchor="middle" dy="4" fontSize="13" fontWeight="600" fill="var(--accent-strong)">{b.label}</text>
            </g>
            {b.children.map((ch, j) => {
              const chy = by - 18 + j * 36;
              const chx = 680;
              return (
                <g key={j}>
                  <path d={`M${bx + 70},${by} C 600,${by} 600,${chy} ${chx - 56},${chy}`} stroke="var(--border-strong)" strokeWidth="1.2" fill="none" />
                  <g transform={`translate(${chx},${chy})`}>
                    <rect x="-56" y="-13" width="112" height="26" rx="8" fill="var(--surface)" stroke="var(--border-2)" />
                    <text textAnchor="middle" dy="4" fontSize="12" fill="var(--text)">{ch}</text>
                  </g>
                </g>
              );
            })}
          </g>
        );
      })}
      <g transform={`translate(${cx},${cy})`}>
        <circle r="46" fill="var(--accent)" />
        <text textAnchor="middle" dy="5" fontSize="15" fontWeight="700" fill="var(--accent-contrast)">{doc.mind.root}</text>
      </g>
    </svg>
  );
}
