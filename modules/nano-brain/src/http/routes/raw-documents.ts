import { Hono } from 'hono';
import { getCompileState } from '../../core/compile';
import { assertCanReadSource, assertCanWriteSource } from '../../core/permissions';
import { getRawDocument, persistRawDocument } from '../../core/raw-documents';
import { getSourceById, NanoBrainError } from '../../core/sources';
import { internalRoute } from '../route';

// 后台入库 → 原文入库(raw_documents)入口:让 014 compile 相位有料可编(此前无 HTTP 端点,
// 编译只在 nano 测试内跑过,生产 Gbrain 入库走 /nano/pages 直建原文页、从不编译)。
// 入库落 raw_document 后由 dream compile 相位(带 granularity)编译成 source_entry 结构化条目。
export const rawDocumentsRouter = new Hono();

rawDocumentsRouter.post(
  '/nano/raw-documents',
  internalRoute('原文入库失败', async (c, ctx) => {
    const body = await c.req.json();
    const sourceId = String(body.source_id ?? '').trim();
    if (!sourceId) throw new NanoBrainError('source_id 必填', 'invalid_input');
    const source = await getSourceById(sourceId);
    if (!source) throw new NanoBrainError('source 不存在', 'not_found');
    assertCanWriteSource(ctx, source);

    const rawBody = body.body ?? body.raw_body;
    if (typeof rawBody !== 'string' || rawBody.length === 0) {
      throw new NanoBrainError('原文 body 必填', 'invalid_input');
    }
    const externalRef = String(body.external_ref ?? '').trim();
    if (!externalRef) throw new NanoBrainError('external_ref 必填(同源同 ref 幂等 upsert)', 'invalid_input');

    const doc = await persistRawDocument({
      sourceId,
      externalRef,
      title: String(body.title ?? externalRef),
      contentType: String(body.content_type ?? 'text/markdown'),
      rawBody,
      createdBy: ctx.userId,
    });
    return c.json({
      raw_document: { id: doc.id, source_id: doc.sourceId, external_ref: doc.externalRef, title: doc.title, content_hash: doc.contentHash }
    }, 201);
  }),
);

// B2 复审修复(codex Round-2 BLOCK):平台层需要按具体 raw_document 校验"真编译成功"(status='compiled'
//   且 content_hash 匹配当前正文),不能凭 dream run 级 status(skipped/partial 不代表该文件真编译)。
rawDocumentsRouter.get(
  '/nano/raw-documents/:id/compile-state',
  internalRoute('读取原文编译状态失败', async (c, ctx) => {
    const rawDocumentId = c.req.param('id') ?? '';
    const doc = await getRawDocument(rawDocumentId);
    if (!doc) throw new NanoBrainError('raw_document 不存在', 'not_found');
    const source = await getSourceById(doc.sourceId);
    if (!source) throw new NanoBrainError('source 不存在', 'not_found');
    assertCanReadSource(ctx, source);

    const state = await getCompileState(rawDocumentId);
    return c.json({
      compile_state: state
        ? {
            raw_document_id: rawDocumentId,
            status: state.status,
            content_hash: state.contentHash,
            compile_version: state.compileVersion,
            compiled_page_id: state.compiledPageId,
          }
        : null,
    });
  }),
);
