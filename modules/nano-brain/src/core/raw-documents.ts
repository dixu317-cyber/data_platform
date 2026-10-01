// 014 · T1 · §5.2:原文全文真理来源 + 可寻址分片持久化。
//   raw_documents = 1 文件 1 行原文全文(编译无论如何不丢原文,FR-360);
//   raw_chunks = 对 raw_body 的字符偏移可寻址分片(溯源锚点,FR-361)。
// 与编译解耦:compile 相位改 pages.body,永不改写 raw_documents.raw_body。
import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getNanoBrainPool } from '../db';

// 机械字符窗口大小:raw_chunks 按此连续切分 raw_body,窗口首尾相接无空洞、无重叠,
// 保证 raw_body.slice(char_start,char_end)==chunk_text 且区间并集覆盖全文(AM-1402)。
// 注:与 chunks.ts 的嵌入分片(按 markdown 块/token,会 trim/丢字符)不同——溯源分片必须无损可寻址。
export const RAW_CHUNK_CHAR_SIZE = 1200;

export type RawChunkSpan = {
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  chunkText: string;
  contentHash: string;
};

export type RawDocument = {
  id: string;
  sourceId: string;
  externalRef: string;
  title: string;
  contentType: string;
  rawBody: string;
  contentHash: string;
  byteSize: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// 归一化换行(与 capture/pages 一致口径),保证 raw_body 是稳定的原文真理来源。
function normalizeRawBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 把 raw_body 按 char 窗口无损切分为可寻址分片。
 * 不变式:chunks[0].charStart===0;chunks[i].charStart===chunks[i-1].charEnd;last.charEnd===rawBody.length;
 *         rawBody.slice(charStart,charEnd)===chunkText。空正文 → 无分片。
 */
export function chunkRawBodyByChars(rawBody: string, maxChars: number = RAW_CHUNK_CHAR_SIZE): RawChunkSpan[] {
  const size = Math.max(1, Math.floor(maxChars));
  const spans: RawChunkSpan[] = [];
  let index = 0;
  for (let start = 0; start < rawBody.length; start += size) {
    const end = Math.min(start + size, rawBody.length);
    const chunkText = rawBody.slice(start, end);
    spans.push({
      chunkIndex: index,
      charStart: start,
      charEnd: end,
      chunkText,
      contentHash: hashContent(chunkText),
    });
    index += 1;
  }
  return spans;
}

function mapRawDocument(row: any): RawDocument {
  return {
    id: row.id,
    sourceId: row.source_id,
    externalRef: row.external_ref,
    title: row.title,
    contentType: row.content_type,
    rawBody: row.raw_body,
    contentHash: row.content_hash,
    byteSize: row.byte_size,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type PersistRawDocumentInput = {
  sourceId: string;
  externalRef: string;
  title: string;
  contentType: string;
  rawBody: string;
  createdBy: string;
  maxChars?: number;
};

/**
 * 原文入库:UNIQUE(source_id, external_ref) upsert(同 external_ref 重入库不翻倍,FR-371),
 * 并重建其可寻址 raw_chunks(char 偏移覆盖全文)。整体事务化。
 */
export async function persistRawDocument(input: PersistRawDocumentInput): Promise<RawDocument> {
  const rawBody = normalizeRawBody(input.rawBody);
  const contentHash = hashContent(rawBody);
  const byteSize = Buffer.byteLength(rawBody, 'utf8');
  const spans = chunkRawBodyByChars(rawBody, input.maxChars);

  const pool = getNanoBrainPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `
        INSERT INTO raw_documents (
          id, source_id, external_ref, title, content_type, raw_body, content_hash, byte_size, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (source_id, external_ref)
        DO UPDATE SET
          title = EXCLUDED.title,
          content_type = EXCLUDED.content_type,
          raw_body = EXCLUDED.raw_body,
          content_hash = EXCLUDED.content_hash,
          byte_size = EXCLUDED.byte_size,
          updated_at = now()
        RETURNING id, source_id, external_ref, title, content_type, raw_body, content_hash, byte_size, created_by, created_at, updated_at
      `,
      [
        randomUUID(),
        input.sourceId,
        input.externalRef,
        input.title,
        input.contentType,
        rawBody,
        contentHash,
        byteSize,
        input.createdBy,
      ],
    );
    const doc = mapRawDocument(result.rows[0]);

    await client.query('DELETE FROM raw_chunks WHERE raw_document_id = $1', [doc.id]);
    for (const span of spans) {
      await client.query(
        `
          INSERT INTO raw_chunks (
            id, raw_document_id, source_id, chunk_index, char_start, char_end, chunk_text, content_hash
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [randomUUID(), doc.id, doc.sourceId, span.chunkIndex, span.charStart, span.charEnd, span.chunkText, span.contentHash],
      );
    }

    await client.query('COMMIT');
    return doc;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type RawChunkRow = {
  id: string;
  rawDocumentId: string;
  sourceId: string;
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  chunkText: string;
  contentHash: string;
};

export async function listRawChunks(rawDocumentId: string, client?: pg.PoolClient): Promise<RawChunkRow[]> {
  const runner = client ?? getNanoBrainPool();
  const result = await runner.query(
    `
      SELECT id, raw_document_id, source_id, chunk_index, char_start, char_end, chunk_text, content_hash
      FROM raw_chunks
      WHERE raw_document_id = $1
      ORDER BY chunk_index ASC
    `,
    [rawDocumentId],
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    rawDocumentId: row.raw_document_id,
    sourceId: row.source_id,
    chunkIndex: row.chunk_index,
    charStart: row.char_start,
    charEnd: row.char_end,
    chunkText: row.chunk_text,
    contentHash: row.content_hash,
  }));
}

export async function getRawDocument(rawDocumentId: string): Promise<RawDocument | null> {
  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT id, source_id, external_ref, title, content_type, raw_body, content_hash, byte_size, created_by, created_at, updated_at
      FROM raw_documents
      WHERE id = $1
    `,
    [rawDocumentId],
  );
  return result.rows[0] ? mapRawDocument(result.rows[0]) : null;
}
