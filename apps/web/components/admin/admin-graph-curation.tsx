"use client";

import { useEffect, useMemo, useState, useRef } from "react";

import { AdminShell, AdminPageHead, PanelHead, KnowledgeSubnav } from "./admin-pages";
import { ConfirmDialog } from "./admin-confirm-dialog";
import { CurationSourceRail, CurationSearchList, type CurationRailItem } from "./curation-master-detail";
import type { GraphCurationSource, GraphCurationDetail } from "@ff/platform/platform-store";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`/api/platform/${path}`, { headers: { "content-type": "application/json" }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || `请求失败 ${res.status}`);
  return data;
}

export function AdminGraphCurationWorkbench({ sources }: { sources: GraphCurationSource[] }) {
  const [activeSource, setActiveSource] = useState<string>(sources[0]?.sourceId ?? "");
  // P0:图谱源列表改用本地 state 镜像 props.sources——删源成功后从列表局部移除该源即可,不再 window.location.reload()
  //   （reload 会把后端诚实返回的"已同步清理 N 份 / 清理 N/M 失败仅清平台引用"告知瞬间刷没,叠加后端失败仍
  //   ok:true,管理员会误以为干净删除）。
  const [sourceList, setSourceList] = useState(sources);
  const [detail, setDetail] = useState<GraphCurationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<{ title: string; description: string; danger?: boolean; confirmText?: string; run: () => void } | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [addingEntity, setAddingEntity] = useState(false);
  const [newEntityName, setNewEntityName] = useState("");
  const [newEntityType, setNewEntityType] = useState("");
  const [newEntityDesc, setNewEntityDesc] = useState("");
  const [addingRelation, setAddingRelation] = useState(false);
  const [newRelSource, setNewRelSource] = useState("");
  const [newRelTarget, setNewRelTarget] = useState("");
  const [newRelDesc, setNewRelDesc] = useState("");
  const [newRelKeywords, setNewRelKeywords] = useState("");
  const [newRelWeight, setNewRelWeight] = useState("");
  const [docFilter, setDocFilter] = useState<string>("__ALL__");
  const genRef = useRef(0);
  // P0 修复（P45 浏览器测试逮到）：删源成功后 setActiveSource 切到下一个源，会触发下方
  //   useEffect([activeSource]) 跑 loadDetail(activeSource)——它默认 keepNotice=false 会 setNotice("")，
  //   把删源结果 notice 在同一渲染周期冲掉，令 P0「notice 持续可见」对「删非末位源」路径失效。
  //   用此 ref 标志：仅删源联动的那次切源保留 notice；用户手动点选其它源仍照常清 notice。
  const keepNoticeOnSwitchRef = useRef(false);

  const loadDetail = async (sourceId: string, keepNotice = false) => {
    if (!sourceId) return;
    const gen = ++genRef.current;
    setLoading(true);
    if (!keepNotice) setNotice("");
    try {
      const d = await api(`admin/graph-curation/detail?sourceId=${encodeURIComponent(sourceId)}`);
      if (genRef.current !== gen) return;
      setDetail(d);
      setSelected([]);
    } catch (e) {
      if (genRef.current !== gen) return;
      setNotice(e instanceof Error ? e.message : "加载失败");
      setDetail(null);
    } finally {
      if (genRef.current === gen) setLoading(false);
    }
  };

  useEffect(() => {
    setSelected([]);
    setPending(null);
    setDetail(null);
    setEditing(null);
    setDocFilter("__ALL__");
    if (activeSource) void loadDetail(activeSource, keepNoticeOnSwitchRef.current);
    keepNoticeOnSwitchRef.current = false; // 用完即重置，只作用于紧跟其后的这一次切源
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource]);

  const toggleSelect = (name: string) =>
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const doMerge = async () => {
    const target = mergeTarget.trim() || selected[0];
    if (selected.length < 2 || !target) {
      setNotice("合并需要勾选 2 个及以上实体,并指定合并后的名字。");
      return;
    }
    setNotice("正在真实合并实体(改写 LightRAG 图谱)…");
    try {
      const r = await api("admin/graph-curation/merge", { method: "POST", body: JSON.stringify({ sourceId: activeSource, sourceEntities: selected, targetEntity: target }) });
      setNotice(r.message || "已合并");
      setMergeTarget("");
      await loadDetail(activeSource, true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "合并失败");
    }
  };

  const startEdit = (name: string, type: string, desc: string) => {
    setEditing(name);
    setEditName(name);
    setEditType(type);
    setEditDesc(desc);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setNotice("正在保存实体(改写 LightRAG 图谱)…");
    try {
      const r = await api("admin/graph-curation/entity/edit", { method: "POST", body: JSON.stringify({ sourceId: activeSource, entityName: editing, newName: editName, entityType: editType, description: editDesc }) });
      setNotice(r.message || "已保存");
      setEditing(null);
      await loadDetail(activeSource, true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "保存失败");
    }
  };

  const deleteEntity = async (name: string) => {
    setNotice(`正在删除实体「${name}」…`);
    try {
      const r = await api("admin/graph-curation/entity/delete", { method: "POST", body: JSON.stringify({ sourceId: activeSource, entityName: name }) });
      setNotice(r.message || "已删除");
      await loadDetail(activeSource, true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "删除失败");
    }
  };

  const deleteRelation = async (src: string, target: string) => {
    setNotice(`正在删除关系「${src}→${target}」…`);
    try {
      const r = await api("admin/graph-curation/relation/delete", { method: "POST", body: JSON.stringify({ sourceId: activeSource, sourceEntity: src, targetEntity: target }) });
      setNotice(r.message || "已删除关系");
      await loadDetail(activeSource, true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "删除失败");
    }
  };

  const createEntity = async () => {
    if (!newEntityName.trim() || !newEntityType.trim()) {
      setNotice("实体名和类型不能为空");
      return;
    }
    setNotice("正在新建实体(改写 LightRAG 图谱)…");
    try {
      const r = await api("admin/graph-curation/entity/create", { method: "POST", body: JSON.stringify({ sourceId: activeSource, entityName: newEntityName, entityType: newEntityType, description: newEntityDesc }) });
      setNotice(r.message || "已新建");
      setNewEntityName("");
      setNewEntityType("");
      setNewEntityDesc("");
      setAddingEntity(false);
      await loadDetail(activeSource, true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "新建实体失败");
    }
  };

  const createRelation = async () => {
    if (!newRelSource.trim() || !newRelTarget.trim()) {
      setNotice("源实体和目标实体不能为空");
      return;
    }
    const weight = newRelWeight.trim() ? Number(newRelWeight) : undefined;
    if (newRelWeight.trim() && !Number.isFinite(weight)) {
      setNotice("权重必须是数字");
      return;
    }
    setNotice("正在新建关系(改写 LightRAG 图谱)…");
    try {
      const r = await api("admin/graph-curation/relation/create", { method: "POST", body: JSON.stringify({ sourceId: activeSource, sourceEntity: newRelSource, targetEntity: newRelTarget, description: newRelDesc, keywords: newRelKeywords, weight }) });
      setNotice(r.message || "已新建");
      setNewRelSource("");
      setNewRelTarget("");
      setNewRelDesc("");
      setNewRelKeywords("");
      setNewRelWeight("");
      setAddingRelation(false);
      await loadDetail(activeSource, true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "新建关系失败");
    }
  };

  const deleteSource = async () => {
    setNotice("正在删除图谱源(级联清空实体/关系/文档)…");
    try {
      const r = await api("admin/graph-curation/source/delete", { method: "POST", body: JSON.stringify({ sourceId: activeSource }) });
      // Q4:后端删除失败仍返 ok:true 且把降级如实写进 message（如"清理 N/M 后端删除未成功,已仅清理平台引用"）。
      //   按业务 r.ok 分级——ok=false 时明确提示未完全成功,不吞警告（以 r.ok 兜底防未来后端改口径）。
      setNotice(r.message || (r.ok === false ? "删除未完全成功，请查看后端返回详情。" : "已删除"));
      // P0:局部从列表移除已删源并切到原位置的下一个源（尾部则回退到新末位,空列表清空）,notice 保持可见,
      //   不再整页 reload。注：后端删源无论模块侧成败都会清平台引用并返 ok:true（spec §一.3），故平台侧该源
      //   必然消失,本地列表移除是正确的;r.ok 只用于上面 notice 的成功/降级文案分级,不影响是否移除。
      const deletedId = activeSource;
      const deletedIndex = sourceList.findIndex((s) => s.sourceId === deletedId);
      const remaining = sourceList.filter((s) => s.sourceId !== deletedId);
      setSourceList(remaining);
      // 保住上面刚设的删除结果 notice，别被切源联动的 loadDetail 冲掉（见 keepNoticeOnSwitchRef 定义处）。
      keepNoticeOnSwitchRef.current = true;
      setActiveSource(remaining[Math.min(deletedIndex, remaining.length - 1)]?.sourceId ?? "");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "删除图谱源失败");
    }
  };

  const srcById = new Map(sourceList.map((s) => [s.sourceId, s]));

  const graphSourceSortOptions: { key: string; label: string; comparator: (a: CurationRailItem, b: CurationRailItem) => number }[] = [
    {
      key: "name",
      label: "源名",
      comparator: (a, b) => (srcById.get(a.id)?.name ?? "").localeCompare(srcById.get(b.id)?.name ?? "", "zh-Hans-CN"),
    },
    {
      key: "time",
      label: "入库时间",
      comparator: (a, b) => {
        const ta = srcById.get(a.id)?.createdAt;
        const tb = srcById.get(b.id)?.createdAt;
        if (!ta && !tb) return 0;
        if (!ta) return 1;
        if (!tb) return -1;
        return tb.localeCompare(ta);
      },
    },
  ];

  const entityDegree = (name: string) =>
    (detail?.relations ?? []).filter((r) => r.source === name || r.target === name).length;

  // 实体来源文档（provenance）：e.source 是 file_path，多文档共享实体用 <SEP> 拼接。
  const docsOf = (src: string) => (src || "").split("<SEP>").map((s) => s.trim()).filter(Boolean);
  const docOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of detail?.entities ?? []) {
      for (const d of docsOf(e.source)) if (!seen.has(d)) { seen.add(d); out.push(d); }
    }
    return out;
  }, [detail?.entities]);

  // useMemo 稳定引用：否则每次 render 重建数组 → CurationSearchList 的 [items] effect 把页码重置回第 1 页。
  // 按 docFilter 预过滤（__ALL__ 全留，否则留 source 含该文档的实体）；换源/reload/切文档时重算。
  const indexedEntities = useMemo(
    () =>
      (detail?.entities ?? [])
        .filter((e) => docFilter === "__ALL__" || docsOf(e.source).includes(docFilter))
        .map((e, i) => ({ ...e, _key: `${e.name}-${i}` })),
    [detail?.entities, docFilter],
  );

  // 关系列表同实体列表改用 CurationSearchList（分页+搜索），消除原 .curation-relation-list 的 620px 内滚小窗。
  // 稳定引用避免每 render 重建致页码重置；getKey 优先关系 id（同向多条关系时唯一），回退 source-target-index。
  const indexedRelations = useMemo(
    () => (detail?.relations ?? []).map((r, i) => ({ ...r, _key: r.id ?? `${r.source}-${r.target}-${i}` })),
    [detail?.relations],
  );

  const entitySortOptions: { key: string; label: string; comparator: (a: typeof indexedEntities[number], b: typeof indexedEntities[number]) => number }[] = [
    { key: "name", label: "名称", comparator: (a, b) => a.name.localeCompare(b.name, "zh-Hans-CN") },
    { key: "degree", label: "度数", comparator: (a, b) => entityDegree(b.name) - entityDegree(a.name) },
  ];

  return (
    <AdminShell active="/admin/knowledge-bases" title="关系图谱">
      <AdminPageHead
        eyebrow="关系图谱 · 可编辑工作台"
        title="直接增删改良知识图谱里的实体与关系"
        description="GraphRAG 抽取出的实体/关系会有重复、碎片、错连。这里可以合并重复实体、改名/改类型/补描述、删除噪声实体与错误关系——所有操作都真实改写 LightRAG 图谱存储,问答即时生效。"
      />
      <KnowledgeSubnav active="/admin/knowledge-bases/graph" />
      {notice ? <p className="admin-console-notice" role="status">{notice}</p> : null}

      {sourceList.length === 0 ? (
        <section className="admin-panel"><p className="monitoring-empty">还没有真实入库的 GraphRAG 图谱源。先在场景里上传图谱型资料并完成入库。</p></section>
      ) : (
        <>
          <section className="admin-panel">
            <PanelHead eyebrow="选择图谱源" title="按知识库 / 场景选择要 curate 的图谱" />
            <CurationSourceRail
              items={sourceList.map((s): CurationRailItem => ({ id: s.sourceId, primary: s.name, secondary: s.scenarioName || undefined }))}
              activeId={activeSource}
              onSelect={setActiveSource}
              searchPlaceholder="🔍 筛选图谱源…"
              sortOptions={graphSourceSortOptions}
            />
            {detail ? (
              <p className="curation-meta">实体 <b>{detail.entityCount}</b> · 关系 <b>{detail.relationCount}</b>{detail.duplicateNames.length ? <> · 疑似重复 <b className="curation-dup-count">{detail.duplicateNames.length}</b></> : null}</p>
            ) : null}
            {activeSource ? (
              <div className="curation-source-danger">
                <button type="button" className="curation-danger" onClick={() => setPending({ title: "删除图谱源", description: `删除后该源的全部实体、关系、文档将级联清空且不可恢复。符合条件的文本资料还会同步移除全域问答中的文档证据，且不可恢复。确认删除「${srcById.get(activeSource)?.name ?? activeSource}」吗？`, danger: true, confirmText: "删除图谱源", run: deleteSource })}>删除此图谱源</button>
              </div>
            ) : null}
          </section>

          {detail && detail.duplicateNames.length > 0 ? (
            <section className="admin-panel">
              <PanelHead eyebrow="去重建议" title="疑似重复实体(勾选下方同名实体后合并)" />
              <div className="curation-dup-chips">
                {detail.duplicateNames.map((d) => <span key={d}>{d}</span>)}
              </div>
            </section>
          ) : null}

          {/* 合并操作条 */}
          <section className="admin-panel curation-merge-bar">
            <div>
              <b>已勾选 {selected.length} 个实体</b>
              {selected.length > 0 ? <small>{selected.join("、")}</small> : <small>勾选 2 个及以上要合并的实体</small>}
            </div>
            <input type="text" placeholder={`合并后名字(默认「${selected[0] ?? ""}」)`} value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} />
            <button type="button" className="curation-primary" disabled={selected.length < 2} onClick={() => setPending({ title: "合并实体", description: `将把勾选的 ${selected.length} 个实体合并为一个，原实体会被替换，确认合并？`, confirmText: "合并", run: doMerge })}>合并为一个实体</button>
          </section>

          <section className="curation-grid">
            {/* 实体列表 */}
            <section className="admin-panel">
              <PanelHead eyebrow="实体" title={`实体列表${loading ? "(加载中…)" : ""}`} />
              <div className="curation-row-actions">
                <button type="button" onClick={() => setAddingEntity((v) => !v)}>＋ 新增实体</button>
              </div>
              {addingEntity ? (
                <div className="curation-edit-form">
                  <input value={newEntityName} onChange={(e) => setNewEntityName(e.target.value)} placeholder="实体名" />
                  <input value={newEntityType} onChange={(e) => setNewEntityType(e.target.value)} placeholder="类型(organization/person/concept…)" />
                  <textarea value={newEntityDesc} onChange={(e) => setNewEntityDesc(e.target.value)} placeholder="描述" rows={2} />
                  <div className="curation-edit-actions">
                    <button type="button" className="curation-primary" onClick={createEntity}>新建</button>
                    <button type="button" onClick={() => { setAddingEntity(false); setNewEntityName(""); setNewEntityType(""); setNewEntityDesc(""); }}>取消</button>
                  </div>
                </div>
              ) : null}
              {docOptions.length > 1 ? (
                <div className="curation-entity-sort">
                  <select className="curation-sort-select" value={docFilter} onChange={(e) => { setDocFilter(e.target.value); setSelected([]); setEditing(null); }}>
                    <option value="__ALL__">全部文档（{docOptions.length} 篇）</option>
                    {docOptions.map((d) => (<option key={d} value={d}>{d}</option>))}
                  </select>
                </div>
              ) : null}
              <CurationSearchList
                items={indexedEntities}
                getKey={(e) => e._key}
                filterPredicate={(e, q) => e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q)}
                searchPlaceholder="🔍 筛选实体…"
                pageSize={10}
                loading={loading}
                emptyLabel={docFilter === "__ALL__" ? "该图谱源暂无实体。" : "该文档暂无实体。"}
                countLabel={(n) => `共 ${n} 个实体`}
                sortOptions={entitySortOptions}
                renderItem={(e) => (
                  <article className={`curation-entity-item${selected.includes(e.name) ? " is-selected" : ""}`}>
                    {editing === e.name ? (
                      <div className="curation-edit-form">
                        <input value={editName} onChange={(ev) => setEditName(ev.target.value)} placeholder="实体名" />
                        <input value={editType} onChange={(ev) => setEditType(ev.target.value)} placeholder="类型(organization/person/concept…)" />
                        <textarea value={editDesc} onChange={(ev) => setEditDesc(ev.target.value)} placeholder="描述" rows={2} />
                        <div className="curation-edit-actions">
                          <button type="button" className="curation-primary" onClick={saveEdit}>保存</button>
                          <button type="button" onClick={() => setEditing(null)}>取消</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <label className="curation-entity-head">
                          <input type="checkbox" checked={selected.includes(e.name)} onChange={() => toggleSelect(e.name)} />
                          <b>{e.name}</b>
                          <span className="curation-type">{e.type}</span>
                        </label>
                        {e.description ? <p>{e.description}</p> : null}
                        <div className="curation-row-actions">
                          <button type="button" onClick={() => startEdit(e.name, e.type, e.description)}>编辑</button>
                          <button type="button" className="curation-danger" onClick={() => setPending({ title: "删除实体", description: `删除后不可恢复，确认删除实体「${e.name}」吗？`, danger: true, confirmText: "删除", run: () => deleteEntity(e.name) })}>删除</button>
                        </div>
                      </>
                    )}
                  </article>
                )}
              />
            </section>

            {/* 关系列表 */}
            <section className="admin-panel">
              <PanelHead eyebrow="关系" title="关系列表" />
              <div className="curation-row-actions">
                <button type="button" onClick={() => setAddingRelation((v) => !v)}>＋ 新增关系</button>
              </div>
              {addingRelation ? (
                <div className="curation-edit-form">
                  <input value={newRelSource} onChange={(e) => setNewRelSource(e.target.value)} placeholder="源实体" />
                  <input value={newRelTarget} onChange={(e) => setNewRelTarget(e.target.value)} placeholder="目标实体" />
                  <textarea value={newRelDesc} onChange={(e) => setNewRelDesc(e.target.value)} placeholder="描述" rows={2} />
                  <input value={newRelKeywords} onChange={(e) => setNewRelKeywords(e.target.value)} placeholder="关键词(可选,逗号分隔)" />
                  <input value={newRelWeight} onChange={(e) => setNewRelWeight(e.target.value)} placeholder="权重(可选数字)" />
                  <div className="curation-edit-actions">
                    <button type="button" className="curation-primary" onClick={createRelation}>新建</button>
                    <button type="button" onClick={() => { setAddingRelation(false); setNewRelSource(""); setNewRelTarget(""); setNewRelDesc(""); setNewRelKeywords(""); setNewRelWeight(""); }}>取消</button>
                  </div>
                </div>
              ) : null}
              <CurationSearchList
                items={indexedRelations}
                getKey={(r) => r._key}
                filterPredicate={(r, q) => r.source.toLowerCase().includes(q) || r.target.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)}
                searchPlaceholder="🔍 筛选关系…"
                pageSize={10}
                loading={loading}
                emptyLabel="该图谱源暂无关系。"
                countLabel={(n) => `共 ${n} 条关系`}
                renderItem={(r) => (
                  <article className="curation-relation-item">
                    <div className="curation-relation-head">
                      <b>{r.source}</b><span>→</span><b>{r.target}</b>
                    </div>
                    {r.description ? <p>{r.description}</p> : null}
                    <button type="button" className="curation-danger" onClick={() => setPending({ title: "删除关系", description: `确认删除关系「${r.source} → ${r.target}」吗？`, danger: true, confirmText: "删除", run: () => deleteRelation(r.source, r.target) })}>删除关系</button>
                  </article>
                )}
              />
            </section>
          </section>
        </>
      )}
      <ConfirmDialog
        open={!!pending}
        title={pending?.title ?? ""}
        description={pending?.description}
        danger={pending?.danger}
        confirmText={pending?.confirmText}
        onConfirm={() => { const p = pending; setPending(null); if (p) p.run(); }}
        onCancel={() => setPending(null)}
      />
    </AdminShell>
  );
}
