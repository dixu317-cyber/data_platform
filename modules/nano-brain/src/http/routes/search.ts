import { Hono } from 'hono';
import { searchNanoBrain } from '../../core/search';
import { askNanoBrain } from '../../core/ask';
import { internalRoute } from '../route';
import { toPublicSearchResult } from '../serializers';

export const searchRouter = new Hono();

searchRouter.post(
  '/nano/search',
  internalRoute('检索失败', async (c, ctx) => {
    const body = await c.req.json();
    const result = await searchNanoBrain(ctx, {
      query: body.query,
      limit: body.limit,
      source_id: body.source_id,
      page_ids: body.page_ids, // I110：场景内检索透传 page_ids 做查询级隔离。
    });
    return c.json({ query: result.query, results: result.results.map(toPublicSearchResult) });
  }),
);

searchRouter.post(
  '/nano/ask',
  internalRoute('问答失败', async (c, ctx) => {
    const body = await c.req.json();
    const result = await askNanoBrain(ctx, {
      query: body.query,
      limit: body.limit,
      source_id: body.source_id,
      page_ids: body.page_ids, // I110：场景内问答透传 page_ids 做查询级隔离。
      entry_slug: body.entry_slug,
    });
    return c.json({
      query: result.query,
      answer: result.answer,
      llm_used: result.llmUsed,
      degraded: result.degraded,
      no_evidence: result.noEvidence,
      entry_scoped: result.entryScoped,
      citations: result.citations.map((citation) => ({
        ...toPublicSearchResult(citation),
        locator: {
          chunk_id: citation.locator.chunkId,
          page_id: citation.locator.pageId,
          source_id: citation.locator.sourceId,
          slug: citation.locator.slug,
          chunk_index: citation.locator.chunkIndex,
          entry_slug: citation.locator.entrySlug,
        },
        source_entry: citation.sourceEntry
          ? { slug: citation.sourceEntry.slug, relation: citation.sourceEntry.relation }
          : null,
      })),
    });
  }),
);
