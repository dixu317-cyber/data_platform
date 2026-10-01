"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Logo } from "../site/logo";
import { ThemeToggle } from "../theme-provider";
import { useAuth } from "../../lib/auth-context";
import { readSseStream, type AgentStreamEvent } from "../../lib/api";
import {
  buildScenarioProductSurface,
  type ScenarioProductSurface,
  type ScenarioProductSurfaceKind
} from "@ff/platform/scenario-product-surface";
import {
  getTemplateViewOption,
  templateViewOptions,
  type TemplateLibraryView
} from "../../lib/template-library-view";
import {
  buildKnowledgeAssetStats,
  filterKnowledgeAssets,
  knowledgeAssetKinds,
  knowledgeAssetRiskNote,
  knowledgeAssetScopes,
  knowledgeGovernanceActions,
  knowledgeModeLabel,
  knowledgeVisibilityLabel,
  type KnowledgeAssetKindFilter,
  type KnowledgeAssetScope
} from "../../lib/knowledge-space-view";
import { buildAccountPermissionViewModel } from "../../lib/account-permission-view";
import { createGlobalRailState, reduceGlobalRailState } from "../../lib/global-rails-state";
import {
  createScenarioDraft,
  customScenarioTemplate,
  officialTemplates,
  processingTasks,
  scenarioAvailability,
  scenarioById,
  scenarioDataSources,
  scenarioLifecycle,
  scenarioOutputs,
  scenarioSettings,
  scenarioWorkbenchById,
  templateById,
  workspaceNav,
  workspaceProfile,
  type KnowledgeSpaceObject,
  type ProcessingTask,
  type ScenarioDataSource,
  type ScenarioInstance,
  type ScenarioOutput,
  type ScenarioSettings,
  type ScenarioTemplate,
  type TemplateDemoWalkthrough,
  type ScenarioWorkbench,
  type Visibility
} from "@ff/platform/frontstage";
import {
  computePlatformSnapshotMetrics,
  sortScenariosByStatusAndTime,
  toKnowledgeSpaceObject,
  toScenarioInstance,
  type LiveKnowledgeRecord,
  type LiveScenarioRecord,
  type PlatformSnapshot
} from "./platform-live";
import { NotificationBell } from "./notification-bell";

type ShellProps = {
  active: string;
  title: string;
  eyebrow?: string;
  initialSnapshot?: PlatformSnapshot;
  children: React.ReactNode;
};

type ScenarioTab = "overview" | "data" | "tasks" | "ask" | "outputs" | "settings";
type LiveScenarioAnswer = {
  text: string;
  engine: "Gbrain" | "Naive RAG" | "GraphRAG";
  citations: Array<{
    knowledgeObjectId: string;
    sourceOriginalName: string;
    scenarioName: string;
    engine: "Gbrain" | "Naive RAG" | "GraphRAG";
    excerpt: string;
  }>;
  nextActions: string[];
};

type LiveWorkbenchTemplate = {
  id: string;
  name: string;
  category: string;
  headline: string;
  productForm: ScenarioProductSurfaceKind[];
  outputCapabilities: string[];
};

type ScenarioChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  engine?: LiveScenarioAnswer["engine"];
  citations?: LiveScenarioAnswer["citations"];
  nextActions?: string[];
  traceId?: string;
};

type ScenarioChatSession = {
  id: string;
  scenarioId: string;
  title: string;
  ownerName: string;
  updatedAt: string;
  updatedAtText?: string;
  messageCount?: number;
  latestMessage?: string;
  messages: ScenarioChatMessage[];
};

type ScenarioChatSessionSummary = Omit<ScenarioChatSession, "messages"> & {
  messageCount: number;
  latestMessage: string;
};
type ScenarioCitation = LiveScenarioAnswer["citations"][number];

type GlobalChatScope = "company" | "team" | "private";
type GlobalChatCitation = {
  knowledgeObjectId: string;
  sourceOriginalName: string;
  scenarioId: string;
  scenarioName: string;
  engine: LiveScenarioAnswer["engine"];
  knowledgeType: "知识百科" | "文档证据" | "关系图谱";
  excerpt: string;
};
// P52 §六阶段3（3D）：与 store-types 契约对齐——无 excerpt 的路由可观测 DTO（镜像，最小展示）。
type GlobalRoutingDecision = {
  engines?: LiveScenarioAnswer["engine"][];
  prunedEngines: LiveScenarioAnswer["engine"][];
  basis: "rules" | "classifier" | "fail-open" | "routing-off";
  reason: string;
  latencyMs: number;
};
type GlobalChatContextTrace = {
  layers: string[];
  scopeLabel: string;
  route: "direct" | "retrieve";
  routeReason: string;
  // P33/P36 合一（spec §2.3）：与 store-types 契约对齐，保留三字段（gateway 真值 / legacy 最小空值）。
  shortTermTurns: number;
  compressedContext: string;
  longTermMemoryHits: string[];
  retrievalTracks: Array<{ label: "文档证据" | "关系图谱" | "知识百科"; count: number; description: string }>;
  routing?: GlobalRoutingDecision;
};
type GlobalChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: GlobalChatCitation[];
  contextTrace?: GlobalChatContextTrace;
  traceId?: string;
};

// 终端用户对一次回答点赞/点踩 → 真写后端 trace(差评进后台待改进队列)。
function AnswerFeedback({ traceId }: { traceId?: string }) {
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const [tip, setTip] = useState("");
  if (!traceId) return null;
  const send = async (v: "up" | "down") => {
    setVote(v);
    try {
      const r = await fetch(`/api/platform/traces/${traceId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vote: v })
      });
      const d = await r.json().catch(() => ({}));
      setTip(d.message ?? (v === "up" ? "已记录好评" : "已记录差评"));
    } catch {
      setTip("反馈提交失败");
    }
  };
  return (
    <div className="answer-feedback" aria-label="回答评价">
      <button type="button" className={vote === "up" ? "active" : ""} onClick={() => send("up")} aria-label="有帮助">👍</button>
      <button type="button" className={vote === "down" ? "active" : ""} onClick={() => send("down")} aria-label="没帮助">👎</button>
      {tip ? <span className="answer-feedback-tip">{tip}</span> : null}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  let k = 0;
  while (pos < text.length) {
    const bi = text.indexOf("**", pos);
    const ci = text.indexOf("`", pos);
    let ni = -1;
    let type: "b" | "c" | null = null;
    if (bi !== -1 && (ci === -1 || bi <= ci)) { ni = bi; type = "b"; }
    else if (ci !== -1) { ni = ci; type = "c"; }
    if (ni === -1) { parts.push(text.slice(pos)); break; }
    if (ni > pos) parts.push(text.slice(pos, ni));
    if (type === "b") {
      const ei = text.indexOf("**", ni + 2);
      if (ei === -1) { parts.push("**"); pos = ni + 2; }
      else { parts.push(<strong key={k++}>{text.slice(ni + 2, ei)}</strong>); pos = ei + 2; }
    } else {
      const ei = text.indexOf("`", ni + 1);
      if (ei === -1) { parts.push("`"); pos = ni + 1; }
      else { parts.push(<code key={k++}>{text.slice(ni + 1, ei)}</code>); pos = ei + 1; }
    }
  }
  if (!parts.length) return text;
  return <>{parts}</>;
}

function renderMarkdown(text: string): React.ReactNode {
  const blocks: React.ReactNode[] = [];
  let bk = 0;
  let listBuf: string[] = [];
  const flushList = () => {
    if (!listBuf.length) return;
    blocks.push(<ul key={bk++}>{listBuf.map((s, i) => <li key={i}>{renderInline(s)}</li>)}</ul>);
    listBuf = [];
  };
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isSeparator = (l: string) =>
    /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(l);
  const splitRow = (row: string) =>
    row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  const lines = text.split(/\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flushList(); continue; }
    const hm = /^#{1,6}\s+(.+)$/.exec(line);
    if (hm) { flushList(); blocks.push(<h4 className="md-h" key={bk++}>{renderInline(hm[1])}</h4>); continue; }
    const lm = /^[-*]\s+(.+)$/.exec(line);
    if (lm) { listBuf.push(lm[1]); continue; }
    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      isSeparator(lines[i + 1]) &&
      splitRow(line).length === splitRow(lines[i + 1]).length
    ) {
      flushList();
      const headerCells = splitRow(line);
      i += 2;
      const dataRows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = splitRow(lines[i]);
        dataRows.push(headerCells.map((_, ci) => cells[ci] ?? ""));
        i++;
      }
      i--;
      blocks.push(
        <table className="md-table" key={bk++}>
          <thead>
            <tr>{headerCells.map((c, ci) => <th key={ci}>{renderInline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {dataRows.map((row, ri) => (
              <tr key={ri}>{row.map((c, ci) => <td key={ci}>{renderInline(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }
    flushList();
    blocks.push(<p key={bk++}>{renderInline(line)}</p>);
  }
  flushList();
  return <>{blocks}</>;
}

function AssistantText({ content, animate }: { content: string; animate: boolean }) {
  const [revealed, setRevealed] = useState(animate ? "" : content);
  useEffect(() => {
    if (!animate) { setRevealed(content); return; }
    setRevealed("");
    let i = 0;
    const step = Math.max(1, Math.ceil(content.length / 120));
    const timer = setInterval(() => {
      i += step;
      if (i >= content.length) { setRevealed(content); clearInterval(timer); }
      else setRevealed(content.slice(0, i));
    }, 24);
    return () => clearInterval(timer);
  }, [content, animate]);
  return <div className="md-answer">{renderMarkdown(revealed)}</div>;
}

type GlobalChatSession = {
  id: string;
  title: string;
  scope: GlobalChatScope;
  threadId?: string;
  architectureVersion?: "legacy" | "agent-gateway";
  updatedAt: string;
  compressedContext: string;
  /** @deprecated P33 停用，仅容忍存量读入，运行逻辑不得读写 */
  memory?: {
    provider: "local";
    shortTermCount: number;
    longTermFacts: string[];
  };
  messages: GlobalChatMessage[];
};
type GlobalChatSessionSummary = {
  id: string;
  title: string;
  scope: GlobalChatScope;
  updatedAt: string;
  updatedAtText: string;
  messageCount: number;
  latestMessage: string;
};

const navGlyphs: Record<string, string> = {
  "/app": "⌂",
  "/app/ask": "⌕",
  "/app/templates": "◇",
  "/app/scenarios": "▦",
  "/app/tasks": "✓",
  "/app/knowledge": "◌",
  "/app/settings": "⚙"
};

const visibilityOptions: Array<{ value: Visibility; label: string; description: string }> = [
  { value: "private", label: "仅自己可用", description: "个人资料和个人问答，不进入团队空间。" },
  { value: "team", label: "团队内可用", description: "适合销售、售前、法务等小组共同使用。" },
  { value: "company", label: "公司级场景", description: "发布前需要更严格的资料和答案复核。" }
];

export function AskHome({ initialSnapshot }: { initialSnapshot?: PlatformSnapshot } = {}) {
  return <WorkspaceHomePage initialSnapshot={initialSnapshot} />;
}

function emptyPlatformSnapshot(): PlatformSnapshot {
  return { scenarios: [], tasks: [], knowledge: [] };
}

function usePlatformSnapshot(initialSnapshot?: PlatformSnapshot) {
  const auth = useAuth();
  const [snapshot, setSnapshot] = useState<PlatformSnapshot>(() => initialSnapshot ?? emptyPlatformSnapshot());
  const [state, setState] = useState<"loading" | "ready" | "error">(initialSnapshot ? "ready" : "loading");

  useEffect(() => {
    if (auth.state === "loading") return;
    let cancelled = false;
    async function load() {
      setState("loading");
      const headers = auth.token ? { Authorization: `Bearer ${auth.token}` } : undefined;
      try {
        const [scenarioResponse, taskResponse, knowledgeResponse] = await Promise.all([
          fetch("/api/platform/scenarios", { headers, cache: "no-store" }),
          fetch("/api/platform/tasks", { headers, cache: "no-store" }),
          fetch("/api/platform/knowledge-objects", { headers, cache: "no-store" })
        ]);
        if (!scenarioResponse.ok || !taskResponse.ok || !knowledgeResponse.ok) {
          if (initialSnapshot) {
            setState("ready");
            return;
          }
          throw new Error("platform unavailable");
        }
        const [scenarioBody, taskBody, knowledgeBody] = await Promise.all([
          scenarioResponse.json(),
          taskResponse.json(),
          knowledgeResponse.json()
        ]);
        if (cancelled) return;
        setSnapshot({
          scenarios: Array.isArray(scenarioBody.scenarios) ? scenarioBody.scenarios : [],
          tasks: Array.isArray(taskBody.tasks) ? taskBody.tasks : [],
          knowledge: Array.isArray(knowledgeBody.knowledge_objects) ? knowledgeBody.knowledge_objects : []
        });
        setState("ready");
      } catch {
        if (!cancelled) {
          setSnapshot(initialSnapshot ?? emptyPlatformSnapshot());
          setState("error");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [auth.state, auth.token, initialSnapshot]);

  return { snapshot, state };
}

export function WorkspaceHomePage({ initialSnapshot }: { initialSnapshot?: PlatformSnapshot } = {}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [homeAttachments, setHomeAttachments] = useState<File[]>([]);
  const [homeKnowledgeScope, setHomeKnowledgeScope] = useState<"company" | "team" | "private">("company");
  const { snapshot, state } = usePlatformSnapshot(initialSnapshot);
  const metrics = computePlatformSnapshotMetrics(snapshot);
  const liveScenarios = useMemo(() => sortScenariosByStatusAndTime(snapshot.scenarios).map(toScenarioInstance), [snapshot.scenarios]);
  const readyScenarios = liveScenarios.filter((scenario) => scenario.status === "ready");
  const pendingTasks = snapshot.tasks.filter((task) => task.status !== "ready" && task.status !== "failed");
  const primaryScenario = readyScenarios[0] ?? liveScenarios[0];
  const readyPreview = (primaryScenario ? [primaryScenario, ...readyScenarios.filter((scenario) => scenario.id !== primaryScenario.id)] : readyScenarios).slice(0, 4);
  const pendingPreview = pendingTasks.slice(0, 2);

  function ask(value = question) {
    const q = value.trim() || (homeAttachments.length ? "请分析我上传的附件，并结合公司知识给出结论。" : "");
    if (!q) return;
    try {
      if (homeAttachments.length) {
        sessionStorage.setItem("ff_companybrain_pending_attachments", JSON.stringify(homeAttachments.map(formatAttachmentMeta)));
      } else {
        sessionStorage.removeItem("ff_companybrain_pending_attachments");
      }
      sessionStorage.setItem("ff_companybrain_query_context", JSON.stringify({
        knowledgeScope: homeKnowledgeScope
      }));
    } catch {
      // Attachment metadata is only a front-end handoff; routing should not depend on storage availability.
    }
    router.push(`/app/ask?q=${encodeURIComponent(q)}`);
  }

  return (
    <FrontstageShell active="/app" title="应用总览" eyebrow={workspaceProfile.workspaceName} initialSnapshot={snapshot}>
      <div className="home-workspace-page">
        <section className="brain-ops-strip home-metric-strip" aria-label="工作区入口">
          <KpiCard href="/app/scenarios" label="业务场景" value={String(metrics.scenarioCount)} helper="查看可使用和处理中场景" />
          <KpiCard href="/app/knowledge" label="可用知识" value={String(metrics.readyKnowledgeCount)} helper="查看已可被场景调用的资料" />
          <KpiCard href="/app/tasks" label="待处理任务" value={String(metrics.pendingTaskCount)} helper="查看资料处理与复核进度" />
          <KpiCard href="/app/templates" label="场景模板" value={String(officialTemplates.length)} helper="选择模板创建新的业务场景" />
        </section>

        <section className="brain-command-center home-start-center" aria-label="问公司大脑">
          <div className="brain-command-main">
            <div className="brain-command-title">
              <span>公司大脑</span>
              <h1>早上好，需要了解什么业务信息？</h1>
              <p>连接全域数据，提供深度洞察与合规指引。</p>
            </div>

            <form
              className="brain-ask-console"
              onSubmit={(event) => {
                event.preventDefault();
                ask();
              }}
            >
              <div className="home-ask-head">
                <label htmlFor="brain-home-question">问公司大脑</label>
                <span>支持 PDF、Word、Markdown、表格、图片、音频和视频</span>
              </div>
              <textarea
                id="brain-home-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="输入复杂的业务问题，例如：提取并对比过去三个季度华东区的核心销售数据..."
                rows={3}
              />
              {homeAttachments.length ? (
                <div className="home-attachment-list">
                  {homeAttachments.map((file) => <span key={`${file.name}-${file.size}`}>{formatAttachmentMeta(file)}</span>)}
                </div>
              ) : null}
              <div className="brain-ask-actions home-context-tools" aria-label="提问上下文">
                <label htmlFor="home-ask-attachments" className="home-context-upload">
                  <b>上传资料</b>
                  <span>文档 / 表格 / 图片 / 音视频</span>
                  <input
                    id="home-ask-attachments"
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.md,.csv,.xlsx,.json,image/*,audio/*,video/*"
                    onChange={(event) => setHomeAttachments(Array.from(event.currentTarget.files ?? []))}
                  />
                </label>
                <label className="home-context-field">
                  <span>知识范围</span>
                  <select
                    value={homeKnowledgeScope}
                    onChange={(event) => setHomeKnowledgeScope(event.currentTarget.value as "company" | "team" | "private")}
                  >
                    <option value="company">全公司知识</option>
                    <option value="team">团队知识</option>
                    <option value="private">个人资料</option>
                  </select>
                </label>
                <button type="submit" className="home-context-send" aria-label="发送问题"><span aria-hidden>➤</span></button>
              </div>
            </form>
          </div>

          <div className="home-template-entry">
            <div>
              <b>第一次使用</b>
              <span>从模板开始创建一个可复用的业务场景，接入资料后等待后台处理。</span>
            </div>
            <Link href="/app/templates">选择模板</Link>
          </div>

          <aside className="brain-command-side home-next-side" aria-label="当前可以继续的事情">
            <section>
              <div className="brain-side-title">
                <span>直接可用</span>
                <Link href="/app/scenarios">查看更多</Link>
              </div>
              <div className="brain-ready-list">
                {readyPreview.map((scenario) => <ScenarioCompactCard key={scenario.id} scenario={scenario} />)}
                {state !== "loading" && !primaryScenario ? (
                  <Link className="ux-task-mini-row" href="/app/templates"><b>还没有可用场景</b><span>先从模板或自建场景提交资料</span></Link>
                ) : null}
                {readyScenarios.length > readyPreview.length ? (
                  <Link className="home-more-row" href="/app/scenarios">还有 {readyScenarios.length - readyPreview.length} 个可用场景</Link>
                ) : null}
              </div>
            </section>
            <section>
              <div className="brain-side-title">
                <span>需要处理</span>
                <Link href="/app/tasks">查看更多</Link>
              </div>
              <div className="brain-task-list">
                {pendingTasks.length > 0
                  ? pendingPreview.map((task) => <TaskMini key={task.id} task={task} />)
                  : <Link className="ux-task-mini-row" href="/app/templates"><b>暂无待处理任务</b><span>可以从模板创建一个新场景</span></Link>}
                {pendingTasks.length > pendingPreview.length ? (
                  <Link className="home-more-row" href="/app/tasks">还有 {pendingTasks.length - pendingPreview.length} 个任务</Link>
                ) : null}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </FrontstageShell>
  );
}

export function CompanyChatPage({ initialQuery, initialSnapshot }: { initialQuery?: string; initialSnapshot?: PlatformSnapshot } = {}) {
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState<GlobalChatSessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<GlobalChatSession | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [pendingAttachmentLabels, setPendingAttachmentLabels] = useState<string[]>([]);
  const [scope, setScope] = useState<GlobalChatScope>("company");
  const startedInitialQueryRef = useRef(false);
  const [contextReady, setContextReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // P36d 3a-ii：agent-gateway 轮次（首轮 relay / 追问 live SSE）的取消句柄，卸载时兜底 abort。
  const activeTurnAbortRef = useRef<AbortController | null>(null);
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const auth = useAuth();
  const { snapshot } = usePlatformSnapshot(initialSnapshot);
  const liveScenarios = useMemo(() => sortScenariosByStatusAndTime(snapshot.scenarios).map(toScenarioInstance), [snapshot.scenarios]);
  const readyScenarios = liveScenarios.filter((scenario) => scenario.status === "ready");
  const recentGlobalEntries = sessions.length > 0
    ? sessions.slice(0, 3).map((session) => ({
        id: session.id,
        title: session.title,
        description: session.latestMessage,
        meta: `${scopeLabel(session.scope)} · ${session.updatedAtText}`,
        action: () => void openSession(session.id)
      }))
    : readyScenarios.slice(0, 3).map((scenario) => ({
        id: scenario.id,
        title: scenario.name,
        description: scenario.description,
        meta: `${visibilityText(scenario.visibility)} · ${scenario.sourceCount} 个来源`,
        action: () => setInput(`${scenario.name}里最关键的信息是什么？`)
      }));
  const latestAssistant = [...(activeSession?.messages ?? [])].reverse().find((item) => item.role === "assistant");
  const latestUserQuestion = [...(activeSession?.messages ?? [])].reverse().find((item) => item.role === "user")?.content ?? "";
  const activeCitations = latestAssistant?.citations ?? [];
  const [railState, dispatchRail] = useReducer(reduceGlobalRailState, activeCitations.length, createGlobalRailState);
  const [isMobileWorkspace, setIsMobileWorkspace] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState<"history" | "sources" | null>(null);
  const previousCitationCountRef = useRef(activeCitations.length);
  const historyDrawerRef = useRef<HTMLElement>(null);
  const sourcesDrawerRef = useRef<HTMLElement>(null);
  const historyDrawerTriggerRef = useRef<HTMLButtonElement>(null);
  const sourcesDrawerTriggerRef = useRef<HTMLButtonElement>(null);
  const activeTrace = latestAssistant?.contextTrace;
  const citationGroups = groupGlobalCitations(activeCitations);
  const relatedScenario = activeCitations[0]
    ? readyScenarios.find((scenario) => scenario.id === activeCitations[0].scenarioId)
    : null;
  const isDirectAnswer = activeTrace?.route === "direct";
  const recommendedTemplates = recommendTemplatesForGlobalAnswer(latestUserQuestion, activeCitations);
  const suggestedQuestions = [
    "哪些客户续约风险最高？",
    "把最近命中的依据整理成可分享结论。",
    "这个问题适合沉淀成什么业务场景？"
  ];

  useEffect(() => {
    const previousCount = previousCitationCountRef.current;
    const nextCount = activeCitations.length;
    if (previousCount !== nextCount) {
      dispatchRail({ type: "citations-changed", previousCount, nextCount });
      previousCitationCountRef.current = nextCount;
    }
  }, [activeCitations.length]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1179px)");
    const syncViewport = () => {
      setIsMobileWorkspace(query.matches);
      if (!query.matches) setMobileDrawer(null);
    };
    syncViewport();
    query.addEventListener("change", syncViewport);
    return () => query.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (!isMobileWorkspace || !mobileDrawer) return;
    const drawer = mobileDrawer === "history" ? historyDrawerRef.current : sourcesDrawerRef.current;
    drawer?.querySelector<HTMLElement>("[data-mobile-drawer-close]")?.focus();
  }, [isMobileWorkspace, mobileDrawer]);

  useEffect(() => {
    if (!isMobileWorkspace || !mobileDrawer) return;
    const shell = historyDrawerRef.current?.closest<HTMLElement>(".ux-shell");
    const backgroundRegions = [
      shell?.querySelector<HTMLElement>(".ux-sidebar"),
      shell?.querySelector<HTMLElement>(".ux-header")
    ].filter((element): element is HTMLElement => Boolean(element));
    const previousState = backgroundRegions.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden")
    }));

    for (const element of backgroundRegions) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }

    return () => {
      for (const { element, inert, ariaHidden } of previousState) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
    };
  }, [isMobileWorkspace, mobileDrawer]);

  const closeMobileDrawer = (drawer = mobileDrawer) => {
    if (!drawer) return;
    setMobileDrawer(null);
    requestAnimationFrame(() => {
      (drawer === "history" ? historyDrawerTriggerRef.current : sourcesDrawerTriggerRef.current)?.focus();
    });
  };

  const handleMobileDrawerKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!isMobileWorkspace || !mobileDrawer) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobileDrawer();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.hasAttribute("hidden"));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    focusable[nextIndex].focus();
  };

  const historyPanelVisible = railState.historyExpanded || (isMobileWorkspace && mobileDrawer === "history");
  const sourcesPanelVisible = railState.sourcesExpanded || (isMobileWorkspace && mobileDrawer === "sources");

  function requestHeaders(json = false) {
    return {
      ...(json ? { "content-type": "application/json" } : {}),
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {})
    };
  }

  async function loadSessions(selectSessionId?: string) {
    setLoadingSessions(true);
    try {
      const response = await fetch("/api/platform/chat-sessions", { headers: requestHeaders(), cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "会话历史加载失败。");
      const nextSessions = Array.isArray(body.sessions) ? body.sessions as GlobalChatSessionSummary[] : [];
      setSessions(nextSessions);
      if (selectSessionId) {
        await openSession(selectSessionId, false);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会话历史加载失败。");
    } finally {
      setLoadingSessions(false);
    }
  }

  async function openSession(sessionId: string, refreshHistory = false) {
    // codex 审补强：切会话时中止仍在进行的流式轮次，避免旧会话 SSE 回调写进新打开的会话。
    activeTurnAbortRef.current?.abort();
    activeTurnAbortRef.current = null;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/platform/chat-sessions/${sessionId}`, { headers: requestHeaders(), cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "无法打开这条会话。");
      setActiveSession(body.session as GlobalChatSession);
      setAnimatingId(null);
      setScope((body.session as GlobalChatSession).scope);
      if (refreshHistory) await loadSessions();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法打开这条会话。");
    } finally {
      setPending(false);
    }
  }

  async function renameSession(sessionId: string, nextTitle: string) {
    const title = nextTitle.trim();
    setEditingSessionId(null);
    if (!title) return;
    const previous = sessions;
    setSessions((prev) => prev.map((item) => (item.id === sessionId ? { ...item, title } : item)));
    try {
      const response = await fetch(`/api/platform/chat-sessions/${sessionId}`, {
        method: "PATCH",
        headers: requestHeaders(true),
        body: JSON.stringify({ title })
      });
      if (!response.ok) throw new Error();
    } catch {
      setSessions(previous);
      setMessage("重命名失败，请重试。");
    }
  }

  async function deleteSession(sessionId: string) {
    const previous = sessions;
    setSessions((prev) => prev.filter((item) => item.id !== sessionId));
    if (activeSession?.id === sessionId) {
      setActiveSession(null);
      setInput("");
    }
    try {
      const response = await fetch(`/api/platform/chat-sessions/${sessionId}`, {
        method: "DELETE",
        headers: requestHeaders()
      });
      if (!response.ok) throw new Error();
    } catch {
      setSessions(previous);
      setMessage("删除失败，请重试。");
    }
  }

  // P36d 3a-ii：agent-gateway 会话共用轮次消费——首轮（create 建会话后 relay 补首答）与追问共用。
  // 内部按响应形态分流：SSE live 边读边渲染直接返回 null（调用方无需再替换 session）；
  // JSON 200（reused ①②）整体返回 session；202（reused ③ retryable）用同一 idempotencyKey 退避重试。
  async function consumeAgentTurn(
    sessionId: string,
    query: string,
    idempotencyKey: string,
    signal: AbortSignal
  ): Promise<GlobalChatSession | null> {
    const retryDelaysMs = [800, 1500, 2500];
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      const response = await fetch(`/api/platform/chat-sessions/${sessionId}/messages`, {
        method: "POST",
        headers: requestHeaders(true),
        body: JSON.stringify({ query, idempotency_key: idempotencyKey }),
        signal
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? "追问失败。");
      }
      if (response.status === 202) {
        if (attempt >= retryDelaysMs.length) throw new Error("追问处理超时，请重试。");
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        await consumeAgentSseResponse(response, sessionId, signal);
        return null;
      }
      const body = await response.json().catch(() => ({}));
      return body.session as GlobalChatSession;
    }
    throw new Error("追问处理超时，请重试。");
  }

  // SSE 消费核心：追加一条流式 assistant 消息（不设 animatingId——流式本身即动画，避免与打字机冲突），
  // message_delta 增量拼 content；message_completed 写 citations/contextTrace/traceId（喂来源面板）；
  // error 回滚该流式消息并抛错，交调用方统一走失败态处理。
  async function consumeAgentSseResponse(response: Response, sessionId: string, signal: AbortSignal): Promise<void> {
    const streamingId = `streaming_${crypto.randomUUID()}`;
    // codex 审补强：所有回调只在「当前展示的仍是本轮 session」时更新，避免流式期间用户切会话后旧轮回调写进新会话。
    const onThisSession = (prev: GlobalChatSession | null) => prev && prev.id === sessionId;
    setActiveSession((prev) =>
      onThisSession(prev)
        ? {
            ...prev!,
            messages: [
              ...prev!.messages,
              { id: streamingId, role: "assistant", content: "", createdAt: new Date().toISOString() }
            ]
          }
        : prev
    );

    let streamError: string | null = null;
    await readSseStream(response, (event: AgentStreamEvent) => {
      if (signal.aborted) return;
      if (event.event === "message_delta") {
        const text = typeof event.data?.text === "string" ? event.data.text : "";
        if (!text) return;
        setActiveSession((prev) =>
          onThisSession(prev)
            ? {
                ...prev!,
                messages: prev!.messages.map((m) => (m.id === streamingId ? { ...m, content: m.content + text } : m))
              }
            : prev
        );
        return;
      }
      if (event.event === "message_completed") {
        const data = event.data as {
          message?: { content?: string };
          citations?: GlobalChatCitation[];
          contextTrace?: GlobalChatContextTrace;
          trace_id?: string;
        };
        const finalContent = typeof data.message?.content === "string" ? data.message.content : undefined;
        setActiveSession((prev) =>
          onThisSession(prev)
            ? {
                ...prev!,
                messages: prev!.messages.map((m) =>
                  m.id === streamingId
                    ? {
                        ...m,
                        ...(finalContent !== undefined ? { content: finalContent } : {}),
                        citations: data.citations,
                        contextTrace: data.contextTrace,
                        traceId: data.trace_id
                      }
                    : m
                )
              }
            : prev
        );
        return;
      }
      if (event.event === "error") {
        const data = event.data as { message?: string };
        streamError = data?.message ?? "生成回答失败，请重试。";
      }
    });

    if (signal.aborted) return; // 已切会话/卸载：不再抛错扰动新会话的失败态
    if (streamError) {
      setActiveSession((prev) =>
        onThisSession(prev) ? { ...prev!, messages: prev!.messages.filter((m) => m.id !== streamingId) } : prev
      );
      throw new Error(streamError);
    }
  }

  async function createSessionFromQuestion(nextQuery: string) {
    const q = nextQuery.trim();
    if (!q || pending) return;
    setPending(true);
    setMessage("");

    // 乐观渲染：发送前立即显示用户消息，清空输入框
    const optimisticUserMsg: GlobalChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
      createdAt: new Date().toISOString()
    };
    setActiveSession({
      id: "",
      title: q.slice(0, 60),
      scope,
      updatedAt: new Date().toISOString(),
      compressedContext: "",
      messages: [optimisticUserMsg]
    });
    setInput("");

    const controller = new AbortController();
    activeTurnAbortRef.current = controller;

    try {
      const response = await fetch("/api/platform/chat-sessions", {
        method: "POST",
        headers: requestHeaders(true),
        body: JSON.stringify({ query: q, scope }),
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "会话创建失败。");
      if (controller.signal.aborted) return; // 卸载/切会话：已 abort 则不再落 activeSession
      const createdSession = body.session as GlobalChatSession;

      if (createdSession.architectureVersion === "agent-gateway") {
        // agent-gateway：建会话 messages 为空（首轮答案由 relay 补），先把 session 骨架 + 乐观 user 落下，
        // 再对 createdSession.id 发首问，走共用 SSE 消费流程。
        setActiveSession({ ...createdSession, messages: [optimisticUserMsg] });
        const idempotencyKey = crypto.randomUUID();
        const relaySession = await consumeAgentTurn(createdSession.id, q, idempotencyKey, controller.signal);
        if (relaySession) setActiveSession(relaySession);
      } else {
        // legacy：createdSession 已内联答首轮，行为完全不变（整体替换 + 打字机）。
        setActiveSession(createdSession);
        const lastCreatedMsg = createdSession.messages[createdSession.messages.length - 1];
        if (lastCreatedMsg?.role === "assistant") setAnimatingId(lastCreatedMsg.id);
      }
      // 只刷新左侧历史列表，不再二次 openSession（会清空 animatingId 取消首轮打字机）；
      // createdSession 已是完整 POST 响应，activeSession.id 仍可高亮该会话。
      await loadSessions();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会话创建失败。");
      setInput(q);       // 失败时恢复输入，不丢用户消息
      setActiveSession(null);
      setAnimatingId(null);
    } finally {
      setPending(false);
      activeTurnAbortRef.current = null;
    }
  }

  async function appendQuestion(nextQuery: string) {
    const q = nextQuery.trim();
    if (!q || !activeSession || pending) return;
    setPending(true);
    setMessage("");

    // 乐观渲染：发送前立即追加用户消息，清空输入框
    const optimisticUserMsg: GlobalChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
      createdAt: new Date().toISOString()
    };
    const sessionBeforeUpdate = activeSession;
    setActiveSession({
      ...activeSession,
      messages: [...activeSession.messages, optimisticUserMsg]
    });
    setInput("");

    const controller = new AbortController();
    activeTurnAbortRef.current = controller;

    try {
      if (sessionBeforeUpdate.architectureVersion === "agent-gateway") {
        // agent-gateway：据 architectureVersion 预判直接走共用 SSE 消费（省一次 content-type 分支）；
        // consumeAgentTurn 内部仍按响应形态分流 live SSE / JSON 200（reused①②）/ 202（reused③ 重试）。
        const idempotencyKey = crypto.randomUUID();
        const relaySession = await consumeAgentTurn(sessionBeforeUpdate.id, q, idempotencyKey, controller.signal);
        if (relaySession) setActiveSession(relaySession);
      } else {
        // legacy：POST /chat-sessions/:id/messages 原样返回 {session}，整体替换 + 打字机，逻辑完全不变。
        const response = await fetch(`/api/platform/chat-sessions/${activeSession.id}/messages`, {
          method: "POST",
          headers: requestHeaders(true),
          body: JSON.stringify({ query: q }),
          signal: controller.signal
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message ?? "追问失败。");
        const appendedSession = body.session as GlobalChatSession;
        setActiveSession(appendedSession);
        const lastAppendedMsg = appendedSession.messages[appendedSession.messages.length - 1];
        if (lastAppendedMsg?.role === "assistant") setAnimatingId(lastAppendedMsg.id);
      }
      await loadSessions();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "追问失败。");
      setActiveSession(sessionBeforeUpdate);  // 回滚乐观更新
      setAnimatingId(null);
      setInput(q);                            // 恢复输入
    } finally {
      setPending(false);
      activeTurnAbortRef.current = null;
    }
  }

  function submitQuestion(value = input) {
    if (activeSession) void appendQuestion(value);
    else void createSessionFromQuestion(value);
  }

  useEffect(() => {
    if (auth.state === "loading") return;
    void loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.state, auth.token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeSession?.id, activeSession?.messages.length, pending]);

  useEffect(() => {
    // 卸载时兜底 abort 未完成的 agent-gateway 轮次（首轮 relay / 追问 live SSE）。
    return () => activeTurnAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (auth.state === "loading" || !contextReady || startedInitialQueryRef.current) return;
    const q = initialQuery?.trim();
    if (!q) return;
    startedInitialQueryRef.current = true;
    void createSessionFromQuestion(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.state, auth.token, initialQuery, scope, contextReady]);

  useEffect(() => {
    try {
      const contextRaw = sessionStorage.getItem("ff_companybrain_query_context");
      if (contextRaw) {
        const context = JSON.parse(contextRaw);
        if (context.knowledgeScope === "company" || context.knowledgeScope === "team" || context.knowledgeScope === "private") {
          setScope(context.knowledgeScope);
        }
        sessionStorage.removeItem("ff_companybrain_query_context");
      }
      const raw = sessionStorage.getItem("ff_companybrain_pending_attachments");
      if (!raw) return;
      const labels = JSON.parse(raw);
      if (Array.isArray(labels)) setPendingAttachmentLabels(labels.filter((item): item is string => typeof item === "string"));
      sessionStorage.removeItem("ff_companybrain_pending_attachments");
    } catch {
      setPendingAttachmentLabels([]);
    } finally {
      setContextReady(true);
    }
  }, []);

  return (
    <FrontstageShell active="/app/ask" title="全域问答" eyebrow="公司大脑" initialSnapshot={snapshot}>
      <div
        className={`global-ask-workspace ${railState.historyExpanded ? "history-expanded" : "history-collapsed"} ${railState.sourcesExpanded ? "sources-expanded" : "sources-collapsed"}`}
        data-history-expanded={railState.historyExpanded}
        data-sources-expanded={railState.sourcesExpanded}
      >
        {mobileDrawer ? <button type="button" className="global-mobile-drawer-backdrop" aria-label="关闭辅助面板" onClick={() => closeMobileDrawer()} /> : null}
        <aside
          ref={historyDrawerRef}
          id="global-history-rail"
          className={`global-chat-history ${mobileDrawer === "history" ? "global-mobile-drawer-open" : ""}`}
          aria-label="历史对话"
          aria-hidden={isMobileWorkspace && mobileDrawer !== "history" ? true : undefined}
          aria-modal={isMobileWorkspace && mobileDrawer === "history" ? true : undefined}
          inert={isMobileWorkspace && mobileDrawer !== "history"}
          role={isMobileWorkspace && mobileDrawer === "history" ? "dialog" : undefined}
          onKeyDown={handleMobileDrawerKeyDown}
        >
          {historyPanelVisible ? (
            <>
              <header>
                <span>历史对话</span>
                <div className="global-rail-header-actions">
                  <button
                    type="button"
                    className="global-rail-toggle"
                    aria-label={isMobileWorkspace ? "关闭历史对话抽屉" : "收起历史对话"}
                    aria-controls="global-history-rail"
                    aria-expanded={isMobileWorkspace ? mobileDrawer === "history" : railState.historyExpanded}
                    data-mobile-drawer-close={isMobileWorkspace ? "true" : undefined}
                    onClick={() => isMobileWorkspace ? closeMobileDrawer("history") : dispatchRail({ type: "toggle-history" })}
                  >
                    <span aria-hidden>‹</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSession(null);
                      setInput("");
                      setMessage("");
                    }}
                  >
                    新建
                  </button>
                </div>
              </header>
          <div className="global-history-list">
            {loadingSessions ? <p>正在读取会话...</p> : null}
            {!loadingSessions && sessions.length === 0 ? <p>暂无历史会话。提交第一个问题后，这里会按更新时间排序。</p> : null}
            {sessions.map((item) => (
              <div key={item.id} className={`global-history-item ${activeSession?.id === item.id ? "active" : ""}`}>
                {editingSessionId === item.id ? (
                  <input
                    autoFocus
                    defaultValue={item.title}
                    className="global-history-edit"
                    maxLength={120}
                    onBlur={(event) => void renameSession(item.id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void renameSession(item.id, (event.target as HTMLInputElement).value);
                      if (event.key === "Escape") setEditingSessionId(null);
                    }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className="global-history-open"
                      onClick={() => void openSession(item.id)}
                    >
                      <b>{item.title}</b>
                      <span>{scopeLabel(item.scope)} · {item.updatedAtText}</span>
                      <small>{item.latestMessage}</small>
                    </button>
                    <div className="global-history-actions">
                      <button type="button" onClick={() => setEditingSessionId(item.id)} aria-label="重命名会话" title="重命名">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                      </button>
                      <button type="button" onClick={() => void deleteSession(item.id)} aria-label="删除会话" title="删除">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <section className="global-scope-card">
            <span>当前知识范围</span>
            <p>{scopeDescription(scope)}</p>
          </section>
            </>
          ) : (
            <button
              type="button"
              className="global-rail-toggle global-rail-restore"
              aria-label="展开历史对话"
              aria-controls="global-history-rail"
              aria-expanded={railState.historyExpanded}
              onClick={() => dispatchRail({ type: "toggle-history" })}
            >
              <span aria-hidden>›</span>
              <span>历史</span>
            </button>
          )}
        </aside>

        <main
          className="global-chat-thread"
          aria-label="全域问答会话"
          aria-hidden={isMobileWorkspace && mobileDrawer ? true : undefined}
          inert={isMobileWorkspace && !!mobileDrawer}
        >
          <div className="global-mobile-drawer-triggers" aria-label="问答辅助面板">
            <button
              ref={historyDrawerTriggerRef}
              type="button"
              className="global-rail-toggle"
              aria-label="打开历史对话"
              aria-controls="global-history-rail"
              aria-expanded={mobileDrawer === "history"}
              onClick={() => setMobileDrawer("history")}
            >
              <span aria-hidden>☰</span>
              <span>历史</span>
            </button>
            <button
              ref={sourcesDrawerTriggerRef}
              type="button"
              className="global-rail-toggle"
              aria-label="打开溯源信息和场景推荐"
              aria-controls="global-sources-rail"
              aria-expanded={mobileDrawer === "sources"}
              onClick={() => setMobileDrawer("sources")}
            >
              <span aria-hidden>☷</span>
              <span>来源</span>
            </button>
          </div>
          {!activeSession ? (
            <section className="global-empty-state">
              <span>全域问答</span>
              <h1>先提出一个业务问题，再让公司大脑组织证据。</h1>
              <p>系统会在当前账号可访问的文档证据、关系图谱和知识百科中做混合检索，并把来源、权限范围和可沉淀场景一起呈现。</p>
              <div className="global-empty-suggestions" aria-label="最近使用">
                <span>{sessions.length > 0 ? "最近使用" : "可继续使用"}</span>
                <div className="global-empty-grid">
                  {recentGlobalEntries.map((entry) => (
                  <button key={entry.id} type="button" onClick={entry.action}>
                    <small>{entry.meta}</small>
                    <b>{entry.title}</b>
                    <span>{entry.description}</span>
                  </button>
                  ))}
                  {recentGlobalEntries.length === 0 ? (
                    <Link href="/app/templates">选择方案模板，创建第一个可复用业务场景</Link>
                  ) : null}
                </div>
              </div>
            </section>
          ) : (
            <div className="global-chat-messages">
              {activeSession.messages.map((item) => (
                <article key={item.id} className={`global-message ${item.role === "user" ? "user" : "assistant"}`}>
                  <span>{item.role === "user" ? "你" : "公司大脑"}</span>
                  {item.role === "user" ? <p>{item.content}</p> : <AssistantText content={item.content} animate={item.id === animatingId} />}
                  {item.role === "assistant" && item.contextTrace ? (
                    <div className="global-answer-tags global-inline-references">
                      {item.contextTrace.route === "direct" ? <em>直接回答</em> : null}
                      {item.contextTrace.route === "retrieve"
                        ? item.contextTrace.retrievalTracks.filter((track) => track.count > 0).map((track) => <em key={track.label}>{track.label} {track.count}</em>)
                        : null}
                      {/* P52 §六阶段3（3D）：最小展示路由剪枝信息，不做花哨 UI。 */}
                      {item.contextTrace.routing && item.contextTrace.routing.prunedEngines.length > 0 ? (
                        <em>已剪枝 {item.contextTrace.routing.prunedEngines.join("、")}</em>
                      ) : null}
                    </div>
                  ) : null}
                  {item.role === "assistant" ? <AnswerFeedback traceId={item.traceId} /> : null}
                  {item.role === "assistant" && item.id === latestAssistant?.id && recommendedTemplates.length > 0 ? (
                    <div className="global-followup-templates" aria-label="基于本轮问题推荐的场景模板">
                      <span>可以沉淀成这些业务场景</span>
                      <div>
                        {recommendedTemplates.map((template) => (
                          <Link key={template.id} href={`/app/create?template=${template.id}`}>
                            <b>{template.name}</b>
                            <small>{template.headline}</small>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
              {pending && !activeSession.messages.some((item) => item.id.startsWith("streaming_")) ? (
                <article className="global-message assistant loading">
                  <span>公司大脑</span>
                  <p>正在检索可访问知识、整理上下文和生成回答...</p>
                </article>
              ) : null}
              <div ref={messagesEndRef} aria-hidden />
            </div>
          )}
          {message ? <p className="global-error">{message}</p> : null}

          <form
            className="global-composer"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const nextQuery = String(form.get("q") ?? "");
              submitQuestion(nextQuery);
              event.currentTarget.reset();
            }}
          >
            <label htmlFor="global-ask-input">问公司大脑</label>
            <textarea
              id="global-ask-input"
              name="q"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                // Enter 发送，Shift+Enter 换行；中文输入法组字中的回车不触发发送
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submitQuestion();
                }
              }}
              placeholder={activeSession ? "继续追问，系统会保留本次会话上下文..." : "输入复杂的业务问题，例如：提取并对比过去三个季度华东区的核心销售数据..."}
              rows={4}
            />
            <div className="global-composer-actions">
              <label htmlFor="global-ask-attachments">
                上传资料
                <input
                  id="global-ask-attachments"
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.md,.csv,.xlsx,.json,image/*,audio/*,video/*"
                  onChange={(event) => setAttachments(Array.from(event.currentTarget.files ?? []))}
                />
              </label>
              <select value={scope} onChange={(event) => setScope(event.target.value as GlobalChatScope)} disabled={!!activeSession?.id} aria-label="知识范围">
                <option value="company">全公司知识</option>
                <option value="team">团队知识</option>
                <option value="private">个人资料</option>
              </select>
              {activeSession?.id && <small className="global-scope-hint">知识范围已锁定，切换请新建会话</small>}
              <button type="submit" disabled={pending}>{pending ? "生成中" : "发送"}</button>
            </div>
            {attachments.length || pendingAttachmentLabels.length ? (
              <div className="global-attachment-list">
                {attachments.map((file) => <span key={`${file.name}-${file.size}`}>{formatAttachmentMeta(file)}</span>)}
                {pendingAttachmentLabels.map((label) => <span key={label}>{label}</span>)}
              </div>
            ) : null}
          </form>
        </main>

        <aside
          ref={sourcesDrawerRef}
          id="global-sources-rail"
          className={`global-source-rail ${mobileDrawer === "sources" ? "global-mobile-drawer-open" : ""}`}
          aria-label="溯源信息和场景推荐"
          aria-hidden={isMobileWorkspace && mobileDrawer !== "sources" ? true : undefined}
          aria-modal={isMobileWorkspace && mobileDrawer === "sources" ? true : undefined}
          inert={isMobileWorkspace && mobileDrawer !== "sources"}
          role={isMobileWorkspace && mobileDrawer === "sources" ? "dialog" : undefined}
          onKeyDown={handleMobileDrawerKeyDown}
        >
          {sourcesPanelVisible ? (
            <>
              <div className="global-source-rail-toolbar">
                <button
                  type="button"
                  className="global-rail-toggle"
                  aria-label={isMobileWorkspace ? "关闭溯源信息和场景推荐抽屉" : "收起溯源信息和场景推荐"}
                  aria-controls="global-sources-rail"
                  aria-expanded={isMobileWorkspace ? mobileDrawer === "sources" : railState.sourcesExpanded}
                  data-mobile-drawer-close={isMobileWorkspace ? "true" : undefined}
                  onClick={() => isMobileWorkspace ? closeMobileDrawer("sources") : dispatchRail({ type: "toggle-sources" })}
                >
                  <span aria-hidden>›</span>
                </button>
              </div>
          <section className="global-source-panel">
            <header>
              <span>本轮来源</span>
              <b>{isDirectAnswer ? "未检索" : `${activeCitations.length} 条`}</b>
            </header>
            {activeCitations.length === 0 ? (
              <p>{isDirectAnswer ? "本轮识别为通用对话，由模型直接回答，没有调用企业知识库。" : "开始提问后，这里会展示命中的资料、知识类型和来源场景。"}</p>
            ) : null}
            {citationGroups.map((group) => (
              <section key={group.type} className="global-source-section">
                <header>
                  <h3>{group.type}</h3>
                  <span>{group.items.length} 条</span>
                </header>
                <p>{knowledgeSourceHint(group.type)}</p>
                {group.items.map((citation, index) => (
                  <article key={`${citation.knowledgeObjectId}-${citation.sourceOriginalName}-${index}`}>
                    <em>{sourceBadgeForCitation(citation)}</em>
                    <b>{citation.scenarioName}</b>
                    <small>{displaySourceName(citation.sourceOriginalName)}</small>
                    <p>{citation.excerpt}</p>
                  </article>
                ))}
              </section>
            ))}
          </section>

          <section className="global-source-panel">
            <header>
              <span>回答范围</span>
              <b>{activeTrace?.scopeLabel ?? scopeLabel(scope)}</b>
            </header>
            <ul className="global-answer-scope-list">
              <li><b>知识范围</b><span>{scopeDescription(activeSession?.scope ?? scope)}</span></li>
              <li><b>连续追问</b><span>{activeSession ? "会沿用当前会话的问题线索" : "提交问题后开始新会话"}</span></li>
              <li><b>路由判断</b><span>{activeTrace?.routeReason ?? "提交问题后判断是否需要检索知识库"}</span></li>
              <li><b>来源说明</b><span>{isDirectAnswer ? "本轮未检索企业知识" : activeCitations.length ? "已返回可追踪资料依据" : "回答后展示命中的来源"}</span></li>
            </ul>
          </section>

          <section className="global-source-panel">
            <header>
              <span>推荐沉淀</span>
              <b>{relatedScenario ? "可进入场景" : "可建场景"}</b>
            </header>
            {relatedScenario ? (
              <>
                <h2>{relatedScenario.name}</h2>
                <p>{relatedScenario.description}</p>
                <div className="global-source-actions">
                  <Link href={`/app/scenarios/${relatedScenario.id}`}>进入业务场景</Link>
                  <Link href="/app/templates">查看方案模板</Link>
                </div>
              </>
            ) : (
              <div className="global-source-actions">
                <Link href="/app/templates">选择方案模板</Link>
                <Link href="/app/create?mode=blank">自建业务场景</Link>
              </div>
            )}
            {suggestedQuestions.map((question) => (
              <button key={question} type="button" onClick={() => setInput(question)}>{question}</button>
            ))}
          </section>
            </>
          ) : (
            <button
              type="button"
              className="global-rail-toggle global-rail-restore"
              aria-label={`展开溯源信息和场景推荐，${activeCitations.length} 条来源`}
              aria-controls="global-sources-rail"
              aria-expanded={railState.sourcesExpanded}
              onClick={() => dispatchRail({ type: "toggle-sources" })}
            >
              <span aria-hidden>‹</span>
              <span>来源</span>
              <b>{activeCitations.length}</b>
            </button>
          )}
        </aside>
      </div>
    </FrontstageShell>
  );
}

export function TemplateLibraryPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [selectedTemplateId, setSelectedTemplateId] = useState("customer-360");
  const [view, setView] = useState<TemplateLibraryView>("featured");
  const categories = ["全部", ...Array.from(new Set(officialTemplates.map((item) => item.category)))];
  const visible = officialTemplates.filter((template) => {
    const q = query.trim().toLowerCase();
    const categoryOk = category === "全部" || template.category === category;
    const queryOk = !q || `${template.name} ${template.headline} ${template.bestFor.join(" ")}`.toLowerCase().includes(q);
    return categoryOk && queryOk;
  });
  const selectedTemplate = visible.find((template) => template.id === selectedTemplateId) ?? visible[0] ?? officialTemplates[0];
  const activeView = getTemplateViewOption(view);

  return (
    <FrontstageShell active="/app/templates" title="方案模板" eyebrow="最佳实践入口">
      <section className="ux-page-head template-library-head">
        <div>
          <span>方案模板</span>
          <h1>从业务目标选择知识应用方案。</h1>
          <p>模板不是静态卡片，而是创建业务场景的最佳实践入口。先选业务目标，再上传资料，后台会按资料和权限配置真实 RAG 入库策略。</p>
        </div>
        <div className="template-library-actions">
          <Link className="primary" href="/app/create?mode=blank">自建场景</Link>
          <Link href={`/app/create?template=${selectedTemplate.id}`}>创建所选方案</Link>
        </div>
      </section>
      <div className="template-market-toolbar">
        <label>
          <span>搜索方案</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索客户、制度、客服、合同..." />
        </label>
        <TemplateViewToggle view={view} onChange={setView} />
      </div>
      <section className="template-market-layout" aria-label="方案模板目录">
        <aside className="template-filter-panel">
          <div>
            <span>业务分类</span>
            <b>按目标缩小范围</b>
          </div>
          <div className="template-category-list">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                className={item === category ? "active" : ""}
                onClick={() => setCategory(item)}
              >
                <span>{item}</span>
                <small>{item === "全部" ? officialTemplates.length : officialTemplates.filter((template) => template.category === item).length}</small>
              </button>
            ))}
          </div>
          <div className="template-filter-note">
            <b>没有合适方案？</b>
            <p>可以直接自建场景，上传资料后由后台判断适合进入哪类知识处理链路。</p>
            <Link href="/app/create?mode=blank">自建场景</Link>
          </div>
        </aside>

        <div className="template-market-main">
          <header>
            <div>
              <span>{activeView.label}视图</span>
              <b>{visible.length} 个可选方案</b>
            </div>
            <small>{activeView.description}</small>
          </header>
          <TemplateMarketCanvas
            view={view}
            templates={visible}
            selectedTemplate={selectedTemplate}
            onSelect={setSelectedTemplateId}
          />
        </div>

        {selectedTemplate ? <TemplateCatalogPreview template={selectedTemplate} /> : null}
      </section>
    </FrontstageShell>
  );
}

export const ScenarioLibraryPage = TemplateLibraryPage;

export function TemplateDetailPage({ id }: { id: string }) {
  const template = templateById(id);
  if (!template) return <TemplateNotFound />;

  return (
    <FrontstageShell active="/app/templates" title={template.name} eyebrow="模板详情">
      <div className="ux-template-detail">
        <section className="ux-hero-panel">
          <span>{template.category}</span>
          <h1>{template.name}</h1>
          <p>{template.headline}</p>
          <div className="ux-actions">
            <Link className="ux-primary-link" href={`/app/create?template=${template.id}`}>用这个模板创建</Link>
            <Link href="#preview">查看方案预览</Link>
          </div>
        </section>
        <aside className="ux-side-panel">
          <Meta label="创建耗时" value={template.setupTime} />
          <Meta label="确认要求" value={template.reviewRequirement} />
          <Meta label="支持资料" value={template.acceptedFiles.join(" / ")} />
        </aside>
        <InfoSection title="适用于" items={template.bestFor} />
        <InfoSection title="你需要准备什么" items={template.inputExamples} />
        <InfoSection title="系统会做什么" items={template.processingExplanation} ordered />
        <InfoSection title="创建后能做什么" items={template.outputCapabilities} />
        <section id="preview" className="ux-demo-panel">
          <span>方案预览</span>
          <h2>{template.demoWalkthrough.scenarioName}</h2>
          <div className="ux-demo-grid">
            <div>
              <h3>案例资料</h3>
              {template.demoWalkthrough.sampleInputs.map((asset) => (
                <article key={asset.fileName} className="ux-source-card">
                  <b>{asset.title}</b>
                  <small>{displaySourceName(asset.fileName)}</small>
                  <p>{asset.description}</p>
                </article>
              ))}
            </div>
            <div>
              <h3>处理过程</h3>
              <ol>{template.demoWalkthrough.processingPreview.map((step) => <li key={step}>{step}</li>)}</ol>
            </div>
          </div>
          <div className="ux-answer-preview">
            <small>验证问题</small>
            <h3>{template.demoWalkthrough.sampleQuestion}</h3>
            <p>{template.demoWalkthrough.sampleAnswer}</p>
            <div className="ux-citation-grid">
              {template.demoWalkthrough.citations.map((citation) => (
                <article key={`${citation.source}-${citation.label}`}>
                  <b>{citation.label}</b>
                  <small>{displaySourceName(citation.source)}</small>
                  <p>{citation.excerpt}</p>
                </article>
              ))}
            </div>
          </div>
          <Pills items={template.demoWalkthrough.resultHighlights} />
        </section>
      </div>
    </FrontstageShell>
  );
}

export function CreateScenarioPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isBlankMode = searchParams.get("mode") === "blank";
  const initialTemplate = isBlankMode ? customScenarioTemplate.id : searchParams.get("template") ?? "customer-360";
  const [templateId, setTemplateId] = useState(initialTemplate);
  const initialTemplateObject = templateById(initialTemplate) ?? customScenarioTemplate;
  const [name, setName] = useState(isBlankMode ? "" : initialTemplateObject.demoWalkthrough.scenarioName);
  const [description, setDescription] = useState(isBlankMode ? "" : initialTemplateObject.headline);
  const [visibility, setVisibility] = useState<Visibility>(isBlankMode ? "private" : "team");
  const [processingGoal, setProcessingGoal] = useState(isBlankMode ? "让后台根据资料判断适合做成什么知识应用。" : initialTemplateObject.demoWalkthrough.sampleQuestion);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const template = templateById(templateId) ?? customScenarioTemplate;
  const creationTemplates = [customScenarioTemplate, ...officialTemplates];
  const isCustomTemplate = template.id === customScenarioTemplate.id;
  const uploadedFileNames = uploadedFiles.map((file) => file.name);
  const draft = useMemo(
    () => createScenarioDraft({
      templateId: template.id,
      name: name.trim() || template.demoWalkthrough.scenarioName,
      visibility,
      fileNames: uploadedFileNames,
      description,
      processingGoal
    }),
    [description, name, processingGoal, template.demoWalkthrough.scenarioName, template.id, uploadedFileNames, visibility]
  );
  const hasFiles = uploadedFiles.length > 0;
  function selectTemplate(next: string) {
    setTemplateId(next);
    const nextTemplate = templateById(next) ?? customScenarioTemplate;
    const isCustom = nextTemplate.id === customScenarioTemplate.id;
    setName(isCustom ? "" : nextTemplate.demoWalkthrough.scenarioName);
    setDescription(isCustom ? "" : nextTemplate.headline);
    setProcessingGoal(isCustom ? "让后台根据资料判断适合做成什么知识应用。" : nextTemplate.demoWalkthrough.sampleQuestion);
    setUploadedFiles([]);
    setSubmitError("");
  }

  async function submitScenario() {
    if (!name.trim() || !hasFiles || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError("");
    try {
      const form = new FormData();
      form.set("template_id", template.id);
      form.set("name", name.trim());
      form.set("description", description.trim());
      form.set("visibility", visibility);
      form.set("processing_goal", processingGoal.trim());
      uploadedFiles.forEach((file) => form.append("files", file));
      const response = await fetch("/api/platform/scenarios", { method: "POST", body: form });
      if (!response.ok) throw new Error("场景提交失败");
      const body = await response.json();
      router.push(`/app/tasks?created=${encodeURIComponent(body.task.id)}`);
    } catch {
      setSubmitError("提交失败，请确认资料文件仍然可用后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <FrontstageShell active="/app/templates" title="创建场景" eyebrow="创建场景">
      <section className="ux-page-head">
        <h1>先提交业务目标和资料包，再由后台完成知识处理。</h1>
        <p>前台负责创建场景、上传资料和说明期望产物；后台管理员会确认资料质量，并选择合适的知识处理方式后入库发布。</p>
      </section>
      <div className="ux-create-layout">
        <section className="ux-form-panel create-scenario-form">
          <div className="create-mode-switch">
            <button type="button" className={!isCustomTemplate ? "active" : ""} onClick={() => selectTemplate("customer-360")}>从模板创建</button>
            <button type="button" className={isCustomTemplate ? "active" : ""} onClick={() => selectTemplate(customScenarioTemplate.id)}>自建场景</button>
          </div>
          <div className="create-picker-block">
            <div className="create-section-title">
              <span>选择创建方式</span>
              <small>选择官方模板，或直接上传资料自建一个业务场景。</small>
            </div>
            <div className="create-template-options" role="radiogroup" aria-label="选择创建方式">
              {creationTemplates.map((item) => {
                const active = item.id === template.id;
                const custom = item.id === customScenarioTemplate.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={active ? "active" : ""}
                    role="radio"
                    aria-checked={active}
                    onClick={() => selectTemplate(item.id)}
                  >
                    <span>{custom ? "自建" : item.category}</span>
                    <b>{item.name}</b>
                    <small>{custom ? "上传资料并说明目标，由后台判断处理方式。" : item.demoWalkthrough.scenarioName}</small>
                  </button>
                );
              })}
            </div>
          </div>
          <label>场景名称</label>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：华东客户续约风险分析" />
          <label>场景说明</label>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="说明这个场景要解决什么问题、面向谁使用、希望输出什么结果。" />
          <label>期望处理结果</label>
          <textarea value={processingGoal} onChange={(event) => setProcessingGoal(event.target.value)} rows={3} placeholder="例如：把客户资料整理成可追问的续约简报，并展示风险、机会和来源依据。" />

          <div className="create-intake-panel">
            <div className="create-section-title">
              <span>权限与资料</span>
              <small>先确认谁能使用，再接入后台需要处理的业务资料。</small>
            </div>

            <div className="create-intake-grid">
              <section className="create-intake-section">
                <div className="create-mini-head">
                  <b>发布范围</b>
                  <span>决定场景处理完成后开放给谁使用。</span>
                </div>
                <div className="create-visibility-options" role="radiogroup" aria-label="发布范围">
                  {visibilityOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={visibility === option.value ? "active" : ""}
                      role="radio"
                      aria-checked={visibility === option.value}
                      onClick={() => setVisibility(option.value)}
                    >
                      <b>{option.label}</b>
                      <small>{option.description}</small>
                    </button>
                  ))}
                </div>
              </section>

              <section className="create-intake-section create-source-advice">
                <div className="create-mini-head">
                  <b>建议资料类型</b>
                  <span>当前模板更适合先提交这些资料。</span>
                </div>
                <div className="create-file-type-list">
                  {template.acceptedFiles.map((fileType) => <span key={fileType}>{fileType}</span>)}
                </div>
              </section>
            </div>

            <section className="create-intake-section create-upload-section">
              <div className="create-mini-head">
                <b>上传资料包</b>
                <span>{hasFiles ? "资料已接入，可以提交后台处理。" : "还没有接入资料，提交前至少需要选择一份文件或使用案例资料。"}</span>
              </div>
              <div className="create-upload-box">
                <input
                  id="scenario-file-upload"
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.md,.txt,.csv,.xlsx,.json,.html"
                  onChange={(event) => setUploadedFiles(Array.from(event.currentTarget.files ?? []))}
                />
                <label htmlFor="scenario-file-upload">选择文件</label>
                <button type="button" onClick={() => setUploadedFiles(template.demoWalkthrough.sampleInputs.map(makeTemplateSampleFile))}>使用模板案例资料</button>
                <span>{hasFiles ? `已接入 ${uploadedFiles.length} 份资料` : "支持 PDF、Word、Markdown、表格、JSON 等资料"}</span>
              </div>

              <div className={`create-file-state ${hasFiles ? "ready" : ""}`}>
                <b>{hasFiles ? "已接入资料" : "等待资料接入"}</b>
                {hasFiles ? (
                  <div className="ux-file-list create-file-list">
                    {uploadedFiles.map((file) => (
                      <span key={`${file.name}-${file.size}`}>{displaySourceName(file.name)}</span>
                    ))}
                  </div>
                ) : (
                  <p>可以上传自己的文件，也可以先使用模板案例资料跑通创建链路。</p>
                )}
              </div>
            </section>
          </div>

          {submitError && <p className="create-submit-error">{submitError}</p>}
          <button className="ux-button" disabled={!name.trim() || !hasFiles || isSubmitting} onClick={submitScenario}>
            {isSubmitting ? "正在提交资料" : "提交后台处理"}
          </button>
        </section>
        <aside className="ux-path-panel create-processing-panel">
          <h2>提交后链路</h2>
          <div className="create-admin-note">
            <b>{draft.task.currentStep}</b>
            <span>{draft.task.userMessage}</span>
          </div>
          {scenarioLifecycle.map((stage, index) => (
            <div className="ux-stage-row" key={stage.key}>
              <i>{index + 1}</i>
              <div>
                <b>{stage.label}</b>
                <span>{stage.description}</span>
              </div>
            </div>
          ))}
          <div className="create-admin-note">
            <b>后台管理员会决定什么</b>
            <span>确认资料质量、发布范围和处理策略；再选择知识汇编、文档证据、关系图谱或组合处理方式。</span>
          </div>
        </aside>
      </div>
    </FrontstageShell>
  );
}

export function MyScenariosPage({ initialSnapshot }: { initialSnapshot?: PlatformSnapshot } = {}) {
  const { snapshot, state } = usePlatformSnapshot(initialSnapshot);
  const [status, setStatus] = useState("全部");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scenarios = useMemo(() => sortScenariosByStatusAndTime(snapshot.scenarios).map(toScenarioInstance), [snapshot.scenarios]);
  const visible = scenarios.filter((scenario) => {
    const statusOk = status === "全部" || statusLabel(scenario.status) === status;
    const q = query.trim().toLowerCase();
    const template = templateById(scenario.templateId);
    const queryOk = !q || `${scenario.name} ${scenario.description} ${template?.name ?? ""} ${template?.category ?? ""}`.toLowerCase().includes(q);
    return statusOk && queryOk;
  });
  const selectedScenario = visible.find((scenario) => scenario.id === selectedId) ?? visible[0] ?? scenarios[0];
  const readyCount = scenarios.filter((scenario) => scenario.status === "ready").length;
  const processingCount = scenarios.filter((scenario) => scenario.status !== "ready" && scenario.status !== "failed").length;
  const companyCount = scenarios.filter((scenario) => scenario.visibility === "company").length;

  return (
    <FrontstageShell active="/app/scenarios" title="业务场景" eyebrow="知识应用资产" initialSnapshot={snapshot}>
      <section className="scenario-asset-head">
        <div>
          <span>业务场景资产</span>
          <h1>管理已经创建、正在处理和经常使用的知识应用。</h1>
          <p>场景不是一次性问答入口。每个场景都绑定资料、权限、处理任务、历史会话和可交付产物，打开后进入对应业务工作台。</p>
        </div>
        <div className="scenario-asset-metrics" aria-label="场景统计">
          <span><b>{scenarios.length}</b>全部场景</span>
          <span><b>{readyCount}</b>可使用</span>
          <span><b>{processingCount}</b>处理中</span>
          <span><b>{companyCount}</b>公司级</span>
        </div>
      </section>

      <div className="scenario-asset-layout">
        <aside className="scenario-asset-filter" aria-label="场景筛选">
          <Link className="scenario-create-primary" href="/app/templates">创建业务场景</Link>
          <section>
            <b>状态</b>
            {["全部", "可使用", "处理中", "待复核", "失败"].map((item) => (
              <button key={item} type="button" className={item === status ? "active" : ""} onClick={() => setStatus(item)}>
                <span>{item}</span>
                <em>{countScenariosByStatus(scenarios, item)}</em>
              </button>
            ))}
          </section>
          <section>
            <b>使用范围</b>
            {(["private", "team", "company"] as Visibility[]).map((item) => (
              <Link key={item} href={`/app/scenarios?scope=${item}`}>
                <span>{visibilityText(item)}</span>
                <em>{scenarios.filter((scenario) => scenario.visibility === item).length}</em>
              </Link>
            ))}
          </section>
        </aside>

        <section className="scenario-asset-table" aria-label="业务场景列表">
          <header>
            <div>
              <span>场景列表</span>
              <b>{visible.length} 个场景</b>
            </div>
            <label>
              <span>搜索</span>
              <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索场景、模板、业务目标..." />
            </label>
          </header>
          <div className="scenario-list-head" aria-hidden="true">
            <span>场景</span>
            <span>形态</span>
            <span>范围</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          <div className="scenario-asset-rows">
            {visible.map((scenario) => (
              <ScenarioAssetRow
                key={scenario.id}
                scenario={scenario}
                active={selectedScenario?.id === scenario.id}
                onFocus={() => setSelectedId(scenario.id)}
              />
            ))}
            {state !== "loading" && visible.length === 0 ? (
              <div className="scenario-empty-row">
                <b>没有匹配的业务场景</b>
                <span>可以调整筛选条件，或从模板创建一个新的知识应用。</span>
                <Link href="/app/templates">选择模板</Link>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="scenario-asset-inspector" aria-label="场景详情">
          {selectedScenario ? (
            <ScenarioAssetInspector scenario={selectedScenario} />
          ) : (
            <section>
              <span>还没有场景</span>
              <h2>先创建一个业务场景</h2>
              <p>上传资料后，后台管理员会选择真实 RAG 入库策略并发布给前台使用。</p>
              <Link href="/app/templates">选择模板</Link>
            </section>
          )}
        </aside>
      </div>
    </FrontstageShell>
  );
}

export function TaskCenterPage({ initialSnapshot }: { initialSnapshot?: PlatformSnapshot } = {}) {
  const searchParams = useSearchParams();
  const createdTask = searchParams.get("created");
  const [liveTasks, setLiveTasks] = useState<ProcessingTask[]>(initialSnapshot?.tasks ?? []);
  const [statusFilter, setStatusFilter] = useState("全部状态");
  const [kindFilter, setKindFilter] = useState("全部类型");
  const [sortBy, setSortBy] = useState("最新更新");

  useEffect(() => {
    let alive = true;
    fetch("/api/platform/tasks", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("tasks unavailable");
        return response.json();
      })
      .then((body) => {
        if (!alive) return;
        setLiveTasks(Array.isArray(body.tasks) ? body.tasks : []);
      })
      .catch(() => {
        if (!alive) return;
        setLiveTasks([]);
      });
    return () => {
      alive = false;
    };
  }, [createdTask]);

  const allTasks = useMemo(() => {
    // 按 id 去重：后端/脏数据可能返回重复 task，重复 key 会让 React 列表 reconciliation 错乱
    // （筛选/排序后复用错误 DOM 节点、内容不跟着更新），故渲染前先保证 id 唯一。
    const seenIds = new Set<string>();
    const base = liveTasks.filter((task) => {
      if (seenIds.has(task.id)) return false;
      seenIds.add(task.id);
      return true;
    });
    const filtered = base.filter((task) => {
      const statusOk = statusFilter === "全部状态" || taskStatusGroup(task) === statusFilter;
      const kindOk = kindFilter === "全部类型" || task.kind === kindFilter;
      return statusOk && kindOk;
    });
    return [...filtered].sort((a, b) => {
      if (sortBy === "处理进度") return b.progress - a.progress;
      if (sortBy === "提交时间") return compareTaskTime(a.submittedAt, b.submittedAt);
      return compareTaskTime(a.updatedAt, b.updatedAt);
    });
  }, [kindFilter, liveTasks, sortBy, statusFilter]);
  const pendingAdminCount = allTasks.filter((task) => task.waitingFor === "后台管理员").length;
  const runningCount = allTasks.filter((task) => task.status === "processing").length;
  const readyCount = allTasks.filter((task) => task.status === "ready").length;

  return (
    <FrontstageShell active="/app/tasks" title="处理任务" eyebrow="资料入库与发布进度" initialSnapshot={initialSnapshot}>
      <section className="ux-page-head task-center-head">
        <div>
          <span>任务中心</span>
          <h1>跟踪资料包从提交到发布的每一步。</h1>
          <p>这里按状态、类型和时间组织任务。用户能看到当前等待谁处理，后台管理员能据此接手资料入库和复核。</p>
        </div>
        <div className="task-head-metrics">
          <span><b>{pendingAdminCount}</b>待管理员确认</span>
          <span><b>{runningCount}</b>处理中</span>
          <span><b>{readyCount}</b>可使用</span>
        </div>
      </section>
      {createdTask && (
        <section className="task-submit-banner">
          <b>新场景任务已提交</b>
          <span>后台已接收到场景名称、资料包和处理诉求。任务已进入“待管理员确认”，需要选择知识处理方式后才能入库。</span>
        </section>
      )}
      <section className="task-control-bar" aria-label="任务筛选和排序">
        <div>
          {["全部状态", "待管理员确认", "处理中", "可使用"].map((item) => (
            <button key={item} type="button" className={statusFilter === item ? "active" : ""} onClick={() => setStatusFilter(item)}>{item}</button>
          ))}
        </div>
        <div>
          {["全部类型", "资料接入", "管理员确认", "发布复核"].map((item) => (
            <button key={item} type="button" className={kindFilter === item ? "active" : ""} onClick={() => setKindFilter(item)}>{item}</button>
          ))}
        </div>
        <div>
          {["最新更新", "提交时间", "处理进度"].map((item) => (
            <button key={item} type="button" className={sortBy === item ? "active" : ""} onClick={() => setSortBy(item)}>{item}</button>
          ))}
        </div>
      </section>
      <div className="task-board-layout">
        <aside className="task-board-side">
          <b>处理规则</b>
          <p>个人资料只进入个人知识空间；团队资料只对团队场景开放；公司级资料需要管理员复核后才能进入公司大脑。</p>
          <div className="task-board-side-note">
            <span>前台只展示处理状态</span>
            <strong>入库、复核和发布由后台管理员在管理台完成。</strong>
          </div>
        </aside>
        <div className="task-list">
          {allTasks.map((task) => <TaskCard key={task.id} task={task} />)}
          {allTasks.length === 0 ? (
            <article className="ux-task-card">
              <header className="task-card-head"><span>暂无任务</span><small>资料接入</small></header>
              <h2>还没有提交资料处理任务</h2>
              <p>从模板或自建场景上传资料后，这里会显示等待后台确认、入库、发布和退回补充的真实任务。</p>
              <footer className="task-card-actions"><Link href="/app/templates">选择模板</Link><Link href="/app/create?mode=blank">自建场景</Link></footer>
            </article>
          ) : null}
        </div>
      </div>
    </FrontstageShell>
  );
}

export function KnowledgeSpacePage({ initialSnapshot }: { initialSnapshot?: PlatformSnapshot } = {}) {
  const { snapshot, state } = usePlatformSnapshot(initialSnapshot);
  const knowledgeObjects = useMemo(() => snapshot.knowledge.map(toKnowledgeSpaceObject), [snapshot.knowledge]);
  const [scopeFilter, setScopeFilter] = useState<KnowledgeAssetScope>("all");
  const [kindFilter, setKindFilter] = useState<KnowledgeAssetKindFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stats = useMemo(() => buildKnowledgeAssetStats(knowledgeObjects), [knowledgeObjects]);
  const filteredObjects = useMemo(
    () => filterKnowledgeAssets(knowledgeObjects, { scope: scopeFilter, kind: kindFilter, query }),
    [knowledgeObjects, scopeFilter, kindFilter, query]
  );
  const selectedObject = filteredObjects.find((object) => object.id === selectedId) ?? filteredObjects[0] ?? knowledgeObjects[0] ?? null;
  return (
    <FrontstageShell active="/app/knowledge" title="知识资产" eyebrow="可召回知识空间" initialSnapshot={snapshot}>
      <section className="knowledge-asset-head">
        <div>
          <span>知识资产中心</span>
          <h1>管理可召回的知识资产、权限边界和业务来源。</h1>
          <p>这里展示当前账号真实可见的文档证据、关系图谱、知识百科和业务产物。用户可以确认哪些知识能被个人、团队或公司级场景召回，并发起更新、共享或发布申请。</p>
        </div>
        <div className="knowledge-asset-metrics">
          <span><b>{stats.total}</b>全部资产</span>
          <span><b>{stats.private}</b>个人</span>
          <span><b>{stats.team}</b>团队</span>
          <span><b>{stats.company}</b>公司</span>
        </div>
      </section>
      <div className="knowledge-asset-layout">
        <aside className="knowledge-asset-filter">
          <div className="knowledge-filter-block">
            <strong>权限范围</strong>
            {knowledgeAssetScopes.map((scope) => (
              <button key={scope.id} type="button" className={scopeFilter === scope.id ? "active" : ""} onClick={() => setScopeFilter(scope.id)}>
                <b>{scope.label}</b>
                <span>{scope.description}</span>
              </button>
            ))}
          </div>
          <div className="knowledge-filter-block">
            <strong>资产类型</strong>
            {knowledgeAssetKinds.map((kind) => (
              <button key={kind.id} type="button" className={kindFilter === kind.id ? "active" : ""} onClick={() => setKindFilter(kind.id)}>
                <b>{kind.label}</b>
                <span>{kind.description}</span>
              </button>
            ))}
          </div>
        </aside>
        <section className="knowledge-asset-main">
          <div className="knowledge-asset-toolbar">
            <div>
              <span>资产清单</span>
              <b>{filteredObjects.length} / {stats.total}</b>
            </div>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资产、来源、负责人或场景..." aria-label="搜索知识资产" />
          </div>
          <div className="knowledge-asset-table" role="list">
            {filteredObjects.map((object) => (
              <KnowledgeAssetRow
                key={object.id}
                object={object}
                active={selectedObject?.id === object.id}
                onSelect={() => setSelectedId(object.id)}
              />
            ))}
            {state !== "loading" && filteredObjects.length === 0 ? (
              <div className="knowledge-empty-state">
                <b>当前条件下没有知识资产</b>
                <p>可以调整筛选条件，或从方案模板创建业务场景并提交资料，等待后台完成入库后再查看。</p>
                <Link href="/app/templates">选择方案模板</Link>
              </div>
            ) : null}
          </div>
        </section>
        <KnowledgeAssetInspector object={selectedObject} />
      </div>
    </FrontstageShell>
  );
}

export function OutputsPage() {
  return <KnowledgeSpacePage />;
}

export function SettingsPage({ initialSnapshot }: { initialSnapshot?: PlatformSnapshot } = {}) {
  const auth = useAuth();
  const { snapshot } = usePlatformSnapshot(initialSnapshot);
  const account = useMemo(
    () => auth.user ? buildAccountPermissionViewModel({ user: auth.user, snapshot }) : null,
    [auth.user, snapshot]
  );

  if (!account) return null;

  return (
    <FrontstageShell active="/app/settings" title="账号与权限" eyebrow="账号与知识权限" initialSnapshot={snapshot}>
      <div className="account-permission-page">
        <section className="account-permission-header" data-account-section="header">
          <span>账号中心</span>
          <h1>账号与权限</h1>
          <p>这里展示当前账号已获授权的身份归属与知识访问边界。</p>
        </section>
        <div className="account-permission-grid">
          <section className="account-permission-section" data-account-section="identity">
            <header>
              <span>身份归属</span>
              <h2>当前账号</h2>
            </header>
            <dl className="account-permission-details">
              <div><dt>账号</dt><dd>{account.identity.displayName}（{account.identity.username}）</dd></div>
              <div><dt>组织</dt><dd>{account.identity.organizationLabel}</dd></div>
              <div><dt>所属团队</dt><dd>{account.identity.teamLabels.length > 0 ? account.identity.teamLabels.join("、") : "未分配团队"}</dd></div>
              <div><dt>角色</dt><dd>{account.identity.roleLabel}</dd></div>
            </dl>
          </section>
          <div className="account-permission-side">
            <section className="account-permission-section" data-account-section="permissions">
              <header>
                <span>权限范围</span>
                <h2>可见知识资产</h2>
              </header>
              <div className="account-permission-counts">
                <div><b>{account.knowledgeCounts.private} 个资产</b><span>个人知识仅当前账号可见。</span></div>
                <div><b>{account.knowledgeCounts.team} 个资产</b><span>团队知识按所属团队授权。</span></div>
                <div><b>{account.knowledgeCounts.company} 个资产</b><span>公司知识在当前账号范围内可检索。</span></div>
              </div>
            </section>
            <section className="account-permission-section account-permission-links" data-account-section="quick-links">
              <header>
                <span>快捷入口</span>
                <h2>继续处理工作</h2>
              </header>
              <div>
                {account.links.filter((link) => link.visible).map((link) => (
                  <Link key={link.id} href={link.href}>
                    {link.id === "knowledge"
                      ? "查看知识资产"
                      : link.id === "tasks"
                        ? "查看处理任务"
                        : "进入治理后台"}
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </FrontstageShell>
  );
}

export function ScenarioDetailByIdPage({
  id,
  tab = "overview",
  initialQuery,
  initialSessionId
}: {
  id: string;
  tab?: ScenarioTab;
  initialQuery?: string;
  initialSessionId?: string;
}) {
  const workbench = scenarioWorkbenchById(id);
  if (!workbench) return <LiveScenarioDetailPage id={id} tab={tab} initialQuery={initialQuery} initialSessionId={initialSessionId} />;
  return <ScenarioDetailPage workbench={workbench} tab={tab} initialQuery={initialQuery} />;
}

function LiveScenarioDetailPage({ id, tab = "overview", initialQuery, initialSessionId }: { id: string; tab?: ScenarioTab; initialQuery?: string; initialSessionId?: string }) {
  const auth = useAuth();
  const [state, setState] = useState<"loading" | "ready" | "not-found" | "error">("loading");
  const [scenario, setScenario] = useState<LiveScenarioRecord | null>(null);
  const [tasks, setTasks] = useState<ProcessingTask[]>([]);
  const [knowledge, setKnowledge] = useState<LiveKnowledgeRecord[]>([]);
  const [template, setTemplate] = useState<LiveWorkbenchTemplate>(() => ({
    id: customScenarioTemplate.id,
    name: customScenarioTemplate.name,
    category: customScenarioTemplate.category,
    headline: customScenarioTemplate.headline,
    productForm: customScenarioTemplate.productForm,
    outputCapabilities: customScenarioTemplate.outputCapabilities
  }));
  const [surface, setSurface] = useState<ScenarioProductSurface>(() => buildScenarioProductSurface(customScenarioTemplate.id, { productForm: customScenarioTemplate.productForm }));
  const [sessions, setSessions] = useState<ScenarioChatSessionSummary[]>([]);

  useEffect(() => {
    if (auth.state === "loading") return;
    if (!auth.token) {
      setState("error");
      return;
    }
    let cancelled = false;
    async function loadLiveScenario() {
      setState("loading");
      try {
        const headers = { Authorization: `Bearer ${auth.token}` };
        const [workbenchResponse, sessionsResponse] = await Promise.all([
          fetch(`/api/platform/scenarios/${id}/workbench`, { headers, cache: "no-store" }),
          fetch(`/api/platform/scenarios/${id}/sessions`, { headers, cache: "no-store" })
        ]);
        if (workbenchResponse.status === 404) {
          if (!cancelled) setState("not-found");
          return;
        }
        if (!workbenchResponse.ok) throw new Error("live scenario unavailable");
        const workbenchBody = await workbenchResponse.json();
        const sessionsBody = sessionsResponse.ok ? await sessionsResponse.json() : { sessions: [] };
        const liveScenario = workbenchBody.scenario as LiveScenarioRecord | null;
        if (cancelled) return;
        if (!liveScenario) {
          setState("not-found");
          return;
        }
        setScenario(liveScenario);
        setTasks(Array.isArray(workbenchBody.tasks) ? workbenchBody.tasks : []);
        setKnowledge(Array.isArray(workbenchBody.knowledge_objects) ? workbenchBody.knowledge_objects : []);
        setTemplate(workbenchBody.template ?? template);
        setSurface(workbenchBody.surface ?? buildScenarioProductSurface(liveScenario.templateId));
        setSessions(Array.isArray(sessionsBody.sessions) ? sessionsBody.sessions : []);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    }
    void loadLiveScenario();
    return () => {
      cancelled = true;
    };
  }, [auth.state, auth.token, id]);

  if (state === "not-found") return <NotFoundScenarioPage />;

  const tabs = ["overview", "data", "tasks", "ask", "outputs", "settings"] as const;
  return (
    <FrontstageShell active="/app/scenarios" title={scenario?.name ?? "场景加载中"} eyebrow={template.name}>
      {state === "loading" ? (
        <section className="ux-page-head"><h1>正在读取场景</h1><p>系统正在加载前台提交、后台入库后的真实场景数据。</p></section>
      ) : state === "error" || !scenario ? (
        <section className="ux-page-head"><h1>暂时无法读取场景</h1><p>请确认登录状态和本地平台服务是否可用。</p></section>
      ) : (
        <>
          <section className={`scenario-workbench-hero ${scenario.status === "ready" ? "ready" : ""}`}>
            <div className="scenario-workbench-title">
              <span>{template.category} · {surface.label} · {statusLabel(scenario.status)}</span>
              <h1>{scenario.name}</h1>
              <p>{scenario.description || scenario.processingGoal}</p>
            </div>
            <div className="scenario-workbench-primary">
              <Link href={`/app/scenarios/${scenario.id}/ask?q=${encodeURIComponent(surface.primaryAction.prompt)}`}>{surface.primaryAction.label}</Link>
              <Link href={`/app/scenarios/${scenario.id}/data`}>管理资料</Link>
            </div>
            <div className="ux-workbench-meta scenario-workbench-meta">
              <Meta label="负责人" value={scenario.ownerName} />
              <Meta label="资料源" value={`${scenario.sourceCount} 个`} />
              <Meta label="发布范围" value={visibilityText(scenario.visibility)} />
            </div>
            <nav className="ux-tabs" aria-label="场景工作台">
              {tabs.map((item) => (
                <Link key={item} href={`/app/scenarios/${scenario.id}${item === "overview" ? "" : `/${item}`}`} className={item === tab ? "active" : ""}>
                  {scenarioTabLabel(item)}
                </Link>
              ))}
            </nav>
          </section>
          {tab === "overview" && <LiveScenarioOverview scenario={scenario} template={template} surface={surface} tasks={tasks} knowledge={knowledge} sessions={sessions} />}
          {tab === "data" && <LiveScenarioDataPanel knowledge={knowledge} />}
          {tab === "tasks" && <div className="ux-task-grid">{tasks.map((task) => <TaskCard key={task.id} task={task} />)}</div>}
          {tab === "ask" && <LiveScenarioAskPanel scenario={scenario} surface={surface} sessions={sessions} tasks={tasks} knowledge={knowledge} initialQuery={initialQuery} initialSessionId={initialSessionId} token={auth.token} onSessionsChange={setSessions} />}
          {tab === "outputs" && <LiveScenarioOutputsPanel scenario={scenario} template={template} surface={surface} knowledge={knowledge} />}
          {tab === "settings" && <LiveScenarioSettingsPanel scenario={scenario} surface={surface} knowledge={knowledge} />}
        </>
      )}
    </FrontstageShell>
  );
}

export function ScenarioRunPage({ id }: { id: string }) {
  return <ScenarioDetailByIdPage id={id} tab="ask" />;
}

export function ScenarioDetailPage({
  workbench,
  tab = "overview",
  initialQuery
}: {
  workbench: ScenarioWorkbench;
  tab?: ScenarioTab;
  initialQuery?: string;
}) {
  return (
    <FrontstageShell active="/app/scenarios" title={workbench.scenario.name} eyebrow={workbench.template.name}>
      <ScenarioWorkbenchHeader workbench={workbench} activeTab={tab} />
      {tab === "overview" && (workbench.scenario.status === "ready" ? <ReadyScenarioUsePage workbench={workbench} /> : <ScenarioOverview workbench={workbench} />)}
      {tab === "data" && <ScenarioDataTab dataSources={workbench.dataSources} />}
      {tab === "tasks" && <ScenarioTasksTab workbench={workbench} />}
      {tab === "ask" && <ScenarioAskTab workbench={workbench} initialQuery={initialQuery} />}
      {tab === "outputs" && <ScenarioOutputsTab outputs={workbench.outputs} />}
      {tab === "settings" && <ScenarioSettingsTab settings={workbench.settings} />}
    </FrontstageShell>
  );
}

export function NotFoundScenarioPage() {
  return (
    <FrontstageShell active="/app/scenarios" title="场景不存在">
      <section className="ux-page-head">
        <h1>没有找到这个场景</h1>
        <p>可能已经归档，或当前账号没有访问权限。</p>
        <Link className="ux-primary-link" href="/app/scenarios">返回场景资产中心</Link>
      </section>
    </FrontstageShell>
  );
}

function LiveScenarioOverview({
  scenario,
  template,
  surface,
  tasks,
  knowledge,
  sessions
}: {
  scenario: LiveScenarioRecord;
  template: LiveWorkbenchTemplate;
  surface: ScenarioProductSurface;
  tasks: ProcessingTask[];
  knowledge: LiveKnowledgeRecord[];
  sessions: ScenarioChatSessionSummary[];
}) {
  const latestTask = tasks[0];
  const ready = scenario.status === "ready";
  return (
    <div className="scenario-live-console">
      <section className="scenario-use-panel">
        <div className="scenario-use-copy">
          <span>{ready ? "当前可用" : statusLabel(scenario.status)}</span>
          <h2>{surface.workspaceTitle}</h2>
          <p>{ready ? surface.description : latestTask?.userMessage ?? "后台完成入库和发布后，这里会出现可使用的业务工作台。"}</p>
        </div>
        <div className="scenario-use-actions">
          <Link className="primary" href={`/app/scenarios/${scenario.id}/ask?q=${encodeURIComponent(surface.primaryAction.prompt)}`}>{surface.primaryAction.label}</Link>
          {surface.secondaryActions.slice(0, 2).map((action) => (
            <Link key={action.label} href={`/app/scenarios/${scenario.id}/ask?q=${encodeURIComponent(action.prompt)}`}>{action.label}</Link>
          ))}
        </div>
      </section>

      <section className="scenario-live-section scenario-history-section">
        <header>
          <div><span>历史记录</span><h3>最近在这个场景里的使用记录</h3></div>
          <Link href={`/app/scenarios/${scenario.id}/ask`}>新建会话</Link>
        </header>
        <div className="scenario-history-list">
          {sessions.slice(0, 4).map((session) => (
            <Link key={session.id} href={`/app/scenarios/${scenario.id}/ask?session=${session.id}`}>
              <b>{session.title}</b>
              <span>{session.latestMessage}</span>
              <small>{session.updatedAtText} · {session.messageCount} 条消息</small>
            </Link>
          ))}
          {sessions.length === 0 ? (
            <Link href={`/app/scenarios/${scenario.id}/ask?q=${encodeURIComponent(surface.primaryAction.prompt)}`}>
              <b>还没有历史会话</b>
              <span>第一次使用会自动保存为这个场景的历史记录。</span>
              <small>{surface.primaryAction.label}</small>
            </Link>
          ) : null}
        </div>
      </section>

      <section className="scenario-live-section scenario-material-section">
        <header>
          <div><span>资料管理</span><h3>{knowledge.length} 个已入库知识对象</h3></div>
          <Link href={`/app/scenarios/${scenario.id}/data`}>查看资料</Link>
        </header>
        <div className="scenario-material-list">
          {knowledge.slice(0, 5).map((item) => (
            <Link key={item.id} href={`/app/scenarios/${scenario.id}/ask?q=${encodeURIComponent(item.title)}`}>
              <b>{displaySourceName(item.sourceOriginalName)}</b>
              <span>{item.ragEngine}</span>
              <small>{truncateText(item.content, 72)}</small>
            </Link>
          ))}
          {knowledge.length === 0 ? <p>后台确认入库后，这里会展示当前场景可召回的资料、切片、图谱或知识页。</p> : null}
        </div>
      </section>

      <aside className="scenario-live-rail">
        <section>
          <span>可生成材料</span>
          <div className="scenario-output-actions">
            {(template.outputCapabilities.length ? template.outputCapabilities : ["业务摘要", "引用依据", "行动建议"]).slice(0, 5).map((item) => (
              <Link key={item} href={`/app/scenarios/${scenario.id}/ask?q=${encodeURIComponent(`生成${item}`)}`}>{item}</Link>
            ))}
          </div>
        </section>
        <section>
          <span>后台状态</span>
          <div className="scenario-state-stack">
            <div><b>{statusLabel(scenario.status)}</b><small>{latestTask?.currentStep ?? scenario.processingGoal}</small></div>
            <div><b>{visibilityText(scenario.visibility)}</b><small>权限过滤会作用于问答、资料和产物。</small></div>
            <div><b>{surface.label}</b><small>{surface.headline}</small></div>
          </div>
        </section>
      </aside>
    </div>
  );
}

function ScenarioSessionList({
  sessions,
  activeSessionId,
  scenarioId,
  onOpen,
  onNew
}: {
  sessions: ScenarioChatSessionSummary[];
  activeSessionId: string | null;
  scenarioId: string;
  onOpen: (sessionId: string) => void;
  onNew: () => void;
}) {
  return (
    <aside className="scenario-chat-history">
      <header>
        <span>历史记录</span>
        <button type="button" onClick={onNew}>新建</button>
      </header>
      <div>
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            className={activeSessionId === session.id ? "active" : ""}
            onClick={() => onOpen(session.id)}
          >
            <b>{session.title}</b>
            <span>{session.latestMessage}</span>
            <small>{session.updatedAtText} · {session.messageCount} 条消息</small>
          </button>
        ))}
        {sessions.length === 0 ? (
          <Link href={`/app/scenarios/${scenarioId}/ask`}>
            <b>暂无历史</b>
            <span>首次发送后会保存在这里。</span>
          </Link>
        ) : null}
      </div>
    </aside>
  );
}

function LiveScenarioDataPanel({ knowledge }: { knowledge: LiveKnowledgeRecord[] }) {
  return (
    <section className="ux-panel">
      <PanelTitle title="已入库资料" actionHref="/app/templates" actionLabel="继续创建场景" />
      <div className="ux-table">
        {knowledge.map((item) => (
          <article key={item.id}>
            <div>
              <b>{item.title}</b>
              <span>{displaySourceName(item.sourceOriginalName)}</span>
            </div>
            <em>{item.ragEngine}</em>
            <strong>{visibilityText(item.visibility)}</strong>
            <small>{item.content}</small>
          </article>
        ))}
        {knowledge.length === 0 ? <p>当前场景还没有可查看的知识对象，请先等待管理员完成入库。</p> : null}
      </div>
    </section>
  );
}

function LiveScenarioAskPanel({
  scenario,
  surface,
  sessions,
  tasks,
  knowledge,
  initialQuery,
  initialSessionId,
  token,
  onSessionsChange
}: {
  scenario: LiveScenarioRecord;
  surface: ScenarioProductSurface;
  sessions: ScenarioChatSessionSummary[];
  tasks: ProcessingTask[];
  knowledge: LiveKnowledgeRecord[];
  initialQuery?: string;
  initialSessionId?: string;
  token: string | null;
  onSessionsChange: (sessions: ScenarioChatSessionSummary[]) => void;
}) {
  const [sessionSummaries, setSessionSummaries] = useState<ScenarioChatSessionSummary[]>(sessions);
  const [activeSession, setActiveSession] = useState<ScenarioChatSession | null>(null);
  const [input, setInput] = useState(initialQuery ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const startedInitialQueryRef = useRef(false);
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  const latestAssistant = [...(activeSession?.messages ?? [])].reverse().find((item) => item.role === "assistant");
  const latestCitations = latestAssistant?.citations ?? [];

  function requestHeaders(json = false) {
    return {
      ...(json ? { "content-type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  async function refreshSessions() {
    if (!token) return;
    const response = await fetch(`/api/platform/scenarios/${scenario.id}/sessions`, { headers: requestHeaders(), cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return;
    const nextSessions = Array.isArray(body.sessions) ? body.sessions as ScenarioChatSessionSummary[] : [];
    setSessionSummaries(nextSessions);
    onSessionsChange(nextSessions);
  }

  async function openSession(sessionId: string) {
    if (!token) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/platform/scenarios/${scenario.id}/sessions/${sessionId}`, {
        headers: requestHeaders(),
        cache: "no-store"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "无法打开这条历史记录。");
      setActiveSession(body.session as ScenarioChatSession);
      setAnimatingId(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法打开这条历史记录。");
    } finally {
      setPending(false);
    }
  }

  async function createSession(nextQuery: string) {
    const q = nextQuery.trim();
    if (!q || pending) return;
    setPending(true);
    setMessage("");

    // 乐观渲染：发送前立即显示用户消息，清空输入框
    const optimisticUserMsg: ScenarioChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
      createdAt: new Date().toISOString()
    };
    setActiveSession({
      id: "",
      scenarioId: scenario.id,
      title: q.slice(0, 60),
      ownerName: "",
      updatedAt: new Date().toISOString(),
      messages: [optimisticUserMsg]
    });
    setInput("");

    try {
      const response = await fetch(`/api/platform/scenarios/${scenario.id}/sessions`, {
        method: "POST",
        headers: requestHeaders(true),
        body: JSON.stringify({ query: q })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "会话创建失败。");
      const createdScenarioSession = body.session as ScenarioChatSession;
      setActiveSession(createdScenarioSession);
      const lastCreatedScenarioMsg = createdScenarioSession.messages[createdScenarioSession.messages.length - 1];
      if (lastCreatedScenarioMsg?.role === "assistant") setAnimatingId(lastCreatedScenarioMsg.id);
      await refreshSessions();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会话创建失败。");
      setInput(q);       // 失败时恢复输入，不丢用户消息
      setActiveSession(null);
      setAnimatingId(null);
    } finally {
      setPending(false);
    }
  }

  async function appendQuestion(nextQuery: string) {
    const q = nextQuery.trim();
    if (!q || !activeSession || pending) return;
    setPending(true);
    setMessage("");

    // 乐观渲染：发送前立即追加用户消息，清空输入框
    const optimisticUserMsg: ScenarioChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
      createdAt: new Date().toISOString()
    };
    const sessionBeforeUpdate = activeSession;
    setActiveSession({
      ...activeSession,
      messages: [...activeSession.messages, optimisticUserMsg]
    });
    setInput("");

    try {
      const response = await fetch(`/api/platform/scenarios/${scenario.id}/sessions/${activeSession.id}/messages`, {
        method: "POST",
        headers: requestHeaders(true),
        body: JSON.stringify({ query: q })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "追问失败。");
      const appendedScenarioSession = body.session as ScenarioChatSession;
      setActiveSession(appendedScenarioSession);
      const lastAppendedScenarioMsg = appendedScenarioSession.messages[appendedScenarioSession.messages.length - 1];
      if (lastAppendedScenarioMsg?.role === "assistant") setAnimatingId(lastAppendedScenarioMsg.id);
      await refreshSessions();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "追问失败。");
      setActiveSession(sessionBeforeUpdate);  // 回滚乐观更新
      setAnimatingId(null);
      setInput(q);                            // 恢复输入
    } finally {
      setPending(false);
    }
  }

  function submitQuestion(nextQuery = input) {
    if (scenario.status !== "ready") return;
    if (activeSession) void appendQuestion(nextQuery);
    else void createSession(nextQuery);
  }

  useEffect(() => {
    setSessionSummaries(sessions);
  }, [sessions]);

  useEffect(() => {
    if (!token || startedInitialQueryRef.current) return;
    if (initialSessionId) {
      startedInitialQueryRef.current = true;
      void openSession(initialSessionId);
      return;
    }
    if (scenario.status === "ready" && initialQuery?.trim()) {
      startedInitialQueryRef.current = true;
      void createSession(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, scenario.status, token, initialQuery, initialSessionId]);

  const fallbackText = scenario.status === "ready"
    ? surface.emptyState
    : tasks[0]?.userMessage ?? "当前场景还在等待后台处理。";

  return (
    <div className="scenario-chat-workspace">
      <ScenarioSessionList
        sessions={sessionSummaries}
        activeSessionId={activeSession?.id ?? null}
        scenarioId={scenario.id}
        onOpen={(sessionId) => void openSession(sessionId)}
        onNew={() => {
          setActiveSession(null);
          setInput("");
          setMessage("");
        }}
      />
      <section className="scenario-chat-main">
        {!activeSession ? (
          <div className="scenario-chat-empty">
            <span>{surface.label}</span>
            <h2>{surface.workspaceTitle}</h2>
            <p>{fallbackText}</p>
            <div className="scenario-prompt-grid">
              {surface.quickPrompts.slice(0, 4).map((prompt) => (
                <button key={prompt} type="button" onClick={() => setInput(prompt)}>{prompt}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="scenario-message-list">
            {activeSession.messages.map((item) => (
              <article key={item.id} className={`scenario-message ${item.role}`}>
                <span>{item.role === "user" ? "你" : scenario.name}</span>
                {item.role === "user" ? <p>{item.content}</p> : <AssistantText content={item.content} animate={item.id === animatingId} />}
                {item.role === "assistant" && item.citations?.length ? (
                  <ScenarioInlineCitations citations={item.citations} />
                ) : null}
                {item.role === "assistant" ? <AnswerFeedback traceId={item.traceId} /> : null}
              </article>
            ))}
            {pending ? (
              <article className="scenario-message assistant">
                <span>{scenario.name}</span>
                <p>正在基于当前场景资料生成回答...</p>
              </article>
            ) : null}
          </div>
        )}
        {message ? <p className="global-error">{message}</p> : null}
        <form
          className="scenario-composer"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const nextQuery = String(form.get("q") ?? "");
            submitQuestion(nextQuery);
            event.currentTarget.reset();
          }}
        >
          <input
            name="q"
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            placeholder={scenario.status === "ready" ? surface.primaryAction.prompt : "等待后台入库后即可使用..."}
          />
          <button type="submit" disabled={pending || scenario.status !== "ready"}>{pending ? "生成中" : "发送"}</button>
        </form>
      </section>
      <aside className={`scenario-evidence-rail mode-${surface.rightRailMode}`}>
        <section>
          <span>{surface.contextPanelTitle}</span>
          <h2>{latestCitations.length ? `${latestCitations.length} 条本轮依据` : "等待本轮回答"}</h2>
          <div className="scenario-evidence-list">
            {(latestCitations.length ? latestCitations : knowledge.slice(0, 5).map((item) => ({
              knowledgeObjectId: item.id,
              sourceOriginalName: item.sourceOriginalName,
              scenarioName: scenario.name,
              engine: item.ragEngine,
              excerpt: item.content
            }))).map((citation, index) => <ScenarioEvidenceCard key={`${citation.knowledgeObjectId}-${citation.sourceOriginalName}-${index}`} citation={citation} />)}
          </div>
        </section>
        <section>
          <span>可生成材料</span>
          <div className="scenario-output-actions">
            {surface.secondaryActions.map((action) => (
              <button key={action.label} type="button" onClick={() => setInput(action.prompt)}>{action.label}</button>
            ))}
          </div>
        </section>
        <section>
          <span>资料状态</span>
          <div className="scenario-state-stack">
            <div><b>{statusLabel(scenario.status)}</b><small>{tasks[0]?.currentStep ?? scenario.processingGoal}</small></div>
            <div><b>{knowledge.length} 个知识对象</b><small>回答会按当前账号权限过滤。</small></div>
          </div>
          <Link className="scenario-rail-link" href={`/app/scenarios/${scenario.id}/data`}>管理资料</Link>
        </section>
      </aside>
    </div>
  );
}

function ScenarioInlineCitations({ citations }: { citations: ScenarioCitation[] }) {
  const groups = groupScenarioCitations(citations);
  return (
    <div className="scenario-inline-citations" aria-label="本条回答命中的依据类型">
      {groups.map((group) => (
        <em key={group.engine} className={`citation-${scenarioEngineClass(group.engine)}`}>
          <span>{group.label}</span>
          <b>{group.count} 条</b>
        </em>
      ))}
    </div>
  );
}

function ScenarioEvidenceCard({ citation }: { citation: ScenarioCitation }) {
  const label = knowledgeTypeLabel(citation.engine);
  const facts = scenarioEvidenceFacts(citation.excerpt);
  return (
    <article className={`scenario-evidence-card evidence-${scenarioEngineClass(citation.engine)}`}>
      <header>
        <span>{label}</span>
        <small>{scenarioEvidenceBadge(citation.engine)}</small>
      </header>
      <b>{displaySourceName(citation.sourceOriginalName)}</b>
      <p>{scenarioEvidenceHint(citation.engine)}</p>
      {facts.length > 1 ? (
        <ul>
          {facts.slice(0, 3).map((fact) => <li key={fact}>{fact}</li>)}
        </ul>
      ) : (
        <strong>{facts[0] ?? "当前依据已命中，但没有可展示的摘要。"}</strong>
      )}
    </article>
  );
}

function LiveScenarioOutputsPanel({ scenario, template, surface, knowledge }: { scenario: LiveScenarioRecord; template: LiveWorkbenchTemplate; surface: ScenarioProductSurface; knowledge: LiveKnowledgeRecord[] }) {
  return (
    <div className="scenario-output-workspace">
      <section className="scenario-output-head">
        <div>
          <span>{surface.label}</span>
          <h2>这个场景可以持续生成和复用的业务材料</h2>
          <p>产物会基于后台已入库资料生成，生成后可下载、分享或继续回到场景内追问。</p>
        </div>
        <Link href={`/app/scenarios/${scenario.id}/ask?q=${encodeURIComponent(surface.primaryAction.prompt)}`}>{surface.primaryAction.label}</Link>
      </section>
      <div className="scenario-output-list">
        {(template.outputCapabilities.length ? template.outputCapabilities : ["业务摘要", "引用依据", "行动建议"]).map((item) => (
          <article key={item}>
            <div>
              <span>可生成</span>
              <h3>{item}</h3>
              <p>{surface.description}</p>
            </div>
            <div className="scenario-output-row-actions">
              <Link href={`/app/scenarios/${scenario.id}/ask?q=${encodeURIComponent(`生成${item}`)}`}>生成</Link>
              <Link href={`/app/scenarios/${scenario.id}/ask?q=${encodeURIComponent(`生成${item}的可下载版本`)}`}>生成可下载版</Link>
            </div>
          </article>
        ))}
      </div>
      <section className="scenario-output-sources">
        <span>可用于生成的资料依据</span>
        {knowledge.slice(0, 6).map((item) => (
          <Link key={item.id} href={`/app/scenarios/${scenario.id}/ask?q=${encodeURIComponent(item.title)}`}>
            <b>{displaySourceName(item.sourceOriginalName)}</b>
            <small>{item.ragEngine} · {truncateText(item.content, 90)}</small>
          </Link>
        ))}
        {knowledge.length === 0 ? <p>后台确认入库后会生成可查看的知识对象。</p> : null}
      </section>
    </div>
  );
}

function LiveScenarioSettingsPanel({ scenario, surface, knowledge }: { scenario: LiveScenarioRecord; surface: ScenarioProductSurface; knowledge: LiveKnowledgeRecord[] }) {
  const engines = Array.from(new Set(knowledge.map((item) => item.ragEngine)));
  return (
    <div className="ux-settings-grid">
      <SettingsBlock title="场景权限" items={[visibilityText(scenario.visibility), `负责人：${scenario.ownerName}`, `资料源：${scenario.sourceCount} 个`]} />
      <SettingsBlock title="后台处理" items={[scenario.processingGoal || "等待后台判断", engines.length ? `已入库：${engines.join("、")}` : "尚未完成入库"]} />
      <SettingsBlock title="使用形态" items={[surface.label, surface.workspaceTitle, scenario.status === "ready" ? surface.primaryAction.label : "等待后台发布"]} />
    </div>
  );
}

function FrontstageShell({ active, title, eyebrow, initialSnapshot, children }: ShellProps) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { snapshot } = usePlatformSnapshot(initialSnapshot);
  const pendingCount = snapshot.tasks.filter((task) => task.status !== "ready" && task.status !== "failed").length;
  const currentUser = auth.user?.display_name || auth.user?.username || workspaceProfile.currentUser;
  const userInitial = currentUser.trim().slice(0, 1) || "用";
  const roleLabel = auth.user?.is_admin ? "管理员" : "成员";
  const scopeLabel = formatUserScope(auth.user);

  async function handleLogout() {
    try {
      await auth.logout();
      router.replace(`/login?next=${encodeURIComponent(pathname || active || "/app")}`);
    } catch {
      // AuthProvider 保留有效会话并把失败原因写入 auth.message，允许用户重试。
    }
  }

  return (
    <div className="ux-shell">
      <aside className="ux-sidebar">
        <Link href="/" className="ux-brand" aria-label="返回官网"><Logo size={30} /></Link>
        <Link className="ux-sidebar-action" href="/app/templates">新建场景</Link>
        <nav className="ux-nav" aria-label="前台工作区导航">
          {workspaceNav.map((item) => {
            const isActive = active === item.href || (item.href !== "/app" && active.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={isActive ? "active" : ""}>
                <i aria-hidden>{navGlyphs[item.href] ?? "•"}</i>
                <b>{item.label}</b>
                <span>{item.description}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="ux-content">
        <header className="ux-header">
          <div className="ux-header-title">
            <small>{eyebrow ?? "公司大脑"}</small>
            <b>{title}</b>
          </div>
          <label className="ux-search">
            <span>⌘K</span>
            <input placeholder="搜索场景、资料、答案、任务..." />
          </label>
          <div className="ux-header-actions">
            <Link className="ux-header-link" href="/app/tasks">
              <span>待处理</span>
              <strong>{pendingCount}</strong>
            </Link>
            {auth.user?.is_admin ? <Link className="ux-header-link" href="/admin">运营后台</Link> : null}
            <NotificationBell />
            <ThemeToggle />
            <details className="ux-account-menu">
              <summary aria-label="账号与权限菜单">
                <i>{userInitial}</i>
                <span>
                  <b>{currentUser}</b>
                  <small>{roleLabel}</small>
                </span>
              </summary>
              <div className="ux-account-popover">
                <div className="ux-account-card">
                  <i>{userInitial}</i>
                  <div>
                    <b>{currentUser}</b>
                    <span>{auth.user?.username ?? "当前账号"} · {roleLabel}</span>
                  </div>
                </div>
                <dl className="ux-account-meta">
                  <div>
                    <dt>权限范围</dt>
                    <dd>{scopeLabel}</dd>
                  </div>
                  <div>
                    <dt>数据边界</dt>
                    <dd>个人、团队、公司级知识按账号过滤</dd>
                  </div>
                </dl>
                <div className="ux-account-actions">
                  <Link href="/app/settings">账号与权限</Link>
                  {auth.user?.is_admin ? <Link href="/admin">进入知识运营后台</Link> : null}
                  <button type="button" onClick={handleLogout}>退出登录</button>
                </div>
                {auth.message ? <p className="auth-error" role="alert">{auth.message}</p> : null}
              </div>
            </details>
          </div>
        </header>
        <main className="ux-main">{children}</main>
      </div>
    </div>
  );
}

function formatUserScope(user: { organization_id?: string; team_ids?: string[] } | null) {
  if (!user) return "未登录";
  const organizationName = formatOrganizationName(user.organization_id);
  const teamNames = (user.team_ids ?? []).map(formatTeamName).filter(Boolean);
  if (teamNames.length > 0) return `${organizationName} / ${teamNames.join("、")}`;
  return `${organizationName} / 个人空间`;
}

function formatOrganizationName(id?: string) {
  if (!id) return "当前组织";
  const map: Record<string, string> = {
    "org-main": "赋范企业组织",
    "org_companybrain": "赋范企业组织"
  };
  return map[id] ?? id;
}

function formatTeamName(id: string) {
  const map: Record<string, string> = {
    sales: "销售团队",
    product: "产品团队",
    legal: "法务团队",
    ops: "运营团队",
    "default-team": "默认团队",
    "platform-admin": "平台管理员"
  };
  return map[id] ?? id;
}

function ScenarioWorkbenchHeader({ workbench, activeTab }: { workbench: ScenarioWorkbench; activeTab: ScenarioTab }) {
  const availability = scenarioAvailability(workbench.scenario);
  const isReady = workbench.scenario.status === "ready";
  return (
    <section className={`ux-workbench-head ${isReady ? "ready" : ""}`}>
      <div className="ux-workbench-title">
        <span>{workbench.template.category} · {availability.label}</span>
        <h1>{workbench.scenario.name}</h1>
        <p>{isReady ? availability.description : workbench.scenario.description}</p>
      </div>
      <div className="ux-workbench-meta">
        <Meta label="负责人" value={workbench.scenario.owner} />
        <Meta label="资料源" value={`${workbench.dataSources.length} 个`} />
        <Meta label="发布范围" value={workbench.settings.publicationMode} />
      </div>
      {!isReady && (
        <div className="ux-lifecycle">
          {workbench.lifecycle.map((stage, index) => (
            <div key={stage.key} className={index < 4 ? "done" : ""}>
              <i>{index + 1}</i>
              <b>{stage.label}</b>
              <span>{stage.description}</span>
            </div>
          ))}
        </div>
      )}
      <nav className="ux-tabs" aria-label="场景工作台">
        {workbench.tabs.map((item) => (
          <Link key={item.key} href={item.href} className={item.key === activeTab ? "active" : ""}>{item.label}</Link>
        ))}
      </nav>
    </section>
  );
}

function ReadyScenarioUsePage({ workbench }: { workbench: ScenarioWorkbench }) {
  const availability = scenarioAvailability(workbench.scenario);
  const primaryQuestion = workbench.scenario.recommendedQuestions[0] ?? workbench.template.demoWalkthrough.sampleQuestion;
  const primaryOutputs = workbench.outputs.slice(0, 3);
  const primarySources = workbench.dataSources.slice(0, 4);
  return (
    <div className="scenario-workspace">
      <section className="scenario-use-console">
        <div className="scenario-use-head">
          <div>
            <span>{availability.label}</span>
            <h2>这个场景已经可以直接用于业务处理</h2>
            <p>{workbench.scenario.description}</p>
          </div>
          <div className="scenario-use-status">
            <b>资料已发布</b>
            <span>{workbench.dataSources.length} 个资料源 · {workbench.outputs.length} 个产物</span>
          </div>
        </div>

        <form className="scenario-question-bar" action={`/app/scenarios/${workbench.scenario.id}/ask`}>
          <label htmlFor="ready-scenario-question">向这个场景提问或生成业务产物</label>
          <div>
            <input id="ready-scenario-question" name="q" defaultValue={primaryQuestion} aria-label="场景问题" />
            <button type="submit">发送</button>
          </div>
        </form>

        <div className="scenario-business-actions" aria-label="可执行业务任务">
          {primaryOutputs.map((output) => (
            <Link key={output.id} href={`/app/scenarios/${workbench.scenario.id}/outputs`}>
              <small>{output.status}</small>
              <b>{output.type}</b>
              <span>{output.summary}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="scenario-data-console">
        <div className="scenario-section-title">
          <div>
            <span>场景资料</span>
            <h3>当前场景使用了这些资料</h3>
          </div>
          <Link href={`/app/scenarios/${workbench.scenario.id}/data`}>查看全部资料</Link>
        </div>
        <div className="scenario-source-table">
          {primarySources.map((source) => (
            <article key={source.id}>
              <div>
                <b>{source.title}</b>
                <span>{displaySourceName(source.fileName)}</span>
              </div>
              <em>{displaySourceType(source.sourceType)}</em>
              <strong>{source.status}</strong>
            </article>
          ))}
        </div>
        <div className="scenario-data-actions">
          <button type="button" onClick={async () => { const r = await fetch(`/api/platform/scenarios/${workbench.scenario.id}/data-request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update" }) }); const d = await r.json().catch(() => ({})); window.alert(d.message ?? "已提交资料更新申请。"); }}>申请更新资料</button>
          <button type="button" onClick={() => { window.location.href = "/app/create"; }}>再次上传资料</button>
          <button type="button" onClick={async () => { const r = await fetch(`/api/platform/scenarios/${workbench.scenario.id}/data-request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete" }) }); const d = await r.json().catch(() => ({})); window.alert(d.message ?? "已提交资料删除申请。"); }}>申请删除资料</button>
        </div>
      </section>

      <section className="scenario-evidence-console">
        <div className="scenario-section-title">
          <div>
            <span>依据与产物</span>
            <h3>最近结果来自哪些资料</h3>
          </div>
          <Link href={`/app/scenarios/${workbench.scenario.id}/outputs`}>查看成品</Link>
        </div>
        <div className="scenario-evidence-grid">
          {workbench.template.demoWalkthrough.citations.map((citation) => (
            <article key={`${citation.source}-${citation.label}`}>
              <b>{citation.label}</b>
              <span>{displaySourceName(citation.source)}</span>
              <p>{citation.excerpt}</p>
            </article>
          ))}
        </div>
      </section>

      <aside className="scenario-side-rail">
        <section>
          <span>建议追问</span>
          <div className="scenario-suggestion-list">
            {workbench.scenario.recommendedQuestions.slice(0, 4).map((question) => (
              <Link key={question} href={`/app/scenarios/${workbench.scenario.id}/ask?q=${encodeURIComponent(question)}`}>{question}</Link>
            ))}
          </div>
        </section>

        <section>
          <span>场景治理</span>
          <div className="scenario-governance-list">
            <div><b>使用范围</b><em>{workbench.settings.publicationMode}</em></div>
            <div><b>回答规则</b><em>{workbench.settings.answerPolicy}</em></div>
            <div><b>资料规则</b><em>{workbench.settings.reviewPolicy}</em></div>
          </div>
        </section>

        <section>
          <span>最近产物</span>
          <div className="scenario-output-list">
            {primaryOutputs.map((output) => (
              <Link key={output.id} href={`/app/scenarios/${workbench.scenario.id}/outputs`}>
                <b>{output.title.replace(`${workbench.scenario.name} · `, "")}</b>
                <em>{output.updatedAt}</em>
              </Link>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function ScenarioOverview({ workbench }: { workbench: ScenarioWorkbench }) {
  return (
    <div className="ux-workbench-grid">
      <section className="ux-panel">
        <PanelTitle title="推荐问题" actionHref={`/app/scenarios/${workbench.scenario.id}/ask`} actionLabel="继续追问" />
        <div className="ux-action-list">
          {workbench.scenario.recommendedQuestions.map((question) => (
            <Link key={question} href={`/app/scenarios/${workbench.scenario.id}/ask?q=${encodeURIComponent(question)}`} className="ux-action-row">
              <b>{question}</b>
              <span>在当前场景资料和规则下生成可追溯答案。</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="ux-panel">
        <PanelTitle title="场景能力" actionHref={`/app/scenarios/${workbench.scenario.id}/outputs`} actionLabel="查看产物" />
        <Pills items={workbench.scenario.readyActions} />
        <div className="ux-meta-stack">
          <Meta label="检索策略" value={workbench.settings.retrievalPolicy} />
          <Meta label="回答策略" value={workbench.settings.answerPolicy} />
        </div>
      </section>
    </div>
  );
}

function ScenarioDataTab({ dataSources }: { dataSources: ScenarioDataSource[] }) {
  return (
    <section className="ux-panel">
      <PanelTitle title="资料管理" actionHref="/app/create" actionLabel="再次上传资料" />
      <div className="ux-data-request-bar">
        <button type="button" onClick={async () => { const id = window.location.pathname.split("/")[3]; const r = await fetch(`/api/platform/scenarios/${id}/data-request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update" }) }); const d = await r.json().catch(() => ({})); window.alert(d.message ?? "已提交资料更新申请。"); }}>申请更新资料</button>
        <button type="button" onClick={async () => { const id = window.location.pathname.split("/")[3]; const r = await fetch(`/api/platform/scenarios/${id}/data-request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete" }) }); const d = await r.json().catch(() => ({})); window.alert(d.message ?? "已提交资料删除申请。"); }}>申请删除资料</button>
        <button type="button" onClick={() => { window.location.href = "/admin/pipelines"; }}>查看后台入库记录</button>
      </div>
      <div className="ux-table">
        {dataSources.map((source) => (
          <article key={source.id}>
            <div>
              <b>{source.title}</b>
              <span>{displaySourceName(source.fileName)}</span>
            </div>
            <em>{displaySourceType(source.sourceType)}</em>
            <strong>{source.status}</strong>
            <small>{source.evidencePolicy}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function ScenarioTasksTab({ workbench }: { workbench: ScenarioWorkbench }) {
  if (workbench.scenario.status === "ready") {
    return (
      <div className="ux-task-grid">
        {workbench.outputs.map((output) => (
          <article key={output.id} className="ux-task-card ready-task">
            <span>{output.status}</span>
            <h2>{output.type}</h2>
            <p>{output.summary}</p>
            <div className="ux-actions">
              <Link href={`/app/scenarios/${workbench.scenario.id}/outputs`}>打开成品</Link>
              <Link href={`/app/scenarios/${workbench.scenario.id}/ask?q=${encodeURIComponent(output.type)}`}>继续生成</Link>
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className="ux-task-grid">
      {workbench.tasks.map((task) => <TaskCard key={task.id} task={task} />)}
    </div>
  );
}

function ScenarioAskTab({ workbench, initialQuery }: { workbench: ScenarioWorkbench; initialQuery?: string }) {
  const initial = initialQuery ?? workbench.template.demoWalkthrough.sampleQuestion;
  const [query, setQuery] = useState(initial);
  const isReady = workbench.scenario.status === "ready";

  return (
    <>
    <div className="ux-chat-layout ux-chat-workbench">
      <section className="ux-chat-main">
        <div className="ux-chat-thread">
          <div className="ux-message user">{query}</div>
          <div className="ux-message assistant">
            <span>{workbench.scenario.name}</span>
            <p>{workbench.template.demoWalkthrough.sampleAnswer}</p>
            <div className="ux-citation-grid">
              {workbench.template.demoWalkthrough.citations.map((citation) => (
                <article key={`${citation.source}-${citation.label}`}>
                  <b>{citation.label}</b>
                  <small>{displaySourceName(citation.source)}</small>
                  <p>{citation.excerpt}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
        <section className="ux-chat-action-board">
          <div>
            <h2>{isReady ? "继续处理业务" : "场景内下一步"}</h2>
            <p>{isReady ? "在当前场景里继续追问、生成成品和沉淀任务。" : "在当前场景里继续完成验证、复核、发布和产物生成。"}</p>
          </div>
          <div className="ux-chat-action-grid">
            {workbench.outputs.slice(0, 3).map((output) => (
              <article key={output.id}>
                <b>{output.type}</b>
                <span>{output.summary}</span>
              </article>
            ))}
          </div>
        </section>
        <form
          className="ux-composer"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setQuery(String(form.get("q") ?? ""));
            event.currentTarget.reset();
          }}
        >
          <input name="q" placeholder={isReady ? "向当前场景提问，或让它生成业务成品..." : "用当前场景继续验证答案、引用和边界..."} />
          <button type="submit">{isReady ? "发送" : "验证"}</button>
        </form>
      </section>
      <aside className="ux-context-panel">
        <span>{isReady ? "使用策略" : "验证策略"}</span>
        <h2>当前策略</h2>
        <p>{workbench.settings.retrievalPolicy}</p>
        <p>{workbench.settings.answerPolicy}</p>
        <div className="ux-context-section">
          <h3>场景资料</h3>
          {workbench.dataSources.map((source) => (
            <div key={source.id} className="ux-context-row">
              <b>{displaySourceName(source.fileName)}</b>
              <span>{source.status}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
    <section className="ux-chat-follow-grid" aria-label={isReady ? "场景使用后的可接续工作" : "场景验证后的可接续工作"}>
      <article className="ux-follow-card">
        <span>处理任务</span>
        <h2>{workbench.tasks[0]?.title ?? `处理${workbench.scenario.name}`}</h2>
        <p>{workbench.tasks[0]?.userMessage ?? "当前场景可以继续验证和复核。"}</p>
        <Link href={`/app/scenarios/${workbench.scenario.id}/tasks`}>查看处理任务</Link>
      </article>
      <article className="ux-follow-card">
        <span>资料来源</span>
        <h2>{workbench.dataSources.length} 份资料已关联</h2>
        <p>{workbench.settings.retrievalPolicy}</p>
        <Link href={`/app/scenarios/${workbench.scenario.id}/data`}>管理资料来源</Link>
      </article>
      <article className="ux-follow-card">
        <span>可生成成品</span>
        <h2>{workbench.outputs[0]?.title ?? workbench.scenario.name}</h2>
        <p>{workbench.outputs[0]?.summary ?? "可继续生成、复核和发布场景产物。"}</p>
        <div className="ux-follow-pills">
          {workbench.outputs.slice(0, 3).map((output) => <small key={output.id}>{output.type}</small>)}
        </div>
      </article>
    </section>
    <section className="ux-chat-ops-board" aria-label={isReady ? "场景使用的处理链路" : "场景验证的处理链路"}>
      <article>
        <span>场景链路</span>
        <h2>从资料到答案的处理过程</h2>
        <div className="ux-ops-list">
          {workbench.template.processingExplanation.map((step) => <p key={step}>{step}</p>)}
        </div>
      </article>
      <article>
        <span>{isReady ? "使用规则" : "发布检查"}</span>
        <h2>{isReady ? "当前场景如何保证可靠" : "上线前需要确认什么"}</h2>
        <div className="ux-ops-list">
          <p>{workbench.settings.reviewPolicy}</p>
          <p>{workbench.settings.answerPolicy}</p>
          <p>{workbench.outputs.map((output) => output.type).join("、")}</p>
        </div>
      </article>
    </section>
    </>
  );
}

function ScenarioOutputsTab({ outputs }: { outputs: ScenarioOutput[] }) {
  return (
    <div className="ux-output-grid">
      {outputs.map((output) => (
        <article key={output.id} className="ux-card">
          <span>{output.type}</span>
          <h2>{output.title}</h2>
          <p>{output.summary}</p>
          <small>{output.status} · {output.updatedAt}</small>
        </article>
      ))}
    </div>
  );
}

function ScenarioSettingsTab({ settings }: { settings: ScenarioSettings }) {
  return (
    <div className="ux-settings-grid">
      <SettingsBlock title="发布范围" items={[settings.publicationMode, settings.reviewPolicy]} />
      <SettingsBlock title="检索与回答" items={[settings.retrievalPolicy, settings.answerPolicy]} />
      <SettingsBlock title="已连接来源" items={settings.connectedSources} />
    </div>
  );
}

function TemplateViewToggle({ view, onChange }: { view: TemplateLibraryView; onChange: (view: TemplateLibraryView) => void }) {
  return (
    <div className="template-view-switch" aria-label="切换模板展示方式">
      {templateViewOptions.map((option) => (
        <button
          key={option.id}
          type="button"
          className={option.id === view ? "active" : ""}
          aria-label={`${option.label}视图`}
          aria-pressed={option.id === view}
          title={`${option.label}视图`}
          onClick={() => onChange(option.id)}
        >
          <span className={`template-view-icon ${option.id}`} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>
      ))}
    </div>
  );
}

function TemplateMarketCanvas({
  view,
  templates,
  selectedTemplate,
  onSelect
}: {
  view: TemplateLibraryView;
  templates: ScenarioTemplate[];
  selectedTemplate: ScenarioTemplate;
  onSelect: (id: string) => void;
}) {
  if (templates.length === 0) {
    return (
      <div className="template-empty-state">
        <b>没有匹配的模板</b>
        <p>换一个关键词，或直接自建场景提交资料。</p>
        <Link href="/app/create?mode=blank">自建场景</Link>
      </div>
    );
  }

  if (view === "grid") return <TemplateGridView templates={templates} selectedTemplate={selectedTemplate} onSelect={onSelect} />;
  if (view === "list") return <TemplateListView templates={templates} selectedTemplate={selectedTemplate} onSelect={onSelect} />;
  if (view === "compare") return <TemplateCompareView templates={templates} selectedTemplate={selectedTemplate} onSelect={onSelect} />;
  return <TemplateFeaturedView templates={templates} selectedTemplate={selectedTemplate} onSelect={onSelect} />;
}

function TemplateFeaturedView({
  templates,
  selectedTemplate,
  onSelect
}: {
  templates: ScenarioTemplate[];
  selectedTemplate: ScenarioTemplate;
  onSelect: (id: string) => void;
}) {
  const preferredIds = ["customer-360", "support-agent", "contract-playbook", "risk-investigation"];
  const featured = [
    selectedTemplate,
    ...preferredIds
      .map((id) => templates.find((template) => template.id === id))
      .filter((template): template is ScenarioTemplate => Boolean(template)),
    ...templates
  ].filter((template, index, list) => list.findIndex((item) => item.id === template.id) === index).slice(0, 4);
  const lead = featured[0] ?? selectedTemplate;
  const side = featured.slice(1);

  return (
    <div className="template-featured-view">
      <button type="button" className="template-featured-lead" onClick={() => onSelect(lead.id)}>
        <span>{lead.category} · {templateSurfaceLabel(lead)}</span>
        <h2>{lead.name}</h2>
        <p>{lead.headline}</p>
        <div>
          {lead.bestFor.slice(0, 3).map((item) => <em key={item}>{item}</em>)}
        </div>
        <footer>
          <b>{lead.setupTime}</b>
          <small>{lead.reviewRequirement}</small>
        </footer>
      </button>
      <div className="template-featured-stack">
        {side.map((template) => (
          <button
            key={template.id}
            type="button"
            className={`template-featured-mini ${template.id === selectedTemplate.id ? "active" : ""}`}
            onClick={() => onSelect(template.id)}
          >
            <span>{template.category}</span>
            <b>{template.name}</b>
            <p>{template.outputCapabilities.slice(0, 3).join(" / ")}</p>
          </button>
        ))}
      </div>
      <div className="template-featured-strip">
        {templates.slice(0, 6).map((template) => (
          <button
            key={template.id}
            type="button"
            className={template.id === selectedTemplate.id ? "active" : ""}
            onClick={() => onSelect(template.id)}
          >
            <b>{template.name}</b>
            <span>{templateSurfaceLabel(template)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TemplateGridView({
  templates,
  selectedTemplate,
  onSelect
}: {
  templates: ScenarioTemplate[];
  selectedTemplate: ScenarioTemplate;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="template-card-gallery">
      {templates.map((template) => (
        <TemplateCard key={template.id} template={template} active={template.id === selectedTemplate.id} onSelect={onSelect} />
      ))}
    </div>
  );
}

function TemplateListView({
  templates,
  selectedTemplate,
  onSelect
}: {
  templates: ScenarioTemplate[];
  selectedTemplate: ScenarioTemplate;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="template-compact-list">
      {templates.map((template) => (
        <button
          key={template.id}
          type="button"
          className={`template-compact-row ${template.id === selectedTemplate.id ? "active" : ""}`}
          onClick={() => onSelect(template.id)}
        >
          <span>{template.category}</span>
          <div>
            <b>{template.name}</b>
            <p>{template.headline}</p>
          </div>
          <small>{templateSurfaceLabel(template)}</small>
          <small>{template.acceptedFiles.slice(0, 2).join(" / ")}</small>
          <small>{template.setupTime}</small>
        </button>
      ))}
    </div>
  );
}

function TemplateCompareView({
  templates,
  selectedTemplate,
  onSelect
}: {
  templates: ScenarioTemplate[];
  selectedTemplate: ScenarioTemplate;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="template-compare-wrap">
      <table className="template-compare-table">
        <thead>
          <tr>
            <th>方案</th>
            <th>适用业务</th>
            <th>准备资料</th>
            <th>产出</th>
            <th>复核</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <tr key={template.id} className={template.id === selectedTemplate.id ? "active" : ""} onClick={() => onSelect(template.id)}>
              <td>
                <button type="button" onClick={() => onSelect(template.id)}>
                  <b>{template.name}</b>
                  <span>{template.category} · {templateSurfaceLabel(template)}</span>
                </button>
              </td>
              <td>{template.bestFor.slice(0, 3).join("、")}</td>
              <td>{template.acceptedFiles.slice(0, 3).join("、")}</td>
              <td>{template.outputCapabilities.slice(0, 3).join("、")}</td>
              <td>{template.reviewRequirement}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TemplateCard({ template, active = false, onSelect }: { template: ScenarioTemplate; active?: boolean; onSelect?: (id: string) => void }) {
  const surface = buildScenarioProductSurface(template.id, { productForm: template.productForm });
  return (
    <article className={`template-card ${active ? "active" : ""}`}>
      <div className="template-card-main">
        <span>{template.category} · {surface.label}</span>
        <h2>{template.name}</h2>
        <p>{template.headline}</p>
        <Pills items={template.inputExamples.slice(0, 3)} />
      </div>
      <dl>
        <div><dt>可产出</dt><dd>{template.outputCapabilities.slice(0, 2).join("、")}</dd></div>
        <div><dt>耗时</dt><dd>{template.setupTime}</dd></div>
      </dl>
      <footer>
        {onSelect ? <button type="button" onClick={() => onSelect(template.id)}>选中</button> : null}
        <Link href={`/app/templates/${template.id}`}>查看模板</Link>
        <Link className="primary" href={`/app/create?template=${template.id}`}>创建</Link>
      </footer>
    </article>
  );
}

function templateSurfaceLabel(template: ScenarioTemplate) {
  return buildScenarioProductSurface(template.id, { productForm: template.productForm }).label;
}

function TemplateCatalogPreview({ template }: { template: ScenarioTemplate }) {
  return (
    <aside className="template-preview-panel" aria-label="模板说明">
      <div className="template-preview-head">
        <span>{template.category}方案</span>
        <h2>{template.name}</h2>
        <p>{template.headline}</p>
      </div>
      <div className="template-preview-meta">
        <div><span>创建耗时</span><b>{template.setupTime}</b></div>
        <div><span>复核要求</span><b>{template.reviewRequirement}</b></div>
      </div>
      <section>
        <span>适合的业务问题</span>
        <div className="template-preview-pills">
          {template.bestFor.slice(0, 4).map((item) => <em key={item}>{item}</em>)}
        </div>
      </section>
      <section>
        <span>建议准备资料</span>
        <div className="template-preview-pills">
          {template.inputExamples.slice(0, 4).map((item) => <em key={item}>{item}</em>)}
        </div>
      </section>
      <section>
        <span>创建后能得到</span>
        <ul className="template-output-list">
          {template.outputCapabilities.slice(0, 4).map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
      <section className="template-preview-demo">
        <span>案例场景</span>
        <b>{template.demoWalkthrough.scenarioName}</b>
        <p>{template.demoWalkthrough.sampleQuestion}</p>
      </section>
      <footer>
        <Link href={`/app/templates/${template.id}`}>查看完整说明</Link>
        <Link className="primary" href={`/app/create?template=${template.id}`}>用这个方案创建</Link>
      </footer>
    </aside>
  );
}

function TemplateNotFound() {
  return (
    <FrontstageShell active="/app/templates" title="模板不存在">
      <section className="ux-page-head">
        <h1>没有找到这个模板</h1>
        <p>可以返回模板库选择其他官方场景。</p>
        <Link className="ux-primary-link" href="/app/templates">返回模板库</Link>
      </section>
    </FrontstageShell>
  );
}

function ScenarioAssetRow({
  scenario,
  active,
  onFocus
}: {
  scenario: ScenarioInstance;
  active: boolean;
  onFocus: () => void;
}) {
  const template = templateById(scenario.templateId) ?? customScenarioTemplate;
  const surface = buildScenarioProductSurface(template.id, { productForm: template.productForm });
  const availability = scenarioAvailability(scenario);
  return (
    <article className={`scenario-asset-row ${active ? "active" : ""}`} onMouseEnter={onFocus} onFocus={onFocus}>
      <Link href={`/app/scenarios/${scenario.id}`} className="scenario-row-main">
        <span className={`scenario-row-icon surface-${surface.kind}`} aria-hidden="true" />
        <div>
          <b>{scenario.name}</b>
          <p>{truncateText(scenario.description, 92)}</p>
          <small>{scenario.owner} · {scenario.sourceCount} 个来源 · {scenario.updatedAt}</small>
        </div>
      </Link>
      <span className="scenario-row-surface">{surface.label}</span>
      <span className={`home-scope-badge scope-${scenario.visibility}`}>{visibilityText(scenario.visibility)}</span>
      <span className={`scenario-row-status status-${scenario.status}`}>{availability.label}</span>
      <div className="scenario-row-actions">
        <Link href={`/app/scenarios/${scenario.id}`}>{scenario.status === "ready" ? surface.primaryAction.label : availability.nextAction}</Link>
        <Link href={`/app/scenarios/${scenario.id}/data`}>资料</Link>
      </div>
    </article>
  );
}

function ScenarioAssetInspector({ scenario }: { scenario: ScenarioInstance }) {
  const template = templateById(scenario.templateId) ?? customScenarioTemplate;
  const surface = buildScenarioProductSurface(template.id, { productForm: template.productForm });
  const availability = scenarioAvailability(scenario);
  const prompts = scenario.status === "ready" ? surface.quickPrompts : scenario.recommendedQuestions;
  return (
    <section>
      <span>{template.name} · {availability.label}</span>
      <h2>{scenario.name}</h2>
      <p>{scenario.description}</p>
      <div className="scenario-inspector-meta">
        <div><small>工作台形态</small><b>{surface.label}</b></div>
        <div><small>发布范围</small><b>{visibilityText(scenario.visibility)}</b></div>
        <div><small>资料来源</small><b>{scenario.sourceCount} 个</b></div>
      </div>
      <div className="scenario-inspector-actions">
        <Link className="primary" href={`/app/scenarios/${scenario.id}`}>{scenario.status === "ready" ? surface.primaryAction.label : availability.nextAction}</Link>
        <Link href={`/app/scenarios/${scenario.id}/data`}>管理资料</Link>
      </div>
      <div className="scenario-inspector-prompts">
        <b>{scenario.status === "ready" ? "常用操作" : "处理完成后可用"}</b>
        {prompts.slice(0, 4).map((prompt) => (
          <Link key={prompt} href={`/app/scenarios/${scenario.id}/ask?q=${encodeURIComponent(prompt)}`}>{prompt}</Link>
        ))}
      </div>
    </section>
  );
}

function ScenarioCard({ scenario }: { scenario: ScenarioInstance }) {
  const template = templateById(scenario.templateId) ?? officialTemplates[0];
  const availability = scenarioAvailability(scenario);
  return (
    <article className="ux-card scenario">
      <span>{template.name} · {availability.label}</span>
      <h2>{scenario.name}</h2>
      <p>{availability.description}</p>
      <div className="ux-card-meta">
        <small>{scenario.owner}</small>
        <small>{scenario.sourceCount} 个来源</small>
        <small>{scenario.updatedAt}</small>
      </div>
      <footer>
        <Link href={`/app/scenarios/${scenario.id}`}>{scenario.status === "ready" ? "使用场景" : availability.nextAction}</Link>
        <Link href={`/app/scenarios/${scenario.id}/data`}>查看资料</Link>
      </footer>
    </article>
  );
}

function ScenarioCompactCard({ scenario }: { scenario: ScenarioInstance }) {
  const availability = scenarioAvailability(scenario);
  return (
    <Link className="ux-compact-row home-scenario-row" href={`/app/scenarios/${scenario.id}`} aria-label={`打开场景：${scenario.name}`}>
      <div className="home-row-copy">
        <div className="home-row-head">
          <b>{scenario.name}</b>
          <span className={`home-scope-badge scope-${scenario.visibility}`}>{visibilityText(scenario.visibility)}</span>
        </div>
        <p>{scenario.description}</p>
      </div>
      <em className="home-row-status">{availability.label}</em>
    </Link>
  );
}

function TaskCard({ task }: { task: ProcessingTask }) {
  return (
    <article className="ux-task-card">
      <header className="task-card-head">
        <span>{taskStatusGroup(task)}</span>
        <small>{task.kind} · {task.ragMode}</small>
      </header>
      <h2>{task.title}</h2>
      <p>{task.userMessage}</p>
      <div className="task-meta-grid">
        <div><span>等待对象</span><b>{task.waitingFor}</b></div>
        <div><span>发布范围</span><b>{visibilityText(task.visibility)}</b></div>
        <div><span>提交人</span><b>{task.owner}</b></div>
        <div><span>更新时间</span><b>{task.updatedAt}</b></div>
      </div>
      <div className="task-file-row">
        {task.files.slice(0, 3).map((fileName) => <span key={fileName}>{displaySourceName(fileName)}</span>)}
        {task.files.length > 3 && <span>+{task.files.length - 3}</span>}
      </div>
      <div className="ux-progress"><i style={{ width: `${task.progress}%` }} /></div>
      <footer className="task-card-actions">
        <Link href={`/app/scenarios/${task.scenarioId}/tasks`}>查看任务</Link>
        <Link href={`/app/scenarios/${task.scenarioId}/data`}>{task.status === "ready" ? "管理资料" : "补充资料"}</Link>
      </footer>
    </article>
  );
}

function TaskMini({ task }: { task: ProcessingTask }) {
  return (
    <Link className="ux-task-mini-row home-task-row" href={`/app/scenarios/${task.scenarioId}/tasks`} aria-label={`查看任务：${task.title}`}>
      <div className="home-row-copy">
        <div className="home-row-head">
          <b>{task.title}</b>
          <span className={`home-scope-badge scope-${task.visibility}`}>{visibilityText(task.visibility)}</span>
        </div>
        <p>{task.currentStep} · {task.progress}%</p>
        <span className="home-task-progress" aria-hidden="true"><i style={{ width: `${task.progress}%` }} /></span>
      </div>
    </Link>
  );
}

function KnowledgeAssetRow({ object, active, onSelect }: { object: KnowledgeSpaceObject; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`knowledge-asset-row ${active ? "active" : ""}`} onClick={onSelect} role="listitem">
      <span className={`knowledge-type-dot type-${object.mode}`} />
      <div className="knowledge-row-title">
        <b>{object.title}</b>
        <span>{truncateText(object.summary, 74)}</span>
      </div>
      <div className="knowledge-row-meta">
        <strong>{knowledgeModeLabel(object.mode)}</strong>
        <span>{object.sourceLabel}</span>
      </div>
      <div className="knowledge-row-scope">
        <strong>{knowledgeVisibilityLabel(object.visibility)}</strong>
        <span>{object.owner}</span>
      </div>
      <small>{object.updatedAt}</small>
    </button>
  );
}

function KnowledgeAssetInspector({ object }: { object: KnowledgeSpaceObject | null }) {
  if (!object) {
    return (
      <aside className="knowledge-asset-inspector">
        <PanelHeading eyebrow="资产详情" title="等待选择知识资产" />
        <p>前台提交资料并由后台完成入库后，这里会显示来源、权限边界和可发起的治理动作。</p>
        <Link href="/app/templates">从模板创建</Link>
      </aside>
    );
  }

  return (
    <aside className="knowledge-asset-inspector">
      <PanelHeading eyebrow={knowledgeModeLabel(object.mode)} title={object.title} />
      <p>{object.summary}</p>
      <dl className="knowledge-inspector-meta">
        <div><dt>来源</dt><dd>{object.sourceLabel}</dd></div>
        <div><dt>负责人</dt><dd>{object.owner}</dd></div>
        <div><dt>权限</dt><dd>{knowledgeVisibilityLabel(object.visibility)}</dd></div>
        <div><dt>更新</dt><dd>{object.updatedAt}</dd></div>
      </dl>
      <div className="knowledge-inspector-note">
        <b>权限影响</b>
        <span>{knowledgeAssetRiskNote(object)}</span>
      </div>
      <div className="knowledge-inspector-actions">
        {knowledgeGovernanceActions(object).map((action) => (
          action === "查看场景"
            ? <Link key={action} href={`/app/scenarios/${object.linkedScenarioId}`}>{action}</Link>
            : <button key={action} type="button">{action}</button>
        ))}
      </div>
    </aside>
  );
}

function PanelHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="panel-heading">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
    </header>
  );
}

function SettingsBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="ux-panel">
      <h2>{title}</h2>
      <div className="ux-action-list">
        {items.map((item, idx) => <div key={`${item}-${idx}`} className="ux-action-row static"><b>{item}</b></div>)}
      </div>
    </section>
  );
}

function InfoSection({ title, items, ordered = false }: { title: string; items: string[]; ordered?: boolean }) {
  return (
    <section className="ux-info-section">
      <h2>{title}</h2>
      {ordered ? <ol>{items.map((item, idx) => <li key={`${item}-${idx}`}>{item}</li>)}</ol> : <Pills items={items} />}
    </section>
  );
}

function PanelTitle({ title, actionHref, actionLabel }: { title: string; actionHref: string; actionLabel: string }) {
  return (
    <div className="ux-panel-title">
      <h2>{title}</h2>
      <Link href={actionHref}>{actionLabel}</Link>
    </div>
  );
}

function KpiCard({ label, value, helper, href }: { label: string; value: string; helper: string; href?: string }) {
  const content = (
    <>
      <span>{label}</span>
      <b>{value}</b>
      <small>{helper}</small>
    </>
  );
  if (href) {
    return (
      <Link className="ux-kpi home-metric-card" href={href} aria-label={`${label}：${value}，${helper}`}>
        {content}
      </Link>
    );
  }
  return <article className="ux-kpi">{content}</article>;
}

function Pills({ items }: { items: string[] }) {
  return <div className="ux-pills">{items.map((item) => <span key={item}>{item}</span>)}</div>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="ux-meta"><span>{label}</span><b>{value}</b></div>;
}

function statusLabel(status: ScenarioInstance["status"] | ProcessingTask["status"]) {
  if (status === "ready") return "可使用";
  if (status === "processing") return "处理中";
  if (status === "waiting_review") return "待复核";
  if (status === "submitted") return "已提交";
  if (status === "failed") return "失败";
  return "草稿";
}

function countScenariosByStatus(scenarios: ScenarioInstance[], label: string) {
  if (label === "全部") return scenarios.length;
  if (label === "处理中") return scenarios.filter((scenario) => scenario.status !== "ready" && scenario.status !== "failed").length;
  return scenarios.filter((scenario) => statusLabel(scenario.status) === label).length;
}

function truncateText(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function scenarioTabLabel(tab: ScenarioTab) {
  const labels: Record<ScenarioTab, string> = {
    overview: "概览",
    data: "资料",
    tasks: "任务",
    ask: "问答",
    outputs: "产物",
    settings: "设置"
  };
  return labels[tab];
}

function taskStatusGroup(task: ProcessingTask) {
  if (task.waitingFor === "后台管理员" || task.status === "submitted") return "待管理员确认";
  if (task.status === "ready") return "可使用";
  if (task.status === "failed") return "失败";
  return "处理中";
}

function visibilityText(value: Visibility) {
  if (value === "private") return "仅自己可用";
  if (value === "team") return "团队内可用";
  return "公司级场景";
}

function compareTaskTime(a: string, b: string) {
  return taskTimeRank(b) - taskTimeRank(a);
}

function taskTimeRank(value: string) {
  // 对齐 displayRelativeTime 的真实输出：刚刚 / N 分钟前 / N 小时前 / N 天前。
  // rank 越大表示越新（越靠前）：以"距今分钟数"取负偏移，分钟前>小时前>天前。
  if (value.includes("刚刚")) return Number.MAX_SAFE_INTEGER;
  const minute = value.match(/(\d+)\s*分钟前/);
  if (minute) return 1_000_000_000 - Number(minute[1]);
  const hour = value.match(/(\d+)\s*小时前/);
  if (hour) return 1_000_000_000 - Number(hour[1]) * 60;
  const day = value.match(/(\d+)\s*天前/);
  if (day) return 1_000_000_000 - Number(day[1]) * 1440;
  // 兼容可能的历史绝对文案
  if (value.includes("今天")) return 900_000_000;
  if (value.includes("昨天")) return 800_000_000;
  return 0;
}

function displaySourceName(value: string) {
  return value
    .replace(/\.(json|csv|md|txt|pdf|docx|xlsx)$/i, "")
    .replace(/RFP/gi, "投标问卷")
    .replace(/FAQ/gi, "常见问题");
}

function knowledgeTypeLabel(engine: LiveScenarioAnswer["engine"]) {
  if (engine === "Naive RAG") return "文档证据";
  if (engine === "GraphRAG") return "关系图谱";
  return "知识百科";
}

function groupScenarioCitations(citations: ScenarioCitation[]) {
  const order: Array<ScenarioCitation["engine"]> = ["Naive RAG", "GraphRAG", "Gbrain"];
  return order
    .map((engine) => ({
      engine,
      label: knowledgeTypeLabel(engine),
      count: citations.filter((citation) => citation.engine === engine).length
    }))
    .filter((group) => group.count > 0);
}

function scenarioEngineClass(engine: LiveScenarioAnswer["engine"]) {
  if (engine === "Naive RAG") return "document";
  if (engine === "GraphRAG") return "graph";
  return "wiki";
}

function scenarioEvidenceBadge(engine: LiveScenarioAnswer["engine"]) {
  if (engine === "Naive RAG") return "原文片段";
  if (engine === "GraphRAG") return "关系线索";
  return "知识条目";
}

function scenarioEvidenceHint(engine: LiveScenarioAnswer["engine"]) {
  if (engine === "Naive RAG") return "来自文档切片与向量召回，用于核对制度、合同、表格和流程原文。";
  if (engine === "GraphRAG") return "来自实体、事件和关系路径，用于判断客户、需求、风险与证据之间的连接。";
  return "来自已沉淀的知识页与事实卡，用于复用稳定结论和业务口径。";
}

function scenarioEvidenceFacts(excerpt: string) {
  const normalized = excerpt.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const semicolonFacts = normalized
    .split(/[；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (semicolonFacts.length > 1) return semicolonFacts.map((item) => truncateText(item, 92));
  const sentenceFacts = normalized
    .split(/(?<=[。！？!?])\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (sentenceFacts.length > 1) return sentenceFacts.slice(0, 3).map((item) => truncateText(item, 92));
  return [truncateText(normalized, 150)];
}

function groupGlobalCitations(citations: GlobalChatCitation[]) {
  // 桶间按「桶内最高分」排序：citations 已是 rerank 相关度降序，故按类型首次出现顺序收集，
  // 天然等价于按各类型最高分降序排桶；桶内保持数组顺序（仍是分数序）。空桶不会产生。
  const groups = new Map<GlobalChatCitation["knowledgeType"], GlobalChatCitation[]>();
  for (const citation of citations) {
    const items = groups.get(citation.knowledgeType);
    if (items) items.push(citation);
    else groups.set(citation.knowledgeType, [citation]);
  }
  return [...groups].map(([type, items]) => ({ type, items }));
}

function knowledgeSourceHint(type: GlobalChatCitation["knowledgeType"]) {
  if (type === "文档证据") return "来自 PDF、Word、Markdown、表格等资料的可追溯片段，适合核对制度、合同和流程依据。";
  if (type === "关系图谱") return "来自实体、事件和关系路径，适合判断客户、人员、供应商和风险之间的关联。";
  return "来自已经沉淀的知识页、手册和事实卡，适合快速复用稳定结论。";
}

function sourceBadgeForCitation(citation: GlobalChatCitation) {
  if (citation.knowledgeType === "文档证据") return "原文片段";
  if (citation.knowledgeType === "关系图谱") return "关系线索";
  return "知识条目";
}

function recommendTemplatesForGlobalAnswer(query: string, citations: GlobalChatCitation[]) {
  if (citations.length === 0) return [];
  const text = `${query} ${citations.map((citation) => `${citation.scenarioName} ${citation.sourceOriginalName} ${citation.knowledgeType} ${citation.excerpt}`).join(" ")}`.toLowerCase();
  const types = new Set(citations.map((citation) => citation.knowledgeType));
  const scored = officialTemplates.map((template) => {
    const searchable = [
      template.name,
      template.category,
      template.headline,
      ...template.bestFor,
      ...template.inputExamples,
      ...template.outputCapabilities
    ].join(" ").toLowerCase();
    let score = 0;
    for (const token of searchTokens(text)) {
      if (searchable.includes(token)) score += Math.min(6, token.length);
    }
    if (types.has("关系图谱") && template.productForm.includes("graph_explorer")) score += 12;
    if (types.has("文档证据") && template.productForm.includes("document_review")) score += 10;
    if (types.has("文档证据") && template.productForm.includes("chat")) score += 4;
    if (types.has("知识百科") && template.productForm.includes("knowledge_portal")) score += 8;
    if (text.includes("客户") && template.id === "customer-360") score += 10;
    if ((text.includes("制度") || text.includes("政策") || text.includes("报销")) && template.id === "policy-evidence") score += 10;
    if ((text.includes("合同") || text.includes("条款")) && template.id === "contract-playbook") score += 10;
    if ((text.includes("风险") || text.includes("关系")) && template.id === "risk-investigation") score += 8;
    return { template, score };
  });
  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.template);
}

function searchTokens(value: string) {
  return Array.from(new Set(value
    .replace(/[？?，,。；;：:、（）()【】\[\]{}"'“”‘’·/\\_-]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 32)));
}

function scopeLabel(scope: GlobalChatScope) {
  if (scope === "private") return "个人资料";
  if (scope === "team") return "团队知识";
  return "全公司知识";
}

function scopeDescription(scope: GlobalChatScope) {
  if (scope === "private") return "只检索当前账号自己提交并已发布的资料，不进入团队或公司级召回。";
  if (scope === "team") return "检索当前账号所属团队可访问的知识，并叠加自己的个人资料。";
  return "检索公司级可见知识，并叠加当前账号有权限访问的团队和个人资料。";
}

function formatAttachmentMeta(file: File) {
  const size = file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(file.size / 1024))}KB`;
  return `${file.name} · ${size}`;
}

function makeTemplateSampleFile(sample: TemplateDemoWalkthrough["sampleInputs"][number]) {
  const typeMap: Record<string, string> = {
    md: "text/markdown",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    pdf: "application/pdf"
  };
  const content = [
    `# ${sample.title}`,
    sample.description,
    "这是一份用于跑通真实提交链路的案例资料，会随场景提交进入后台资料请求。"
  ].join("\n\n");
  return new File([content], sample.fileName, { type: typeMap[sample.fileType] ?? "text/plain" });
}

function displaySourceType(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("csv") || normalized.includes("xlsx")) return "表格";
  if (normalized.includes("json")) return "关系数据";
  if (normalized.includes("md") || normalized.includes("txt")) return "文本";
  return "文档";
}
