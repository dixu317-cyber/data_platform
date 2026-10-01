"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";

import { AdminShell, AdminPageHead, PanelHead, AdminStatusBadge } from "./admin-pages";
import type { MonitoringOverview, MonitoringTrendPoint, MonitoringFormPanels, MonitoringTelemetry, MonitoringTelemetryDetail, TraceFormLabel } from "@ff/platform/platform-store";

type TraceRow = MonitoringTelemetry;

const FORM_BADGE: Record<TraceFormLabel, string> = {
  文档型: "Naive RAG",
  图谱型: "GraphRAG",
  知识页型: "Gbrain"
};

export function AdminMonitoringPage({
  overview,
  traces,
  trends = [],
  formPanels,
  children
}: {
  overview: MonitoringOverview;
  traces: TraceRow[];
  trends?: MonitoringTrendPoint[];
  formPanels?: MonitoringFormPanels;
  children?: ReactNode;
}) {
  const [formFilter, setFormFilter] = useState<TraceFormLabel | "全部">("全部");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [onlyDown, setOnlyDown] = useState(false);

  const filtered = traces.filter((t) => {
    if (formFilter !== "全部" && !t.forms.includes(formFilter)) return false;
    if (onlyFailed && t.success) return false;
    if (onlyDown && t.feedback?.vote !== "down") return false;
    return true;
  });

  const o = overview.overall;
  const reviewQueue = traces.filter((t) => t.feedback?.vote === "down");

  return (
    <AdminShell active="/admin/monitoring" title="运行监控">
      <AdminPageHead
        eyebrow="运行监控 · 可观测"
        title="真实问答链路、质量与反馈一屏可见"
        description="每一次「问公司大脑」与场景问答都会落成一条 trace：检索到哪些证据、用了多少 token、延迟多少、用户是否满意。所有指标来自真实问答，非示例数据。"
      />

      {/* 总览健康层 */}
      <section className="admin-panel">
        <PanelHead eyebrow="总览健康层" title="一级运营指标(实时聚合)" />
        <div className="monitoring-kpi-grid">
          <article className="monitoring-kpi"><span>问答量</span><b>{o.queries}</b><small>累计真实问答</small></article>
          <article className="monitoring-kpi"><span>回答成功率</span><b>{o.successRate}%</b><small>命中真实引用或直接回答</small></article>
          <article className="monitoring-kpi"><span>无答案率</span><b>{o.noAnswerRate}%</b><small>检索未命中任何来源</small></article>
          <article className="monitoring-kpi"><span>延迟 P50 / P95</span><b>{o.p50LatencyMs} / {o.p95LatencyMs}<i>ms</i></b><small>端到端</small></article>
          <article className="monitoring-kpi"><span>Token 消耗</span><b>{o.totalTokens.toLocaleString()}</b><small>生成模型累计</small></article>
          <article className="monitoring-kpi"><span>好评 / 差评</span><b>{o.upvotes} / {o.downvotes}</b><small>待改进 {o.pendingReview}</small></article>
        </div>
      </section>

      {/* 三形态健康卡 */}
      <section className="admin-panel">
        <PanelHead eyebrow="三形态健康" title="文档型 / 图谱型 / 知识页型 各自检索表现" />
        <div className="monitoring-form-grid">
          {overview.forms.map((f) => (
            <article key={f.form} className="monitoring-form-card">
              <header>
                <b>{f.form}</b>
                <AdminStatusBadge status={f.queries === 0 ? "观察" : f.hitRate >= 60 ? "正常" : "需复核"} />
              </header>
              <small>{FORM_BADGE[f.form]}</small>
              <div className="monitoring-form-metrics">
                <div><span>命中问答</span><b>{f.queries}</b></div>
                <div><span>检索命中率</span><b>{f.hitRate}%</b></div>
                <div><span>平均检索延迟</span><b>{f.avgRetrievalMs}ms</b></div>
                <div><span>差评</span><b>{f.downvotes}</b></div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 趋势层:按天时序 */}
      {trends.length > 0 ? (
        <section className="admin-panel">
          <PanelHead eyebrow="趋势层" title="最近问答量 / 成功率 / 延迟 / 差评(按天)" />
          <div className="monitoring-trend-table" role="table">
            <div role="row" className="admin-table-head">
              <span>日期</span><span>问答量</span><span>成功率</span><span>平均延迟</span><span>差评</span><span>Token</span>
            </div>
            {trends.map((p) => (
              <div role="row" key={p.date}>
                <b>{p.date}</b>
                <span><i className="monitoring-bar" style={{ width: `${Math.min(100, p.queries * 12)}%` }} />{p.queries}</span>
                <span>{p.successRate}%</span>
                <span>{p.avgLatencyMs}ms</span>
                <span>{p.downvotes}</span>
                <span>{p.tokens}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 三形态深度面板:每种知识形态的原生监控 */}
      {formPanels ? (
        <section className="admin-panel">
          <PanelHead eyebrow="三形态深度面板" title="不同知识形态的原生监控指标" />
          <div className="monitoring-deep-grid">
            {/* 文档型:chunk/来源命中分布 */}
            <article className="monitoring-deep-card">
              <header><b>文档型 · Naive RAG</b><span>来源命中分布</span></header>
              <p className="monitoring-deep-note">{formPanels.文档型.zeroHitSources} 个来源在被检索时命中为 0(可能切分不当 / 检索策略需调)。</p>
              <div className="monitoring-source-bars">
                {formPanels.文档型.sources.length === 0 ? <small className="monitoring-empty">暂无文档型检索记录。</small> : null}
                {formPanels.文档型.sources.map((s) => (
                  <div key={s.name} className="monitoring-source-bar">
                    <span title={s.name}>{s.name}</span>
                    <i style={{ width: `${Math.min(100, (s.hits / Math.max(1, s.queries)) * 100)}%` }} />
                    <em>{s.hits} 命中 / {s.queries} 次检索</em>
                  </div>
                ))}
              </div>
            </article>

            {/* 图谱型:实体/关系/重复实体(真 graph-rag) */}
            <article className="monitoring-deep-card">
              <header><b>图谱型 · GraphRAG</b><span>实体 / 关系 / 去重</span></header>
              {formPanels.图谱型.available ? (
                <>
                  <div className="monitoring-graph-counts">
                    <div><span>实体</span><b>{formPanels.图谱型.entities}</b></div>
                    <div><span>关系</span><b>{formPanels.图谱型.relations}</b></div>
                    <div><span>图谱来源</span><b>{formPanels.图谱型.sources}</b></div>
                    <div><span>重复实体候选</span><b>{formPanels.图谱型.duplicateCandidates.length}</b></div>
                  </div>
                  {formPanels.图谱型.duplicateCandidates.length > 0 ? (
                    <div className="monitoring-dup-list">
                      <small>疑似重复实体(建议 curate 合并):</small>
                      {formPanels.图谱型.duplicateCandidates.slice(0, 10).map((dup, i) => (
                        <span key={i} className="monitoring-dup-pair">{dup}</span>
                      ))}
                    </div>
                  ) : <small className="monitoring-empty">未检出明显重复实体。</small>}
                  <div className="monitoring-entity-chips">
                    {formPanels.图谱型.sampleEntities.slice(0, 16).map((e) => <span key={e}>{e}</span>)}
                  </div>
                </>
              ) : <small className="monitoring-empty">GraphRAG 图谱统计暂不可用(模块未响应)。</small>}
            </article>

            {/* 知识页型:引用可追溯 / 新鲜度 */}
            <article className="monitoring-deep-card">
              <header><b>知识页型 · Gbrain</b><span>可追溯 / 新鲜度</span></header>
              <div className="monitoring-graph-counts">
                <div><span>引用可追溯率</span><b>{formPanels.知识页型.traceableRate}%</b></div>
                <div><span>知识页数</span><b>{formPanels.知识页型.knowledgePages}</b></div>
                <div><span>最新页距今</span><b>{formPanels.知识页型.latestPageAgeHours === null ? "—" : `${formPanels.知识页型.latestPageAgeHours}h`}</b></div>
              </div>
              <p className="monitoring-deep-note">引用可追溯率 = 知识页型问答中真正命中知识页来源的比例;新鲜度反映知识页是否需要刷新。</p>
            </article>
          </div>
        </section>
      ) : null}

      {/* 反馈/改进层:差评进待改进队列 */}
      <section className="admin-panel">
        <PanelHead eyebrow="反馈 / 改进层" title={`待改进队列(${reviewQueue.length} 条差评)`} />
        {reviewQueue.length === 0 ? (
          <p className="monitoring-empty">暂无差评。前台答案被点踩后,会自动进入这里,供管理员归因(检索没召回 / 召回了但答错 / 资料缺失 / 切分不当 / 图谱错误)并整改。</p>
        ) : (
          <div className="monitoring-review-queue">
            {reviewQueue.map((t) => (
              <Link key={t.id} href={`/admin/monitoring/${t.id}`} className="monitoring-review-card">
                <b>{t.kind === "global_chat" ? "全域问答" : "场景问答"}</b>
                <small>{t.forms.join(" / ") || "—"} · 命中 {t.hitSourceCount} 源 · {t.totalLatencyMs}ms</small>
                <em>{t.hitSourceCount === 0 ? "疑因:检索未命中(资料缺失/切分/检索策略)" : "疑因:召回了但答错(生成/证据不足)→ 点开看 span 归因"}</em>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* trace 钻取层 */}
      <section className="admin-panel">
        <PanelHead
          eyebrow="trace 钻取层"
          title={`问答日志(${filtered.length} 条)`}
          action={
            <div className="monitoring-filters">
              {(["全部", "文档型", "图谱型", "知识页型"] as const).map((f) => (
                <button key={f} type="button" className={formFilter === f ? "active" : ""} onClick={() => setFormFilter(f)}>{f}</button>
              ))}
              <button type="button" className={onlyFailed ? "active" : ""} onClick={() => setOnlyFailed((v) => !v)}>只看未成功</button>
              <button type="button" className={onlyDown ? "active" : ""} onClick={() => setOnlyDown((v) => !v)}>只看差评</button>
            </div>
          }
        />
        <div className="admin-data-table monitoring-trace-table" role="table" aria-label="问答日志">
          <div role="row" className="admin-table-head">
            <span>类型</span>
            <span>形态</span>
            <span>引用</span>
            <span>延迟</span>
            <span>Token</span>
            <span>反馈</span>
            <span>状态</span>
          </div>
          {filtered.map((t) => (
            <Link role="row" key={t.id} href={`/admin/monitoring/${t.id}`} className={`monitoring-trace-row${t.feedback?.vote === "down" ? " is-down" : ""}`}>
              <b>{t.kind === "global_chat" ? "全域问答" : "场景问答"}<small>{t.route === "direct" ? "直接回答" : "知识检索"} · {t.scope ?? ""}</small></b>
              <span>{t.forms.length ? t.forms.join(" / ") : "—"}</span>
              <span>{t.citationCount} 条 · {t.hitSourceCount} 源</span>
              <span>{t.totalLatencyMs}ms</span>
              <span>{t.totalTokens || "—"}</span>
              <span>{t.feedback ? (t.feedback.vote === "up" ? "👍 好评" : "👎 差评") : "—"}</span>
              <AdminStatusBadge status={t.success ? "正常" : "需复核"} />
            </Link>
          ))}
          {filtered.length === 0 ? (
            <div role="row" className="admin-empty-ledger-row">
              <b>当前筛选下没有问答记录<small>去前台「问公司大脑」真实问几条,这里就会出现真实 trace。</small></b>
            </div>
          ) : null}
        </div>
      </section>

      {children}
    </AdminShell>
  );
}

export function AdminTraceDetailPage({ trace }: { trace: MonitoringTelemetryDetail }) {
  return (
    <AdminShell active="/admin/monitoring" title="问答 trace 详情">
      <AdminPageHead
        eyebrow="trace 详情"
        title={trace.kind === "global_chat" ? "全域问答治理记录" : "场景问答治理记录"}
        description={`${trace.route === "direct" ? "直接回答" : "知识检索"} · ${trace.scope ?? ""} · ${new Date(trace.createdAt).toLocaleString("zh-CN")}`}
      />

      <section className="admin-panel">
        <PanelHead eyebrow="本次问答" title="结果与一级指标" action={<AdminStatusBadge status={trace.success ? "正常" : "需复核"} />} />
        <div className="monitoring-trace-summary">
          <div><span>端到端延迟</span><b>{trace.totalLatencyMs}ms</b></div>
          <div><span>命中引用 / 来源</span><b>{trace.citationCount} / {trace.hitSourceCount}</b></div>
          <div><span>Token</span><b>{trace.totalTokens || "—"}</b></div>
          <div><span>形态</span><b>{trace.forms.join(" / ") || "—"}</b></div>
          <div><span>用户反馈</span><b>{trace.feedback ? (trace.feedback.vote === "up" ? "👍 好评" : "👎 差评") : "未评价"}</b></div>
        </div>
      </section>

      {/* span 树:每步可钻取,RETRIEVER 展开命中证据,LLM 显 token/延迟 */}
      <section className="admin-panel">
        <PanelHead eyebrow="链路 span 树" title="这次回答到底怎么发生的" />
        <div className="monitoring-span-tree">
          <article className="monitoring-span chain">
            <header><b>CHAIN · 一次问答</b><span>{trace.totalLatencyMs}ms</span></header>
            <small>问题 → 检索 → 生成</small>
          </article>
          {trace.spans.map((s, i) => (
            <article key={i} className={`monitoring-span ${s.kind.toLowerCase()}`}>
              <header>
                <b>{s.kind}{s.engine ? `（${s.engine}）` : ""}</b>
                <span>{s.latencyMs}ms</span>
              </header>
              {s.kind === "RETRIEVER" ? (
                <div className="monitoring-span-body">
                  <small>{s.form ?? "—"} · 命中 {s.hitCount ?? 0} 条</small>
                </div>
              ) : (
                <div className="monitoring-span-body">
                  <small>合计 {s.totalTokens ?? "—"} token</small>
                </div>
              )}
            </article>
          ))}
          {trace.spans.length === 0 ? <p className="monitoring-empty">本次为直接回答,无检索 span。</p> : null}
        </div>
      </section>

      {/* P37-T4d（FR-452）：检索健康——本次各引擎是否正常参与/被路由剪掉/异常超时。 */}
      {trace.retrievalHealth ? (
        <section className="admin-panel">
          <PanelHead eyebrow="检索健康" title="本次各引擎参与情况" />
          <div className="monitoring-trace-summary">
            {trace.retrievalHealth.sources.map((s) => (
              <div key={s.engine}>
                <span>{s.engine}</span>
                <b>
                  {s.status === "ok"
                    ? "正常参与"
                    : s.status === "skipped-by-router"
                      ? "本次未参与(路由剪枝)"
                      : s.status === "timeout"
                        ? "超时"
                        : "异常"}
                </b>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Link className="monitoring-back" href="/admin/monitoring">← 返回运行监控</Link>
    </AdminShell>
  );
}
