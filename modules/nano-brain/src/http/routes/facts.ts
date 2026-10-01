import { Hono } from 'hono';
import { getFact, listEntityFacts, listFacts } from '../../core/facts';
import type { FactSubmissionStatus } from '../../core/fact-submissions';
import { internalRoute } from '../route';
import { toPublicFact } from '../serializers';

export const factsRouter = new Hono();

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseStatus(value: string | undefined): FactSubmissionStatus | undefined {
  return value as FactSubmissionStatus | undefined;
}

function factFilters(c: any) {
  return {
    sourceId: c.req.query('source_id'),
    submittedBy: c.req.query('submitted_by'),
    status: parseStatus(c.req.query('status')),
    limit: parseLimit(c.req.query('limit')),
  };
}

factsRouter.get(
  '/nano/facts',
  internalRoute('读取 facts 列表失败', async (c, ctx) => {
    const facts = await listFacts(ctx, {
      ...factFilters(c),
      entitySlug: c.req.query('entity_slug'),
    });
    return c.json({ facts: facts.map(toPublicFact) });
  }),
);

factsRouter.get(
  '/nano/facts/:factId',
  internalRoute('读取 fact 失败', async (c, ctx) => {
    const fact = await getFact(ctx, c.req.param('factId')!);
    return c.json({ fact: toPublicFact(fact) });
  }),
);

factsRouter.get(
  '/nano/entities/:entitySlug/facts',
  internalRoute('读取实体 facts 失败', async (c, ctx) => {
    const facts = await listEntityFacts(ctx, c.req.param('entitySlug')!, factFilters(c));
    return c.json({ facts: facts.map(toPublicFact) });
  }),
);
