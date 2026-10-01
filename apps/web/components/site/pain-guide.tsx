"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Rec = {
  key: string;
  prompt: string;
  solution: string;
  posture: string;
  color: string;
  soft: string;
  bright: string;
  icon: React.ReactNode;
  why: string;
  result: string;
};

const IconRead = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H2z" />
    <path d="M22 4.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H22z" />
  </svg>
);
const IconRelation = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="18" cy="7" r="2.4" />
    <circle cx="12" cy="18" r="2.4" />
    <path d="M7.7 7.6 10.5 16M16.6 8.7 13.4 16M8.2 6.4h7.6" />
  </svg>
);
const IconSearch = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const recs: Rec[] = [
  {
    key: "personal",
    prompt: "沉淀团队经验、随时可信问答",
    solution: "个人知识库",
    posture: "读",
    color: "var(--c-personal)",
    soft: "var(--c-personal-soft)",
    bright: "var(--accent-bright)",
    icon: IconRead,
    why: "经验、研究、写作类知识更适合「读」——系统读完一堆资料，整理成一篇可浏览、可追问、带引用的知识，而不是每次都从零检索。",
    result: "员工像翻百科一样浏览沉淀下来的知识，并在任意条目上直接追问，每条都能溯源回原始资料。"
  },
  {
    key: "relation",
    prompt: "理清客户 / 项目 / 组织之间的关系、做画像",
    solution: "关系知识库",
    posture: "问 + 探",
    color: "var(--c-relation)",
    soft: "var(--c-relation-soft)",
    bright: "var(--c-relation-bright)",
    icon: IconRelation,
    why: "客户画像、尽调、垂直领域这类问题，价值在「谁和谁、因为什么」。系统跨资料识别关键对象与它们的关联，给出带关系链的答案。",
    result: "一句话问出关系型答案（答案里看得见关系链），需要时再展开关系网络视图深入探索。"
  },
  {
    key: "document",
    prompt: "把制度 / 合同 / 报告变成可检索的证据",
    solution: "文档资料库",
    posture: "搜",
    color: "var(--c-document)",
    soft: "var(--c-document-soft)",
    bright: "var(--c-document-bright)",
    icon: IconSearch,
    why: "正式文档的核心诉求是「拿到带出处的证据」。系统在成百上千份文档里搜到答案，并高亮支撑它的那段原文。",
    result: "答案 + 源文档精确段落 + 一键打开原文，每个结论都站得住、查得到。"
  }
];

const keywords: { match: string[]; key: string }[] = [
  {
    match: ["客户", "画像", "销售", "关系", "尽调", "组织", "项目", "供应商", "人脉", "关联", "网络", "图谱", "渠道", "合作", "谁和谁", "投资", "竞品"],
    key: "relation"
  },
  {
    match: ["制度", "合同", "报告", "报销", "流程", "规范", "文档", "表格", "政策", "手册", "条款", "法务", "发票", "标准", "sop", "检索", "资料", "证据", "原文", "条文"],
    key: "document"
  },
  {
    match: ["经验", "沉淀", "研究", "写作", "百科", "wiki", "笔记", "总结", "学习", "教程", "实践", "方法", "复盘", "培训", "新人", "上手", "问答"],
    key: "personal"
  }
];

const hintExamples = [
  { text: "我想做销售的客户画像", key: "relation" },
  { text: "报销标准怎么查", key: "document" },
  { text: "沉淀团队的项目经验", key: "personal" }
];

export function PainGuide() {
  const [active, setActive] = useState<string>("personal");
  const [typed, setTyped] = useState("");

  const matchedFromText = useMemo(() => {
    if (!typed.trim()) return null;
    const t = typed.toLowerCase();
    for (const k of keywords) {
      if (k.match.some((m) => t.includes(m.toLowerCase()))) return k.key;
    }
    return null;
  }, [typed]);

  const noMatch = typed.trim().length > 0 && !matchedFromText;
  const currentKey = matchedFromText ?? active;
  const current = recs.find((r) => r.key === currentKey)!;

  return (
    <div className="guide">
      <div className="guide-choices">
        {recs.map((r) => {
          const on = currentKey === r.key;
          return (
            <button
              key={r.key}
              className={`gc ${on ? "on" : ""}`}
              style={{ ["--gc" as any]: r.color, ["--gcs" as any]: r.soft }}
              onClick={() => {
                setActive(r.key);
                setTyped("");
              }}
            >
              <span className="gc-icon">{r.icon}</span>
              <span className="gc-prompt">{r.prompt}</span>
              <span className="gc-sol">{r.solution}</span>
              <span className="gc-check" aria-hidden>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
            </button>
          );
        })}
      </div>

      <div className={`guide-or ${noMatch ? "nomatch" : ""}`}>
        <svg className="guide-or-ic" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="也可以直接描述，例如：我想做销售的客户画像"
          aria-label="描述你的场景"
        />
        {matchedFromText && (
          <span className="guide-flag matched">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            已为你匹配
          </span>
        )}
        {noMatch && <span className="guide-flag warn">换个说法试试 ↓</span>}
      </div>

      {noMatch && (
        <div className="guide-hint">
          <span>没太明白，试试这样描述：</span>
          {hintExamples.map((h) => (
            <button key={h.text} onClick={() => setTyped(h.text)}>
              {h.text}
            </button>
          ))}
        </div>
      )}

      <div
        className="gr"
        key={currentKey + String(matchedFromText)}
        style={{
          ["--gc" as any]: current.color,
          ["--gcs" as any]: current.soft,
          ["--gcb" as any]: current.bright
        }}
      >
        <div className="gr-rail" />
        <div className="gr-main">
          <div className="gr-head">
            <span className="gr-icon">{current.icon}</span>
            <div className="gr-head-text">
              <span className="gr-badge">为你推荐</span>
              <h3>
                {current.solution}
                <span className="gr-posture">姿势 · {current.posture}</span>
              </h3>
            </div>
          </div>
          <div className="gr-grid">
            <div>
              <span className="gr-label">为什么是它</span>
              <p>{current.why}</p>
            </div>
            <div>
              <span className="gr-label">你会得到</span>
              <p>{current.result}</p>
            </div>
          </div>
          <div className="gr-actions">
            <Link href="/admin/new" className="btn btn-primary">
              用这个方案开始建库
            </Link>
            <Link href="/app" className="btn btn-ghost">
              先去前台体验问答
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
