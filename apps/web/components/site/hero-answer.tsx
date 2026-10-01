"use client";

import { useEffect, useState } from "react";

type Demo = {
  q: string;
  lib: string;
  libColor: string;
  answer: string;
  cites: { title: string; meta: string }[];
};

const demos: Demo[] = [
  {
    q: "上季度华东大客户都谁在跟？",
    lib: "关系知识库",
    libColor: "var(--c-relation)",
    answer:
      "华东大区上季度有 6 家重点客户在跟进。其中「赋范科技」由张磊负责，关联到 A 项目与两份在谈合同；「恒生医疗」由李娜负责，处于复购洽谈阶段。",
    cites: [
      { title: "客户档案：张磊 — 负责 — 赋范科技", meta: "关系链 · 可查看关系视图" },
      { title: "拜访纪要 2024Q1.docx", meta: "第 3 段 · 华东大区" }
    ]
  },
  {
    q: "出差打车能报销吗，标准是多少？",
    lib: "文档资料库",
    libColor: "var(--c-document)",
    answer:
      "可以。按现行《差旅管理制度 v3》，市内交通凭实报销，单次单程不超过 80 元；超出部分需部门负责人审批。",
    cites: [
      { title: "《差旅管理制度 v3》第 4 条", meta: "市内交通 · 原文段落已高亮" },
      { title: "报销操作指引.pdf", meta: "第 2 页 · 审批流程" }
    ]
  },
  {
    q: "我们做向量检索时怎么选切分粒度？",
    lib: "个人知识库",
    libColor: "var(--c-personal)",
    answer:
      "团队沉淀的经验条目给出三条原则：先按语义边界切、再控制单段长度、最后用真实问题回测。可在该条目上继续追问。",
    cites: [
      { title: "知识条目：检索效果调优经验", meta: "可浏览 · 溯源 4 份原始资料" }
    ]
  }
];

export function HeroAnswer() {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<"ask" | "think" | "answer">("ask");

  useEffect(() => {
    let t1: any, t2: any, t3: any;
    setPhase("ask");
    t1 = setTimeout(() => setPhase("think"), 1100);
    t2 = setTimeout(() => setPhase("answer"), 2100);
    t3 = setTimeout(() => setI((v) => (v + 1) % demos.length), 6200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [i]);

  const d = demos[i];

  return (
    <div className="hero-card" role="img" aria-label="问公司大脑示例：问题、带依据的答案与来源">
      <div className="hero-card-bar">
        <span className="hero-card-dot" />
        <span className="hero-card-title mono">问公司大脑</span>
        <span className="hero-card-live">
          <span className="live-dot" /> 实时检索
        </span>
      </div>

      <div className="hero-card-body">
        <div className="hero-q">
          <span className="hero-q-avatar">问</span>
          <p key={"q" + i} className="hero-q-text">
            {d.q}
          </p>
        </div>

        {phase === "think" && (
          <div className="hero-think">
            <span className="tdot" />
            <span className="tdot" />
            <span className="tdot" />
            <em>正在跨已建知识库检索并核对依据…</em>
          </div>
        )}

        {phase === "answer" && (
          <div className="hero-a" key={"a" + i}>
            <div className="hero-a-head">
              <span className="hero-a-avatar">答</span>
              <span
                className="hero-a-lib"
                style={{ color: d.libColor, borderColor: d.libColor }}
              >
                命中 · {d.lib}
              </span>
            </div>
            <p className="hero-a-text">{d.answer}</p>
            <div className="hero-cites">
              <span className="hero-cites-label">依据 {d.cites.length} 条</span>
              {d.cites.map((c, k) => (
                <div className="hero-cite" key={k}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                  <div>
                    <strong>{c.title}</strong>
                    <span>{c.meta}</span>
                  </div>
                  <span className="hero-cite-open">打开</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="hero-card-foot">
        {demos.map((_, k) => (
          <button
            key={k}
            aria-label={`示例 ${k + 1}`}
            className={k === i ? "hd active" : "hd"}
            onClick={() => setI(k)}
          />
        ))}
      </div>
    </div>
  );
}
