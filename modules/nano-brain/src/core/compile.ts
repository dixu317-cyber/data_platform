// 014 · T2 · FR-363/364/366/368 · §5.3/§6.1/§7.1/§7.5:单源编译 v1。
//   compileSource(rawDocumentId) → 调 LLM 网关通读原文 → 结构化条目 {概览/大纲/分节/要点} 落 pages(source_entry),
//   每分节 → page_provenance 指向原文真 span(char 区间落 raw_body 内、quote 为原文子串),忠实度自检写 metadata.fidelity。
//   长文按 raw_chunks 分段 map-reduce,分节溯源不因分段丢失(§7.1 长文)。
//   LLM 客户端注入(CompileLlmClient),测试在接口层 patch/spy(确定性验结构映射+溯源硬映射,真 LLM 归 AM-1417)。
import { createHash, randomUUID } from 'node:crypto';
import { getNanoBrainPool } from '../db';
import type { CompileLlmClient } from './llm';
import { prepareChunksForMarkdown, replacePageChunks } from './chunks';
import { replacePageLinks } from './links';
import { getRawDocument, listRawChunks, type RawChunkRow, type RawDocument } from './raw-documents';
import { slugify } from './slug';

// 编译提示词版本;compile_version 变才全量重编(§6.3 prompt 版本门)。
export const COMPILE_PROMPT_VERSION = 'compile.v1';

// 长文分段字符预算:一段原文累计字符 ≤ 此值(按 raw_chunks 整片累加,至少 1 片/段)。
//   短文(< 预算)→ 1 段(segments==1);长文(> 预算)→ 多段(segments>1,FR-368)。
export const COMPILE_SEGMENT_CHAR_BUDGET = 4000;

// 014 · T5 · 编译粒度档位(具名常量,FR-375/377 · AM-1416)。魔法字面量禁用,一律引这三个常量。
//   档位真影响产物形态(非回显存值):文档级=整篇 1 source_entry;段落级=单文件按大分节拆多 sub-source_entry;
//   主题级=在 source_entry 之上叠加 theme_entry(聚合走 theme-compile,本 param 只保 source_entry 单条)。
//   承 009 业务档位范式(业务语义档位 → 底层 param)。
export const GRANULARITY_DOCUMENT = 'document';
export const GRANULARITY_THEME = 'theme';
export const GRANULARITY_PARAGRAPH = 'paragraph';
export type CompileGranularity =
  | typeof GRANULARITY_DOCUMENT
  | typeof GRANULARITY_THEME
  | typeof GRANULARITY_PARAGRAPH;

export type CompileSourceInput = {
  rawDocumentId: string;
  llm: CompileLlmClient;
  compileVersion?: string;
  granularity?: CompileGranularity;
  segmentCharBudget?: number;
  // 显式重编触发(内容变更 / 版本升级 / failed 重试,由上游 compile 相位 plan 决策)绕过幂等守卫。
  force?: boolean;
};

export type CompileOutcome = {
  // 'unchanged' = 幂等守卫命中(同 content_hash + compile_version 已 compiled),未调 LLM、未重写条目。
  status: 'compiled' | 'skipped' | 'unchanged';
  pageId?: string;
  slug?: string;
  // 产出的 source_entry 条目数:文档级/主题级 =1(整篇一条目),段落级 = 大分节数(单文件派生多条目,AM-1416)。
  entryCount: number;
  segments: number;
  sectionsTotal: number;
  sectionsCited: number;
  uncitedSections: number;
  fidelityFlag: 'ok' | 'low';
};

// 原文分段:把 raw_chunks 按字符预算成组(至少 1 片/段),段边界 = 组内首片 charStart ~ 末片 charEnd。
type Segment = { index: number; charStart: number; charEnd: number };

export function segmentRawChunks(chunks: RawChunkRow[], budget: number = COMPILE_SEGMENT_CHAR_BUDGET): Segment[] {
  const limit = Math.max(1, Math.floor(budget));
  const segments: Segment[] = [];
  let curStart: number | null = null;
  let curEnd = 0;
  for (const c of chunks) {
    if (curStart === null) {
      curStart = c.charStart;
      curEnd = c.charEnd;
      continue;
    }
    // 若加入当前片会超预算,且当前段已非空 → 封段,另起一段。
    if (c.charEnd - curStart > limit) {
      segments.push({ index: segments.length, charStart: curStart, charEnd: curEnd });
      curStart = c.charStart;
      curEnd = c.charEnd;
    } else {
      curEnd = c.charEnd;
    }
  }
  if (curStart !== null) segments.push({ index: segments.length, charStart: curStart, charEnd: curEnd });
  return segments;
}

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// 014 · B3 复审修复(codex Round-2 BLOCK):编译条目 slug 改回 canonical 标题 slug(与共享 slug.ts 同源,
//   与 /nano/pages 直建路径同款算法),不再拼 rawDoc 短码——文档级=整篇一条目、一标题一页,靠既有
//   UNIQUE(source_id, slug) upsert 去重(同源同标题=同页,重编幂等,与直建路径行为一致)。
//   canonical slug 同时让 [[标题]] wiki 链经 links.ts 的 slugify 归一后能精确解析到该编译页(B5)。
//   精确归属职责改由 page.metadata.raw_document_id 承担(见 compileSource 内 planMetadata),不再靠 slug 编码归属。
export function resolveEntrySlug(doc: RawDocument): string {
  return slugify(doc.title) || 'entry';
}

// 014 · B2 复审修复:暴露 raw_document 粒度的编译状态查询,供平台层(platform-store.ingestGbrainFile)
//   按"该 raw_document 是否真编译成功(status='compiled' 且 content_hash 匹配当前正文)"校验,
//   而非凭 dream run 级 status(skipped/partial 不代表该文件真编译)。
export type CompileStateInfo = {
  status: string;
  contentHash: string;
  compileVersion: string;
  compiledPageId: string | null;
};

export async function getCompileState(rawDocumentId: string): Promise<CompileStateInfo | null> {
  const pool = getNanoBrainPool();
  const result = await pool.query<{ status: string; content_hash: string; compile_version: string; compiled_page_id: string | null }>(
    `SELECT status, content_hash, compile_version, compiled_page_id FROM raw_document_compile_state WHERE raw_document_id = $1`,
    [rawDocumentId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { status: row.status, contentHash: row.content_hash, compileVersion: row.compile_version, compiledPageId: row.compiled_page_id };
}

// 组装好的分节(已分配全局 order / section_id)。
type AssembledSection = {
  sectionId: string;
  heading: string;
  level: number;
  order: number;
  content: string;
  evidence: string[];
  segCharStart: number;
  segCharEnd: number;
};

type OutlineItem = { section_id: string; heading: string; level: number; order: number };

type ProvenanceRow = {
  sectionId: string;
  rawChunkId: string | null;
  charStart: number;
  charEnd: number;
  quote: string;
};

// 溯源映射:把分节的 evidence 逐字子串定位回 raw_body(限定在该分节所属分段区间内搜索),
//   命中 → char 区间(落 raw_body 内)+ quote(==raw_body.slice)+ 覆盖该位置的 raw_chunk。定位失败 → 无溯源(uncited)。
function mapProvenance(section: AssembledSection, rawBody: string, chunks: RawChunkRow[]): ProvenanceRow[] {
  const rows: ProvenanceRow[] = [];
  for (const evidence of section.evidence) {
    if (!evidence) continue;
    const idx = rawBody.indexOf(evidence, section.segCharStart);
    if (idx < 0) continue; // 无法对齐原文
    const charStart = idx;
    const charEnd = idx + evidence.length;
    // 越界防御:必须严格落在 raw_body 内且不超出所属分段区间。
    if (!(charStart >= 0 && charStart < charEnd && charEnd <= rawBody.length && charEnd <= section.segCharEnd)) continue;
    const quote = rawBody.slice(charStart, charEnd); // === evidence,溯源为原文子串
    const chunk = chunks.find((c) => c.charStart <= charStart && charStart < c.charEnd) ?? null;
    rows.push({ sectionId: section.sectionId, rawChunkId: chunk ? chunk.id : null, charStart, charEnd, quote });
  }
  return rows;
}

function buildBodyMarkdown(title: string, summary: string, sections: AssembledSection[], keyPoints: string[]): string {
  const parts: string[] = [`# ${title}`, ''];
  if (summary.trim()) {
    parts.push('## 概览', '', summary.trim(), '');
  }
  for (const s of sections) {
    parts.push(`## ${s.heading}`, '', s.content.trim(), '');
  }
  if (keyPoints.length > 0) {
    parts.push('## 要点', '', ...keyPoints.map((k) => `- ${k}`), '');
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * 单源编译 v1:通读 → 结构化条目 + 溯源硬映射 + 忠实度自检,原子落 pages(source_entry)+ page_provenance +
 *   raw_document_compile_state。LLM 网关不可用(client.compile 返回 null)→ status='skipped' 不伪造条目(§6.4)。
 */
export async function compileSource(input: CompileSourceInput): Promise<CompileOutcome> {
  const doc = await getRawDocument(input.rawDocumentId);
  if (!doc) throw new Error(`raw_document 不存在: ${input.rawDocumentId}`);
  const compileVersion = input.compileVersion ?? COMPILE_PROMPT_VERSION;
  const granularity: CompileGranularity = input.granularity ?? GRANULARITY_DOCUMENT;

  // 幂等守卫(FR-371 · §6.3 · AM-1411):同 raw_document 同 content_hash + 同 compile_version 已 compiled
  //   → 跳过不重编、LLM 零调用、无重复条目。force=true(上游 plan 决策的显式重编)绕过。
  if (!input.force) {
    const guardPool = getNanoBrainPool();
    const prior = await guardPool.query<{ status: string; content_hash: string; compile_version: string; compiled_page_id: string | null }>(
      `SELECT status, content_hash, compile_version, compiled_page_id FROM raw_document_compile_state WHERE raw_document_id = $1`,
      [doc.id],
    );
    const row = prior.rows[0];
    if (row && row.status === 'compiled' && row.content_hash === doc.contentHash && row.compile_version === compileVersion) {
      return {
        status: 'unchanged',
        pageId: row.compiled_page_id ?? undefined,
        slug: resolveEntrySlug(doc),
        entryCount: 1,
        segments: 0,
        sectionsTotal: 0,
        sectionsCited: 0,
        uncitedSections: 0,
        fidelityFlag: 'ok',
      };
    }
  }

  const chunks = await listRawChunks(doc.id);
  const rawBody = doc.rawBody;
  const segments = chunks.length > 0 ? segmentRawChunks(chunks, input.segmentCharBudget) : [{ index: 0, charStart: 0, charEnd: rawBody.length }];

  // 逐段调 LLM 通读(map);任一段网关不可用 → 诚实降级 skipped(不伪造)。
  const assembled: AssembledSection[] = [];
  const summaries: string[] = [];
  const keyPoints: string[] = [];
  let model = '';
  let order = 0;
  for (const seg of segments) {
    const rawText = rawBody.slice(seg.charStart, seg.charEnd);
    const result = await input.llm.compile({
      rawText,
      title: doc.title,
      segmentIndex: seg.index,
      segmentCount: segments.length,
    });
    if (result === null) {
      return { status: 'skipped', entryCount: 0, segments: segments.length, sectionsTotal: 0, sectionsCited: 0, uncitedSections: 0, fidelityFlag: 'ok' };
    }
    if (result.model && !model) model = result.model;
    if (result.summary && result.summary.trim()) summaries.push(result.summary.trim());
    if (Array.isArray(result.keyPoints)) keyPoints.push(...result.keyPoints);
    for (const s of result.sections) {
      order += 1;
      assembled.push({
        sectionId: `s${order}`,
        heading: s.heading,
        level: s.level,
        order,
        content: s.content,
        evidence: s.evidence,
        segCharStart: seg.charStart,
        segCharEnd: seg.charEnd,
      });
    }
  }

  const summary = summaries.join('\n\n');

  // 溯源映射(reduce):逐分节把 evidence 落回原文 span(每分节各自一组 rows,供档位分条目记账)。
  const provBySection = new Map<string, ProvenanceRow[]>();
  for (const section of assembled) {
    provBySection.set(section.sectionId, mapProvenance(section, rawBody, chunks));
  }

  // 粒度档位 → 条目切分(AM-1416,非回显:档位真影响产物形态,非同一输出回显不同值)。
  //   - 段落级(GRANULARITY_PARAGRAPH):单文件按大分节拆多 sub-source_entry(每分节一条目、单文件条目数 >1);
  //   - 文档级 / 主题级:整篇一条目(概览 + 全分节 + 要点;主题级的 theme_entry 由 theme-compile 叠加,此处保 source_entry 单条)。
  type EntryPlan = { slug: string; title: string; sections: AssembledSection[]; provenance: ProvenanceRow[]; summary: string; keyPoints: string[] };
  const baseSlug = resolveEntrySlug(doc);
  const plans: EntryPlan[] = [];
  if (granularity === GRANULARITY_PARAGRAPH && assembled.length > 1) {
    for (const section of assembled) {
      plans.push({
        slug: `${baseSlug}-s${section.order}`,
        title: `${doc.title} · ${section.heading}`,
        sections: [section],
        provenance: provBySection.get(section.sectionId) ?? [],
        summary: '',
        keyPoints: [],
      });
    }
  } else {
    plans.push({
      slug: baseSlug,
      title: doc.title,
      sections: assembled,
      provenance: assembled.flatMap((s) => provBySection.get(s.sectionId) ?? []),
      summary,
      keyPoints,
    });
  }

  // embedding 是慢 I/O；先在事务外为每个编译条目准备索引，事务内只做原子替换。
  // 这与 /nano/pages 的 prepare → BEGIN → replace 顺序一致，避免长事务占用连接。
  const preparedPlans = await Promise.all(
    plans.map(async (plan) => {
      const body = buildBodyMarkdown(plan.title, plan.summary, plan.sections, plan.keyPoints);
      return { plan, body, chunks: await prepareChunksForMarkdown(body) };
    }),
  );

  const pool = getNanoBrainPool();
  const client = await pool.connect();
  const pageIds: string[] = [];
  let aggSectionsTotal = 0;
  let aggSectionsCited = 0;
  try {
    await client.query('BEGIN');
    for (const { plan, body: planBody, chunks: preparedChunks } of preparedPlans) {
      const planOutline: OutlineItem[] = plan.sections.map((s) => ({ section_id: s.sectionId, heading: s.heading, level: s.level, order: s.order }));
      // 忠实度自检(FR-366):无对应 provenance 的分节 → uncited;flag=low(缺陷可观察,不静默当成功)。
      const planSectionsCited = new Set(plan.provenance.map((r) => r.sectionId)).size;
      const planSectionsTotal = plan.sections.length;
      const planUncited = planSectionsTotal - planSectionsCited;
      const planFlag: 'ok' | 'low' = planUncited > 0 ? 'low' : 'ok';
      aggSectionsTotal += planSectionsTotal;
      aggSectionsCited += planSectionsCited;

      const planHash = hashContent(planBody);
      const planMetadata = {
        entry: { summary: plan.summary, outline: planOutline, key_points: plan.keyPoints },
        compile: {
          model,
          prompt_version: compileVersion,
          segments: segments.length,
          token_cost: { prompt: 0, completion: 0 },
          latency_ms: 0,
          error: null,
        },
        fidelity: {
          sections_total: planSectionsTotal,
          sections_cited: planSectionsCited,
          uncited_sections: planUncited,
          flag: planFlag,
        },
        granularity,
        // B3 复审修复:精确归属靠 metadata,不再靠 slug 编码(32-bit 短码有生日碰撞 + 无法证明归属)。
        //   平台层(ingestGbrainFile)据此校验查回的编译页确实对应本次入库的 raw_document。
        raw_document_id: doc.id,
        raw_document_content_hash: doc.contentHash,
      };

      const upserted = await client.query(
        `
          INSERT INTO pages (
            id, source_id, slug, title, body, content_hash, created_by, updated_by,
            entry_kind, compile_status, compile_version, granularity, metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 'source_entry', 'compiled', $8, $9, $10::jsonb)
          ON CONFLICT (source_id, slug)
          DO UPDATE SET
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            content_hash = EXCLUDED.content_hash,
            updated_by = EXCLUDED.updated_by,
            updated_at = now(),
            entry_kind = 'source_entry',
            compile_status = 'compiled',
            compile_version = EXCLUDED.compile_version,
            granularity = EXCLUDED.granularity,
            metadata = EXCLUDED.metadata,
            archived_at = NULL,
            archived_by = NULL
          RETURNING id
        `,
        [randomUUID(), doc.sourceId, plan.slug, plan.title, planBody, planHash, doc.createdBy, compileVersion, granularity, JSON.stringify(planMetadata)],
      );
      const pageId: string = upserted.rows[0].id;
      pageIds.push(pageId);

      // 重编幂等:先清旧溯源再写新,避免重复条目。
      await client.query('DELETE FROM page_provenance WHERE page_id = $1', [pageId]);
      for (const row of plan.provenance) {
        await client.query(
          `
            INSERT INTO page_provenance (
              id, page_id, source_id, section_id, assertion_ordinal, raw_document_id, raw_chunk_id, char_start, char_end, quote, confidence
            )
            VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, 1.0)
          `,
          [randomUUID(), pageId, doc.sourceId, row.sectionId, doc.id, row.rawChunkId, row.charStart, row.charEnd, row.quote],
        );
      }

      await replacePageChunks(client, { pageId, sourceId: doc.sourceId, slug: plan.slug, chunks: preparedChunks });
      // B5 方案1(已拍板):抽链源改用原始 raw markdown(doc.rawBody),不用 LLM 改写后的 planBody——
      //   作者手写的 [[]] 链不因编译改写正文而丢失。chunks 仍从 planBody 生成(检索走结构化正文,互链走原文,各取所需)。
      await replacePageLinks(client, { pageId, sourceId: doc.sourceId, fromSlug: plan.slug, body: doc.rawBody, createdBy: doc.createdBy });
    }

    // 增量状态一行/文件(compiled_page_id 指向首条目;段落级多条目共此状态行,同 hash+version 幂等跳过)。
    await client.query(
      `
        INSERT INTO raw_document_compile_state (
          raw_document_id, source_id, compile_version, content_hash, compiled_page_id, status, processed_at
        )
        VALUES ($1, $2, $3, $4, $5, 'compiled', now())
        ON CONFLICT (raw_document_id)
        DO UPDATE SET
          compile_version = EXCLUDED.compile_version,
          content_hash = EXCLUDED.content_hash,
          compiled_page_id = EXCLUDED.compiled_page_id,
          status = 'compiled',
          processed_at = now()
      `,
      [doc.id, doc.sourceId, compileVersion, doc.contentHash, pageIds[0] ?? null],
    );

    await client.query('COMMIT');
    const aggUncited = aggSectionsTotal - aggSectionsCited;
    return {
      status: 'compiled',
      pageId: pageIds[0],
      slug: plans[0]!.slug,
      entryCount: plans.length,
      segments: segments.length,
      sectionsTotal: aggSectionsTotal,
      sectionsCited: aggSectionsCited,
      uncitedSections: aggUncited,
      fidelityFlag: aggUncited > 0 ? 'low' : 'ok',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
