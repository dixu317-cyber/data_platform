"use client";

import { useEffect, useState, useRef } from "react";

import { AdminShell, AdminPageHead, PanelHead, KnowledgeSubnav } from "./admin-pages";
import { ConfirmDialog } from "./admin-confirm-dialog";
import { CurationSourceRail, CurationSearchList, type CurationRailItem } from "./curation-master-detail";
import type { NaiveDocument, DocChunk, GbrainPageSource, KnowledgePageItem } from "@ff/platform/platform-store";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`/api/platform/${path}`, { headers: { "content-type": "application/json" }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || `请求失败 ${res.status}`);
  return data;
}

// ========== 文档型:文档 → chunk 浏览 / 删除噪声 chunk ==========
export function AdminDocCurationWorkbench({ documents }: { documents: NaiveDocument[] }) {
  const [active, setActive] = useState(documents[0]?.documentId ?? "");
  const [pending, setPending] = useState<{ title: string; description: string; danger?: boolean; confirmText?: string; run: () => void } | null>(null);
  const [chunks, setChunks] = useState<DocChunk[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const genRef = useRef(0);

  const load = async (documentId: string, keep = false) => {
    if (!documentId) return;
    const gen = ++genRef.current;
    setLoading(true);
    if (!keep) setNotice("");
    try {
      const d = await api(`admin/doc-curation/chunks?documentId=${encodeURIComponent(documentId)}`);
      if (genRef.current !== gen) return;
      setChunks(d.chunks ?? []);
    } catch (e) {
      if (genRef.current !== gen) return;
      setNotice(e instanceof Error ? e.message : "加载失败");
      setChunks([]);
    } finally {
      if (genRef.current === gen) setLoading(false);
    }
  };

  useEffect(() => {
    setPending(null);
    setChunks([]);
    if (active) void load(active);
    /* eslint-disable-next-line */
  }, [active]);

  const remove = async (chunkId: string) => {
    setNotice("正在删除 chunk(真删 traditional_chunks)…");
    try {
      const r = await api("admin/doc-curation/chunk/delete", { method: "POST", body: JSON.stringify({ documentId: active, chunkId }) });
      setNotice(r.message || "已删除");
      await load(active, true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "删除失败");
    }
  };

  const docById = new Map(documents.map((d) => [d.documentId, d]));

  const docSortOptions: {
    key: string;
    label: string;
    comparator: (a: CurationRailItem, b: CurationRailItem) => number;
  }[] = [
    {
      key: "name",
      label: "文档名",
      comparator: (a, b) => {
        const an = docById.get(a.id)?.name ?? "";
        const bn = docById.get(b.id)?.name ?? "";
        return an.localeCompare(bn, "zh-Hans-CN");
      },
    },
    {
      key: "time",
      label: "入库时间",
      comparator: (a, b) => {
        const av = docById.get(a.id)?.createdAt ?? "";
        const bv = docById.get(b.id)?.createdAt ?? "";
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return bv.localeCompare(av);
      },
    },
  ];

  const chunkSortOptions: {
    key: string;
    label: string;
    comparator: (a: DocChunk, b: DocChunk) => number;
  }[] = [
    {
      key: "index",
      label: "序号",
      comparator: (a, b) => a.chunkIndex - b.chunkIndex,
    },
    {
      key: "chars",
      label: "字数",
      comparator: (a, b) => b.charCount - a.charCount,
    },
  ];

  return (
    <AdminShell active="/admin/knowledge-bases" title="Naive RAG 管理">
      <AdminPageHead eyebrow="文档型 · 可编辑管理" title="按文档查看切分 chunk,删除噪声片段" description="文档型知识按 chunk 切分后向量检索。这里能看到每个文档真实切出的 chunk,删除空白/页眉页脚/乱码等噪声 chunk——直接改写 traditional_chunks,检索即时生效。" />
      <KnowledgeSubnav active="/admin/knowledge-bases/naive" />
      {notice ? <p className="admin-console-notice" role="status">{notice}</p> : null}
      {documents.length === 0 ? (
        <section className="admin-panel"><p className="monitoring-empty">还没有真实入库的文档型资料。</p></section>
      ) : (
        <section className="admin-panel curation-master-detail">
          <aside className="curation-rail-panel">
            <PanelHead eyebrow="选择文档" title="按文档查看 chunk" />
            {/* TODO(P18): 左列 chunk 数徽标——ref.metadata.chunkCount 已入库(platform-store ~4575)，
                但需要改 NaiveDocument 类型 + listNaiveDocuments（未在本轮授权范围内），跳过标记待下批。 */}
            <CurationSourceRail
              items={documents.map((d): CurationRailItem => ({ id: d.documentId, primary: d.name, secondary: d.scenarioName || undefined }))}
              activeId={active}
              onSelect={setActive}
              searchPlaceholder="🔍 筛选文档…"
              sortOptions={docSortOptions}
            />
          </aside>
          <section className="curation-detail-panel">
            <PanelHead eyebrow="chunk 列表" title="每个 chunk 的真实切分内容" />
            <CurationSearchList
              key={active}
              items={chunks}
              getKey={(c) => c.id}
              filterPredicate={(c, q) => c.text.toLowerCase().includes(q)}
              searchPlaceholder="🔍 搜 chunk"
              loading={loading}
              emptyLabel="该文档暂无 chunk。"
              countLabel={(n) => `共 ${n} 个 chunk`}
              sortOptions={chunkSortOptions}
              renderItem={(c) => (
                <article className="curation-chunk-item">
                  <header><b>#{c.chunkIndex}</b><span>{c.charCount} 字</span><button type="button" className="curation-danger" onClick={() => setPending({ title: "删除 chunk", description: `确认删除 #${c.chunkIndex} chunk？删除后不可恢复（直接改写 traditional_chunks）。`, danger: true, confirmText: "删除", run: () => remove(c.id) })}>删除</button></header>
                  <p>{c.text}</p>
                </article>
              )}
            />
          </section>
        </section>
      )}
      <ConfirmDialog open={pending !== null} title={pending?.title ?? ""} description={pending?.description ?? ""} danger={pending?.danger} confirmText={pending?.confirmText} onConfirm={() => { const p = pending; setPending(null); if (p) p.run(); }} onCancel={() => setPending(null)} />
    </AdminShell>
  );
}

// ========== 知识页型:页面浏览 / 编辑标题正文(真改+重索引) ==========
export function AdminPageCurationWorkbench({ sources }: { sources: GbrainPageSource[] }) {
  const [active, setActive] = useState(sources[0]?.bucketId ?? "");
  const [pending, setPending] = useState<{ title: string; description: string; danger?: boolean; confirmText?: string; run: () => void } | null>(null);
  const [pages, setPages] = useState<KnowledgePageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<{ sourceId: string; slug: string } | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const genRef = useRef(0);

  const load = async (bucketId: string, keep = false) => {
    if (!bucketId) return;
    const gen = ++genRef.current;
    setLoading(true);
    if (!keep) setNotice("");
    try {
      const d = await api(`admin/page-curation/pages?bucketId=${encodeURIComponent(bucketId)}`);
      if (genRef.current !== gen) return;
      setPages(d.pages ?? []);
    } catch (e) {
      if (genRef.current !== gen) return;
      setNotice(e instanceof Error ? e.message : "加载失败");
      setPages([]);
    } finally {
      if (genRef.current === gen) setLoading(false);
    }
  };

  useEffect(() => {
    setEditing(null);
    setPending(null);
    setPages([]);
    if (active) void load(active);
    /* eslint-disable-next-line */
  }, [active]);

  const pageKey = (p: KnowledgePageItem) => `${p.sourceId}:${p.pageId ?? p.slug}`;
  const isEditing = (p: KnowledgePageItem) => editing?.sourceId === p.sourceId && editing.slug === p.slug;
  const startEdit = (p: KnowledgePageItem) => { setEditing({ sourceId: p.sourceId, slug: p.slug }); setTitle(p.title); setBody(p.body); };

  const save = async () => {
    if (!editing) return;
    setNotice("正在保存知识页(真改 + 重新索引)…");
    try {
      const r = await api("admin/page-curation/page/edit", { method: "POST", body: JSON.stringify({ sourceId: editing.sourceId, slug: editing.slug, title, body }) });
      setNotice(r.message || "已保存");
      setEditing(null);
      await load(active, true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "保存失败");
    }
  };

  const gbrainSortOptions: {
    key: string;
    label: string;
    comparator: (a: KnowledgePageItem, b: KnowledgePageItem) => number;
  }[] = [
    {
      key: "updated",
      label: "更新时间",
      comparator: (a, b) => {
        const av = a.updatedAt ?? "";
        const bv = b.updatedAt ?? "";
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return bv.localeCompare(av);
      },
    },
    {
      key: "title",
      label: "标题",
      comparator: (a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"),
    },
  ];

  return (
    <AdminShell active="/admin/knowledge-bases" title="Gbrain 管理">
      <AdminPageHead eyebrow="知识页型 · 可编辑管理" title="编辑结构化知识页的标题与正文" description="知识页型是人工/编译生成的结构化页面。这里可以直接修订页面标题与 Markdown 正文,保存后真实写回并重新切分索引——比删 chunk 更适合纠正事实、补充内容。" />
      <KnowledgeSubnav active="/admin/knowledge-bases/gbrain" />
      {notice ? <p className="admin-console-notice" role="status">{notice}</p> : null}
      {sources.length === 0 ? (
        <section className="admin-panel"><p className="monitoring-empty">还没有真实入库的知识页型资料。</p></section>
      ) : (
        <section className="admin-panel curation-master-detail">
          <aside className="curation-rail-panel">
            <PanelHead eyebrow="选择知识库" title="按知识库查看页面" />
            <CurationSourceRail
              items={sources.map((s): CurationRailItem => ({ id: s.bucketId, primary: s.name, secondary: s.scenarioName || undefined, badge: `${s.pageCount} 页` }))}
              activeId={active}
              onSelect={setActive}
              searchPlaceholder="🔍 筛选空间…"
            />
          </aside>
          <section className="curation-detail-panel">
            <PanelHead eyebrow="知识页" title="页面标题与正文(可编辑)" />
            <CurationSearchList
              key={active}
              items={pages}
              getKey={pageKey}
              filterPredicate={(p, q) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q)}
              searchPlaceholder="🔍 搜标题/正文"
              loading={loading}
              emptyLabel="该知识库暂无页面。"
              countLabel={(n) => `共 ${n} 个知识页`}
              sortOptions={gbrainSortOptions}
              renderItem={(p) => (
                <article className="curation-page-item">
                  {isEditing(p) ? (
                    <div className="curation-edit-form">
                      <p className="curation-edit-slug">slug：{p.slug}</p>
                      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
                      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder="Markdown 正文" />
                      <div className="curation-edit-actions">
                        <button type="button" className="curation-primary" onClick={() => setPending({ title: "确认覆盖知识页", description: "保存将覆盖该知识页正文并重新索引，确认覆盖？", confirmText: "保存", run: save })}>保存并重索引</button>
                        <button type="button" onClick={() => setEditing(null)}>取消</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <header><b>{p.title}</b><button type="button" onClick={() => startEdit(p)}>编辑</button></header>
                      {p.scenarioName ? <p className="curation-page-scenario">场景 · {p.scenarioName}</p> : null}
                      <pre>{p.body.slice(0, 600)}{p.body.length > 600 ? "…" : ""}</pre>
                    </>
                  )}
                </article>
              )}
            />
          </section>
        </section>
      )}
      <ConfirmDialog open={pending !== null} title={pending?.title ?? ""} description={pending?.description ?? ""} danger={pending?.danger} confirmText={pending?.confirmText} onConfirm={() => { const p = pending; setPending(null); if (p) p.run(); }} onCancel={() => setPending(null)} />
    </AdminShell>
  );
}
