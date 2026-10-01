"use client";

import { useEffect, useRef, useState } from "react";

function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => {
        if (e[0].isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, seen };
}

/* ---------- demo: 文档资料库 (搜) ---------- */
function DocDemo() {
  const qs = [
    {
      q: "报销标准是多少？",
      a1: "一线城市住宿 ",
      hi: "≤ 500 元 / 晚",
      a2: "，市内交通实报实销，超标需部门负责人审批。",
      cite: "《差旅与报销制度 v3》第 4 条 · 第 2 段"
    },
    {
      q: "年假怎么折算？",
      a1: "入职满 1 年起每年 ",
      hi: "5 个工作日",
      a2: "，按当年实际在职月份折算，可顺延至次年 3 月。",
      cite: "《考勤与假期管理办法》第 7 条"
    }
  ];
  const [i, setI] = useState(0);
  const { ref, seen } = useInView<HTMLDivElement>();
  useEffect(() => {
    if (!seen) return;
    const t = setInterval(() => setI((v) => (v + 1) % qs.length), 4200);
    return () => clearInterval(t);
  }, [seen]);
  const d = qs[i];
  return (
    <div className="sd sd-doc" ref={ref}>
      <div className="sd-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <span key={"q" + i} className="sd-typed">{d.q}</span>
      </div>
      <div className="sd-ans" key={"a" + i}>
        <p>
          {d.a1}
          <mark>{d.hi}</mark>
          {d.a2}
        </p>
        <div className="sd-cite">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          {d.cite}
          <span className="sd-open">打开原文</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- demo: 个人知识库 (读) ---------- */
function ReadDemo() {
  const { ref, seen } = useInView<HTMLDivElement>();
  const lines = [
    "先按语义边界切，别按固定字数硬切。",
    "单段控制在可独立理解的长度。",
    "用真实业务问题回测，再微调粒度。"
  ];
  return (
    <div className={`sd sd-read ${seen ? "in" : ""}`} ref={ref}>
      <div className="sd-doc-head">
        <span className="sd-kind">知识条目</span>
        <span className="sd-src">溯源 4 份原始资料</span>
      </div>
      <h4>检索效果调优 · 团队经验</h4>
      <p className="sd-lead">把项目里反复踩过的坑，沉淀成一条随时能查、能追问的知识。</p>
      <ul className="sd-points">
        {lines.map((l, k) => (
          <li key={k} style={{ transitionDelay: `${k * 220 + 200}ms` }}>
            {l}
          </li>
        ))}
      </ul>
      <div className="sd-followup">
        <span>在此条目上追问…</span>
        <i className="sd-caret" />
      </div>
    </div>
  );
}

/* ---------- demo: 关系知识库 (探) ---------- */
const REL_EDGES = [
  { d: "M170,100 Q104,62 58,46", label: "负责", lx: 104, ly: 56 },
  { d: "M170,100 Q104,142 62,154", label: "关联", lx: 104, ly: 142 },
  { d: "M170,100 Q238,62 284,52", label: "在谈", lx: 238, ly: 58 },
  { d: "M170,100 Q244,130 290,140", label: "复购", lx: 244, ly: 136 },
  { d: "M170,100 Q170,140 170,178", label: "属于", lx: 188, ly: 144 }
];
const REL_NODES = [
  { x: 58, y: 46, r: 21, t: ["张磊"], d: "0.18s" },
  { x: 62, y: 154, r: 21, t: ["A 项目"], d: "0.30s" },
  { x: 284, y: 52, r: 22, t: ["合同", "×2"], d: "0.42s" },
  { x: 290, y: 140, r: 21, t: ["李娜"], d: "0.54s" },
  { x: 170, y: 178, r: 22, t: ["医疗", "行业"], d: "0.66s" }
];

function RelationDemo() {
  const { ref, seen } = useInView<HTMLDivElement>();
  return (
    <div className={`sd sd-rel ${seen ? "in" : ""}`} ref={ref}>
      <div className="sd-rel-head">
        <span className="sd-kind">关系图谱</span>
        <span className="sd-src">跨 3 份资料聚合</span>
      </div>
      <svg viewBox="0 0 340 208" className="sd-graph" aria-hidden>
        <defs>
          <radialGradient id="relCore" cx="40%" cy="35%" r="75%">
            <stop offset="0%" stopColor="var(--rc-bright)" />
            <stop offset="100%" stopColor="var(--rc)" />
          </radialGradient>
          <radialGradient id="relNode" cx="40%" cy="32%" r="80%">
            <stop offset="0%" stopColor="var(--surface-raise)" />
            <stop offset="100%" stopColor="var(--rcs)" />
          </radialGradient>
          <filter id="relGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* base edges */}
        <g className="g-edge" fill="none">
          {REL_EDGES.map((e, i) => (
            <path key={i} d={e.d} />
          ))}
        </g>
        {/* flowing pulses */}
        <g className="g-flow" fill="none" filter="url(#relGlow)">
          {REL_EDGES.map((e, i) => (
            <path key={i} d={e.d} style={{ animationDelay: `${i * 0.3}s` }} />
          ))}
        </g>
        {/* labels */}
        <g className="g-label" fontSize="9.5">
          {REL_EDGES.map((e, i) => (
            <text key={i} x={e.lx} y={e.ly}>
              {e.label}
            </text>
          ))}
        </g>
        {/* satellite nodes */}
        <g className="g-nodes">
          {REL_NODES.map((n, i) => (
            <g key={i} className="g-node" style={{ ["--nd" as any]: n.d }}>
              <circle cx={n.x} cy={n.y} r={n.r} />
              {n.t.length === 1 ? (
                <text x={n.x} y={n.y + 3.4}>{n.t[0]}</text>
              ) : (
                <>
                  <text x={n.x} y={n.y - 2}>{n.t[0]}</text>
                  <text x={n.x} y={n.y + 9}>{n.t[1]}</text>
                </>
              )}
            </g>
          ))}
          <g className="g-node g-core">
            <circle className="g-core-halo" cx="170" cy="100" r="40" />
            <circle cx="170" cy="100" r="32" />
            <text x="170" y="97">赋范</text>
            <text x="170" y="110">科技</text>
          </g>
        </g>
      </svg>
      <p className="sd-rel-ans">
        <strong>赋范科技</strong> 由张磊负责，关联 A 项目与 2 份在谈合同；复购洽谈由李娜跟进。
      </p>
    </div>
  );
}

const rows = [
  {
    key: "document",
    badge: "文档资料库 · 搜",
    color: "var(--c-document)",
    soft: "var(--c-document-soft)",
    title: "把制度、合同、报告变成可引用的证据",
    desc: "上传正式文件，问一句就拿到答案，并高亮原文出处——不用再翻几十页 PDF 找那一行。",
    demo: <DocDemo />
  },
  {
    key: "personal",
    badge: "个人知识库 · 读",
    color: "var(--c-personal)",
    soft: "var(--c-personal-soft)",
    title: "把零散资料，读成一篇可浏览的知识",
    desc: "系统读完一堆资料，整理成带引用的知识条目；像翻百科一样浏览，并在任意条目上直接追问。",
    demo: <ReadDemo />
  },
  {
    key: "relation",
    badge: "关系图谱知识库 · 客户 / 风控 / 尽调",
    color: "var(--c-relation)",
    soft: "var(--c-relation-soft)",
    bright: "var(--c-relation-bright)",
    title: "把对象、事件和证据连成可追问的业务关系网",
    desc: "适合客户画像、续约风险、供应商尽调和复杂项目复盘。系统会把文档、表格和纪要中的关键对象、关系、证据来源沉淀为可检索的图谱资产。",
    demo: <RelationDemo />
  }
];

export function ScenarioRows() {
  return (
    <div className="scn-rows">
      {rows.map((r, i) => (
        <div
          key={r.key}
          className={`scn-row ${i % 2 === 1 ? "rev" : ""}`}
          style={{
            ["--rc" as any]: r.color,
            ["--rcs" as any]: r.soft,
            ["--rc-bright" as any]: (r as any).bright ?? r.color
          }}
        >
          <div className="scn-row-text">
            <span className="scn-badge">{r.badge}</span>
            <h3 className="display">{r.title}</h3>
            <p>{r.desc}</p>
          </div>
          <div className="scn-row-demo">{r.demo}</div>
        </div>
      ))}
    </div>
  );
}
