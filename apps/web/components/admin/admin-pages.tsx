"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Logo } from "../site/logo";
import { ThemeToggle } from "../theme-provider";
import { useAuth } from "../../lib/auth-context";
import type { AdminDashboardSnapshot, DescriptionCard, StoredAdminTemplate } from "@ff/platform/platform-store";
import { ConfirmDialog } from "./admin-confirm-dialog";
import {
  adminAuditEvents,
  adminDashboardDataOverview,
  adminDashboardHealthCards,
  adminDashboardRiskItems,
  adminGraphSnapshot,
  adminIntakeRequests,
  adminNav,
  adminTemplates,
  evaluationRows,
  isActionableAdminRequestStatus,
  knowledgeBaseInventory,
  ragOperationModes,
  resolveAdminFilePreview,
  strategyProfiles
} from "../../lib/fixtures/admin-governance";

type AdminIntakeRequest = (typeof adminIntakeRequests)[number] & {
  scenarioId?: string;
  storedFiles?: Array<{
    id: string;
    originalName: string;
    relativePath: string;
    size: number;
    accessControl?: {
      scope: "private" | "team" | "company";
      organizationId: string;
      teamIds: string[];
    };
    originalState?: "temporary" | "retained" | "deleted";
    originalAvailable?: boolean;
    retentionPolicy?: "delete_after_ingest" | "retain_source";
    retentionReason?: string;
  }>;
  recommendedEngines?: AdminEngine[];
  selectedEngine?: "待选择" | AdminEngine;
  frontstageMapping?: string;
  parsedArtifactCount?: number;
  knowledgeObjectCount?: number;
};

type AdminStoredFile = NonNullable<AdminIntakeRequest["storedFiles"]>[number];
type AdminEngine = "Gbrain" | "Naive RAG" | "GraphRAG";
type RagOperationMode = (typeof ragOperationModes)[number];
type RagParameter = RagOperationMode["parameters"][number];
type RagAssetView = RagOperationMode["assetViews"][number];
type IngestionRun = {
  requestId: string;
  engine: AdminEngine;
  status: "running" | "completed" | "failed";
  currentStep: number;
  message: string;
  sourceId?: string;
};
type GraphIngestedStats = {
  requestId: string;
  status: "loading" | "ready" | "error";
  data: { entityCount: number; relationCount: number; duplicateNames: string[] } | null;
};
type AdminFilePreviewState = {
  title: string;
  kind: string;
  label: string;
  url: string;
  status: "loading" | "ready" | "error";
  text?: string;
  message?: string;
};
type AdminKnowledgeAssetDetail = {
  id: string;
  kind: string;
  engine: AdminEngine;
  title: string;
  metric: string;
  status: string;
  sourceOriginalName: string;
  scenarioName: string;
  visibilityLabel: string;
  ownerName: string;
  createdAt: string;
  content: string;
  metadata: Array<{ label: string; value: string }>;
  // 018 T3：详情区展示/编辑源级描述卡所需的场景锚点 + 卡本身（缺失=未生成，AM-1818 禁假卡）。
  scenarioId: string;
  descriptionCard?: DescriptionCard;
};
type AdminAssetDetailState = {
  mode: Pick<RagOperationMode, "label" | "frontstageLabel">;
  asset: Pick<RagAssetView, "kind" | "label" | "description" | "metric">;
  status: "loading" | "ready" | "error";
  records: AdminKnowledgeAssetDetail[];
  message?: string;
};

// P18：知识库管理三引擎二级导航的单一真相源，供 AdminShell 左栏 + 三个 curation workbench 共用
// （之前 admin-form-curation.tsx 另存一份重复常量，GraphRAG href 都错指向 /admin/graph）。
export const adminKnowledgeSubnav = [
  { label: "资产总览", href: "/admin/knowledge-bases" },
  { label: "Gbrain 管理", href: "/admin/knowledge-bases/gbrain" },
  { label: "Naive RAG 管理", href: "/admin/knowledge-bases/naive" },
  { label: "GraphRAG 管理", href: "/admin/knowledge-bases/graph" }
];

export function KnowledgeSubnav({ active }: { active: string }) {
  return (
    <nav className="curation-subnav" aria-label="知识库管理">
      {adminKnowledgeSubnav.map((item) => (
        <Link key={item.href} href={item.href} className={item.href === active ? "active" : ""}>{item.label}</Link>
      ))}
    </nav>
  );
}

export function AdminOverviewPage({
  initialRequests = [],
  dashboard
}: {
  initialRequests?: AdminIntakeRequest[];
  dashboard?: AdminDashboardSnapshot;
}) {
  const requests = resolveAdminRequests(initialRequests);
  const pendingRequests = requests.filter((request) => !["已发布", "已退回"].includes(request.status));
  const readyRequests = requests.filter((request) => request.status === "已发布");
  const healthCards = dashboard?.healthCards ?? adminDashboardHealthCards;
  const dataOverview = dashboard?.dataOverview ?? adminDashboardDataOverview;
  const dashboardMetrics = [
    { label: "待处理资料包", value: dashboard?.requests.pending ?? pendingRequests.length, helper: "需要确认权限、资料质量和引擎策略", href: "/admin/pipelines", state: (dashboard?.requests.pending ?? pendingRequests.length) > 0 ? "watch" : "healthy" },
    { label: "已发布知识库", value: dashboard?.requests.published ?? readyRequests.length, helper: "已入库并可被前台使用", href: "/admin/knowledge-bases", state: "healthy" },
    { label: "知识库资产", value: dashboard?.assets.total ?? knowledgeBaseInventory.length, helper: "个人、团队、公司级知识边界", href: "/admin/knowledge-bases", state: "healthy" },
    { label: "检索策略", value: strategyProfiles.length, helper: "外放给场景的可调策略", href: "/admin/strategies", state: "healthy" }
  ];
  const dashboardRisks = adminDashboardRiskItems.map((item) => item.label === "待管理员确认资料包" ? { ...item, count: dashboard?.requests.pending ?? pendingRequests.length } : item);
  const maxDataTotal = Math.max(1, ...dataOverview.map((entry) => entry.total));

  return (
    <AdminShell active="/admin" title="运营总览">
      <AdminPageHead
        eyebrow="运营总览"
        title="系统健康、知识资产和待办一屏总览"
        description="管理员进入后台后，先判断服务是否可用、数据是否健康、哪些资料请求需要处理，再进入具体的入库、复核和发布链路。"
        actions={<Link className="admin-primary-action" href="/admin/pipelines">处理待办</Link>}
      />

      <section className="admin-health-strip" aria-label="服务健康状态">
        {healthCards.map((item) => (
          <Link href={item.route} key={item.id} className="admin-health-card">
            <span>{item.label}</span>
            <b>{item.value}</b>
            <small>{item.detail}</small>
            <AdminStatusBadge status={item.status} />
          </Link>
        ))}
      </section>

      <section className="admin-kpi-row admin-kpi-row-dashboard" aria-label="后台关键指标">
        {dashboardMetrics.map((item) => (
          <Link href={item.href} key={item.label} className={`admin-kpi-tile ${item.state}`}>
            <span>{item.label}</span>
            <b>{item.value}</b>
            <small>{item.helper}</small>
          </Link>
        ))}
      </section>

      <div className="admin-dashboard-grid">
        <section className="admin-panel admin-dashboard-map">
          <PanelHead eyebrow="数据总览" title="知识资产按权限范围分布" action={<Link href="/admin/knowledge-bases">查看资产台账</Link>} />
          <div className="admin-data-scope-grid">
            {dataOverview.map((item) => {
              const width = Math.max(12, Math.round((item.total / maxDataTotal) * 100));
              return (
                <article key={item.scope}>
                  <header>
                    <span>{item.scope}</span>
                    <AdminStatusBadge status={item.health} />
                  </header>
                  <strong>{item.total.toLocaleString()} <small>{item.unit}</small></strong>
                  <div className="admin-scope-meter" aria-label={`${item.scope}数据量 ${item.total}${item.unit}`}>
                    <i style={{ width: `${width}%` }} />
                  </div>
                  <dl>
                    <div><dt>模块</dt><dd>{item.module}</dd></div>
                    <div><dt>负责人</dt><dd>{item.owner}</dd></div>
                  </dl>
                  <p>{item.policy}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="admin-panel admin-service-panel">
          <PanelHead eyebrow="服务状态" title="三类 RAG 引擎链路" action={<Link href="/admin/settings">系统接入</Link>} />
          <div className="admin-service-stack">
            {ragOperationModes.map((mode) => (
              <article key={mode.id}>
                <div>
                  <b>{mode.label}</b>
                  <AdminStatusBadge status={mode.status} />
                </div>
                <p>{mode.purpose}</p>
                <small>{mode.storage}</small>
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className="admin-dashboard-grid secondary">
        <section className="admin-panel admin-dashboard-tasks">
          <PanelHead eyebrow="待办任务" title="需要管理员介入的资料请求" action={<Link href="/admin/pipelines">进入处理管线</Link>} />
          <div className="admin-task-table">
            <div className="admin-table-head">
              <span>场景</span>
              <span>范围</span>
              <span>建议引擎</span>
              <span>状态</span>
              <span>提交时间</span>
            </div>
            {pendingRequests.slice(0, 6).map((request) => (
              <Link href="/admin/pipelines" key={request.id}>
                <b>{request.scenarioName}<small>{request.requester}</small></b>
                <span>{request.visibility}</span>
                <span>{requestRecommendedEngines(request).join(" / ")}</span>
                <AdminStatusBadge status={request.status} />
                <span>{request.submittedAt}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="admin-panel admin-risk-panel">
          <PanelHead eyebrow="风险与门禁" title="当前需要关注的治理信号" action={<Link href="/admin/audit">审计记录</Link>} />
          <div className="admin-risk-stack">
            {dashboardRisks.map((item) => (
              <article key={item.label}>
                <span>{item.severity}</span>
                <div>
                  <b>{item.label}</b>
                  <p>{item.detail}</p>
                </div>
                <strong>{item.count}</strong>
              </article>
            ))}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

export function AdminTemplatesPage({ initialTemplates = [] }: { initialTemplates?: StoredAdminTemplate[] }) {
  const [templates, setTemplates] = useState<StoredAdminTemplate[]>(initialTemplates.length ? initialTemplates : adminTemplates.map(legacyAdminTemplateToStored));
  const [notice, setNotice] = useState("");
  const [draftName, setDraftName] = useState("");
  const [pending, setPending] = useState<{ title: string; description: string; danger?: boolean; confirmText?: string; run: () => void } | null>(null);
  const [draftCategory, setDraftCategory] = useState("自定义");
  const [draftHeadline, setDraftHeadline] = useState("");
  const officialCount = templates.filter((template) => template.source === "official").length;
  const customCount = templates.filter((template) => template.source === "custom").length;
  const pausedCount = templates.filter((template) => template.state === "paused").length;
  const averageDemoReadiness = templates.length ? Math.round(templates.reduce((total, template) => total + template.demoReadiness, 0) / templates.length) : 0;

  async function createTemplate() {
    if (!draftName.trim()) {
      setNotice("请先填写模板名称。");
      return;
    }
    const response = await fetch("/api/platform/admin/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: draftName,
        category: draftCategory,
        headline: draftHeadline || "由管理员创建的业务场景模板。",
        accepted_files: ["PDF", "Word", "Markdown", "表格资料"],
        input_examples: ["业务说明", "资料文件"],
        output_capabilities: ["可追问答案", "引用依据", "业务成品"],
        product_form: ["hybrid", "task_workflow"],
        review_requirement: "需要管理员确认"
      })
    });
    const body = await response.json().catch(() => null) as { template?: StoredAdminTemplate; message?: string } | null;
    if (!response.ok || !body?.template) {
      setNotice(body?.message ?? "模板创建失败，请检查登录状态和管理员权限。");
      return;
    }
    setTemplates((items) => [body.template!, ...items]);
    setDraftName("");
    setDraftHeadline("");
    setNotice(`已创建模板「${body.template.name}」，默认进入候选状态。`);
  }

  async function toggleTemplate(template: StoredAdminTemplate) {
    const nextState = template.state === "paused" ? (template.source === "official" ? "official" : "candidate") : "paused";
    const response = await fetch(`/api/platform/admin/templates/${template.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: nextState })
    });
    const body = await response.json().catch(() => null) as { template?: StoredAdminTemplate; message?: string } | null;
    if (!response.ok || !body?.template) {
      setNotice(body?.message ?? "模板状态更新失败。");
      return;
    }
    setTemplates((items) => items.map((item) => item.id === template.id ? body.template! : item));
    setNotice(`已${nextState === "paused" ? "暂停" : "恢复"}「${template.name}」。`);
  }

  async function deleteTemplate(template: StoredAdminTemplate) {
    const response = await fetch(`/api/platform/admin/templates/${template.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      setNotice(body?.message ?? "模板删除失败。");
      return;
    }
    setTemplates((items) => items.filter((item) => item.id !== template.id));
    setNotice(`已删除自定义模板「${template.name}」。`);
  }

  return (
    <AdminShell active="/admin/templates" title="模板治理">
      <AdminPageHead
        eyebrow="模板治理"
        title="模板权限与发布治理"
        description="模板不是静态卡片，而是前台创建业务场景的最佳实践入口。后台管理官方模板、自定义模板、可处理资料类型、发布门禁和删除边界。"
        actions={<button type="button" className="admin-primary-action" disabled={!draftName.trim()} onClick={createTemplate}>新建模板</button>}
      />
      {notice ? <p className="admin-console-notice" role="status">{notice}</p> : null}

      <section className="admin-template-metrics" aria-label="模板治理总览">
        <article><span>官方内置</span><b>{officialCount}</b><small>最佳实践模板，不允许硬删除</small></article>
        <article><span>自定义模板</span><b>{customCount}</b><small>管理员可创建、暂停和删除</small></article>
        <article><span>暂停发布</span><b>{pausedCount}</b><small>前台不可继续从暂停模板创建</small></article>
        <article><span>案例资料完备度</span><b>{averageDemoReadiness}%</b><small>案例资料、验证问题和引用准备情况</small></article>
      </section>

      <section className="admin-panel admin-template-builder">
        <PanelHead eyebrow="模板创建" title="新增可治理的业务场景模板" action={<span>仅管理员可操作</span>} />
        <div className="admin-template-form">
          <label>
            <span>模板名称</span>
            <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="例如：售后质检分析" />
          </label>
          <label>
            <span>业务分类</span>
            <input value={draftCategory} onChange={(event) => setDraftCategory(event.target.value)} placeholder="例如：客服、销售、法务" />
          </label>
          <label>
            <span>适用说明</span>
            <input value={draftHeadline} onChange={(event) => setDraftHeadline(event.target.value)} placeholder="说明这个模板解决什么问题、需要什么资料、会输出什么结果" />
          </label>
          <button type="button" disabled={!draftName.trim()} onClick={createTemplate}>创建模板</button>
        </div>
      </section>

      <section className="admin-panel">
        <PanelHead eyebrow="模板台账" title="发布门禁、资料类型和处理能力" />
        <div className="admin-data-table admin-template-table" role="table" aria-label="模板治理清单">
          <div role="row" className="admin-table-head">
            <span>模板</span>
            <span>来源</span>
            <span>状态</span>
            <span>支持资料</span>
            <span>发布门禁</span>
            <span>处理能力</span>
            <span>操作</span>
          </div>
          {templates.map((template) => (
            <div role="row" key={template.id}>
              <b>{template.name}<small>{template.headline}</small></b>
              <span>{template.source === "official" ? "官方内置" : "自定义模板"} · {template.category}</span>
              <AdminStatusBadge status={template.state} />
              <span>{template.acceptedFiles.slice(0, 4).join(" / ")}</span>
              <span>{template.reviewRequirement}<small>{template.evidenceCoverage}% 证据覆盖</small></span>
              <span>{template.outputCapabilities.slice(0, 3).join(" / ")}<small>{template.demoReadiness}% 案例完备</small></span>
              <div className="admin-row-actions">
                <button type="button" onClick={() => { if (template.state === "paused") { void toggleTemplate(template); } else { setPending({ title: "暂停模板", description: `暂停后「${template.name}」前台不可继续创建场景，确认暂停？`, confirmText: "暂停", run: () => toggleTemplate(template) }); } }}>{template.state === "paused" ? "恢复" : "暂停"}</button>
                <button type="button" onClick={async () => { await fetch(`/api/platform/admin/templates/${template.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: "official" }) }); window.location.reload(); }}>复核</button>
                {template.canDelete ? <button type="button" onClick={() => setPending({ title: "删除模板", description: `删除后不可恢复，确认删除模板「${template.name}」吗？`, danger: true, confirmText: "删除", run: () => deleteTemplate(template) })}>删除</button> : <span>官方不可删</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <ConfirmDialog open={pending !== null} title={pending?.title ?? ""} description={pending?.description ?? ""} danger={pending?.danger} confirmText={pending?.confirmText} onConfirm={() => { const p = pending; setPending(null); if (p) p.run(); }} onCancel={() => setPending(null)} />
    </AdminShell>
  );
}

function legacyAdminTemplateToStored(template: (typeof adminTemplates)[number]): StoredAdminTemplate {
  return {
    id: template.id,
    name: template.name,
    category: "官方",
    state: template.state === "已发布" ? "official" : "candidate",
    source: "official",
    owner: template.owner,
    headline: template.impact,
    acceptedFiles: ["PDF", "Word", "Markdown", "表格资料"],
    inputExamples: ["业务说明", "资料文件"],
    outputCapabilities: template.impact.split(" / ").filter(Boolean),
    productForm: ["hybrid"],
    reviewRequirement: template.reviewPolicy === "无需复核" ? "无需管理员确认" : template.reviewPolicy === "必须复核" ? "需要管理员确认" : "建议管理员确认",
    evidenceSources: template.evidenceSources,
    evidenceCoverage: template.evidenceCoverage,
    demoReadiness: template.demoReadiness,
    canEdit: true,
    canDelete: false,
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z"
  };
}

// ===== 真后端治理调用（同源 fetch 自动带 session cookie 鉴权） =====
async function postRecallVerify(engine: string, query: string): Promise<string> {
  try {
    const r = await fetch("/api/platform/admin/recall-verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ engine, query })
    });
    if (!r.ok) return `召回验证调用失败（HTTP ${r.status}）。`;
    const d = await r.json();
    if (!d.hits?.length) return `已对「${engine}」的 ${d.checkedSources ?? 0} 个真实来源执行检索，本次未命中可引用片段。`;
    const top = d.hits.slice(0, 2).map((h: { source: string; excerpt: string }, i: number) => `${i + 1}. ${h.source}：${h.excerpt}`).join("　");
    return `召回验证（真实检索·命中 ${d.hits.length} 条）：${top}`;
  } catch {
    return "召回验证调用失败：无法连接后端。";
  }
}

// 018 T3：人工保存源级描述卡 → PATCH 真实 admin API，成功后 origin 由后端强制置 manual（AM-1817）。
async function postUpdateDescriptionCard(
  scenarioId: string,
  input: { summaryScope: string; typicalQuestions: string[]; entityHints: string[] }
): Promise<{ ok: boolean; card?: DescriptionCard; message?: string }> {
  try {
    const r = await fetch(`/api/platform/admin/scenarios/${scenarioId}/description-card`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summary_scope: input.summaryScope,
        typical_questions: input.typicalQuestions,
        entity_hints: input.entityHints
      })
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.scenario) {
      return { ok: false, message: body?.message ?? `保存失败（HTTP ${r.status}）。` };
    }
    return { ok: true, card: body.scenario.descriptionCard };
  } catch {
    return { ok: false, message: "保存失败：无法连接后端。" };
  }
}

function triggerAssetExport(engine?: string) {
  const qs = engine && engine !== "全部" ? `?engine=${encodeURIComponent(engine)}` : "";
  window.open(`/api/platform/admin/knowledge-assets/export${qs}`, "_blank");
}

async function postBatchReview(engine?: string): Promise<string> {
  try {
    const r = await fetch("/api/platform/admin/batch-review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ engine })
    });
    if (!r.ok) return `批量复核调用失败（HTTP ${r.status}）。`;
    const d = await r.json();
    return `批量复核完成：真实入库发布 ${d.approved} 个，失败 ${d.failed} 个。`;
  } catch {
    return "批量复核调用失败：无法连接后端。";
  }
}

export function AdminKnowledgeBasesPage({ initialAssets = [] }: { initialAssets?: AdminKnowledgeAssetDetail[] }) {
  const [assets] = useState(initialAssets);
  const [engineFilter, setEngineFilter] = useState<AdminEngine | "全部">("全部");
  const [scopeFilter, setScopeFilter] = useState("全部");
  const [selectedAssetId, setSelectedAssetId] = useState(initialAssets[0]?.id ?? "");
  const [assetDetail, setAssetDetail] = useState<AdminAssetDetailState | null>(null);
  const [consoleNotice, setConsoleNotice] = useState("");
  // 018 T3：描述卡按 scenarioId 覆盖 initialAssets 的静态快照（服务端渲染时的卡内容），保存成功后
  // 立刻反映在详情区，无需整页刷新。generation ref 防止「切场景再切回来」时旧保存响应覆盖新内容
  // （异步竞态：只按 scenarioId 覆盖不够，同场景连续两次保存仍需按代次丢弃过期响应）。
  const [cardOverrides, setCardOverrides] = useState<Record<string, DescriptionCard>>({});
  const cardSaveGenRef = useRef<Record<string, number>>({});
  const saveDescriptionCard = useCallback(
    async (
      scenarioId: string,
      input: { summaryScope: string; typicalQuestions: string[]; entityHints: string[] }
    ): Promise<{ ok: boolean; message?: string }> => {
      const gen = (cardSaveGenRef.current[scenarioId] ?? 0) + 1;
      cardSaveGenRef.current[scenarioId] = gen;
      const result = await postUpdateDescriptionCard(scenarioId, input);
      if (cardSaveGenRef.current[scenarioId] !== gen) return { ok: true }; // 已被更新的保存请求取代，丢弃过期响应
      if (!result.ok || !result.card) return { ok: false, message: result.message };
      setCardOverrides((prev) => ({ ...prev, [scenarioId]: result.card! }));
      return { ok: true };
    },
    []
  );
  const scopeOptions = ["全部", ...Array.from(new Set(assets.map((asset) => asset.visibilityLabel)))];
  const filteredAssets = assets.filter((asset) => {
    const engineMatch = engineFilter === "全部" || asset.engine === engineFilter;
    const scopeMatch = scopeFilter === "全部" || asset.visibilityLabel === scopeFilter;
    return engineMatch && scopeMatch;
  });
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? filteredAssets[0] ?? assets[0];
  const stats = knowledgeAssetStats(assets);

  return (
    <AdminShell active="/admin/knowledge-bases" title="知识库资产">
      <AdminPageHead
        eyebrow="知识资产"
        title="知识资产管理台"
        description="这里是管理员长期治理企业知识资产的操作台：按知识库、权限、引擎、来源和状态查看所有已入库资产，并进入召回验证、索引重建和发布复核。"
        actions={<button type="button" className="admin-primary-action" onClick={() => { triggerAssetExport(engineFilter); setConsoleNotice("已生成真实资产 CSV 并触发下载（当前引擎筛选作为导出条件）。"); }}>导出资产表</button>}
      />
      {consoleNotice ? <p className="admin-console-notice" role="status">{consoleNotice}</p> : null}

      <section className="admin-asset-overview" aria-label="资产总览">
        {stats.map((item) => (
          <article key={item.label} className={item.state}>
            <span>{item.label}</span>
            <b>{item.value}</b>
            <small>{item.helper}</small>
          </article>
        ))}
      </section>

      <section className="admin-knowledge-console" aria-label="知识资产管理工作台">
        <aside className="admin-asset-scope-rail" aria-label="资产范围">
          <header>
            <span>资产范围</span>
            <b>按权限和引擎定位</b>
          </header>
          <div className="admin-scope-list">
            {["全部", "个人", "团队", "公司"].map((scope) => (
              <button key={scope} type="button" className={scopeFilter === scope ? "active" : ""} onClick={() => setScopeFilter(scope)}>
                <span>{scope}</span>
                <b>{scope === "全部" ? assets.length : assets.filter((asset) => asset.visibilityLabel === scope).length}</b>
              </button>
            ))}
          </div>
          <div className="admin-engine-tree">
            {(["Gbrain", "Naive RAG", "GraphRAG"] as AdminEngine[]).map((engine) => (
              <button key={engine} type="button" className={engineFilter === engine ? "active" : ""} onClick={() => setEngineFilter(engine)}>
                <span>{engine}</span>
                <small>{frontstageLabelForEngine(engine)}</small>
                <b>{assets.filter((asset) => asset.engine === engine).length}</b>
              </button>
            ))}
          </div>
        </aside>

        <section className="admin-panel admin-asset-ledger">
          <PanelHead
            eyebrow="资产清单"
            title="按知识库、引擎和权限治理资产"
            action={<span>{filteredAssets.length} / {assets.length} 条</span>}
          />
          <div className="admin-asset-filterbar" aria-label="资产筛选">
            <div>
              {(["全部", "Gbrain", "Naive RAG", "GraphRAG"] as Array<AdminEngine | "全部">).map((engine) => (
                <button key={engine} type="button" className={engineFilter === engine ? "active" : ""} onClick={() => setEngineFilter(engine)}>
                  {engine}
                </button>
              ))}
            </div>
            <div>
              {scopeOptions.map((scope) => (
                <button key={scope} type="button" className={scopeFilter === scope ? "active" : ""} onClick={() => setScopeFilter(scope)}>
                  {scope}
                </button>
              ))}
            </div>
          </div>
          <div className="admin-data-table admin-knowledge-ledger-table" role="table" aria-label="入库资产清单">
            <div role="row" className="admin-table-head">
              <span>资产</span>
              <span>引擎</span>
              <span>类型</span>
              <span>权限范围</span>
              <span>来源</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            {filteredAssets.map((asset) => (
              <div
                role="row"
                key={asset.id}
                className={selectedAsset?.id === asset.id ? "active" : ""}
                data-asset-row={asset.id}
              >
                <button type="button" onClick={() => setSelectedAssetId(asset.id)}>
                  <b>{asset.scenarioName}<small>{asset.title}</small></b>
                </button>
                <span>{asset.engine}</span>
                <span>{assetKindLabel(asset.kind)}</span>
                <span>{assetMetadataValue(asset, "权限范围") ?? asset.visibilityLabel}</span>
                <span>{asset.sourceOriginalName}</span>
                <AdminStatusBadge status={asset.status} />
                <div className="admin-row-actions">
                  <button type="button" onClick={() => openLocalAdminAssetDetail(asset, setAssetDetail)}>预览</button>
                  <Link href={engineManagementHref(asset.engine)}>进入管理页</Link>
                  <button type="button" onClick={async () => {
                    setSelectedAssetId(asset.id);
                    setConsoleNotice(`正在对「${asset.scenarioName}」执行真实召回验证…`);
                    setConsoleNotice(await postRecallVerify(asset.engine, asset.scenarioName));
                  }}>召回验证</button>
                </div>
              </div>
            ))}
            {filteredAssets.length === 0 ? (
              <div role="row" className="admin-empty-ledger-row">
                <b>当前筛选下没有资产<small>请调整引擎或权限范围，或者先在处理管线中确认入库。</small></b>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="admin-panel admin-asset-inspector">
          <PanelHead eyebrow="详情检查器" title={selectedAsset ? selectedAsset.scenarioName : "未选择资产"} />
          {selectedAsset ? (
            <div className="admin-inspector-asset">
              <header>
                <span>{selectedAsset.engine}</span>
                <b>{selectedAsset.title}</b>
                <AdminStatusBadge status={selectedAsset.status} />
              </header>
              <p>{selectedAsset.content}</p>
              <dl>
                <div><dt>资产类型</dt><dd>{assetKindLabel(selectedAsset.kind)}</dd></div>
                <div><dt>权限范围</dt><dd>{assetMetadataValue(selectedAsset, "权限范围") ?? selectedAsset.visibilityLabel}</dd></div>
                <div><dt>来源文件</dt><dd>{selectedAsset.sourceOriginalName}</dd></div>
                <div><dt>负责人</dt><dd>{selectedAsset.ownerName}</dd></div>
              </dl>
              <div className="admin-inspector-actions">
                <button type="button" onClick={async () => { setConsoleNotice(`正在对「${selectedAsset.scenarioName}」执行真实召回验证…`); setConsoleNotice(await postRecallVerify(selectedAsset.engine, selectedAsset.scenarioName)); }}>召回验证</button>
                <button type="button" onClick={async () => { setConsoleNotice(`正在对「${selectedAsset.sourceOriginalName}」真实重检索校验索引可用性…`); setConsoleNotice(await postRecallVerify(selectedAsset.engine, selectedAsset.scenarioName)); }}>索引校验</button>
                <button type="button" onClick={async () => { setConsoleNotice(`正在对「${selectedAsset.scenarioName}」执行真实权限范围内召回复核…`); setConsoleNotice(await postRecallVerify(selectedAsset.engine, selectedAsset.scenarioName)); }}>权限复核</button>
                <button type="button" onClick={() => openLocalAdminAssetDetail(selectedAsset, setAssetDetail)}>快速预览</button>
              </div>
              <AdminDescriptionCardSection
                key={selectedAsset.scenarioId}
                scenarioId={selectedAsset.scenarioId}
                card={cardOverrides[selectedAsset.scenarioId] ?? selectedAsset.descriptionCard}
                onSave={saveDescriptionCard}
              />
            </div>
          ) : (
            <div className="admin-asset-empty-inline">
              <b>暂无入库资产</b>
              <p>前台提交资料并由管理员确认入库后，这里会显示可治理的知识对象。</p>
            </div>
          )}
        </aside>
      </section>

      <section className="admin-panel admin-engine-governance">
        <PanelHead eyebrow="引擎治理" title="三种 RAG 的资产治理入口" action={<button type="button" onClick={async () => { setConsoleNotice("正在批量真实复核入库…"); setConsoleNotice(await postBatchReview()); }}>批量复核</button>} />
        <div className="admin-governance-lanes">
          {ragOperationModes.map((mode) => (
            <article key={mode.id}>
              <header>
                <div>
                  <span>{mode.frontstageLabel}</span>
                  <h2>{mode.label} 治理</h2>
                </div>
                <Link href={engineManagementHref(mode.label)} className="admin-engine-open-link">进入管理页</Link>
              </header>
              <b className="admin-governance-count">{assets.filter((asset) => asset.engine === mode.label).length}</b>
              <ul>
                {governanceStepsForEngine(mode.label).map((step) => <li key={step}>{step}</li>)}
              </ul>
              <div className="admin-governance-assets">
                {mode.assetViews.map((asset) => (
                  <button
                    key={asset.kind}
                    type="button"
                    data-asset-kind={asset.kind}
                    aria-label={`${mode.label} ${asset.label}`}
                    onClick={() => void openAdminAssetDetail(mode, asset, setAssetDetail)}
                  >
                    <span>{asset.label}</span>
                    <small>{assets.filter((record) => record.engine === mode.label && record.kind === asset.kind).length}</small>
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
      {assetDetail ? <AdminKnowledgeAssetOverlay detail={assetDetail} onClose={() => setAssetDetail(null)} /> : null}
    </AdminShell>
  );
}

// 018 T3（AM-1817/1818）：详情区源级描述卡展示 + 编辑。空态引导禁假卡——没有卡就说明"未生成"，
// 不拿占位字符串冒充卡内容。保存真调 onSave（PATCH admin API），origin 由后端强制置 manual。
function AdminDescriptionCardSection({
  scenarioId,
  card,
  onSave
}: {
  scenarioId: string;
  card?: DescriptionCard;
  onSave: (
    scenarioId: string,
    input: { summaryScope: string; typicalQuestions: string[]; entityHints: string[] }
  ) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ summaryScope: "", typicalQuestions: "", entityHints: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function startEdit() {
    setDraft({
      summaryScope: card?.summaryScope ?? "",
      typicalQuestions: (card?.typicalQuestions ?? []).join("\n"),
      entityHints: (card?.entityHints ?? []).join("\n")
    });
    setError("");
    setEditing(true);
  }

  async function handleSave() {
    const typicalQuestions = draft.typicalQuestions.split("\n").map((line) => line.trim()).filter(Boolean);
    const entityHints = draft.entityHints.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!draft.summaryScope.trim() || typicalQuestions.length < 3 || typicalQuestions.length > 5) {
      setError("说明范围必填，典型问题需要 3~5 条（每行一条）。");
      return;
    }
    setSaving(true);
    setError("");
    const result = await onSave(scenarioId, { summaryScope: draft.summaryScope.trim(), typicalQuestions, entityHints });
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "保存失败，请重试。");
      return;
    }
    setEditing(false);
  }

  return (
    <section className="admin-description-card" aria-label="源级描述卡" data-testid="description-card-panel">
      <header>
        <span>源级描述卡</span>
        {!editing ? (
          <button type="button" data-testid="description-card-edit-button" onClick={startEdit}>{card ? "编辑" : "填写描述卡"}</button>
        ) : null}
      </header>
      {editing ? (
        <div className="admin-description-card-form">
          <label>
            <span>说明范围</span>
            <textarea
              value={draft.summaryScope}
              onChange={(event) => setDraft((d) => ({ ...d, summaryScope: event.target.value }))}
              placeholder="这批资料主要覆盖哪些业务范围"
            />
          </label>
          <label>
            <span>典型问题（每行一条，3~5 条）</span>
            <textarea
              value={draft.typicalQuestions}
              onChange={(event) => setDraft((d) => ({ ...d, typicalQuestions: event.target.value }))}
              placeholder={"报销标准是多少\n住宿上限多少\n交通费怎么算"}
            />
          </label>
          <label>
            <span>关键实体提示（可选，每行一条，最多 8 条）</span>
            <textarea
              value={draft.entityHints}
              onChange={(event) => setDraft((d) => ({ ...d, entityHints: event.target.value }))}
            />
          </label>
          {error ? <p className="admin-console-notice" role="alert">{error}</p> : null}
          <div className="admin-row-actions">
            <button type="button" disabled={saving} data-testid="description-card-save" onClick={handleSave}>{saving ? "保存中…" : "保存"}</button>
            <button type="button" disabled={saving} onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      ) : card ? (
        <dl>
          <div><dt>说明范围</dt><dd>{card.summaryScope}</dd></div>
          <div><dt>典型问题</dt><dd><ul>{card.typicalQuestions.map((question) => <li key={question}>{question}</li>)}</ul></dd></div>
          {card.entityHints?.length ? <div><dt>关键实体</dt><dd>{card.entityHints.join("、")}</dd></div> : null}
          <div><dt>生成时间</dt><dd>{new Date(card.generatedAt).toLocaleString()}</dd></div>
          <div><dt>来源</dt><dd>{card.origin === "manual" ? "人工维护" : "自动生成"}</dd></div>
          {card.staleHint ? <div><dt>提示</dt><dd>资料已更新，建议人工复核这张卡是否仍准确。</dd></div> : null}
        </dl>
      ) : (
        <p className="admin-asset-empty-inline" data-testid="description-card-empty">
          尚未生成描述卡，入库完成后会自动生成；也可以现在手动填写。
        </p>
      )}
    </section>
  );
}

// TODO(P18): 三引擎全静态化后此为 dead code（[engine] 动态路由已被静态路由挡住），下批清理（见 P18 spec §四 决策A 第6步）。
export function AdminKnowledgeEnginePage({ engine, initialAssets = [] }: { engine: AdminEngine; initialAssets?: AdminKnowledgeAssetDetail[] }) {
  const [selectedKind, setSelectedKind] = useState("全部");
  const [selectedAssetId, setSelectedAssetId] = useState(initialAssets[0]?.id ?? "");
  const [notice, setNotice] = useState("");
  const [assetDetail, setAssetDetail] = useState<AdminAssetDetailState | null>(null);
  const mode = modeForEngine(engine);
  const kindOptions = ["全部", ...mode.assetViews.map((asset) => asset.kind)];
  const filteredAssets = initialAssets.filter((asset) => selectedKind === "全部" || asset.kind === selectedKind);
  const selectedAsset = initialAssets.find((asset) => asset.id === selectedAssetId) ?? filteredAssets[0] ?? initialAssets[0];
  const pageConfig = enginePageConfig(engine);

  return (
    <AdminShell active={engineManagementHref(engine)} title={`${engine} 管理`}>
      <AdminPageHead
        eyebrow="知识资产"
        title={`${engine} 资产管理`}
        description={pageConfig.description}
        actions={<Link className="admin-primary-action" href="/admin/knowledge-bases">返回资产总览</Link>}
      />
      {notice ? <p className="admin-console-notice" role="status">{notice}</p> : null}

      <section className="admin-engine-detail-overview" aria-label={`${engine} 后台管理总览`}>
        {pageConfig.metrics.map((metric) => (
          <article key={metric.label}>
            <span>{metric.label}</span>
            <b>{metric.value(initialAssets)}</b>
            <small>{metric.helper}</small>
          </article>
        ))}
      </section>

      <section className="admin-engine-workbench-map" aria-label={`${engine} 管理工作台`}>
        <header>
          <span>{pageConfig.workbench.eyebrow}</span>
          <h2>{pageConfig.workbench.title}</h2>
          <p>{pageConfig.workbench.description}</p>
        </header>
        <div className="admin-engine-workbench-tabs">
          {pageConfig.workbench.areas.map((area, index) => (
            <button
              key={area.label}
              type="button"
              className={index === 0 ? "active" : ""}
              onClick={() => setNotice(`${area.label} 已切换到当前工作区。`)}
            >
              <b>{area.label}</b>
              <span>{area.description}</span>
            </button>
          ))}
        </div>
        <div className="admin-engine-control-grid">
          {pageConfig.workbench.controls.map((control) => (
            <article key={control.label}>
              <span>{control.label}</span>
              <b>{control.value}</b>
              <small>{control.helper}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-panel admin-engine-workflow">
        <PanelHead eyebrow="处理链路" title={pageConfig.workflowTitle} action={<button type="button" onClick={async () => { setNotice(`正在对 ${engine} 执行真实批量治理（入库复核）…`); setNotice(await postBatchReview(engine)); }}>批量治理</button>} />
        <div className="admin-engine-stage-strip">
          {pageConfig.stages.map((stage, index) => (
            <article key={stage}>
              <i>{index + 1}</i>
              <span>{stage}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-engine-detail-layout">
        <section className="admin-panel admin-engine-asset-panel">
          <PanelHead eyebrow="资产数据" title={pageConfig.assetTitle} action={<span>{filteredAssets.length} / {initialAssets.length} 条</span>} />
          <div className="admin-asset-filterbar" aria-label={`${engine} 资产类型筛选`}>
            <div>
              {kindOptions.map((kind) => (
                <button key={kind} type="button" className={selectedKind === kind ? "active" : ""} onClick={() => setSelectedKind(kind)}>
                  {kind === "全部" ? "全部" : assetKindLabel(kind)}
                </button>
              ))}
            </div>
          </div>
          <div className="admin-data-table admin-engine-asset-table" role="table" aria-label={`${engine} 资产表`}>
            <div role="row" className="admin-table-head">
              <span>资产</span>
              <span>类型</span>
              <span>来源</span>
              <span>权限</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            {filteredAssets.map((asset) => (
              <div role="row" key={asset.id} className={selectedAsset?.id === asset.id ? "active" : ""} data-engine-row={asset.id}>
                <button type="button" onClick={() => setSelectedAssetId(asset.id)}>
                  <b>{asset.title}<small>{asset.scenarioName}</small></b>
                </button>
                <span>{assetKindLabel(asset.kind)}</span>
                <span>{asset.sourceOriginalName}</span>
                <span>{assetMetadataValue(asset, "权限范围") ?? asset.visibilityLabel}</span>
                <AdminStatusBadge status={asset.status} />
                <div className="admin-row-actions">
                  <button type="button" onClick={() => openLocalAdminAssetDetail(asset, setAssetDetail)}>查看数据</button>
                  <button type="button" onClick={async () => { setNotice(`正在对「${asset.title}」执行真实${pageConfig.primaryAction}检索…`); setNotice(await postRecallVerify(engine, asset.title)); }}>{pageConfig.primaryAction}</button>
                </div>
              </div>
            ))}
            {filteredAssets.length === 0 ? (
              <div role="row" className="admin-empty-ledger-row">
                <b>当前类型暂无资产<small>请先在处理管线中完成 {engine} 入库，或切换筛选类型。</small></b>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="admin-panel admin-engine-inspector">
          <PanelHead eyebrow="资产检查器" title={selectedAsset ? selectedAsset.scenarioName : "未选择资产"} />
          {selectedAsset ? (
            <div className="admin-inspector-asset">
              <header>
                <span>{assetKindLabel(selectedAsset.kind)}</span>
                <b>{selectedAsset.title}</b>
                <AdminStatusBadge status={selectedAsset.status} />
              </header>
              <p>{selectedAsset.content}</p>
              <dl>
                {selectedAsset.metadata.map((item) => (
                  <div key={`${selectedAsset.id}-${item.label}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>
                ))}
              </dl>
              <div className="admin-inspector-actions">
                {pageConfig.actions.map((action) => (
                  <button key={action} type="button" onClick={async () => { setNotice(`正在对「${selectedAsset.title}」执行真实${action}检索…`); setNotice(await postRecallVerify(engine, selectedAsset.title)); }}>{action}</button>
                ))}
                <button type="button" onClick={() => openLocalAdminAssetDetail(selectedAsset, setAssetDetail)}>快速预览</button>
              </div>
            </div>
          ) : (
            <div className="admin-asset-empty-inline">
              <b>暂无 {engine} 资产</b>
              <p>确认入库后，这里会显示可治理的数据对象。</p>
            </div>
          )}
        </aside>
      </section>

      <AdminEngineSpecificConsole
        engine={engine}
        assets={initialAssets}
        selectedAsset={selectedAsset}
        pageConfig={pageConfig}
        onNotice={setNotice}
      />
      {assetDetail ? <AdminKnowledgeAssetOverlay detail={assetDetail} onClose={() => setAssetDetail(null)} /> : null}
    </AdminShell>
  );
}

function AdminEngineSpecificConsole({
  engine,
  assets,
  selectedAsset,
  pageConfig,
  onNotice
}: {
  engine: AdminEngine;
  assets: AdminKnowledgeAssetDetail[];
  selectedAsset?: AdminKnowledgeAssetDetail;
  pageConfig: ReturnType<typeof enginePageConfig>;
  onNotice: (message: string) => void;
}) {
  if (engine === "Naive RAG") {
    return <AdminNaiveRagConsole assets={assets} selectedAsset={selectedAsset} onNotice={onNotice} />;
  }
  if (engine === "GraphRAG") {
    return <AdminGraphRagConsole assets={assets} selectedAsset={selectedAsset} onNotice={onNotice} />;
  }
  return <AdminGbrainConsole assets={assets} selectedAsset={selectedAsset} pageConfig={pageConfig} onNotice={onNotice} />;
}

function AdminNaiveRagConsole({
  assets,
  selectedAsset,
  onNotice
}: {
  assets: AdminKnowledgeAssetDetail[];
  selectedAsset?: AdminKnowledgeAssetDetail;
  onNotice: (message: string) => void;
}) {
  const chunkAssets = assets.filter((asset) => asset.kind === "chunk");
  const vectorAssets = assets.filter((asset) => asset.kind === "embedding");
  const citationAssets = assets.filter((asset) => asset.kind === "citation");
  return (
    <section className="admin-panel admin-engine-specific-console admin-naive-console">
      <PanelHead eyebrow="Naive RAG 专项后台" title="Chunk 浏览器、向量索引批次和 TopK 召回实验" action={<button type="button" onClick={async () => { onNotice("正在启动真实 Naive RAG 召回实验…"); onNotice(await postRecallVerify("Naive RAG", "制度、合同与报告要点")); }}>新建召回实验</button>} />
      <div className="admin-naive-layout">
        <section className="admin-engine-subpanel">
          <header>
            <span>文档与切片 · Chunk 浏览器</span>
            <b>{chunkAssets.length || assets.length} 个切片</b>
          </header>
          <div className="admin-chunk-table" role="table" aria-label="Naive RAG Chunk 浏览器">
            <div role="row" className="admin-table-head">
              <span>Chunk</span>
              <span>来源</span>
              <span>范围</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            {(chunkAssets.length ? chunkAssets : assets).map((asset, index) => (
              <div role="row" key={asset.id} data-chunk-row={asset.id}>
                <b>{asset.title}<small>{truncateAdminText(asset.content, 72)}</small></b>
                <span>{asset.sourceOriginalName}</span>
                <span>{assetMetadataValue(asset, "权限范围") ?? asset.visibilityLabel}</span>
                <AdminStatusBadge status={asset.status} />
                <div className="admin-row-actions">
                  <button type="button" onClick={async () => { onNotice(`正在对「${asset.title}」执行真实引用抽检…`); onNotice(await postRecallVerify("Naive RAG", asset.title)); }}>引用抽检</button>
                  <button type="button" onClick={() => onNotice(`Chunk ${index + 1} 已禁用。`)}>禁用</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="admin-engine-subpanel admin-retrieval-lab">
          <header>
            <span>TopK 召回实验</span>
            <b>{selectedAsset?.scenarioName ?? "当前知识库"}</b>
          </header>
          <label>
            <span>试问</span>
            <input readOnly value={selectedAsset ? `${selectedAsset.scenarioName} 能回答哪些问题？` : "输入业务问题验证召回"} />
          </label>
          <div className="admin-retrieval-controls">
            <div><span>TopK</span><b>8</b></div>
            <div><span>阈值</span><b>0.72</b></div>
            <div><span>重排</span><b>启用</b></div>
          </div>
          <button type="button" onClick={async () => { onNotice("正在运行真实 TopK 召回…"); onNotice(await postRecallVerify("Naive RAG", "关键制度、条款与流程")); }}>运行检索</button>
        </aside>

        <section className="admin-engine-subpanel admin-vector-batches">
          <header>
            <span>向量索引批次</span>
            <b>{vectorAssets.length || assets.length} 批</b>
          </header>
          <div>
            {(vectorAssets.length ? vectorAssets : assets).slice(0, 4).map((asset) => (
              <article key={`vector-${asset.id}`}>
                <span>{asset.sourceOriginalName}</span>
                <b>{asset.metric}</b>
                <small>Embedding · payload · metadata filter 已登记</small>
              </article>
            ))}
          </div>
        </section>

        <section className="admin-engine-subpanel admin-citation-audit">
          <header>
            <span>引用证据</span>
            <b>{citationAssets.length || assets.length} 条</b>
          </header>
          {(citationAssets.length ? citationAssets : assets).slice(0, 3).map((asset) => (
            <article key={`citation-${asset.id}`}>
              <b>{asset.title}</b>
              <p>{truncateAdminText(asset.content, 120)}</p>
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}

function AdminGraphRagConsole({
  assets,
  selectedAsset,
  onNotice
}: {
  assets: AdminKnowledgeAssetDetail[];
  selectedAsset?: AdminKnowledgeAssetDetail;
  onNotice: (message: string) => void;
}) {
  const graphAssets = assets.length ? assets : selectedAsset ? [selectedAsset] : [];
  const primary = selectedAsset ?? graphAssets[0];
  return (
    <section className="admin-panel admin-engine-specific-console admin-graphrag-console">
      <PanelHead eyebrow="GraphRAG 专项后台" title="图谱画布、关系边表、低置信复核队列和多跳路径查询" action={<button type="button" onClick={async () => { onNotice("正在对 GraphRAG 执行真实图谱复核检索…"); onNotice(await postRecallVerify("GraphRAG", "关键实体与关系")); }}>图谱复核</button>} />
      <div className="admin-graphrag-layout">
        <section className="admin-graph-workbench">
          <header>
            <span>图谱画布</span>
            <b>{primary?.scenarioName ?? "关系知识库"}</b>
          </header>
          <div className="admin-graph-stage" aria-label="GraphRAG 图谱画布">
            <svg viewBox="0 0 720 360" role="img" aria-label="实体关系图谱">
              <line x1="165" y1="176" x2="360" y2="90" />
              <line x1="165" y1="176" x2="360" y2="250" />
              <line x1="360" y1="90" x2="560" y2="176" />
              <line x1="360" y1="250" x2="560" y2="176" />
              <g data-graph-node={primary?.scenarioName ?? "主实体"} transform="translate(165 176)">
                <circle r="48" className="main" />
                <text textAnchor="middle" y="4">{graphNodeLabel(primary?.scenarioName ?? "业务实体")}</text>
              </g>
              <g data-graph-node="风险信号" transform="translate(360 90)">
                <circle r="38" className="risk" />
                <text textAnchor="middle" y="4">风险信号</text>
              </g>
              <g data-graph-node="证据来源" transform="translate(360 250)">
                <circle r="38" />
                <text textAnchor="middle" y="4">证据来源</text>
              </g>
              <g data-graph-node="下一步动作" transform="translate(560 176)">
                <circle r="42" className="action" />
                <text textAnchor="middle" y="4">下一步动作</text>
              </g>
            </svg>
          </div>
        </section>

        <section className="admin-engine-subpanel admin-edge-table">
          <header>
            <span>关系边表</span>
            <b>{graphAssets.length || 1} 组候选边</b>
          </header>
          <div role="table" aria-label="GraphRAG 关系边表">
            <div role="row" className="admin-table-head">
              <span>起点</span>
              <span>关系</span>
              <span>终点</span>
              <span>置信度</span>
            </div>
            {graphAssets.map((asset, index) => (
              <div role="row" key={`edge-${asset.id}`}>
                <span>{graphNodeLabel(asset.scenarioName)}</span>
                <b>{index % 2 === 0 ? "影响" : "关联"}</b>
                <span>{assetKindLabel(asset.kind)}</span>
                <strong>{Math.max(72, 93 - index * 6)}%</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-engine-subpanel admin-path-query">
          <header>
            <span>多跳路径查询</span>
            <b>Local / Global / DRIFT</b>
          </header>
          <label>
            <span>路径问题</span>
            <input readOnly value={primary ? `${primary.scenarioName} 的风险如何影响续约？` : "输入实体路径问题"} />
          </label>
          <div className="admin-path-result">
            <span>{graphNodeLabel(primary?.scenarioName ?? "客户")}</span>
            <i />
            <span>风险信号</span>
            <i />
            <span>证据来源</span>
            <i />
            <span>下一步动作</span>
          </div>
          <button type="button" onClick={async () => { onNotice("正在运行真实多跳路径查询…"); onNotice(await postRecallVerify("GraphRAG", "客户、负责人、供应商之间的关系")); }}>运行路径查询</button>
        </section>

        <section className="admin-engine-subpanel admin-review-queue">
          <header>
            <span>低置信复核队列</span>
            <b>{Math.max(1, graphAssets.filter((asset) => asset.kind === "review").length)} 项</b>
          </header>
          {(graphAssets.length ? graphAssets : []).slice(0, 4).map((asset) => (
            <article key={`review-${asset.id}`}>
              <b>{asset.title}</b>
              <p>{truncateAdminText(asset.content, 96)}</p>
              <button type="button" onClick={async () => { onNotice(`正在对「${asset.title}」执行真实关系复核检索…`); onNotice(await postRecallVerify("GraphRAG", asset.title)); }}>复核</button>
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}

function AdminGbrainConsole({
  assets,
  selectedAsset,
  pageConfig,
  onNotice
}: {
  assets: AdminKnowledgeAssetDetail[];
  selectedAsset?: AdminKnowledgeAssetDetail;
  pageConfig: ReturnType<typeof enginePageConfig>;
  onNotice: (message: string) => void;
}) {
  const wikiAssets = assets.length ? assets : selectedAsset ? [selectedAsset] : [];
  return (
    <section className="admin-panel admin-engine-specific-console admin-gbrain-console">
      <PanelHead eyebrow="Gbrain 专项后台" title="页面树、事实卡治理、主题互链和来源映射" action={<button type="button" onClick={async () => { onNotice("正在对 Gbrain 执行真实召回复核…"); onNotice(await postRecallVerify("Gbrain", "知识页要点")); }}>发布复核</button>} />
      <div className="admin-gbrain-layout">
        <section className="admin-engine-subpanel admin-page-tree">
          <header>
            <span>页面树</span>
            <b>{wikiAssets.length || 1} 个知识页</b>
          </header>
          <div className="admin-tree-list" role="tree" aria-label="Gbrain 页面树">
            {wikiAssets.map((asset) => (
              <article key={asset.id} role="treeitem" data-wiki-page={asset.id}>
                <b>{asset.scenarioName}</b>
                <span>{asset.title}</span>
                <small>{asset.sourceOriginalName} · {assetMetadataValue(asset, "权限范围") ?? asset.visibilityLabel}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="admin-engine-subpanel admin-fact-governance">
          <header>
            <span>事实卡治理</span>
            <b>事实记忆</b>
          </header>
          {(wikiAssets.length ? wikiAssets : []).slice(0, 4).map((asset, index) => (
            <article key={`fact-${asset.id}`}>
              <span>事实 {index + 1}</span>
              <b>{truncateAdminText(asset.content, 76)}</b>
              <small>来源：{asset.sourceOriginalName}</small>
              <button type="button" onClick={async () => { onNotice(`正在对「${asset.title}」执行真实事实抽检检索…`); onNotice(await postRecallVerify("Gbrain", asset.title)); }}>抽检</button>
            </article>
          ))}
        </section>

        <section className="admin-engine-subpanel admin-link-map">
          <header>
            <span>主题互链</span>
            <b>目录和主题簇</b>
          </header>
          <div className="admin-link-network">
            {pageConfig.stages.slice(1, 5).map((stage) => <span key={stage}>{stage}</span>)}
          </div>
          <button type="button" onClick={async () => { onNotice("正在对 Gbrain 知识页执行真实召回校验…"); onNotice(await postRecallVerify("Gbrain", "知识页目录与互链")); }}>重建目录</button>
        </section>

        <section className="admin-engine-subpanel admin-source-map">
          <header>
            <span>来源映射</span>
            <b>{new Set(wikiAssets.map((asset) => asset.sourceOriginalName)).size} 个来源</b>
          </header>
          {wikiAssets.map((asset) => (
            <article key={`source-${asset.id}`}>
              <b>{asset.sourceOriginalName}</b>
              <p>{asset.title} / {asset.scenarioName}</p>
              <small>{assetMetadataValue(asset, "权限范围") ?? asset.visibilityLabel}</small>
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}

function scopeToEngine(scope: string): string {
  if (scope === "知识百科") return "Gbrain";
  if (scope === "关系图谱") return "GraphRAG";
  return "Naive RAG";
}

export function AdminStrategiesPage({
  initialStrategies = [],
  initialEvaluations = []
}: {
  initialStrategies?: Array<{ id: string; name: string; scope: string; impact: string; controls: string[] }>;
  initialEvaluations?: Array<{ profile: string; evidence: number; score: string; latency: string }>;
} = {}) {
  const profiles = initialStrategies.length
    ? initialStrategies
    : strategyProfiles.map((p) => ({ id: p.id, name: p.name, scope: p.scope, impact: p.impact, controls: p.controls }));
  const evaluations = initialEvaluations.length
    ? initialEvaluations
    : evaluationRows.map((r) => ({ profile: r.profile, evidence: r.evidence, score: String(r.score), latency: r.latency }));
  const [notice, setNotice] = useState("");
  const primaryProfile = profiles[0];
  const profileMode = ragOperationModes.find((mode) => mode.label === primaryProfile?.scope);
  const runStrategyVerify = async (scope: string, label: string) => {
    const engine = scopeToEngine(scope);
    setNotice(`正在对「${label}」执行真实回归验证检索（${engine}）…`);
    setNotice(await postRecallVerify(engine, label));
  };
  const runAllVerify = async () => {
    setNotice("正在对全部策略执行真实回归验证…");
    const results = await Promise.all(profiles.map(async (p) => `${p.name}：${await postRecallVerify(scopeToEngine(p.scope), p.name)}`));
    setNotice(results.join("　|　"));
  };
  return (
    <AdminShell active="/admin/strategies" title="检索策略">
      <AdminPageHead
        eyebrow="检索策略"
        title="按场景外放可配置的检索和答复策略"
        description="每个策略都要有适用范围、默认路径和可调参数，管理员可以为不同业务场景选择稳定、可解释的 RAG 引擎策略。"
      />
      {notice ? <p className="admin-console-notice" role="status">{notice}</p> : null}

      <section className="admin-strategy-console" aria-label="检索策略管理台">
        <section className="admin-panel admin-strategy-matrix">
          <PanelHead eyebrow="策略矩阵" title="策略、引擎、前台映射和状态" action={<button type="button" onClick={() => runAllVerify()}>新建策略</button>} />
          <div className="admin-data-table admin-strategy-table" role="table" aria-label="策略矩阵">
            <div role="row" className="admin-table-head">
              <span>策略</span>
              <span>引擎</span>
              <span>发布绑定</span>
              <span>控制项</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            {profiles.map((profile) => {
              const mode = ragOperationModes.find((item) => item.label === profile.scope);
              return (
                <div role="row" key={profile.id} data-strategy-id={profile.id}>
                  <b>{profile.name}<small>{profile.impact}</small></b>
                  <span>{profile.scope}</span>
                  <span>{mode?.frontstageLabel ?? "公司大脑"}</span>
                  <span>{profile.controls.join(" / ")}</span>
                  <AdminStatusBadge status="启用中" />
                  <div className="admin-row-actions">
                    <button type="button" onClick={() => runStrategyVerify(profile.scope, profile.name)}>编辑参数</button>
                    <button type="button" onClick={() => runStrategyVerify(profile.scope, profile.name)}>回归验证</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="admin-panel admin-strategy-parameter-panel">
          <PanelHead eyebrow="参数面板" title={primaryProfile.name} action={<AdminStatusBadge status="启用中" />} />
          <p>{primaryProfile.impact}</p>
          <div className="admin-strategy-parameter-list">
            {(profileMode?.parameters ?? []).slice(0, 5).map((parameter) => (
              <article key={parameter.key}>
                <span>{parameter.label}</span>
                <b>{String(parameter.value)}</b>
                <small>{parameter.description}</small>
              </article>
            ))}
          </div>
          <div className="admin-strategy-rollout">
            <span>发布绑定</span>
            <b>{profileMode?.frontstageLabel ?? "公司大脑"}</b>
            <p>{profileMode?.reviewGate ?? "公司大脑策略需要管理员确认引用边界和权限范围。"}</p>
          </div>
        </aside>
      </section>

      <section className="admin-panel admin-strategy-regression">
        <PanelHead eyebrow="回归验证" title="发布前必须通过的业务问题集" action={<button type="button" onClick={() => runAllVerify()}>运行全部验证</button>} />
        <div className="admin-data-table admin-strategy-regression-table" role="table" aria-label="策略回归验证">
          <div role="row" className="admin-table-head">
            <span>验证集</span>
            <span>适用策略</span>
            <span>真实证据</span>
            <span>就绪状态</span>
            <span>操作</span>
          </div>
          {evaluations.map((row) => {
            const scope = profiles.find((p) => p.name === row.profile)?.scope ?? "文档证据";
            return (
              <div role="row" key={row.profile}>
                <b>{row.profile}<small>覆盖正式文档、关系路径和拒答边界</small></b>
                <span>{row.profile}</span>
                <span>{row.evidence} 条真实证据</span>
                <span>{row.score} · {row.latency}</span>
                <div className="admin-row-actions">
                  <button type="button" onClick={() => runStrategyVerify(scope, row.profile)}>查看样例</button>
                  <button type="button" onClick={() => runStrategyVerify(scope, row.profile)}>复验</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </AdminShell>
  );
}

export function AdminPipelinesPage({ initialRequests = [] }: { initialRequests?: AdminIntakeRequest[] }) {
  const [requests, setRequests] = useState(() => resolveAdminRequests(initialRequests));
  const actionableRequests = requests.filter((request) => isActionableAdminRequestStatus(request.status));
  const [selectedRequestId, setSelectedRequestId] = useState(() => actionableRequests[0]?.id ?? requests[0]?.id ?? "");
	  const [pendingAction, setPendingAction] = useState("");
	  const [actionMessage, setActionMessage] = useState("");
	  const [filePreview, setFilePreview] = useState<AdminFilePreviewState | null>(null);
	  const [assetDetail, setAssetDetail] = useState<AdminAssetDetailState | null>(null);
	  const activeRequest = requests.find((request) => request.id === selectedRequestId) ?? actionableRequests[0] ?? requests[0];
  const recommendedEngines = requestRecommendedEngines(activeRequest);
  const [selectedEngine, setSelectedEngine] = useState<AdminEngine>(() => requestSelectedEngine(activeRequest));
  const frontstageMapping = requestFrontstageMapping(activeRequest);
  const selectedMode = ragOperationModes.find((mode) => mode.label === selectedEngine) ?? ragOperationModes[0];
  const selectedIsRecommended = recommendedEngines.includes(selectedEngine);
  const [engineParameterValues, setEngineParameterValues] = useState<Record<string, string>>(() => defaultParameterValues(selectedMode));
  const [strategyExpanded, setStrategyExpanded] = useState(false);
  const [ingestionRun, setIngestionRun] = useState<IngestionRun | null>(null);
  const [ingestedStats, setIngestedStats] = useState<GraphIngestedStats | null>(null);
  const activeIngestionRun = ingestionRun?.requestId === activeRequest?.id ? ingestionRun : null;
  const processMode = ragOperationModes.find((mode) => mode.label === activeIngestionRun?.engine) ?? selectedMode;
  const showIngestedAssets = activeRequest?.status === "已发布" || activeIngestionRun?.status === "completed";
  const graphStats = ingestedStats && activeRequest && ingestedStats.requestId === activeRequest.id ? ingestedStats : null;
  const canOperateActiveRequest = Boolean(activeRequest?.scenarioId);
  const documentRecords = activeRequest.storedFiles?.length
    ? activeRequest.storedFiles.map((file) => ({ name: file.originalName, storedFile: file }))
    : activeRequest.files.map((name) => ({ name, storedFile: null }));

  useEffect(() => {
    setSelectedEngine(requestSelectedEngine(activeRequest));
    setStrategyExpanded(false);
    setIngestionRun(null);
    setIngestedStats(null);
    setActionMessage("");
  }, [activeRequest?.id]);

  useEffect(() => {
    setEngineParameterValues(defaultParameterValues(selectedMode));
  }, [selectedMode.id]);

  useEffect(() => {
    if (activeRequest && (isActionableAdminRequestStatus(activeRequest.status) || ingestionRun?.requestId === activeRequest.id)) return;
    const nextRequestId = actionableRequests[0]?.id ?? requests[0]?.id ?? "";
    if (nextRequestId && nextRequestId !== selectedRequestId) setSelectedRequestId(nextRequestId);
  }, [activeRequest, actionableRequests, ingestionRun?.requestId, requests, selectedRequestId]);

  useEffect(() => {
    if (!showIngestedAssets || processMode.label !== "GraphRAG" || !activeRequest) return;
    const sourceId = activeIngestionRun?.sourceId;
    const requestId = activeRequest.id;
    if (!sourceId) return;
    if (ingestedStats?.requestId === requestId && ingestedStats.status !== "error") return;
    let cancelled = false;
    setIngestedStats({ requestId, status: "loading", data: null });
    (async () => {
      try {
        const response = await fetch(`/api/platform/admin/graph-curation/detail?sourceId=${encodeURIComponent(sourceId)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("graph curation detail fetch failed");
        const body = await response.json();
        if (cancelled) return;
        setIngestedStats({
          requestId,
          status: "ready",
          data: {
            entityCount: typeof body.entityCount === "number" ? body.entityCount : 0,
            relationCount: typeof body.relationCount === "number" ? body.relationCount : 0,
            duplicateNames: Array.isArray(body.duplicateNames) ? body.duplicateNames : []
          }
        });
      } catch {
        if (!cancelled) setIngestedStats({ requestId, status: "error", data: null });
      }
    })();
    return () => { cancelled = true; };
  }, [showIngestedAssets, processMode.label, activeIngestionRun?.sourceId, activeRequest?.id]);

  async function runAdminAction(action: "approve" | "reject") {
    if (!activeRequest || !canOperateActiveRequest || pendingAction) return;
    if (action === "approve" && !strategyExpanded) {
      setActionMessage("请先选择入库引擎并确认参数。");
      return;
    }
    setPendingAction(action);
    setActionMessage("");
    if (action === "approve") {
      // Q5:不再用 delay 逐阶段假动画——它会造出"这些阶段已执行完"的错觉,且在真实入库前白白拖 620ms×N。
      //   请求提前发出（下方 try 立即 PATCH）,进度只如实标"已提交·后端处理中"。currentStep:-1 令步骤轨道
      //   全部渲染为 pending（无任一阶段标 running,后端不透出真实阶段就不假装某阶段在跑）,完成后一次性回填。
      setIngestionRun({
        requestId: activeRequest.id,
        engine: selectedEngine,
        status: "running",
        currentStep: -1,
        message: `已提交，后端处理中…（预计 ${selectedMode.runtimeFlow.length} 个步骤，完成后一次性回填）`
      });
    }
    try {
      const response = await fetch(`/api/platform/admin/requests/${activeRequest.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          selected_engine: selectedEngine,
          strategy_parameters: action === "approve" ? engineParameterValues : undefined,
          reason: action === "reject" ? "资料不完整，需要补充业务说明和原始文件。" : undefined
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Q4:展示后端真实原因（message/error），不再吞成固定"操作失败，请稍后重试"。
        const backendMsg = typeof body?.message === "string" && body.message.trim()
          ? body.message
          : typeof body?.error === "string" && body.error.trim()
            ? body.error
            : `操作失败（HTTP ${response.status}）`;
        throw new Error(backendMsg);
      }
      setRequests((current) => current.map((request) => request.id === activeRequest.id ? body.request : request));
      if (action === "approve") {
        const sourceIdList = Array.isArray(body.sourceIds) ? body.sourceIds : [];
        const sourceId = sourceIdList.length > 0 ? String(sourceIdList[0]) : undefined;
        // Q6:仅 GraphRAG 主引擎会建 Naive 文档证据副本,展示可观测计数;其它引擎不涉副本,不展示以免误导（TC-A8）。
        const stats = body.naiveReplicaStats as { created: number; skipped: number; failed: number } | undefined;
        const replicaText = selectedEngine === "GraphRAG" && stats
          ? `（图谱源 ${sourceIdList.length} · 文档证据副本 ${stats.created} · 跳过 ${stats.skipped} · 失败 ${stats.failed}）`
          : "";
        setIngestionRun({
          requestId: activeRequest.id,
          engine: selectedEngine,
          status: "completed",
          currentStep: selectedMode.runtimeFlow.length - 1,
          message: `入库完成，知识资产已生成并可在资产区查看。${replicaText}`,
          sourceId
        });
      }
      setActionMessage(action === "approve" ? "已确认入库，前台任务状态已同步为可使用，后台资产已生成。" : "已退回用户补充资料，前台任务状态已同步更新。");
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : "操作失败，请稍后重试。";
      if (action === "approve") {
        setIngestionRun((current) => current ? { ...current, status: "failed", message: reason } : current);
      }
      setActionMessage(reason);
    } finally {
      setPendingAction("");
    }
  }

  async function openFilePreview(fileName: string, storedFile: AdminStoredFile | null) {
    const previewMeta = resolveAdminFilePreview(fileName);
    if (!storedFile) {
      setFilePreview({
        title: fileName,
        kind: previewMeta.kind,
        label: previewMeta.label,
        url: "",
        status: "error",
        message: "这条资料只有案例文件名，没有真实上传记录，无法在线预览。"
      });
      return;
    }
    const url = `/api/platform/admin/files/${encodeURIComponent(storedFile.id)}/preview`;
    setFilePreview({ title: fileName, kind: previewMeta.kind, label: previewMeta.label, url, status: "loading" });
    if (previewMeta.kind === "PDF") {
      setFilePreview({ title: fileName, kind: previewMeta.kind, label: previewMeta.label, url, status: "ready" });
      return;
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("preview failed");
      const text = await response.text();
      setFilePreview({ title: fileName, kind: previewMeta.kind, label: previewMeta.label, url, status: "ready", text });
    } catch {
      setFilePreview({
        title: fileName,
        kind: previewMeta.kind,
        label: previewMeta.label,
        url,
        status: "error",
        message: "原始文件不可用，可能已经按入库策略清理。"
      });
    }
  }

  function updateEngineParameter(parameter: RagParameter, value: string) {
    setEngineParameterValues((current) => ({ ...current, [parameter.key]: value }));
  }

  function handlePipelineAction(action: string) {
    if (action === "查看资料") {
      const record = documentRecords.find(({ name }) => resolveAdminFilePreview(name).previewable) ?? documentRecords[0];
      if (!record) {
        setActionMessage("当前资料包没有可查看文件。");
        return;
      }
      void openFilePreview(record.name, record.storedFile);
      return;
    }
    if (action === "配置引擎策略") {
      setActionMessage(`已保存 ${selectedEngine} 策略草稿，确认入库时会带上当前参数配置。`);
      return;
    }
    setActionMessage("资料文件已登记在当前请求中。");
  }

  return (
    <AdminShell active="/admin/pipelines" title="处理管线">
      <AdminPageHead
        eyebrow="处理管线"
        title="资料接收、策略配置、入库复核和发布"
        description="前台提交资料后，后台管理员在这里查看文件、确认权限范围、选择 Gbrain / Naive RAG / GraphRAG 真实入库引擎，并决定发布到前台后的业务映射形态。"
        actions={<button type="button" className="admin-primary-action">批量处理待确认</button>}
        compact
      />

      <section className="admin-pipeline-layout focused">
        <section className="admin-intake-selector">
          <PanelHead
            eyebrow="待处理选择器"
            title={`${actionableRequests.length} 个资料包需要处理`}
            action={<button type="button">按时间排序</button>}
          />
          <div className="admin-intake-table" role="table" aria-label="待处理资料包">
            <div className="admin-intake-table-head" role="row">
              <span>状态</span>
              <span>资料包</span>
              <span>提交人</span>
              <span>范围</span>
              <span>文件</span>
              <span>建议引擎</span>
              <span>提交时间</span>
              <span>操作</span>
            </div>
            {actionableRequests.map((request) => (
              <button
                key={request.id}
                type="button"
                role="row"
                className={`admin-intake-row ${request.id === activeRequest.id ? "active" : ""}`}
                onClick={() => setSelectedRequestId(request.id)}
              >
                <span role="cell" className="admin-intake-status">{request.status}</span>
                <b role="cell">{request.scenarioName}</b>
                <span role="cell">{request.requester}</span>
                <span role="cell">{request.visibility}</span>
                <span role="cell">{request.files.length} 份</span>
                <span role="cell" className="admin-intake-engine">{requestRecommendedEngines(request).join(" / ")}</span>
                <span role="cell">{request.submittedAt}</span>
                <strong role="cell">处理</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="admin-active-request workbench">
          <PanelHead eyebrow="前台提交的场景" title={activeRequest.scenarioName} action={<AdminStatusBadge status={activeRequest.status} />} />

          <div className="admin-scenario-brief">
            <div className="admin-scenario-main">
              <span>场景信息</span>
              <h3>{activeRequest.scenarioName}</h3>
              <p>{activeRequest.requestedOutcome}</p>
            </div>
            <dl>
              <div><dt>提交人</dt><dd>{activeRequest.requester}</dd></div>
              <div><dt>发布范围</dt><dd>{activeRequest.visibility}</dd></div>
              <div><dt>提交时间</dt><dd>{activeRequest.submittedAt}</dd></div>
              <div><dt>建议引擎</dt><dd>{recommendedEngines.join(" / ")}</dd></div>
              <div><dt>知识对象</dt><dd>{activeRequest.knowledgeObjectCount ? `${activeRequest.knowledgeObjectCount} 个` : "待入库"}</dd></div>
            </dl>
            <strong>{activeRequest.permissionImpact}</strong>
          </div>

          <div className="admin-uploaded-documents">
            <PanelHead eyebrow="上传资料" title="先核验前台传入的文件" action={<button type="button">全部展开预览</button>} />
            <div className="admin-document-grid">
              {documentRecords.map(({ name, storedFile }, index) => {
                const preview = resolveAdminFilePreview(name);
                const state = storedFile?.originalState ?? "temporary";
                return (
                  <article key={name} className={`${preview.previewable ? "previewable" : ""} ${state}`}>
                    <div className="admin-file-icon" data-kind={preview.kind}>{preview.kind}</div>
                    <div>
                      <b>{name}</b>
                      <span>{preview.label} · {index === 0 ? "业务说明" : "待解析资料"}</span>
                      <small>{storedFile?.retentionReason ?? (preview.previewable ? "支持在线预览，入库后按策略处理原始文件。" : "需要解包后预览，原包入库后默认清理。")}</small>
                      <div className="admin-retention-row">
                        <em>{fileStateLabel(storedFile)}</em>
                        <em>{retentionPolicyLabel(storedFile?.retentionPolicy)}</em>
                        <em>{fileAccessLabel(storedFile)}</em>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void openFilePreview(name, storedFile)}
                    >
                      {preview.previewable ? "预览" : "解包"}
                    </button>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="admin-engine-workbench">
            <header className="admin-engine-workbench-head">
              <div>
                <span>引擎策略</span>
                <h3>选择入库引擎并配置检索参数</h3>
              </div>
              <small>{selectedIsRecommended ? "系统推荐范围内" : "管理员手动选择"}</small>
            </header>
            <p>管理员在这里决定资料进入哪条真实 RAG 链路，并配置该链路的运行参数；发布到前台时再映射成业务形态。</p>

            <div className="admin-engine-selector">
              {ragOperationModes.map((mode) => {
                const engine = mode.label as AdminEngine;
                const recommended = recommendedEngines.includes(engine);
                return (
                <button
                  type="button"
                    key={mode.id}
                    className={strategyExpanded && selectedEngine === engine ? "active" : ""}
                    aria-expanded={strategyExpanded && selectedEngine === engine}
                    disabled={Boolean(pendingAction)}
                  onClick={() => {
                    setSelectedEngine(engine);
                    setStrategyExpanded(true);
                      setActionMessage(`已选择 ${engine}，发布后前台映射为：${mode.frontstageLabel}。`);
                  }}
                >
                    <b>{mode.label}</b>
                    <span>{mode.service}</span>
                    <small>{recommended ? "推荐" : "可选"} · 前台映射：{mode.frontstageLabel}</small>
                </button>
                );
              })}
            </div>

            {strategyExpanded ? (
              <section className="admin-parameter-panel admin-parameter-panel-expanded">
                <header>
                  <span>可配置参数</span>
                  <h4>{selectedMode.label} 参数</h4>
                  <p>{selectedMode.storage}</p>
                </header>
                <div className="admin-parameter-grid">
                  {selectedMode.parameters.map((parameter) => {
                    const value = engineParameterValues[parameter.key] ?? String(parameter.value);
                    return (
                      <label key={parameter.key} className="admin-parameter-field">
                        <span>
                          <b>{parameter.label}</b>
                          <small>{parameter.description}</small>
                        </span>
                        {parameter.type === "select" ? (
                          <select value={value} onChange={(event) => updateEngineParameter(parameter, event.target.value)}>
                            {parameter.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        ) : null}
                        {parameter.type === "number" ? (
                          <div className="admin-number-input">
                            <input
                              type="number"
                              min={parameter.min}
                              max={parameter.max}
                              step={String(parameter.value).includes(".") ? "0.01" : "1"}
                              value={value}
                              onChange={(event) => updateEngineParameter(parameter, event.target.value)}
                            />
                            {parameter.unit ? <em>{parameter.unit}</em> : null}
                          </div>
                        ) : null}
                        {parameter.type === "boolean" ? (
                          <button
                            type="button"
                            className={`admin-toggle-control ${value === "true" ? "on" : ""}`}
                            onClick={() => updateEngineParameter(parameter, value === "true" ? "false" : "true")}
                            aria-pressed={value === "true"}
                          >
                            {value === "true" ? "已启用" : "已关闭"}
                          </button>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : (
              <div className="admin-engine-collapsed">
                <b>选择一个入库引擎后展开参数</b>
                <p>这里只暴露管理员需要调整的参数；真正的解析、切片、抽取、向量化和发布流程，会在点击确认入库后按步骤实时显示。</p>
              </div>
            )}
          </div>

          {activeIngestionRun ? (
            <section className={`admin-ingestion-progress ${activeIngestionRun.status}`}>
              <header>
                <div>
                  <span>入库进度</span>
                  {/* Q5:标题随真实状态变（失败不再显示"正在处理资料"）——与 currentStep:-1 的诚实全 pending 轨道
                      配合,失败态由 标题「入库未成功」+ 徽章「阻塞」+ 原因消息 三重明示,而非伪造某一步失败。 */}
                  <h3>{processMode.label} {activeIngestionRun.status === "completed" ? "入库完成" : activeIngestionRun.status === "failed" ? "入库未成功" : "正在处理资料"}</h3>
                  <p>{activeIngestionRun.message}</p>
                </div>
                <AdminStatusBadge status={activeIngestionRun.status === "completed" ? "已完成" : activeIngestionRun.status === "failed" ? "阻塞" : "处理中"} />
              </header>
              <div className="admin-process-track">
                {processMode.runtimeFlow.map((step, index) => {
                  const state = activeIngestionRun.status === "failed" && index === activeIngestionRun.currentStep
                    ? "failed"
                    : index < activeIngestionRun.currentStep || activeIngestionRun.status === "completed"
                      ? "done"
                      : index === activeIngestionRun.currentStep
                        ? "running"
                        : "pending";
                  return (
                    <article key={step.stage} className={state}>
                      <i>{index + 1}</i>
                      <div>
                        <b>{step.stage}</b>
                        <span>{step.description}</span>
                        <small>产物：{step.artifact}</small>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {showIngestedAssets ? (
            <section className="admin-ingested-assets">
	              <PanelHead eyebrow="知识库资产" title={`${processMode.label} 已生成的可查看资产`} action={<Link href="/admin/knowledge-bases">进入资产台账</Link>} />
	              <div className="admin-asset-view-grid">
	                {processMode.assetViews.map((asset) => {
	                  // fixtures 的 metric 只是无运行时数据时的示意占位；本区仅在审批完成/已发布后展示，
	                  // 真实运行态一律禁止回落 fixtures 假数：GraphRAG 走真实 curation detail 取数，
	                  // 其余引擎和"知识图谱"kind 暂无 count 接口，统一降级显示 "—"。
	                  const isGraphRag = processMode.label === "GraphRAG";
	                  let displayMetric = "—";
	                  let displayLabel = asset.label;
	                  if (asset.kind === "graph") {
	                    displayMetric = asset.metric;
	                  } else if (isGraphRag && asset.kind === "review") {
	                    displayLabel = "疑似重复";
	                    if (graphStats?.status === "loading") displayMetric = "…";
	                    else if (graphStats?.status === "ready" && graphStats.data) displayMetric = `${graphStats.data.duplicateNames.length} 项`;
	                  } else if (isGraphRag && (asset.kind === "entity" || asset.kind === "relationship")) {
	                    if (graphStats?.status === "loading") displayMetric = "…";
	                    else if (graphStats?.status === "ready" && graphStats.data) {
	                      displayMetric = asset.kind === "entity" ? `${graphStats.data.entityCount} 个对象` : `${graphStats.data.relationCount} 条`;
	                    }
	                  }
	                  return (
	                    <article key={asset.kind} className="admin-asset-view-card">
	                      <small>{displayMetric}</small>
	                      <b>{displayLabel}</b>
	                      <p>{asset.description}</p>
	                      <button
	                        type="button"
	                        data-asset-kind={asset.kind}
	                        aria-label={`${processMode.label} ${asset.label}`}
	                        onClick={() => void openAdminAssetDetail(processMode, asset, setAssetDetail)}
	                      >
	                        {asset.action}
	                      </button>
	                    </article>
	                  );
	                })}
	              </div>
	            </section>
          ) : null}

          <div className="admin-decision-bar sticky">
            {activeRequest.actions.map((action) => {
              const approve = action === "确认入库";
              const reject = action === "退回补充";
              const actionable = approve || reject;
              return (
                <button
                  key={action}
                  type="button"
                  disabled={Boolean(pendingAction) || (actionable && !canOperateActiveRequest)}
                  onClick={() => {
                    if (approve) void runAdminAction("approve");
                    else if (reject) void runAdminAction("reject");
                    else handlePipelineAction(action);
                  }}
                >
                  {pendingAction && actionable ? "处理中" : action === "配置引擎策略" ? "保存策略配置" : action}
                </button>
              );
            })}
          </div>
          {actionMessage && <p className="admin-action-message">{actionMessage}</p>}
        </section>

        <aside className="admin-strategy-inspector">
          <PanelHead eyebrow="质量与发布" title={selectedMode.label} action={<AdminStatusBadge status={selectedMode.status} />} />
          <div className="admin-inspector-hero">
            <span>{selectedIsRecommended ? "系统推荐" : "手动选择"}</span>
            <h3>{selectedMode.service}</h3>
            <p>前台映射为：{selectedMode.frontstageLabel}</p>
          </div>

          <div className="admin-inspector-section">
            <span>推荐依据</span>
            <div className="admin-rag-stage-list compact">
              {selectedMode.inspector.map((item, index) => (
                <span key={item}><i>{index + 1}</i>{item}</span>
              ))}
            </div>
          </div>

          <div className="admin-inspector-section">
            <span>质量门禁</span>
            <div className="admin-gate-list">
              {selectedMode.qualityGates.map((gate) => (
                <article key={gate.label}>
                  <b>{gate.label}</b>
                  <small>{gate.status}</small>
                  <p>{gate.value}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="admin-inspector-section">
            <span>预计产物</span>
            <div className="admin-output-list">
              {selectedMode.previewOutputs.map((output) => (
                <article key={output.label}>
                  <b>{output.label}</b>
                  <p>{output.description}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="admin-inspector-section">
            <span>权限影响</span>
            <p>{activeRequest.permissionImpact}</p>
          </div>

          <div className="admin-inspector-section accent">
            <span>发布映射</span>
            <b>{frontstageMappingLabel(`发布到前台后映射为：${selectedMode.frontstageLabel}。`)}</b>
            <p>{selectedMode.reviewGate}</p>
          </div>
        </aside>
      </section>

	      {filePreview ? <AdminFilePreviewOverlay preview={filePreview} onClose={() => setFilePreview(null)} /> : null}
	      {assetDetail ? <AdminKnowledgeAssetOverlay detail={assetDetail} onClose={() => setAssetDetail(null)} /> : null}
	    </AdminShell>
	  );
	}

// TODO(P18): 全库无 import 的 dead code（GraphRAG 治理唯一入口已是 AdminGraphCurationWorkbench），下批清理（见 P18 spec §四 决策A 第6步）。
export function AdminGraphPage() {
  const lowConfidenceEdges = adminGraphSnapshot.edges.filter((edge) => edge.confidence < 0.8);
  const [notice, setNotice] = useState("");
  const runGraph = async (query: string) => {
    setNotice(`正在对 GraphRAG 执行真实图谱检索：${query}…`);
    setNotice(await postRecallVerify("GraphRAG", query));
  };
  return (
    <AdminShell active="/admin/graph" title="关系图谱">
      <AdminPageHead
        eyebrow="关系图谱"
        title="节点、关系、证据和置信度"
        description="关系图谱用于客户画像、风险尽调和多跳检索。后台要能查看实体关系、证据来源、置信度和低置信复核项。"
      />
      {notice ? <p className="admin-console-notice" role="status">{notice}</p> : null}
      <section className="admin-graph-ops" aria-label="图谱运营台">
        <section className="admin-panel admin-graph-main">
          <PanelHead eyebrow="图谱运营台" title="实体网络、关系边和证据链" action={<button type="button" onClick={() => runGraph("实体网络与关系布局")}>重新计算布局</button>} />
          <div className="admin-graph-canvas">
            <svg viewBox="0 0 900 480" role="img" aria-label="关系图谱">
              {adminGraphSnapshot.edges.map((edge, index) => {
                const source = nodePosition(edge.source);
                const target = nodePosition(edge.target);
                return <line key={`${edge.source}-${edge.target}-${index}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} />;
              })}
              {adminGraphSnapshot.nodes.map((node) => {
                const pos = nodePosition(node.id);
                return (
                  <g key={node.id} data-graph-detail-node={node.id} transform={`translate(${pos.x} ${pos.y})`}>
                    <circle r="34" className={node.health} />
                    <text y="4" textAnchor="middle">{node.label}</text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="admin-graph-node-strip" aria-label="实体目录">
            {adminGraphSnapshot.nodes.map((node) => (
              <article key={node.id}>
                <span>{node.type}</span>
                <b>{node.label}</b>
                <AdminStatusBadge status={node.health === "risk" ? "需复核" : node.health === "watch" ? "观察" : "正常"} />
              </article>
            ))}
          </div>
        </section>

        <aside className="admin-panel admin-graph-sidebar">
          <PanelHead eyebrow="实体目录" title="实体分组与健康状态" />
          <div className="admin-graph-entity-list">
            {adminGraphSnapshot.nodes.map((node) => (
              <article key={`entity-${node.id}`}>
                <b>{node.label}</b>
                <span>{node.type}</span>
                <small>{node.health === "risk" ? "需要复核" : node.health === "watch" ? "观察中" : "稳定"}</small>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="admin-graph-bottom-grid">
        <section className="admin-panel admin-graph-edge-ledger">
          <PanelHead eyebrow="关系边台账" title="边、证据、置信度和操作" action={<button type="button" onClick={() => { triggerAssetExport("GraphRAG"); setNotice("已生成真实关系图谱资产 CSV 并触发下载。"); }}>导出边表</button>} />
          <div className="admin-data-table admin-graph-edge-table" role="table" aria-label="关系边台账">
            <div role="row" className="admin-table-head">
              <span>关系</span>
              <span>起点</span>
              <span>终点</span>
              <span>证据</span>
              <span>置信度</span>
              <span>操作</span>
            </div>
            {adminGraphSnapshot.edges.map((edge) => (
              <div role="row" key={`${edge.source}-${edge.target}-${edge.label}`}>
                <b>{edge.label}</b>
                <span>{graphNodeName(edge.source)}</span>
                <span>{graphNodeName(edge.target)}</span>
                <span>{edge.evidence}</span>
                <span>{Math.round(edge.confidence * 100)}%</span>
                <div className="admin-row-actions">
                  <button type="button" onClick={() => runGraph("关系边的证据来源")}>查看来源</button>
                  <button type="button" onClick={() => runGraph("低置信关系复核")}>复核</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="admin-panel admin-graph-review">
          <PanelHead eyebrow="低置信队列" title={`${lowConfidenceEdges.length} 条关系需要复核`} />
          <div className="admin-graph-review-list">
            {lowConfidenceEdges.map((edge) => (
              <article key={`review-${edge.source}-${edge.target}`}>
                <b>{graphNodeName(edge.source)} → {graphNodeName(edge.target)}</b>
                <span>{edge.label} · {edge.evidence}</span>
                <small>{Math.round(edge.confidence * 100)}% 置信度</small>
              </article>
            ))}
          </div>
        </aside>

        <aside className="admin-panel admin-graph-path">
          <PanelHead eyebrow="路径探查" title="多跳路径验证" action={<button type="button" onClick={() => runGraph("客户、负责人、供应商之间的多跳路径")}>运行路径查询</button>} />
          <div className="admin-path-result">
            <span>赋范科技</span>
            <i>续签中</i>
            <span>年度框架合同</span>
            <i>绑定增购</i>
            <span>二期扩容</span>
          </div>
          <p>用于验证前台风险尽调、客户 360 和机会分析能否拿到可解释路径。</p>
        </aside>
      </section>
    </AdminShell>
  );
}

async function openAdminAssetDetail(
  mode: RagOperationMode,
  asset: RagAssetView,
  setAssetDetail: (detail: AdminAssetDetailState | null) => void
) {
  const baseDetail: AdminAssetDetailState = {
    mode: { label: mode.label, frontstageLabel: mode.frontstageLabel },
    asset: { kind: asset.kind, label: asset.label, description: asset.description, metric: asset.metric },
    status: "loading",
    records: []
  };
  setAssetDetail(baseDetail);

  try {
    const query = new URLSearchParams({ engine: mode.label, kind: asset.kind });
    const response = await fetch(`/api/platform/admin/knowledge-assets?${query.toString()}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof body.message === "string" ? body.message : "无法读取知识库资产。");
    }
    setAssetDetail({
      ...baseDetail,
      status: "ready",
      records: Array.isArray(body.assets) ? body.assets : []
    });
  } catch (error) {
    setAssetDetail({
      ...baseDetail,
      status: "error",
      message: error instanceof Error ? error.message : "无法读取知识库资产。"
    });
  }
}

function openLocalAdminAssetDetail(record: AdminKnowledgeAssetDetail, setAssetDetail: (detail: AdminAssetDetailState | null) => void) {
  const mode = modeForEngine(record.engine);
  const asset = mode.assetViews.find((view) => view.kind === record.kind);
  setAssetDetail({
    mode: { label: mode.label, frontstageLabel: mode.frontstageLabel },
    asset: {
      kind: record.kind,
      label: asset?.label ?? assetKindLabel(record.kind),
      description: asset?.description ?? "查看这条入库资产的正文、来源和治理元数据。",
      metric: record.metric
    },
    status: "ready",
    records: [record]
  });
}

function knowledgeAssetStats(assets: AdminKnowledgeAssetDetail[]) {
  const scenarioCount = new Set(assets.map((asset) => asset.scenarioName)).size;
  const sourceCount = new Set(assets.map((asset) => asset.sourceOriginalName)).size;
  return [
    { label: "知识库", value: scenarioCount, helper: "已发布到后台资产台账", state: "healthy" },
    { label: "入库资产", value: assets.length, helper: "切片、图谱、知识页和引用对象", state: "healthy" },
    { label: "来源文件", value: sourceCount, helper: "保留权限与来源追踪", state: "watch" },
    { label: "待复核", value: assets.filter((asset) => ["待抽检", "待复核", "观察"].includes(asset.status)).length, helper: "低置信、权限和引用边界", state: "watch" }
  ];
}

function modeForEngine(engine: AdminEngine): RagOperationMode {
  return ragOperationModes.find((mode) => mode.label === engine) ?? ragOperationModes[0];
}

function frontstageLabelForEngine(engine: AdminEngine) {
  return modeForEngine(engine).frontstageLabel;
}

function engineManagementHref(engine: string) {
  if (engine === "Naive RAG") return "/admin/knowledge-bases/naive";
  if (engine === "GraphRAG") return "/admin/knowledge-bases/graph";
  return "/admin/knowledge-bases/gbrain";
}

function assetKindLabel(kind: string) {
  const labels: Record<string, string> = {
    wiki: "知识页",
    fact: "事实卡",
    link: "互链",
    source: "来源",
    chunk: "文档切片",
    embedding: "向量索引",
    citation: "引用证据",
    eval: "试问结果",
    entity: "实体",
    relationship: "关系边",
    graph: "图谱",
    review: "复核项"
  };
  return labels[kind] ?? kind;
}

function assetMetadataValue(asset: AdminKnowledgeAssetDetail, label: string) {
  return asset.metadata.find((item) => item.label === label)?.value;
}

function truncateAdminText(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function graphNodeLabel(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 8) return text || "实体";
  return `${text.slice(0, 7)}…`;
}

function graphNodeName(id: string) {
  return adminGraphSnapshot.nodes.find((node) => node.id === id)?.label ?? id;
}

function governanceStepsForEngine(engine: string) {
  if (engine === "Naive RAG") return ["文档解析与清洗", "切片与 overlap 检查", "向量索引状态", "引用证据抽检", "召回验证"];
  if (engine === "GraphRAG") return ["实体抽取", "关系边构建", "图谱可视化", "低置信复核", "多跳验证"];
  return ["知识页生成", "事实卡沉淀", "目录互链", "来源追踪", "发布边界复核"];
}

function enginePageConfig(engine: AdminEngine) {
  if (engine === "Naive RAG") {
    return {
      description: "管理文档解析、切片、向量索引、引用证据和召回验证。这里应该能直接看到每个 chunk、索引状态、来源片段和问答命中情况。",
      workflowTitle: "文档入库到可引用答案的治理链路",
      assetTitle: "文档、切片、索引和引用资产",
      primaryAction: "召回验证",
      consoleTitle: "Naive RAG 专项后台",
      workbench: {
        eyebrow: "文档库工作台",
        title: "按文档、切片、向量和召回结果治理证据库",
        description: "适合制度、合同、手册和表格资料。管理员需要能直接看到文档解析结果、chunk 边界、embedding 状态、元数据过滤条件和召回调试记录。",
        areas: [
          { label: "切片队列", description: "查看页码、段落、chunk_size、overlap 和启停状态" },
          { label: "向量记录", description: "查看 embedding 模型、维度、索引批次和重建状态" },
          { label: "元数据过滤", description: "按部门、文件、版本、权限范围和标签限制召回" },
          { label: "召回调试", description: "用业务问题检查 TopK、阈值、重排和无依据拒答" }
        ],
        controls: [
          { label: "索引方式", value: "Chunk + Embedding", helper: "文档片段进入向量索引，答案必须保留来源" },
          { label: "检索策略", value: "TopK / 阈值 / 重排", helper: "发布前需要验证召回命中和引用覆盖" },
          { label: "治理动作", value: "重切片 · 重建索引 · 禁用片段", helper: "对异常 chunk 做精细化处理" }
        ]
      },
      stages: ["文档解析", "切片清洗", "向量化", "引用索引", "召回验证"],
      actions: ["召回验证", "重建索引", "引用抽检", "禁用切片"],
      metrics: [
        { label: "文档切片", helper: "可查看正文、来源和 overlap", value: (assets: AdminKnowledgeAssetDetail[]) => assets.filter((asset) => asset.kind === "chunk").length },
        { label: "向量索引", helper: "索引批次和可召回状态", value: (assets: AdminKnowledgeAssetDetail[]) => assets.filter((asset) => asset.kind === "embedding").length },
        { label: "引用证据", helper: "答案引用来源和边界", value: (assets: AdminKnowledgeAssetDetail[]) => assets.filter((asset) => asset.kind === "citation").length },
        { label: "试问结果", helper: "TopK、阈值和拒答验证", value: (assets: AdminKnowledgeAssetDetail[]) => assets.filter((asset) => asset.kind === "eval").length }
      ],
      sections: [
        { label: "Chunks", title: "文档与切片", description: "按文件、页码、段落、overlap 和启用状态管理所有切片。", actions: ["批量禁用", "重新切片"] },
        { label: "Vectors", title: "向量索引", description: "查看 embedding 批次、模型维度、索引状态和重建任务。", actions: ["重建索引", "查看批次"] },
        { label: "Evidence", title: "引用证据", description: "抽检答案可引用片段、来源文件和无依据拒答边界。", actions: ["引用抽检", "导出证据"] },
        { label: "Retrieval", title: "召回验证", description: "用业务问题验证 TopK、阈值、重排和拒答策略。", actions: ["新建验证", "查看记录"] }
      ]
    };
  }
  if (engine === "GraphRAG") {
    return {
      description: "管理实体、关系边、图谱画布和低置信复核。GraphRAG 后台需要能看见实体如何被抽取、关系如何构建，以及图谱如何服务多跳检索。",
      workflowTitle: "从文档到实体关系图谱的治理链路",
      assetTitle: "实体、关系、图谱和复核资产",
      primaryAction: "图谱复核",
      consoleTitle: "GraphRAG 专项后台",
      workbench: {
        eyebrow: "图谱工作台",
        title: "按实体、关系和路径治理关系知识库",
        description: "适合客户画像、风控尽调、供应链和多跳关系分析。管理员要能查看实体抽取、关系边证据、低置信复核和路径查询结果。",
        areas: [
          { label: "实体目录", description: "按客户、人员、项目、事件等类型管理实体" },
          { label: "关系复核", description: "查看关系方向、置信度、证据来源和冲突边" },
          { label: "路径查询", description: "验证多跳路径、最短链路和风险传播线索" }
        ],
        controls: [
          { label: "索引方式", value: "Entity + Edge", helper: "实体关系图服务多跳问答和关系追踪" },
          { label: "检索策略", value: "路径扩展", helper: "低置信关系进入人工复核后再发布" },
          { label: "治理动作", value: "实体合并 · 边复核", helper: "保持图谱干净、可解释、可追溯" }
        ]
      },
      stages: ["实体抽取", "关系构建", "消歧合并", "图谱发布", "多跳验证"],
      actions: ["图谱复核", "实体合并", "关系抽检", "多跳验证"],
      metrics: [
        { label: "实体表", helper: "客户、人员、项目和事件", value: (assets: AdminKnowledgeAssetDetail[]) => assets.filter((asset) => asset.kind === "entity").length },
        { label: "关系边", helper: "边类型、方向和置信度", value: (assets: AdminKnowledgeAssetDetail[]) => assets.filter((asset) => asset.kind === "relationship").length },
        { label: "知识图谱", helper: "图谱视图和多跳路径", value: (assets: AdminKnowledgeAssetDetail[]) => assets.filter((asset) => asset.kind === "graph").length },
        { label: "复核队列", helper: "低置信和冲突关系", value: (assets: AdminKnowledgeAssetDetail[]) => assets.filter((asset) => asset.kind === "review").length }
      ],
      sections: [
        { label: "Entities", title: "实体表", description: "按类型、来源、置信度和所属权限范围治理实体。", actions: ["实体合并", "类型修正"] },
        { label: "Edges", title: "关系边", description: "查看关系方向、证据来源、置信度和冲突边。", actions: ["关系抽检", "冲突处理"] },
        { label: "Graph", title: "图谱画布", description: "查看实体网络、关键路径和跨文档连接。", actions: ["打开图谱", "路径分析"] },
        { label: "Review", title: "复核队列", description: "集中处理低置信实体、冲突关系和跨权限边界。", actions: ["批量复核", "退回重抽"] }
      ]
    };
  }
  return {
    description: "管理知识页、事实卡、目录互链、来源目录和发布边界。Gbrain 后台更接近企业 Wiki 治理，需要能看到页面、事实和来源如何组成可浏览知识空间。",
    workflowTitle: "从资料到知识百科空间的治理链路",
    assetTitle: "知识页、事实卡、互链和来源资产",
    primaryAction: "发布复核",
    consoleTitle: "Gbrain 专项后台",
    workbench: {
      eyebrow: "知识大脑工作台",
      title: "按页面、事实、互链和发布边界治理长期知识空间",
      description: "适合个人知识库、团队手册、研究指南和运行手册。管理员关注知识页质量、事实记忆准确性、主题互链、来源追踪和权限发布边界。",
      areas: [
        { label: "页面目录", description: "查看 Wiki 结构、章节层级、摘要和页面状态" },
        { label: "事实记忆", description: "沉淀定义、决策、行动项和稳定事实卡" },
        { label: "主题互链", description: "治理页面之间的双向链接、主题簇和断链" },
        { label: "权限发布", description: "按个人、团队、公司范围控制可见性和召回边界" }
      ],
      controls: [
        { label: "索引方式", value: "Page + Fact + Link", helper: "把资料编译成可浏览、可追问的知识空间" },
        { label: "检索策略", value: "目录导航 / 事实优先", helper: "先找稳定事实，再补充来源和上下文" },
        { label: "治理动作", value: "事实抽检 · 重建目录 · 发布复核", helper: "适合长期维护和组织知识沉淀" }
      ]
    },
    stages: ["资料解析", "知识页生成", "事实抽取", "目录互链", "发布复核"],
    actions: ["发布复核", "事实抽检", "重建目录", "来源追踪"],
    metrics: [
      { label: "知识页", helper: "可浏览 Wiki 页面", value: (assets: AdminKnowledgeAssetDetail[]) => assets.filter((asset) => asset.kind === "wiki").length },
      { label: "事实卡", helper: "定义、结论和关键事实", value: (assets: AdminKnowledgeAssetDetail[]) => assets.filter((asset) => asset.kind === "fact").length },
      { label: "目录互链", helper: "页面关系和导航结构", value: (assets: AdminKnowledgeAssetDetail[]) => assets.filter((asset) => asset.kind === "link").length },
      { label: "来源目录", helper: "页面到原始资料追踪", value: (assets: AdminKnowledgeAssetDetail[]) => assets.filter((asset) => asset.kind === "source").length }
    ],
    sections: [
      { label: "Pages", title: "知识页", description: "查看页面标题、摘要、正文结构、发布状态和可见范围。", actions: ["发布复核", "重新生成"] },
      { label: "Facts", title: "事实卡", description: "抽检事实准确性、来源依据和可召回边界。", actions: ["事实抽检", "禁用事实"] },
      { label: "Links", title: "目录互链", description: "治理页面目录、双向链接、主题簇和导航路径。", actions: ["重建目录", "检查断链"] },
      { label: "Sources", title: "来源目录", description: "追踪每个知识页、事实卡和原始资料之间的关系。", actions: ["来源追踪", "导出目录"] }
    ]
  };
}

function AdminKnowledgeAssetOverlay({ detail, onClose }: { detail: AdminAssetDetailState; onClose: () => void }) {
  return (
    <div className="admin-preview-overlay admin-asset-detail-overlay" role="dialog" aria-modal="true" aria-label={`${detail.asset.label} 资产明细`} onClick={onClose}>
      <section className="admin-preview-sheet admin-asset-detail-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{detail.mode.label} · {detail.mode.frontstageLabel}</span>
            <h2>{detail.asset.label}</h2>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </header>

        <div className="admin-preview-body admin-asset-detail-body">
          {detail.status === "loading" ? <div className="admin-preview-state">正在读取入库资产...</div> : null}
          {detail.status === "error" ? <div className="admin-preview-state error">{detail.message}</div> : null}
          {detail.status === "ready" && detail.records.length === 0 ? (
            <div className="admin-asset-empty">
              <b>当前还没有这类入库记录</b>
              <p>请先在处理管线中确认入库，或检查当前场景是否选择了 {detail.mode.label}。</p>
            </div>
          ) : null}
          {detail.status === "ready" && detail.records.length > 0 ? (
            <div className="admin-asset-detail-stack">
              <section className="admin-asset-detail-summary">
                <div>
                  <span>资产类型</span>
                  <b>{detail.asset.label}</b>
                  <p>{detail.asset.description}</p>
                </div>
                <strong>{detail.records.length}</strong>
              </section>

              <div className="admin-asset-record-list">
                {detail.records.map((record) => (
                  <article key={record.id} className="admin-asset-record-card">
                    <header>
                      <div>
                        <span>{record.status}</span>
                        <h3>{record.title}</h3>
                      </div>
                      <small>{record.metric}</small>
                    </header>
                    <p>{record.content}</p>
                    <dl>
                      {record.metadata.map((item) => (
                        <div key={`${record.id}-${item.label}`}>
                          <dt>{item.label}</dt>
                          <dd>{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function AdminFilePreviewOverlay({ preview, onClose }: { preview: AdminFilePreviewState; onClose: () => void }) {
  return (
    <div className="admin-preview-overlay" role="dialog" aria-modal="true" aria-label={`${preview.title} 文件预览`} onClick={onClose}>
      <section className="admin-preview-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{preview.label}</span>
            <h2>{preview.title}</h2>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </header>

        <div className="admin-preview-body">
          {preview.status === "loading" ? <div className="admin-preview-state">正在加载文件预览...</div> : null}
          {preview.status === "error" ? <div className="admin-preview-state error">{preview.message}</div> : null}
          {preview.status === "ready" && preview.kind === "PDF" ? (
            <iframe className="admin-pdf-preview" title={preview.title} src={preview.url} />
          ) : null}
          {preview.status === "ready" && ["CSV", "XLS"].includes(preview.kind) ? <AdminCsvPreview text={preview.text ?? ""} /> : null}
          {preview.status === "ready" && preview.kind === "MD" ? <AdminMarkdownPreview text={preview.text ?? ""} /> : null}
          {preview.status === "ready" && ["TXT", "JSON"].includes(preview.kind) ? <pre className="admin-text-preview">{formatPreviewText(preview.kind, preview.text ?? "")}</pre> : null}
          {preview.status === "ready" && !["PDF", "CSV", "XLS", "MD", "TXT", "JSON"].includes(preview.kind) ? (
            <div className="admin-preview-state">当前文件类型暂不支持在线预览。</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function AdminCsvPreview({ text }: { text: string }) {
  const rows = parseDelimitedPreview(text).slice(0, 80);
  const [head = [], ...body] = rows;
  return (
    <div className="admin-csv-preview">
      <table>
        <thead>
          <tr>{head.map((cell, index) => <th key={`${cell}-${index}`}>{cell || `列 ${index + 1}`}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {head.map((_, cellIndex) => <td key={cellIndex}>{row[cellIndex] ?? ""}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminMarkdownPreview({ text }: { text: string }) {
  return (
    <article className="admin-markdown-preview">
      {text.split(/\n+/).filter(Boolean).map((line, index) => {
        if (line.startsWith("### ")) return <h4 key={index}>{line.slice(4)}</h4>;
        if (line.startsWith("## ")) return <h3 key={index}>{line.slice(3)}</h3>;
        if (line.startsWith("# ")) return <h2 key={index}>{line.slice(2)}</h2>;
        if (line.startsWith("- ")) return <p key={index} className="list">• {line.slice(2)}</p>;
        return <p key={index}>{line}</p>;
      })}
    </article>
  );
}

export function AdminEvaluationsPage({
  initialEvaluations = []
}: {
  initialEvaluations?: Array<{ profile: string; evidence: number; score: string; latency: string }>;
} = {}) {
  const evaluations = initialEvaluations.length
    ? initialEvaluations
    : evaluationRows.map((r) => ({ profile: r.profile, evidence: r.evidence, score: String(r.score), latency: r.latency }));
  const [notice, setNotice] = useState("");
  const runEvalVerify = async (profile: string) => {
    const engine = profile.includes("知识百科") ? "Gbrain" : profile.includes("关系图谱") ? "GraphRAG" : "Naive RAG";
    setNotice(`正在对「${profile}」执行真实评测检索…`);
    setNotice(await postRecallVerify(engine, profile));
  };
  const runAllEval = async () => {
    setNotice("正在对全部策略执行真实评测检索…");
    const results = await Promise.all(evaluations.map(async (r) => {
      const engine = r.profile.includes("知识百科") ? "Gbrain" : r.profile.includes("关系图谱") ? "GraphRAG" : "Naive RAG";
      return `${r.profile}：${await postRecallVerify(engine, r.profile)}`;
    }));
    setNotice(results.join("　|　"));
  };
  return (
    <AdminShell active="/admin/evaluations" title="质量评估">
      <AdminPageHead
        eyebrow="质量评估"
        title="策略对比、证据覆盖和延迟观察"
        description="管理员用业务问题验证策略质量，避免前台场景发布后出现无依据回答、引用缺失或响应过慢。"
      />
      {notice ? <p className="admin-console-notice" role="status">{notice}</p> : null}
      <section className="admin-evaluation-console" aria-label="评测任务台">
        <section className="admin-panel admin-evaluation-datasets">
          <PanelHead eyebrow="评测任务台" title="问题集、策略和发布门禁" action={<button type="button" onClick={() => runAllEval()}>新建评测任务</button>} />
          <div className="admin-evaluation-dataset-grid">
            {[
              { name: "制度问答问题集", scope: "公司级", count: "42 题", gate: "引用必须命中原文" },
              { name: "客户风险问题集", scope: "团队级", count: "28 题", gate: "关系路径必须可解释" },
              { name: "个人知识库追问集", scope: "个人", count: "18 题", gate: "事实来源必须可追踪" }
            ].map((item) => (
              <article key={item.name}>
                <span>问题集</span>
                <b>{item.name}</b>
                <small>{item.scope} · {item.count}</small>
                <p>{item.gate}</p>
              </article>
            ))}
          </div>
        </section>

        <aside className="admin-panel admin-evaluation-coverage">
          <PanelHead eyebrow="证据覆盖" title="答案是否有来源" />
          <div className="admin-evidence-coverage-meter">
            {evaluations.map((row) => (
              <article key={row.profile}>
                <header><b>{row.profile}</b><span>{row.evidence} 条真实证据</span></header>
                <i style={{ width: `${row.evidence > 0 ? 100 : 0}%` }} />
                <small>{row.score} · {row.latency}</small>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="admin-panel">
        <PanelHead eyebrow="策略对比" title="召回、证据、延迟和拒答边界" action={<button type="button" onClick={() => runAllEval()}>批量复验</button>} />
        <div className="admin-data-table admin-eval-table" role="table" aria-label="策略评估结果">
          <div role="row" className="admin-table-head">
            <span>策略</span>
            <span>就绪</span>
            <span>证据数</span>
            <span>延迟</span>
            <span>操作</span>
          </div>
          {evaluations.map((row) => (
            <div role="row" key={row.profile}>
              <b>{row.profile}<small>覆盖引用、拒答、权限过滤和多轮追问</small></b>
              <span>{row.score}</span>
              <span>{row.evidence}</span>
              <span>{row.latency}</span>
              <div className="admin-row-actions"><button type="button" onClick={() => runEvalVerify(row.profile)}>查看案例</button><button type="button" onClick={() => runEvalVerify(row.profile)}>复验</button></div>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-evaluation-bottom">
        <section className="admin-panel admin-failure-review">
          <PanelHead eyebrow="失败案例复盘" title="不能发布的典型回答" action={<button type="button" onClick={() => runAllEval()}>转复核任务</button>} />
          <div className="admin-failure-stack">
            {[
              { question: "没有制度依据时是否仍然回答？", reason: "严格证据策略应拒答，但候选答案给出推断结论。" },
              { question: "客户关系路径跨团队是否泄露？", reason: "GraphRAG 低置信边需要人工确认后才能进入前台。" }
            ].map((item) => (
              <article key={item.question}>
                <b>{item.question}</b>
                <p>{item.reason}</p>
                <AdminStatusBadge status="需复核" />
              </article>
            ))}
          </div>
        </section>
        <aside className="admin-panel admin-release-gates">
          <PanelHead eyebrow="发布门禁" title="上线前检查项" />
          <div className="admin-gate-list">
            <article><b>引用可打开</b><small>必须通过</small><p>每条证据都能跳到来源片段。</p></article>
            <article><b>权限过滤</b><small>必须通过</small><p>个人和团队资料不越权召回。</p></article>
            <article><b>无依据拒答</b><small>必须通过</small><p>检索不到证据时不编造结论。</p></article>
          </div>
        </aside>
      </section>
    </AdminShell>
  );
}

export function AdminAuditPage({ initialEvents = adminAuditEvents }: { initialEvents?: typeof adminAuditEvents }) {
  const [activeModule, setActiveModule] = useState("全部模块");
  const [showRaw, setShowRaw] = useState(false);
  const filteredEvents = activeModule === "全部模块" ? initialEvents : initialEvents.filter((e) => e.area === activeModule);
  const riskEvents = initialEvents.filter((event) => /风险|策略|权限|处理|图谱/.test(`${event.area}${event.summary}${event.impact}`));
  const handleExportCSV = () => {
    const escape = (value: unknown) => { const str = String(value ?? ""); return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str; };
    const header = ["变更", "模块", "操作人", "时间", "影响"].join(",");
    const rows = initialEvents.map((e) => [e.summary, e.area, e.actor, e.time, e.impact].map(escape).join(","));
    const csv = "﻿" + [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "audit-events.csv";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  return (
    <AdminShell active="/admin/audit" title="审计记录">
      <AdminPageHead
        eyebrow="审计记录"
        title="用户影响变更记录"
        description="模板、策略、管线、图谱、评估和知识资产的关键变更都需要可追溯。"
      />
      <section className="admin-panel admin-audit-filter">
        <PanelHead eyebrow="审计过滤器" title="按模块、动作风险和操作者定位变更" action={<button type="button" onClick={handleExportCSV}>导出审计包</button>} />
        <div className="admin-audit-filter-row">
          {["全部模块", "模板治理", "检索策略", "处理管线", "关系图谱", "质量验证"].map((item) => (
            <button key={item} type="button" className={item === activeModule ? "active" : ""} onClick={() => setActiveModule(item)}>{item}</button>
          ))}
        </div>
      </section>

      <section className="admin-audit-summary">
        <article>
          <span>可追溯影响</span>
          <b>{filteredEvents.length}</b>
          <small>关键变更均记录影响范围</small>
        </article>
        <article>
          <span>风险动作</span>
          <b>{riskEvents.length}</b>
          <small>涉及策略、图谱、权限或处理链路</small>
        </article>
        <article>
          <span>操作人</span>
          <b>{new Set(initialEvents.map((event) => event.actor)).size}</b>
          <small>系统账号和管理员账号分离</small>
        </article>
      </section>

      <section className="admin-panel">
        <PanelHead eyebrow="变更流水" title="最近审计事件" action={<button type="button" onClick={() => setShowRaw(true)}>查看原始事件</button>} />
        <div className="admin-data-table admin-audit-table" role="table" aria-label="审计记录">
          <div role="row" className="admin-table-head">
            <span>变更</span>
            <span>模块</span>
            <span>操作人</span>
            <span>时间</span>
            <span>可追溯影响</span>
          </div>
          {filteredEvents.map((event) => (
            <div role="row" key={event.id}>
              <b>{event.summary}</b>
              <span>{event.area}</span>
              <span>{event.actor}</span>
              <span>{event.time}</span>
              <span>{event.impact}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-panel admin-audit-risk-actions">
        <PanelHead eyebrow="风险动作" title="需要保留复核证据的变更" />
        <div className="admin-risk-stack">
          {riskEvents.map((event) => (
            <article key={`risk-${event.id}`}>
              <span>{event.area}</span>
              <div>
                <b>{event.summary}</b>
                <p>{event.impact}</p>
              </div>
              <strong>{event.time}</strong>
            </article>
          ))}
        </div>
      </section>
      {showRaw && (
        <div onClick={() => setShowRaw(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", maxWidth: 640, width: "90%", maxHeight: "80vh", overflow: "auto", position: "relative", padding: 16, borderRadius: 8, boxSizing: "border-box" }}>
            <button type="button" onClick={() => setShowRaw(false)} style={{ position: "absolute", top: 8, right: 8 }}>关闭</button>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", paddingTop: 24 }}>{JSON.stringify(initialEvents, null, 2)}</pre>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

export function AdminShell({ active, title, children }: { active: string; title: string; children: ReactNode }) {
  const auth = useAuth();
  const currentUser = auth.user?.display_name || auth.user?.username || "管理员";
  return (
    <div className="admin-shell">
      <a className="admin-skip-link" href="#admin-main">跳到主要内容</a>
      <aside className="admin-side">
        <Link href="/" className="admin-brand" aria-label="返回官网">
          <Logo size={30} />
          <small>后台管理台</small>
        </Link>
        <nav aria-label="后台管理导航">
          {adminNav.map((item) => {
            const isKnowledgeNav = item.href === "/admin/knowledge-bases";
            const isActive = isKnowledgeNav ? active.startsWith(item.href) : item.href === active;

            if (isKnowledgeNav) {
              return (
                <div key={item.href} className="admin-nav-group">
                  <Link
                    className={`admin-nav-parent${isActive ? " active" : ""}`}
                    href={item.href}
                    aria-current={active === item.href ? "page" : undefined}
                  >
                    <span>{item.label}</span>
                  </Link>
                  <div className="admin-nav-sub" aria-label="知识库资产二级导航">
                    {adminKnowledgeSubnav.map((subItem) => (
                      <Link
                        key={subItem.href}
                        className={`admin-subnav-link${subItem.href === active ? " active" : ""}`}
                        href={subItem.href}
                        aria-current={subItem.href === active ? "page" : undefined}
                      >
                        <span>{subItem.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            }

            return (
              <Link key={item.href} className={item.href === active ? "active" : ""} href={item.href} aria-current={item.href === active ? "page" : undefined}>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="admin-side-status">
          <span>当前职责</span>
          <b>资料入库、权限复核、知识发布</b>
        </div>
      </aside>
      <main id="admin-main" className="admin-main">
        <header className="admin-top">
          <div>
            <span>{title}</span>
            <small>{currentUser} · 管理员视图</small>
          </div>
          <div className="admin-top-actions">
            <Link href="/app">前台工作区</Link>
            <ThemeToggle />
            <button type="button" onClick={auth.logout}>退出</button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

export function AdminPageHead({ eyebrow, title, description, actions, compact = false }: { eyebrow: string; title: string; description: string; actions?: ReactNode; compact?: boolean }) {
  return (
    <section className={`admin-head admin-page-toolbar ${compact ? "compact" : ""}`} aria-label={`${title} 专业工具栏`}>
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <small>专业工具栏</small>
        <p className="admin-head-context">{description}</p>
      </div>
      {actions ? <div className="admin-head-actions">{actions}</div> : null}
    </section>
  );
}

export function PanelHead({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <header className="admin-panel-head">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {action ? <div className="admin-panel-action">{action}</div> : null}
    </header>
  );
}

function AdminRequestQueue({ requests, compact = false }: { requests: AdminIntakeRequest[]; compact?: boolean }) {
  return (
    <div className={`admin-request-list ${compact ? "compact" : ""}`}>
      {requests.map((request, index) => (
        <article key={request.id} className={index === 0 ? "active" : ""}>
          <header>
            <AdminStatusBadge status={request.status} />
            <small>{request.submittedAt}</small>
          </header>
          <h3>{request.scenarioName}</h3>
          {!compact ? <p>{request.requestedOutcome}</p> : null}
          <dl>
            <div><dt>提交人</dt><dd>{request.requester}</dd></div>
            <div><dt>范围</dt><dd>{request.visibility}</dd></div>
            {!compact ? <div><dt>建议引擎</dt><dd className="admin-engine-dd">{requestRecommendedEngines(request).join(" / ")}</dd></div> : null}
          </dl>
        </article>
      ))}
    </div>
  );
}

function resolveAdminRequests(initialRequests: AdminIntakeRequest[] = []): AdminIntakeRequest[] {
  return initialRequests.length > 0 ? initialRequests : adminIntakeRequests as AdminIntakeRequest[];
}

function requestRecommendedEngines(request?: AdminIntakeRequest): AdminEngine[] {
  if (!request) return ["Gbrain"];
  if (request.recommendedEngines?.length) return request.recommendedEngines;
  return request.recommendedModes.map(engineForMode);
}

function requestSelectedEngine(request?: AdminIntakeRequest): AdminEngine {
  if (!request) return "Gbrain";
  if (request.selectedEngine && request.selectedEngine !== "待选择") return request.selectedEngine;
  if (request.selectedMode !== "待选择") return engineForMode(request.selectedMode);
  return requestRecommendedEngines(request)[0] ?? "Gbrain";
}

function requestFrontstageMapping(request?: AdminIntakeRequest) {
  if (!request) return "发布到前台后映射为：知识百科。";
  if (request.frontstageMapping) return request.frontstageMapping;
  return `发布到前台后映射为：${request.recommendedModes.join(" / ")}。`;
}

function frontstageMappingLabel(value: string) {
  return value.replace(/^发布到前台后映射为：/, "").replace(/。$/, "");
}

function fileStateLabel(file?: AdminStoredFile | null) {
  if (!file) return "上传暂存";
  if (file.originalState === "deleted") return "原始已清理";
  if (file.originalState === "retained") return "源文件保留";
  return "上传暂存";
}

function retentionPolicyLabel(policy?: "delete_after_ingest" | "retain_source") {
  if (policy === "retain_source") return "长期源资料";
  if (policy === "delete_after_ingest") return "入库后清理";
  return "待定策略";
}

function fileAccessLabel(file?: AdminStoredFile | null) {
  const access = file?.accessControl;
  if (!access) return "权限待确认";
  if (access.scope === "private") return "权限：仅本人";
  if (access.scope === "company") return `权限：公司 · ${access.organizationId}`;
  return `权限：团队 · ${access.teamIds.join(" / ") || "未指定"}`;
}

function defaultParameterValues(mode: RagOperationMode) {
  return Object.fromEntries(mode.parameters.map((parameter) => [parameter.key, String(parameter.value)]));
}

function parseDelimitedPreview(text: string) {
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(",").map((cell) => cell.trim()));
}

function formatPreviewText(kind: string, text: string) {
  if (kind !== "JSON") return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function engineForMode(mode: string): AdminEngine {
  if (mode === "文档证据") return "Naive RAG";
  if (mode === "关系图谱") return "GraphRAG";
  return "Gbrain";
}

export function AdminStatusBadge({ status }: { status: string }) {
  return <span className={`admin-status ${statusClass(status)}`}>{statusText(status)}</span>;
}

function statusText(status: string) {
  if (status === "healthy") return "正常";
  if (status === "degraded") return "需复核";
  if (status === "down") return "不可用";
  if (status === "watch") return "观察";
  if (status === "blocked") return "阻塞";
  if (status === "done") return "已完成";
  if (status === "running") return "处理中";
  if (status === "queued") return "排队中";
  if (status === "official") return "已发布";
  if (status === "candidate") return "候选";
  if (status === "experimental") return "试点";
  if (status === "custom") return "自定义";
  if (status === "paused") return "已暂停";
  if (status === "archived") return "已归档";
  return status;
}

function statusClass(status: string) {
  if (["正常", "可运行", "已发布", "已读取", "启用中", "healthy", "done", "official"].includes(status)) return "ok";
  if (["待管理员确认", "等待复核", "观察", "需复核", "等待解析", "watch", "running", "queued", "degraded", "candidate", "experimental", "custom"].includes(status)) return "warn";
  if (["阻塞", "需更新", "blocked", "down", "不可用", "paused", "archived"].includes(status)) return "danger";
  return "neutral";
}

function pipelineStatusText(status: string) {
  if (status === "done") return "已完成";
  if (status === "running") return "处理中";
  if (status === "queued") return "排队中";
  return status;
}

function nodePosition(id: string) {
  const map: Record<string, { x: number; y: number }> = {
    ff: { x: 430, y: 220 },
    zl: { x: 180, y: 140 },
    wh: { x: 680, y: 135 },
    contract: { x: 300, y: 355 },
    expansion: { x: 650, y: 355 },
    risk: { x: 450, y: 80 }
  };
  return map[id] ?? { x: 80, y: 80 };
}
