"use client";

import { useEffect, useMemo, useState } from "react";
import { adminIntegrationSettings, type AdminIntegrationSettings } from "../../lib/fixtures/admin-governance";
import { AdminShell } from "./admin-pages";

type FetchState = "loading" | "ready" | "fallback";

export function AdminSettingsPage({ initialSettings }: { initialSettings?: AdminIntegrationSettings }) {
  const [settings, setSettings] = useState<AdminIntegrationSettings>(initialSettings ?? adminIntegrationSettings);
  const [state, setState] = useState<FetchState>(initialSettings ? "ready" : "loading");
  const [tests, setTests] = useState<Record<string, { status: "idle" | "testing" | "ok" | "fail"; latencyMs?: number; message?: string }>>({});
  const [editingPolicies, setEditingPolicies] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<Record<string, string>>({});
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [editingEngines, setEditingEngines] = useState(false);
  const [engineDraft, setEngineDraft] = useState<Record<string, string>>({});
  const [engineMinDraft, setEngineMinDraft] = useState<Record<string, string>>({});
  const [engineModeDraft, setEngineModeDraft] = useState<Record<string, string>>({});
  const [engineChunkDraft, setEngineChunkDraft] = useState<Record<string, string>>({});
  const [engineMaxTokDraft, setEngineMaxTokDraft] = useState<Record<string, string>>({});
  const [engineRerankDraft, setEngineRerankDraft] = useState<Record<string, string>>({});
  const [engineLinkDepthDraft, setEngineLinkDepthDraft] = useState<Record<string, string>>({});
  const [engineSaving, setEngineSaving] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);

  async function testConnection(target: string) {
    setTests((prev) => ({ ...prev, [target]: { status: "testing" } }));
    try {
      const resp = await fetch("/api/platform/admin/integrations/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target })
      });
      const body = await resp.json().catch(() => ({}));
      const r = body.result ?? {};
      if (resp.ok && r.ok) {
        setTests((prev) => ({ ...prev, [target]: { status: "ok", latencyMs: r.latencyMs, message: r.detail } }));
      } else {
        setTests((prev) => ({ ...prev, [target]: { status: "fail", latencyMs: r.latencyMs, message: r.error ?? "测试失败" } }));
      }
    } catch {
      setTests((prev) => ({ ...prev, [target]: { status: "fail", message: "请求失败" } }));
    }
  }

  function startEditPolicies() {
    const draft: Record<string, string> = {};
    for (const p of settings.runtime_policies) {
      if (p.key && p.numeric) draft[p.key] = String(p.numeric.value);
    }
    setPolicyDraft(draft);
    setPolicyError(null);
    setEditingPolicies(true);
  }

  function cancelEditPolicies() {
    setEditingPolicies(false);
    setPolicyError(null);
  }

  async function savePolicies() {
    const body: Record<string, number> = {};
    for (const p of settings.runtime_policies) {
      if (!p.key || !p.numeric) continue;
      const raw = policyDraft[p.key];
      if (raw === undefined || raw === "") {
        setPolicyError(`「${p.label}」不能为空`);
        return;
      }
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        setPolicyError(`「${p.label}」必须是数字`);
        return;
      }
      if (num < p.numeric.min || num > p.numeric.max) {
        setPolicyError(`「${p.label}」需在 ${p.numeric.min}～${p.numeric.max} 范围内`);
        return;
      }
      if (Number.isInteger(p.numeric.step) && !Number.isInteger(num)) {
        setPolicyError(`「${p.label}」必须是整数`);
        return;
      }
      body[p.key] = num;
    }
    setPolicySaving(true);
    setPolicyError(null);
    try {
      const resp = await fetch("/api/platform/admin/runtime-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.settings) {
        setSettings(data.settings);
        setEditingPolicies(false);
      } else {
        setPolicyError(data.message ?? "保存失败");
      }
    } catch {
      setPolicyError("请求失败");
    } finally {
      setPolicySaving(false);
    }
  }

  async function resetPolicies() {
    if (!confirm("确定恢复运行策略为环境变量/默认值？")) return;
    const body: Record<string, null> = {};
    for (const p of settings.runtime_policies) {
      if (p.key) body[p.key] = null;
    }
    setPolicySaving(true);
    setPolicyError(null);
    try {
      const resp = await fetch("/api/platform/admin/runtime-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.settings) {
        setSettings(data.settings);
        setEditingPolicies(false);
      } else {
        setPolicyError(data.message ?? "恢复失败");
      }
    } catch {
      setPolicyError("请求失败");
    } finally {
      setPolicySaving(false);
    }
  }

  function startEditEngines() {
    const draft: Record<string, string> = {};
    const minDraft: Record<string, string> = {};
    const modeDraft: Record<string, string> = {};
    const chunkDraft: Record<string, string> = {};
    const maxTokDraft: Record<string, string> = {};
    const rerankDraft: Record<string, string> = {};
    const linkDepthDraft: Record<string, string> = {};
    for (const item of settings.engine_retrieval) {
      draft[item.engine] = item.topK === null ? "" : String(item.topK);
      if (item.supportsMinScore) {
        minDraft[item.engine] = item.minScore === null ? "" : String(item.minScore);
      }
      if (item.supportsGraphRetrieval) {
        modeDraft[item.engine] = item.mode ?? "";
        chunkDraft[item.engine] = item.chunkTopK === null ? "" : String(item.chunkTopK);
        maxTokDraft[item.engine] = item.maxTotalTokens === null ? "" : String(item.maxTotalTokens);
        rerankDraft[item.engine] = item.enableRerank === null ? "" : String(item.enableRerank);
      }
      if (item.supportsLinkDepth) {
        linkDepthDraft[item.engine] = item.linkDepth === null ? "" : String(item.linkDepth);
      }
    }
    setEngineDraft(draft);
    setEngineMinDraft(minDraft);
    setEngineModeDraft(modeDraft);
    setEngineChunkDraft(chunkDraft);
    setEngineMaxTokDraft(maxTokDraft);
    setEngineRerankDraft(rerankDraft);
    setEngineLinkDepthDraft(linkDepthDraft);
    setEngineError(null);
    setEditingEngines(true);
  }

  function cancelEditEngines() {
    setEditingEngines(false);
    setEngineError(null);
  }

  async function saveEngines() {
    const body: Record<string, { topK: number | null; minScore?: number | null; mode?: string | null; chunkTopK?: number | null; maxTotalTokens?: number | null; enableRerank?: boolean | null; linkDepth?: number | null }> = {};
    for (const item of settings.engine_retrieval) {
      const entry: { topK: number | null; minScore?: number | null; mode?: string | null; chunkTopK?: number | null; maxTotalTokens?: number | null; enableRerank?: boolean | null; linkDepth?: number | null } = { topK: null };
      const raw = engineDraft[item.engine];
      if (raw !== undefined && raw !== "") {
        const num = Number(raw);
        if (!Number.isFinite(num) || !Number.isInteger(num)) {
          setEngineError(`「${item.label}」TopK 必须是整数`);
          return;
        }
        if (num < item.min || num > item.max) {
          setEngineError(`「${item.label}」TopK 需在 ${item.min}～${item.max} 范围内`);
          return;
        }
        entry.topK = num;
      }
      if (item.supportsMinScore) {
        const rawMin = engineMinDraft[item.engine];
        if (rawMin === undefined || rawMin === "") {
          entry.minScore = null;
        } else {
          const m = Number(rawMin);
          if (!Number.isFinite(m) || m < item.minScoreMin || m > item.minScoreMax) {
            setEngineError(`「${item.label}」引用强度阈值需在 ${item.minScoreMin}～${item.minScoreMax} 之间`);
            return;
          }
          entry.minScore = m;
        }
      }
      if (item.supportsGraphRetrieval) {
        const modeVal = engineModeDraft[item.engine] ?? "";
        entry.mode = modeVal === "" ? null : modeVal;
        const chunkRaw = engineChunkDraft[item.engine] ?? "";
        if (chunkRaw === "") {
          entry.chunkTopK = null;
        } else {
          const chunkNum = Number(chunkRaw);
          if (!Number.isFinite(chunkNum) || !Number.isInteger(chunkNum) || chunkNum < item.chunkTopKMin || chunkNum > item.chunkTopKMax) {
            setEngineError(`「${item.label}」chunk_top_k 需为 ${item.chunkTopKMin}~${item.chunkTopKMax} 之间的整数`);
            return;
          }
          entry.chunkTopK = chunkNum;
        }
        const maxTokRaw = engineMaxTokDraft[item.engine] ?? "";
        if (maxTokRaw === "") {
          entry.maxTotalTokens = null;
        } else {
          const maxTokNum = Number(maxTokRaw);
          if (!Number.isFinite(maxTokNum) || !Number.isInteger(maxTokNum) || maxTokNum < item.maxTotalTokensMin || maxTokNum > item.maxTotalTokensMax) {
            setEngineError(`「${item.label}」max_total_tokens 需为 ${item.maxTotalTokensMin}~${item.maxTotalTokensMax} 之间的整数`);
            return;
          }
          entry.maxTotalTokens = maxTokNum;
        }
        const rerankVal = engineRerankDraft[item.engine] ?? "";
        entry.enableRerank = rerankVal === "" ? null : rerankVal === "true";
      }
      if (item.supportsLinkDepth) {
        const rawLinkDepth = engineLinkDepthDraft[item.engine];
        if (rawLinkDepth === undefined || rawLinkDepth === "") {
          entry.linkDepth = null;
        } else {
          const depthNum = Number(rawLinkDepth);
          if (!Number.isFinite(depthNum) || !Number.isInteger(depthNum) || depthNum < item.linkDepthMin || depthNum > item.linkDepthMax) {
            setEngineError(`「${item.label}」互链深度需为 ${item.linkDepthMin}~${item.linkDepthMax} 之间的整数`);
            return;
          }
          entry.linkDepth = depthNum;
        }
      }
      body[item.engine] = entry;
    }
    setEngineSaving(true);
    setEngineError(null);
    try {
      const resp = await fetch("/api/platform/admin/engine-retrieval-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.settings) {
        setSettings(data.settings);
        setEditingEngines(false);
      } else {
        setEngineError(data.message ?? "保存失败");
      }
    } catch {
      setEngineError("请求失败");
    } finally {
      setEngineSaving(false);
    }
  }

  async function resetEngines() {
    if (!confirm("确定恢复所有引擎检索参数（TopK、引用强度阈值与互链深度）为默认值？")) return;
    const body: Record<string, { topK: null; minScore?: null; mode?: null; chunkTopK?: null; maxTotalTokens?: null; enableRerank?: null; linkDepth?: null }> = {};
    for (const item of settings.engine_retrieval) {
      const entry: { topK: null; minScore?: null; mode?: null; chunkTopK?: null; maxTotalTokens?: null; enableRerank?: null; linkDepth?: null } = { topK: null };
      if (item.supportsMinScore) {
        entry.minScore = null;
      }
      if (item.supportsGraphRetrieval) {
        entry.mode = null;
        entry.chunkTopK = null;
        entry.maxTotalTokens = null;
        entry.enableRerank = null;
      }
      if (item.supportsLinkDepth) {
        entry.linkDepth = null;
      }
      body[item.engine] = entry;
    }
    setEngineSaving(true);
    setEngineError(null);
    try {
      const resp = await fetch("/api/platform/admin/engine-retrieval-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.settings) {
        setSettings(data.settings);
        setEditingEngines(false);
      } else {
        setEngineError(data.message ?? "恢复失败");
      }
    } catch {
      setEngineError("请求失败");
    } finally {
      setEngineSaving(false);
    }
  }

  useEffect(() => {
    let alive = true;
    fetch("/api/platform/admin/settings", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("settings unavailable");
        return response.json();
      })
      .then((body) => {
        if (!alive) return;
        setSettings(body.settings ?? adminIntegrationSettings);
        setState("ready");
      })
      .catch(() => {
        if (!alive) return;
        setSettings(initialSettings ?? adminIntegrationSettings);
        setState("fallback");
      });
    return () => {
      alive = false;
    };
  }, [initialSettings]);

  const statusLabel = settings.overall_status === "ready" ? "全部可用" : settings.overall_status === "blocked" ? "配置阻塞" : "部分待确认";
  const checkedAt = useMemo(() => formatCheckedAt(settings.checked_at), [settings.checked_at]);

  return (
    <AdminShell active="/admin/settings" title="系统接入">
      <section className="admin-head admin-settings-head">
        <span>系统接入</span>
        <h1>接入总控台</h1>
        <p>后台管理员在这里确认模型、解析、数据库和三类 RAG 引擎服务是否已经接入，前台场景只消费映射后的业务能力。</p>
        <div className="admin-settings-toolbar">
          <strong className={`settings-status ${settings.overall_status}`}>{statusLabel}</strong>
          <small>{state === "ready" ? `最近检查：${checkedAt}` : state === "loading" ? "正在读取统一 API..." : "统一 API 未连接，当前显示本地兜底配置"}</small>
          <button type="button" onClick={() => window.location.reload()}>重新检查</button>
        </div>
      </section>

      <section className="settings-section settings-secret-matrix">
        <div className="settings-section-title">
          <h2>密钥状态矩阵</h2>
          <p>只暴露环境变量名、是否配置和脱敏指纹，避免后台泄露真实密钥。</p>
        </div>
        <div className="settings-secret-grid">
          {[...settings.providers, ...settings.parsers].flatMap((item) => item.secrets.map((secret) => (
            <article key={`${item.id}-${secret.env_name}`} className="settings-secret-row">
              <b>{secret.env_name}</b>
              <span>{item.label}</span>
              <em>{secret.configured ? "已配置" : "未配置"}</em>
              <small>{secret.fingerprint ?? "无指纹"}</small>
            </article>
          )))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">
          <h2>模型与向量化</h2>
          <p>决定公司大脑回答质量、Embedding 维度和三类知识库召回能力。</p>
        </div>
        <div className="settings-card-grid">
          {settings.providers.map((provider) => (
            <article key={provider.id} className="settings-card">
              <header>
                <div>
                  <span>{provider.provider}</span>
                  <h3>{provider.label}</h3>
                </div>
                <SecretBadge configured={provider.secrets.every((item) => item.configured)} />
              </header>
              <dl>
                <div><dt>服务地址</dt><dd>{provider.base_url || "未配置"}</dd></div>
                <div><dt>模型</dt><dd>{provider.model || "未配置"}</dd></div>
                {provider.dimensions ? <div><dt>向量维度</dt><dd>{provider.dimensions}</dd></div> : null}
                {provider.secrets.map((secret) => <div key={secret.env_name}><dt>{secret.env_name}</dt><dd>{secret.configured ? `已配置 ${secret.fingerprint ?? ""}` : "未配置"}</dd></div>)}
              </dl>
              <div className="admin-pills">{provider.controls.map((item) => <span key={item}>{item}</span>)}</div>
              <TestConnectionControl target={provider.id} test={tests[provider.id]} onTest={testConnection} />
            </article>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">
          <h2>文档解析</h2>
          <p>负责把 PDF 转成可切片、可引用、可追溯的结构化资料。</p>
        </div>
        <div className="settings-card-grid">
          {settings.parsers.map((parser) => (
            <article key={parser.id} className="settings-card">
              <header>
                <div>
                  <span>{parser.base_url ?? "未配置"}</span>
                  <h3>{parser.label}</h3>
                </div>
                <SecretBadge configured={parser.secrets.every((item) => item.configured)} />
              </header>
              <dl>
                <div><dt>版本</dt><dd>{parser.model_version ?? "未配置"}</dd></div>
                <div><dt>语言</dt><dd>{parser.language ?? "未配置"}</dd></div>
                {parser.secrets.map((secret) => <div key={secret.env_name}><dt>{secret.env_name}</dt><dd>{secret.configured ? `已配置 ${secret.fingerprint ?? ""}` : "未配置"}</dd></div>)}
              </dl>
              <div className="admin-pills">{parser.options.map((item) => <span key={item}>{item}</span>)}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">
          <h2>RAG 模块健康</h2>
          <p>后台负责把前台场景分发到 Gbrain、Naive RAG 和 GraphRAG 三条真实入库与检索链路。</p>
        </div>
        <div className="settings-service-list">
          {settings.modules.map((module) => (
            <article key={module.id} className="settings-service-row">
              <div>
                <StatusDot status={module.status} />
                <div>
                  <h3>{module.label}</h3>
                  <p>{module.role}</p>
                </div>
              </div>
              <code>{module.base_url}</code>
              <span>{module.status === "ok" ? "服务可用" : module.status === "error" ? "服务不可用" : "等待检查"}</span>
              <TestConnectionControl target={module.id} test={tests[module.id]} onTest={testConnection} />
            </article>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div>
          <div className="settings-section-title">
            <h2>数据库权限边界</h2>
            <p>只显示连接摘要，不显示密码或完整连接串；每个库对应不同权限和知识资产边界。</p>
          </div>
          <div className="admin-table settings-db-table">
            {settings.databases.map((database) => (
              <div key={database.id}>
                <b>{database.label}</b>
                <span>{database.database ?? "未配置"}</span>
                <span>{database.host ? `${database.host}${database.port ? `:${database.port}` : ""}` : "未配置"}</span>
                <em>{database.configured ? "已配置" : "未配置"}</em>
                <small>{database.env_name}</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section settings-config-stack">
        <div>
          <div className="settings-section-title">
            <h2>运行策略</h2>
            <p>影响任务处理、状态恢复和文件落盘。</p>
          </div>
          <div className="settings-policy-list">
            <div className="settings-policy-toolbar">
              {!editingPolicies ? (
                <button type="button" onClick={startEditPolicies}>编辑</button>
              ) : (
                <>
                  <button type="button" onClick={resetPolicies} disabled={policySaving}>恢复默认</button>
                  <button type="button" onClick={cancelEditPolicies} disabled={policySaving}>取消</button>
                  <button type="button" onClick={savePolicies} disabled={policySaving}>
                    {policySaving ? "保存中..." : "保存"}
                  </button>
                </>
              )}
            </div>
            {policyError ? <div className="settings-policy-error">{policyError}</div> : null}
            {(() => {
              const renderPolicy = (policy: (typeof settings.runtime_policies)[number]) => {
                const key = policy.key;
                if (key && editingPolicies && policy.numeric) {
                  return (
                    <article key={policy.label} className="settings-policy-edit">
                      <b>{policy.label}</b>
                      <input
                        type="number"
                        min={policy.numeric.min}
                        max={policy.numeric.max}
                        step={policy.numeric.step}
                        value={policyDraft[key] ?? ""}
                        onChange={(event) => setPolicyDraft((prev) => ({ ...prev, [key]: event.target.value }))}
                      />
                      {policy.numeric.unit ? <span>{policy.numeric.unit}</span> : null}
                      <p>{policy.impact}</p>
                    </article>
                  );
                }
                return (
                  <article key={policy.label}>
                    <b>{policy.label}</b>
                    <span>{policy.value}</span>
                    {key && policy.source ? (
                      <small className="settings-policy-source">
                        {policy.source === "db" ? "DB 覆盖" : policy.source === "env" ? "环境变量" : "默认"}
                      </small>
                    ) : null}
                    <p>{policy.impact}</p>
                  </article>
                );
              };
              const systemItems = settings.runtime_policies.filter((policy) => !policy.key);
              const retrievalItems = settings.runtime_policies.filter((policy) => policy.key);
              return (
                <>
                  <div className="settings-policy-group">
                    <div className="settings-policy-group-head">
                      <h3>系统基础设施</h3>
                      <p>接入令牌、入库模式、文件落盘位置（运维配置，多为只读）。</p>
                    </div>
                    {systemItems.map(renderPolicy)}
                  </div>
                  <div className="settings-policy-group">
                    <div className="settings-policy-group-head">
                      <h3>全局检索精排（rerank）</h3>
                      <p>全域问答的召回与重排调优，点右上「编辑」可改数值。</p>
                    </div>
                    {retrievalItems.map(renderPolicy)}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
        <div>
        <div className="settings-section-title">
          <h2>每引擎检索参数</h2>
          <p>按引擎覆盖检索召回数量（TopK，1～30）；Naive RAG 额外可设引用相对强度阈值（0～1，归一化 RRF 过滤弱引用，仅该引擎有此层）。留空=用各检索路径默认值，均不影响平台重排层。</p>
        </div>
        <div className="settings-policy-list">
          <div className="settings-policy-toolbar">
            {!editingEngines ? (
              <button type="button" onClick={startEditEngines}>编辑</button>
            ) : (
              <>
                <button type="button" onClick={resetEngines} disabled={engineSaving}>恢复默认</button>
                <button type="button" onClick={cancelEditEngines} disabled={engineSaving}>取消</button>
                <button type="button" onClick={saveEngines} disabled={engineSaving}>
                  {engineSaving ? "保存中..." : "保存"}
                </button>
              </>
            )}
          </div>
          {engineError ? <div className="settings-policy-error">{engineError}</div> : null}
          {settings.engine_retrieval.map((item) => {
            if (editingEngines) {
              return (
                <article key={item.engine} className="settings-policy-edit">
                  <b>{item.label}</b>
                  <input
                    type="number"
                    min={item.min}
                    max={item.max}
                    step={1}
                    placeholder="TopK 未设置"
                    value={engineDraft[item.engine] ?? ""}
                    onChange={(event) => setEngineDraft((prev) => ({ ...prev, [item.engine]: event.target.value }))}
                  />
                  {item.supportsMinScore ? (
                    <input
                      type="number"
                      min={item.minScoreMin}
                      max={item.minScoreMax}
                      step={0.05}
                      placeholder="引用阈值 未设置"
                      value={engineMinDraft[item.engine] ?? ""}
                      onChange={(event) => setEngineMinDraft((prev) => ({ ...prev, [item.engine]: event.target.value }))}
                    />
                  ) : null}
                  {item.supportsLinkDepth ? (
                    <input
                      type="number"
                      min={item.linkDepthMin}
                      max={item.linkDepthMax}
                      step={1}
                      placeholder="互链深度 未设置"
                      value={engineLinkDepthDraft[item.engine] ?? ""}
                      onChange={(event) => setEngineLinkDepthDraft((prev) => ({ ...prev, [item.engine]: event.target.value }))}
                    />
                  ) : null}
                  {item.supportsGraphRetrieval ? (
                    <>
                      <select
                        aria-label="检索模式 mode"
                        value={engineModeDraft[item.engine] ?? ""}
                        onChange={(event) => setEngineModeDraft((prev) => ({ ...prev, [item.engine]: event.target.value }))}
                      >
                        <option value="">mode 未设置(默认)</option>
                        {item.modeOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                      <input
                        type="number"
                        min={item.chunkTopKMin}
                        max={item.chunkTopKMax}
                        step={1}
                        placeholder="chunk_top_k 未设置"
                        value={engineChunkDraft[item.engine] ?? ""}
                        onChange={(event) => setEngineChunkDraft((prev) => ({ ...prev, [item.engine]: event.target.value }))}
                      />
                      <input
                        type="number"
                        min={item.maxTotalTokensMin}
                        max={item.maxTotalTokensMax}
                        step={1}
                        placeholder="max_total_tokens 未设置"
                        value={engineMaxTokDraft[item.engine] ?? ""}
                        onChange={(event) => setEngineMaxTokDraft((prev) => ({ ...prev, [item.engine]: event.target.value }))}
                      />
                      <select
                        aria-label="enable_rerank"
                        value={engineRerankDraft[item.engine] ?? ""}
                        onChange={(event) => setEngineRerankDraft((prev) => ({ ...prev, [item.engine]: event.target.value }))}
                      >
                        <option value="">rerank 未设置(默认)</option>
                        <option value="true">rerank 开</option>
                        <option value="false">rerank 关</option>
                      </select>
                    </>
                  ) : null}
                  <p>{item.default_hint}{item.supportsMinScore ? "；引用相对强度阈值 0~1：留空=不过滤" : ""}{item.supportsLinkDepth ? `；互链深度 ${item.linkDepthMin}~${item.linkDepthMax}：留空=默认 1 跳` : ""}{item.supportsGraphRetrieval ? "；GraphRAG 检索旋钮 mode/chunk_top_k/max_total_tokens/enable_rerank：留空=走模块默认" : ""}</p>
                </article>
              );
            }
            return (
              <article key={item.engine}>
                <b>{item.label}</b>
                <span>TopK：{item.topK ?? "未设置"}</span>
                <small className="settings-policy-source">
                  {item.source === "db" ? "DB 覆盖" : "默认"}
                </small>
                {item.supportsMinScore ? (
                  <>
                    <span>引用阈值：{item.minScore ?? "未设置"}</span>
                    <small className="settings-policy-source">
                      {item.minScoreSource === "db" ? "DB 覆盖" : "默认"}
                    </small>
                  </>
                ) : null}
                {item.supportsLinkDepth ? (
                  <>
                    <span>互链深度：{item.linkDepth ?? "未设置"}</span>
                    <small className="settings-policy-source">
                      {item.linkDepthSource === "db" ? "DB 覆盖" : "默认"}
                    </small>
                  </>
                ) : null}
                {item.supportsGraphRetrieval ? (
                  <>
                    <span>mode：{item.mode ?? "默认(mix)"}</span>
                    <small className="settings-policy-source">{item.modeSource === "db" ? "DB 覆盖" : "默认"}</small>
                    <span>chunk_top_k：{item.chunkTopK ?? "未设置"}</span>
                    <span>max_total_tokens：{item.maxTotalTokens ?? "未设置"}</span>
                    <span>rerank：{item.enableRerank === null ? "默认" : item.enableRerank ? "开" : "关"}</span>
                  </>
                ) : null}
                <p>{item.default_hint}</p>
              </article>
            );
          })}
        </div>
        </div>
      </section>
    </AdminShell>
  );
}

function SecretBadge({ configured }: { configured: boolean }) {
  return <b className={`secret-badge ${configured ? "ok" : "missing"}`}>{configured ? "已接入" : "缺配置"}</b>;
}

function TestConnectionControl({
  target,
  test,
  onTest
}: {
  target: string;
  test?: { status: "idle" | "testing" | "ok" | "fail"; latencyMs?: number; message?: string };
  onTest: (target: string) => void;
}) {
  const testing = test?.status === "testing";
  return (
    <div className="settings-test-connection">
      <button type="button" disabled={testing} onClick={() => onTest(target)}>
        {testing ? "测试中..." : "测试连接"}
      </button>
      {test && test.status !== "idle" && !testing ? (
        <span className={`settings-test-result ${test.status}`}>
          {test.status === "ok"
            ? `✅ 正常${test.latencyMs != null ? ` (${test.latencyMs}ms)` : ""}`
            : `❌ ${test.message ?? "失败"}`}
        </span>
      ) : null}
    </div>
  );
}

function StatusDot({ status }: { status: "ok" | "error" | "unknown" }) {
  return <i className={`service-dot ${status}`} aria-label={status} />;
}

function formatCheckedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}
