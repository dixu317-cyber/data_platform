import { randomBytes } from 'node:crypto';
import type { UserContext } from '@ff/contracts';
import { putMarkdownPage, type NanoPage } from './pages';
import { NanoBrainPermissionError } from './permissions';
import { ensureDefaultPrivateSource, getSourceById, NanoBrainError, type NanoSource } from './sources';

export type CaptureTarget = 'private' | 'public';
export type CaptureFormat = 'text' | 'markdown';

export type CaptureInput = {
  text?: string;
  markdown?: string;
  title?: string;
  target?: CaptureTarget;
  sourceId?: string;
  slug?: string;
  format?: CaptureFormat;
};

export type CaptureResult = {
  page: NanoPage;
  source: NanoSource;
  target: CaptureTarget;
  format: CaptureFormat;
};

const MAX_CAPTURE_TITLE_LENGTH = 200;
const MAX_CAPTURE_TEXT_BYTES = 1024 * 1024;

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function assertText(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new NanoBrainError(`${label} 必须是字符串`, 'invalid_input');
  }
  const normalized = normalizeNewlines(value);
  if (!normalized) {
    throw new NanoBrainError(`${label} 不能为空`, 'invalid_input');
  }
  if (Buffer.byteLength(normalized, 'utf8') > MAX_CAPTURE_TEXT_BYTES) {
    throw new NanoBrainError(`${label} 超过大小限制`, 'invalid_input');
  }
  return normalized;
}

function resolveCaptureFormat(input: CaptureInput): CaptureFormat {
  if (input.format) return input.format;
  if (input.markdown !== undefined) return 'markdown';
  return 'text';
}

function resolveCaptureText(input: CaptureInput, format: CaptureFormat): string {
  if (format === 'markdown') {
    return assertText(input.markdown ?? input.text, 'Markdown 内容');
  }
  return assertText(input.text ?? input.markdown, 'Capture 文本');
}

function resolveTitle(inputTitle: string | undefined, body: string): string {
  const title = inputTitle?.trim() || extractH1Title(body) || `Capture ${new Date().toISOString()}`;
  if (title.length > MAX_CAPTURE_TITLE_LENGTH) {
    throw new NanoBrainError('标题不能超过 200 个字符', 'invalid_input');
  }
  return title;
}

function extractH1Title(body: string): string | null {
  for (const line of body.split('\n')) {
    const match = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function makeCaptureSlug(title: string): string {
  const base = slugify(title) || 'capture';
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  return `${base}-${stamp}-${randomBytes(3).toString('hex')}`.slice(0, 96);
}

function ensureMarkdownDocument(content: string, title: string, format: CaptureFormat): string {
  if (format === 'markdown') {
    return normalizeNewlines(content) + '\n';
  }
  return `# ${title}\n\n${normalizeNewlines(content)}\n`;
}

async function resolveCaptureSource(ctx: UserContext, input: CaptureInput): Promise<{ source: NanoSource; target: CaptureTarget }> {
  const target = input.target ?? 'private';
  if (target !== 'private' && target !== 'public') {
    throw new NanoBrainError('capture target 只能是 private 或 public', 'invalid_input');
  }

  if (target === 'private') {
    if (input.sourceId && !ctx.isAdmin) {
      throw new NanoBrainError('普通用户 capture 不能显式指定 source_id', 'invalid_input');
    }
    if (input.sourceId && ctx.isAdmin) {
      const source = await getSourceById(input.sourceId);
      if (!source) throw new NanoBrainError('source 不存在', 'not_found');
      if (source.kind !== 'private') {
        throw new NanoBrainError('private capture 只能写入私有 source', 'invalid_input');
      }
      return { source, target };
    }
    const source = await ensureDefaultPrivateSource({ userId: ctx.userId, username: ctx.username });
    return { source, target };
  }

  if (!ctx.isAdmin) {
    throw new NanoBrainPermissionError('只有管理员可以 capture 到公共 source');
  }
  if (!input.sourceId) {
    throw new NanoBrainError('管理员 capture 到公共 source 时必须提供 source_id', 'invalid_input');
  }
  const source = await getSourceById(input.sourceId);
  if (!source) throw new NanoBrainError('source 不存在', 'not_found');
  if (source.kind !== 'public') {
    throw new NanoBrainError('public capture 只能写入公共 source', 'invalid_input');
  }
  return { source, target };
}

export async function captureContent(ctx: UserContext, input: CaptureInput): Promise<CaptureResult> {
  const format = resolveCaptureFormat(input);
  const content = resolveCaptureText(input, format);
  const title = resolveTitle(input.title, content);
  const { source, target } = await resolveCaptureSource(ctx, input);
  const body = ensureMarkdownDocument(content, title, format);
  const page = await putMarkdownPage(ctx, {
    sourceId: source.id,
    slug: input.slug?.trim() || makeCaptureSlug(title),
    title,
    body,
    contentType: 'text/markdown',
  });
  return { page, source, target, format };
}

export async function captureText(ctx: UserContext, input: Omit<CaptureInput, 'format' | 'markdown'>): Promise<CaptureResult> {
  return captureContent(ctx, { ...input, format: 'text' });
}

export async function captureMarkdown(ctx: UserContext, input: Omit<CaptureInput, 'format' | 'text'>): Promise<CaptureResult> {
  return captureContent(ctx, { ...input, format: 'markdown' });
}
