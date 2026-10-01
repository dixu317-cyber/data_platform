import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type pg from 'pg';
import type { UserContext } from '@ff/contracts';
import { getNanoBrainPool } from '../db';
import { assertCanReadSource } from './permissions';
import { embedTexts, vectorToSqlLiteral } from './embeddings';
import { getSourceById, NanoBrainError } from './sources';

export type PreparedChunk = {
  chunkIndex: number;
  text: string;
  contentHash: string;
  embedding: number[];
  embeddingModel: string;
};

export type NanoChunk = {
  id: string;
  pageId: string;
  sourceId: string;
  slug: string;
  chunkIndex: number;
  chunkText: string;
  contentHash: string;
  embeddingModel: string;
  embeddingDimensions: number;
  createdAt: Date;
  updatedAt: Date;
};

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// P7-B：按 embedding 模型自身分词器计 chunk 尺寸（token 空间），从本地 vendored tokenizer.json 加载。
// 加载失败（无 EMBEDDING_TOKENIZER_PATH/文件缺失/依赖缺失）退回字符兜底，并给字符兜底补 overlap（旧版超长块无 overlap）。
// 默认字符切分（基线，P7-A 评测最优；nano 基线无 overlap）——CHUNK_TOKEN_MODE 关闭时用。
const DEFAULT_CHAR_MAX = 1200;
const DEFAULT_CHAR_OVERLAP = 0;
// token opt-in（CHUNK_TOKEN_MODE=1）参数；CHAR_FALLBACK_* 为 token 模式下 tokenizer 缺失时的字符兜底。
const TARGET_TOKENS = 1024;
const OVERLAP_TOKENS = 128;
const CHAR_FALLBACK_MAX = 1600;
const CHAR_FALLBACK_OVERLAP = 200;

let _tok: any = null;
let _tokLoaded = false;

function getTokenizer(): any {
  if (_tokLoaded) return _tok;
  _tokLoaded = true;

  try {
    const path = process.env.EMBEDDING_TOKENIZER_PATH;
    if (path && existsSync(path)) {
      const { Tokenizer } = require('@huggingface/tokenizers');
      const tj = JSON.parse(readFileSync(path, 'utf-8'));

      let tc: any = undefined;
      const configPath = path.replace('tokenizer.json', 'tokenizer_config.json');
      if (existsSync(configPath)) {
        tc = JSON.parse(readFileSync(configPath, 'utf-8'));
      }

      _tok = new Tokenizer(tj, tc);
    }
  } catch (e) {
    _tok = null;
  }
  return _tok;
}

function splitLongTextByChars(text: string, maxChars: number, overlapChars: number): string[] {
  const chunks: string[] = [];
  const step = Math.max(1, maxChars - overlapChars);
  for (let start = 0; start < text.length; start += step) {
    const chunk = text.slice(start, start + maxChars).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function splitLongTextByTokens(text: string, tok: any, chunkTokens: number, overlapTokens: number): string[] {
  const chunks: string[] = [];
  const ids = tok.encode(text).ids;
  const step = Math.max(1, chunkTokens - overlapTokens);

  for (let start = 0; start < ids.length; start += step) {
    const end = Math.min(ids.length, start + chunkTokens);
    const piece = tok.decode(ids.slice(start, end)).trim();
    if (piece) chunks.push(piece);

    if (end >= ids.length) break;
  }
  return chunks;
}

export function splitMarkdownIntoChunkTexts(markdown: string): string[] {
  // 正确 bool 解析：仅 "1"/"true" 才开启（JS 里 !!"0" 为 true，会误开，故不能用 !!）。与 traditional pydantic bool 语义一致。
  const tokenMode = ['1', 'true'].includes((process.env.CHUNK_TOKEN_MODE ?? '').toLowerCase());
  const tok = tokenMode ? getTokenizer() : null;

  const size = (text: string): number => {
    return tok ? tok.encode(text).ids.length : text.length;
  };

  const maxSize = tok ? TARGET_TOKENS : (tokenMode ? CHAR_FALLBACK_MAX : DEFAULT_CHAR_MAX);

  const splitLong = (t: string): string[] => {
    if (tok) {
      return splitLongTextByTokens(t, tok, TARGET_TOKENS, OVERLAP_TOKENS);
    } else if (tokenMode) {
      return splitLongTextByChars(t, CHAR_FALLBACK_MAX, CHAR_FALLBACK_OVERLAP);
    } else {
      return splitLongTextByChars(t, DEFAULT_CHAR_MAX, DEFAULT_CHAR_OVERLAP);
    }
  };

  const blocks = markdown.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const block of blocks) {
    if (size(block) > maxSize) {
      if (current) { chunks.push(current.trim()); current = ''; }
      chunks.push(...splitLong(block));
      continue;
    }

    const candidate = current ? `${current}\n\n${block}` : block;
    if (size(candidate) > maxSize) {
      if (current) chunks.push(current.trim());
      current = block;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [markdown.trim()];
}

export async function prepareChunksForMarkdown(markdown: string): Promise<PreparedChunk[]> {
  const texts = splitMarkdownIntoChunkTexts(markdown);
  const { model, embeddings } = await embedTexts(texts, 'chunk-index');
  return texts.map((text, index) => ({
    chunkIndex: index,
    text,
    contentHash: hashContent(text),
    embedding: embeddings[index]!,
    embeddingModel: model,
  }));
}

export async function replacePageChunks(
  client: pg.PoolClient,
  input: {
    pageId: string;
    sourceId: string;
    slug: string;
    chunks: PreparedChunk[];
  },
): Promise<void> {
  await client.query('DELETE FROM chunks WHERE page_id = $1', [input.pageId]);

  for (const chunk of input.chunks) {
    await client.query(
      `
        INSERT INTO chunks (
          id, page_id, source_id, slug, chunk_index, chunk_text,
          content_hash, embedding, embedding_model
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9)
      `,
      [
        randomUUID(),
        input.pageId,
        input.sourceId,
        input.slug,
        chunk.chunkIndex,
        chunk.text,
        chunk.contentHash,
        vectorToSqlLiteral(chunk.embedding),
        chunk.embeddingModel,
      ],
    );
  }
}

function mapChunk(row: any): NanoChunk {
  return {
    id: row.id,
    pageId: row.page_id,
    sourceId: row.source_id,
    slug: row.slug,
    chunkIndex: row.chunk_index,
    chunkText: row.chunk_text,
    contentHash: row.content_hash,
    embeddingModel: row.embedding_model,
    embeddingDimensions: Number(row.embedding_dimensions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPageChunks(
  ctx: UserContext,
  input: { sourceId: string; slug: string },
): Promise<NanoChunk[]> {
  const source = await getSourceById(input.sourceId);
  if (!source) throw new NanoBrainError('source 不存在', 'not_found');
  assertCanReadSource(ctx, source);

  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT
        c.id, c.page_id, c.source_id, c.slug, c.chunk_index, c.chunk_text,
        c.content_hash, c.embedding_model, vector_dims(c.embedding) AS embedding_dimensions,
        c.created_at, c.updated_at
      FROM chunks c
      JOIN pages p ON p.id = c.page_id
      WHERE c.source_id = $1 AND c.slug = $2 AND p.archived_at IS NULL
      ORDER BY c.chunk_index ASC
    `,
    [input.sourceId, input.slug.trim().toLowerCase()],
  );

  return result.rows.map(mapChunk);
}
