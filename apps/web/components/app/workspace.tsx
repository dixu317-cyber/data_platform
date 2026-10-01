"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "../site/logo";
import { ThemeToggle } from "../theme-provider";
import {
  knowledgeBases,
  agents,
  answerFor,
  taskForAction,
  ragMeta,
  type Answer,
  type ChatAction,
  type Evidence,
  type Rag,
  type TaskCanvas
} from "../../lib/fixtures/chat";
import { DocReader, GraphExplorer, PagesView } from "./overlays";

type Overlay = { kind: "doc"; arg: string } | { kind: "graph" } | { kind: "pages"; arg: string } | null;
type Msg = { id: number; role: "user" | "assistant"; text: string; answer?: Answer };
type Session = { id: string; title: string; agentId: string; msgs: Msg[] };

const typeDot: Record<Rag, string> = { doc: "var(--c-document)", relation: "var(--c-relation)", compile: "var(--c-personal)" };
let uid = 100;

function emptySession(): Session {
  return { id: "s" + uid++, title: "新的对话", agentId: "all", msgs: [] };
}
function seeded(q: string, title: string): Session {
  const ans = answerFor(q);
  return {
    id: "s" + uid++,
    title,
    agentId: "all",
    msgs: [
      { id: uid++, role: "user", text: q },
      { id: uid++, role: "assistant", text: ans.text, answer: ans }
    ]
  };
}

export function Workspace() {
  const [sessions, setSessions] = useState<Session[]>([emptySession()]);
  const [activeId, setActiveId] = useState<string>(() => "");
  const [agentId, setAgentId] = useState("all");
  const [mounted, setMounted] = useState<Set<string>>(new Set(knowledgeBases.map((k) => k.id)));
  const [draft, setDraft] = useState("");
  const [streamId, setStreamId] = useState<number | null>(null);
  const [streamLen, setStreamLen] = useState(0);
  const [active, setActive] = useState<Answer | null>(null);
  const [activeCite, setActiveCite] = useState<number | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timer = useRef<any>(null);
  const querySent = useRef(false);

  // ---- load / persist ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ff-cw");
      if (raw) {
        const d = JSON.parse(raw);
        if (d.sessions?.length) {
          setSessions(d.sessions);
          setActiveId(d.activeId && d.sessions.some((s: Session) => s.id === d.activeId) ? d.activeId : d.sessions[0].id);
          uid = (d.uid as number) || uid;
          setLoaded(true);
          return;
        }
      }
    } catch {}
    const init = [emptySession(), seeded("赋范科技值不值得续约？", "赋范科技续约"), seeded("差旅报销标准是多少？", "差旅报销标准")];
    setSessions(init);
    setActiveId(init[0].id);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem("ff-cw", JSON.stringify({ sessions, activeId, uid }));
    } catch {}
  }, [sessions, activeId, loaded]);

  const cur = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const agent = agents.find((a) => a.id === agentId) ?? agents[0];
  const messages = cur?.msgs ?? [];
  const activeTask = activeTaskId ? taskForAction(activeTaskId) ?? null : null;

  const send = (qRaw: string) => {
    const q = qRaw.trim();
    if (!q || !cur) return;
    const ans = answerFor(q);
    const aId = uid++;
    setSessions((ss) =>
      ss.map((s) =>
        s.id === cur.id
          ? {
              ...s,
              title: s.msgs.length === 0 ? (q.length > 16 ? q.slice(0, 16) + "…" : q) : s.title,
              msgs: [...s.msgs, { id: uid++, role: "user", text: q }, { id: aId, role: "assistant", text: ans.text, answer: ans }]
            }
          : s
      )
    );
    setDraft("");
    setActive(ans);
    setActiveCite(null);
    setActiveTaskId(null);
    setStreamId(aId);
    setStreamLen(0);
  };

  useEffect(() => {
    if (!loaded || querySent.current || typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (!q) return;
    querySent.current = true;
    send(q);
    window.history.replaceState(null, "", "/app/chat");
  }, [loaded]);

  useEffect(() => {
    if (streamId == null) return;
    const msg = messages.find((m) => m.id === streamId);
    if (!msg) return;
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      setStreamLen((n) => {
        if (n >= msg.text.length) {
          clearInterval(timer.current);
          setStreamId(null);
          return n;
        }
        return n + 2;
      });
    }, 16);
    return () => clearInterval(timer.current);
  }, [streamId, messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamLen]);

  const newChat = () => {
    const s = emptySession();
    s.agentId = agentId;
    setSessions((ss) => [s, ...ss]);
    setActiveId(s.id);
    setActive(null);
    setActiveTaskId(null);
    setRailOpen(false);
  };

  const switchTo = (id: string) => {
    setActiveId(id);
    setRailOpen(false);
    const s = sessions.find((x) => x.id === id);
    const lastA = [...(s?.msgs ?? [])].reverse().find((m) => m.role === "assistant");
    setActive(lastA?.answer ?? null);
    setActiveCite(null);
    setActiveTaskId(null);
    if (s) setAgentId(s.agentId);
  };

  const delSession = (id: string) => {
    setSessions((ss) => {
      const next = ss.filter((s) => s.id !== id);
      const fin = next.length ? next : [emptySession()];
      if (id === activeId) setActiveId(fin[0].id);
      return fin;
    });
  };

  const rename = (id: string, title: string) => {
    setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, title: title.trim() || s.title } : s)));
    setEditing(null);
  };

  const selectAgent = (id: string) => {
    setAgentId(id);
    const a = agents.find((x) => x.id === id)!;
    setMounted(new Set(a.kbs));
    if (cur) setSessions((ss) => ss.map((s) => (s.id === cur.id ? { ...s, agentId: id } : s)));
  };

  const toggleKB = (id: string) =>
    setMounted((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const mountedList = knowledgeBases.filter((k) => mounted.has(k.id));

  return (
    <div className="cw">
      {/* ============ LEFT RAIL ============ */}
      <aside className={`cw-rail ${railOpen ? "open" : ""}`}>
        <div className="cw-rail-bd" onClick={() => setRailOpen(false)} />
        <div className="cw-rail-inner">
          <Link href="/" className="cw-brand" aria-label="返回官网"><Logo size={26} /></Link>

          <button className="cw-new" onClick={newChat}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            新建对话
          </button>

          <div className="cw-rail-scroll">
            <div className="cw-rail-sec">空间 · 切换知识范围</div>
            {agents.map((a) => (
              <button key={a.id} className={`cw-agent ${agentId === a.id ? "on" : ""}`} onClick={() => selectAgent(a.id)}>
                <span className="cw-agent-ic">{a.name[0]}</span>
                <span className="cw-agent-main"><b>{a.name}</b><span>{a.desc}</span></span>
              </button>
            ))}

            <div className="cw-rail-sec">知识库 · 挂进对话</div>
            {knowledgeBases.map((k) => (
              <button key={k.id} className={`cw-kb ${mounted.has(k.id) ? "on" : ""}`} onClick={() => toggleKB(k.id)}>
                <span className="cw-kb-check" style={{ ["--kc" as any]: typeDot[k.type] }}>
                  {mounted.has(k.id) && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                </span>
                <span className="cw-kb-main"><b>{k.name}</b><span>{k.count}</span></span>
                <span className="cw-kb-dot" style={{ background: typeDot[k.type] }} />
              </button>
            ))}

            <div className="cw-rail-sec">会话历史</div>
            {sessions.map((s) => (
              <div key={s.id} className={`cw-sess ${s.id === activeId ? "on" : ""}`}>
                {editing === s.id ? (
                  <input
                    autoFocus
                    defaultValue={s.title}
                    className="cw-sess-edit"
                    onBlur={(e) => rename(s.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") rename(s.id, (e.target as HTMLInputElement).value); if (e.key === "Escape") setEditing(null); }}
                  />
                ) : (
                  <>
                    <button className="cw-sess-main" onClick={() => switchTo(s.id)} onDoubleClick={() => setEditing(s.id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L4 21l1.1-4a8.4 8.4 0 1 1 15.9-5.5z" /></svg>
                      <span>{s.title}</span>
                    </button>
                    <button className="cw-sess-del" onClick={() => delSession(s.id)} aria-label="删除会话">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="cw-rail-foot">
            <span className="cw-id"><span className="cw-id-av">张</span><span><b>张磊</b> · 销售部</span></span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* ============ CENTER ============ */}
      <main className="cw-main">
        <header className="cw-main-top">
          <button className="cw-burger" onClick={() => setRailOpen(true)} aria-label="菜单">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
          <span className="cw-main-title">{cur?.title ?? "新的对话"}</span>
          <span className="cw-agent-badge">空间 · {agent.name}</span>
          <div className="cw-mounted">
            {mountedList.map((k) => (
              <span key={k.id} className="cw-mounted-chip"><span className="cw-kb-dot" style={{ background: typeDot[k.type] }} />{k.name}</span>
            ))}
          </div>
        </header>

        <div className="cw-thread" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="cw-empty">
              <span className="cw-empty-orb">
                <svg width="48" height="48" viewBox="0 0 64 64" fill="none">
                  <circle cx="32" cy="32" r="9" fill="var(--accent)" />
                  <circle cx="32" cy="32" r="22" stroke="var(--accent)" strokeWidth="1" opacity="0.35" />
                  <circle cx="13" cy="20" r="2.4" fill="var(--accent)" opacity="0.8" /><circle cx="51" cy="20" r="2.4" fill="var(--accent)" opacity="0.8" /><circle cx="13" cy="44" r="2.4" fill="var(--accent)" opacity="0.8" /><circle cx="51" cy="44" r="2.4" fill="var(--accent)" opacity="0.8" />
                  <path d="M32 32 13 20M32 32l19-12M32 32 13 44M32 32l19 12" stroke="var(--accent)" strokeWidth="1" opacity="0.45" />
                </svg>
              </span>
              <h2 className="cw-empty-h">{agent.id === "all" ? "问公司大脑" : agent.name}</h2>
              <p className="cw-empty-p">当前空间「{agent.name}」· {agent.desc}。试试：</p>
              <div className="cw-starters">
                {agent.starters.map((s) => (
                  <button key={s.q} className="cw-starter" onClick={() => send(s.q)}>
                    <b>{s.label}</b>
                    <span>{s.q}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <Bubble
                key={m.id}
                m={m}
                streamLen={m.id === streamId ? streamLen : undefined}
                onCite={(i) => { setActive(m.answer ?? null); setActiveCite(i); setActiveTaskId(null); }}
                onOpenEvidence={() => { setActive(m.answer ?? null); setActiveCite(null); setActiveTaskId(null); }}
                onStartTask={(taskId) => { setActive(m.answer ?? null); setActiveCite(null); setActiveTaskId(taskId); }}
              />
            ))
          )}
        </div>

        <div className="cw-composer">
          <div className="cw-composer-bar">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }}
              placeholder="问公司大脑……答案会带依据(Enter 发送)"
              rows={1}
            />
            <button className="cw-send" onClick={() => send(draft)} aria-label="发送">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
        </div>
      </main>

      {/* ============ RIGHT EVIDENCE ============ */}
      <aside className="cw-ev">
        <div className="cw-ev-head">
          <span>{activeTask ? "任务画布" : "检索到的依据"}</span>
          {activeTask ? <span className="cw-ev-via">{activeTask.status === "ready" ? "可分享" : "草稿"}</span> : active && <span className="cw-ev-via" style={{ color: ragMeta[active.rag].c, background: ragMeta[active.rag].soft }}>{ragMeta[active.rag].label}</span>}
        </div>
        <div className="cw-ev-body">
          {activeTask ? (
            <TaskCanvasView task={activeTask} onBack={() => setActiveTaskId(null)} />
          ) : !active ? (
            <div className="cw-ev-empty">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
              <p>提问后，这里显示系统检索到的资料、原文与依据。答案适合继续处理时，也会出现可办理的任务动作。</p>
            </div>
          ) : (
            <>
              {active.evidence.map((ev, i) => (
                <EvidenceView key={i} ev={ev} idx={i} active={activeCite === i} tone={ragMeta[active.rag].c}
                  onDoc={(doc) => setOverlay({ kind: "doc", arg: doc })}
                  onGraph={() => setOverlay({ kind: "graph" })} />
              ))}
              {active.actions?.map((action) => (
                <button key={action.id} className="cw-ev-action" style={{ ["--rc" as any]: ragMeta[active.rag].c }} onClick={() => setActiveTaskId(action.taskId)}>
                  {action.label}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              ))}
            </>
          )}
        </div>
      </aside>

      {overlay?.kind === "doc" && <DocReader docName={overlay.arg} onClose={() => setOverlay(null)} />}
      {overlay?.kind === "graph" && <GraphExplorer onClose={() => setOverlay(null)} />}
      {overlay?.kind === "pages" && <PagesView pageId={overlay.arg} onClose={() => setOverlay(null)} />}
    </div>
  );
}

/* ---------- message bubble with inline citations ---------- */
function Bubble({
  m,
  streamLen,
  onCite,
  onOpenEvidence,
  onStartTask
}: {
  m: Msg;
  streamLen?: number;
  onCite: (i: number) => void;
  onOpenEvidence: () => void;
  onStartTask: (taskId: string) => void;
}) {
  if (m.role === "user")
    return (
      <div className="cw-msg user">
        <div className="cw-msg-body">{m.text}</div>
        <span className="cw-msg-av user">张</span>
      </div>
    );
  const text = streamLen != null ? m.text.slice(0, streamLen) : m.text;
  const done = streamLen == null || streamLen >= m.text.length;
  return (
    <div className="cw-msg bot">
      <span className="cw-msg-av bot">FF</span>
      <div className="cw-msg-body">
        <p className="cw-ans">{renderCites(text, onCite)}{!done && <span className="cw-caret" />}</p>
        {done && m.answer && (
          <>
            <div className="cw-ans-tools">
              <button className="cw-ans-ev" onClick={onOpenEvidence}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                依据 {m.answer.evidence.filter((e) => e.kind !== "graph").length || m.answer.evidence.length} 条
              </button>
              {m.answer.actions?.map((action) => (
                <ActionCard key={action.id} action={action} onStartTask={onStartTask} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ActionCard({ action, onStartTask }: { action: ChatAction; onStartTask: (taskId: string) => void }) {
  return (
    <button className="cw-action-card" onClick={() => onStartTask(action.taskId)}>
      <span>下一步动作</span>
      <b>{action.label}</b>
      <em>{action.description}</em>
    </button>
  );
}

function renderCites(text: string, onCite: (i: number) => void) {
  return text.split(/(\[\d+\])/g).map((p, k) => {
    const mt = p.match(/^\[(\d+)\]$/);
    if (mt) {
      const n = parseInt(mt[1], 10);
      return <button key={k} className="cw-cite" onClick={() => onCite(n - 1)}>{n}</button>;
    }
    return <span key={k}>{p}</span>;
  });
}

function TaskCanvasView({ task, onBack }: { task: TaskCanvas; onBack: () => void }) {
  return (
    <div className="cw-task">
      <button className="cw-task-back" onClick={onBack}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        回到依据
      </button>

      <section className="cw-task-hero">
        <span>{task.scenarioName}</span>
        <h2>{task.title}</h2>
        <p>{task.sourceQuestion}</p>
      </section>

      <section className="cw-task-block">
        <b>任务步骤</b>
        <div className="cw-task-steps">
          {task.steps.map((step, index) => (
            <div key={step.id} className={`cw-task-step ${step.status}`}>
              <span>{index + 1}</span>
              <div>
                <b>{step.title}</b>
                <em>{step.description}</em>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="cw-task-block">
        <b>已确认输入</b>
        <div className="cw-task-kv">
          {task.inputs.map((input) => (
            <span key={input.label}><em>{input.label}</em>{input.value}</span>
          ))}
        </div>
      </section>

      <section className="cw-task-block">
        <b>使用的证据</b>
        <div className="cw-task-evidence">
          {task.evidence.map((item) => (
            <span key={item.label}><em>{item.label}</em>{item.detail}</span>
          ))}
        </div>
      </section>

      <section className="cw-task-artifact">
        <span>{task.artifact.kind}</span>
        <h3>{task.artifact.title}</h3>
        <p>{task.artifact.summary}</p>
        <div>
          {task.artifact.sections.map((section) => (
            <em key={section}>{section}</em>
          ))}
        </div>
      </section>

      <div className="cw-task-actions">
        <button>继续追问修改</button>
        <button>保存到任务中心</button>
        <button>分享成品</button>
        <button>沉淀为团队场景</button>
      </div>

      <div className="cw-task-follow">
        <b>可继续说</b>
        {task.followUps.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}

/* ---------- evidence renderers ---------- */
function EvidenceView({ ev, idx, active, tone, onDoc, onGraph }: { ev: Evidence; idx: number; active: boolean; tone: string; onDoc: (doc: string) => void; onGraph: () => void }) {
  if (ev.kind === "chunk")
    return (
      <div className={`cw-evc ${active ? "lit" : ""}`} style={{ ["--rc" as any]: tone }}>
        <div className="cw-evc-top"><span className="cw-evc-n">{idx + 1}</span><strong>{ev.title}</strong></div>
        <p className="cw-evc-snip">{ev.snippet}</p>
        <div className="cw-evc-foot">
          <span className="cw-evc-score"><i style={{ width: `${Math.round(ev.score * 100)}%`, background: tone }} />相关度 {Math.round(ev.score * 100)}%</span>
          <button className="cw-evc-open" onClick={() => onDoc(ev.doc)}>打开原文</button>
        </div>
      </div>
    );
  if (ev.kind === "chain")
    return (
      <div className={`cw-evc ${active ? "lit" : ""}`} style={{ ["--rc" as any]: tone }}>
        <div className="cw-evc-top"><span className="cw-evc-n">{idx + 1}</span><strong>关系链</strong></div>
        <div className="cw-chain">{ev.items.map((c, i) => <span key={i}>{c}</span>)}</div>
      </div>
    );
  if (ev.kind === "graph")
    return (
      <div className="cw-evc cw-evgraph" style={{ ["--rc" as any]: tone }}>
        <div className="cw-evc-top"><strong>检索到的关系子图</strong></div>
        <MiniGraph nodes={ev.nodes} edges={ev.edges} tone={tone} />
        <button className="cw-evc-expand" onClick={onGraph}>
          展开图谱探索
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
        </button>
      </div>
    );
  if (ev.kind === "note")
    return (
      <div className={`cw-evc ${active ? "lit" : ""}`} style={{ ["--rc" as any]: tone }}>
        <div className="cw-evc-top"><span className="cw-evc-n">{idx + 1}</span><strong>{ev.title}</strong></div>
        <p className="cw-evc-snip">{ev.meta}</p>
      </div>
    );
  return (
    <div className={`cw-evc ${active ? "lit" : ""}`} style={{ ["--rc" as any]: tone }}>
      <div className="cw-evc-top"><span className="cw-evc-n">{idx + 1}</span><strong>{ev.title}</strong></div>
      <p className="cw-evc-snip">{ev.meta}</p>
      <div className="cw-evc-foot"><span className="cw-evc-open">浏览条目</span></div>
    </div>
  );
}

function MiniGraph({ nodes, edges, tone }: { nodes: any[]; edges: any[]; tone: string }) {
  const byId: Record<string, any> = {};
  nodes.forEach((n) => (byId[n.id] = n));
  return (
    <svg viewBox="0 0 272 184" className="cw-minigraph" aria-hidden>
      {edges.map((e, i) => {
        const a = byId[e.a], b = byId[e.b];
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={tone} strokeWidth="1.2" opacity="0.4" />
            <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 3} fontSize="8.5" fill="var(--text-3)" textAnchor="middle">{e.label}</text>
          </g>
        );
      })}
      {nodes.map((n) => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`}>
          <circle r={n.core ? 26 : 19} fill={n.core ? tone : "var(--surface)"} stroke={tone} strokeWidth="1.4" />
          <text dy="3" fontSize={n.core ? "10" : "9"} fontWeight="600" textAnchor="middle" fill={n.core ? "#fff" : "var(--text)"}>{n.label.length > 5 ? n.label.slice(0, 5) : n.label}</text>
        </g>
      ))}
    </svg>
  );
}
