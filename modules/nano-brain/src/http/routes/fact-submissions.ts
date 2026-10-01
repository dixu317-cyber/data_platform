import { Hono } from 'hono';
import { saveFactCandidates } from '../../core/fact-candidates';
import { reviewFactSubmission } from '../../core/fact-review';
import { getFactSubmission, listFactSubmissions, submitFactSubmission, type FactSubmissionStatus } from '../../core/fact-submissions';
import { internalRoute } from '../route';
import { toPublicAuditLog, toPublicFact, toPublicFactSubmission } from '../serializers';

export const factSubmissionsRouter = new Hono();

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseStatus(value: string | undefined): FactSubmissionStatus | undefined {
  return value as FactSubmissionStatus | undefined;
}

factSubmissionsRouter.post(
  '/nano/fact-submissions',
  internalRoute('提交事实线索失败', async (c, ctx) => {
    const body = await c.req.json();
    const submission = await submitFactSubmission(ctx, {
      targetSourceId: body.target_source_id,
      rawClaim: body.raw_claim,
      rawEvidenceText: body.raw_evidence_text,
      rawEvidenceUrl: body.raw_evidence_url,
      rawContext: body.raw_context,
    });
    return c.json({ submission: toPublicFactSubmission(submission) }, 201);
  }),
);

factSubmissionsRouter.get(
  '/nano/fact-submissions',
  internalRoute('读取事实提交列表失败', async (c, ctx) => {
    const submissions = await listFactSubmissions(ctx, {
      status: parseStatus(c.req.query('status')),
      submittedBy: c.req.query('submitted_by'),
      targetSourceId: c.req.query('target_source_id'),
      limit: parseLimit(c.req.query('limit')),
    });
    return c.json({ submissions: submissions.map(toPublicFactSubmission) });
  }),
);

factSubmissionsRouter.get(
  '/nano/fact-submissions/:submissionId',
  internalRoute('读取事实提交失败', async (c, ctx) => {
    const submission = await getFactSubmission(ctx, c.req.param('submissionId')!);
    return c.json({ submission: toPublicFactSubmission(submission) });
  }),
);

factSubmissionsRouter.post(
  '/nano/fact-submissions/:submissionId/candidates',
  internalRoute('保存结构化事实候选失败', async (c, ctx) => {
    const body = await c.req.json();
    const submission = await saveFactCandidates(ctx, {
      submissionId: c.req.param('submissionId')!,
      candidates: body.candidates,
      generatedBy: body.generated_by,
      generator: body.generator,
    });
    return c.json({ submission: toPublicFactSubmission(submission) });
  }),
);

factSubmissionsRouter.post(
  '/nano/fact-submissions/:submissionId/review',
  internalRoute('审核事实提交失败', async (c, ctx) => {
    const body = await c.req.json();
    const result = await reviewFactSubmission(ctx, {
      submissionId: c.req.param('submissionId')!,
      action: body.action,
      approvedFact: body.approved_fact,
      reviewComment: body.review_comment,
    });
    return c.json({
      submission: toPublicFactSubmission(result.submission),
      fact: result.fact ? toPublicFact(result.fact) : null,
      audit_log: toPublicAuditLog(result.auditLog),
    });
  }),
);
