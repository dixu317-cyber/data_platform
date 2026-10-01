/**
 * ModuleClient Port 接口
 *
 * 边界铁律：
 * 1. 本接口仅定义领域层调用 RAG 模块（nano-brain / traditional-rag / graph-rag）的抽象契约。
 * 2. 绝不读取环境变量（env）。
 * 3. 绝不拼接或注入内部 Token（如 RAG_INTERNAL_TOKEN）。
 * 4. 绝不拼接 HTTP URL。
 * 5. 不依赖任何外部框架或具体实现（如 Next.js, Hono, fetch 等）。
 * 具体的 HTTP 请求、鉴权注入等基础设施细节由 server-only adapter 实现。
 */

import type { StoreUser } from '../store-types';

// ==================== GraphRAG 模块 DTO ====================

export interface GraphCurationSource {
  sourceId: string;
  name: string;
  scenarioName: string;
  createdAt: string;
}

export interface GraphCurationEntity {
  id: string | null;
  name: string;
  type: string;
  description: string;
  source: string;
}

export interface GraphCurationRelation {
  id: string | null;
  source: string;
  target: string;
  description: string;
  weight: number | null;
}

export interface GraphCurationDetail {
  sourceId: string;
  sourceName: string;
  entities: GraphCurationEntity[];
  relations: GraphCurationRelation[];
  entityCount: number;
  relationCount: number;
  duplicateNames: string[];
}

// ==================== Traditional-RAG 模块 DTO ====================

export interface NaiveDocument {
  documentId: string;
  sourceId: string;
  name: string;
  scenarioName: string;
  createdAt: string;
}

export interface DocChunk {
  id: string;
  chunkIndex: number;
  text: string;
  charCount: number;
}

// ==================== Nano-Brain 模块 DTO ====================

export interface GbrainPageSource {
  bucketId: string;
  name: string;
  scenarioName: string;
}

export interface KnowledgePageItem {
  sourceId: string;
  pageId?: string;
  slug: string;
  title: string;
  body: string;
  contentType?: string;
  updatedAt: string;
}

// ==================== Port 接口定义 ====================

export interface ModuleClient {
  // --- 图谱策展（GraphRAG 模块） ---
  listGraphCurationSources(user: StoreUser): Promise<GraphCurationSource[]>;
  getGraphCurationDetail(user: StoreUser, sourceId: string): Promise<GraphCurationDetail | null>;
  mergeGraphCurationEntities(user: StoreUser, input: { sourceId: string; sourceEntities: string[]; targetEntity: string }): Promise<{ ok: boolean; message?: string }>;
  editGraphCurationEntity(user: StoreUser, input: { sourceId: string; entityName: string; newName?: string; entityType?: string; description?: string }): Promise<{ ok: boolean; message?: string }>;
  deleteGraphCurationEntity(user: StoreUser, input: { sourceId: string; entityName: string }): Promise<{ ok: boolean; message?: string }>;
  deleteGraphCurationRelation(user: StoreUser, input: { sourceId: string; sourceEntity: string; targetEntity: string }): Promise<{ ok: boolean; message?: string }>;

  // --- Naive 文档（traditional-rag 模块） ---
  listNaiveDocuments(user: StoreUser): Promise<NaiveDocument[]>;
  getDocumentChunks(user: StoreUser, documentId: string): Promise<DocChunk[]>;
  deleteDocumentChunk(user: StoreUser, input: { documentId: string; chunkId: string }): Promise<{ ok: boolean; message?: string }>;

  // --- Gbrain 知识页（nano-brain 模块） ---
  listGbrainPageSources(user: StoreUser): Promise<GbrainPageSource[]>;
  listGbrainPages(user: StoreUser, bucketId: string): Promise<KnowledgePageItem[]>;
  editGbrainPage(user: StoreUser, input: { sourceId: string; slug: string; title: string; body: string }): Promise<{ ok: boolean; message?: string }>;
}
