// HTTP 层序列化：把 core 的 camelCase 领域对象转成对外 snake_case JSON。

export function toPublicUser(user: {
  id: string;
  username: string;
  isAdmin: boolean;
  organizationId: string;
  teamIds: string[];
}) {
  return {
    id: user.id,
    username: user.username,
    is_admin: user.isAdmin,
    organization_id: user.organizationId,
    team_ids: user.teamIds,
  };
}

export function toPublicSource(source: {
  id: string;
  name: string;
  kind: string;
  ownerUserId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    owner_user_id: source.ownerUserId,
    created_by: source.createdBy,
    created_at: source.createdAt,
    updated_at: source.updatedAt,
  };
}

export function toPublicPage(page: {
  id: string;
  sourceId: string;
  slug: string;
  title: string;
  body: string;
  contentHash: string;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: page.id,
    source_id: page.sourceId,
    slug: page.slug,
    title: page.title,
    body: page.body,
    content_hash: page.contentHash,
    created_by: page.createdBy,
    updated_by: page.updatedBy,
    created_at: page.createdAt,
    updated_at: page.updatedAt,
  };
}

export function toPublicChunk(chunk: {
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
}) {
  return {
    id: chunk.id,
    page_id: chunk.pageId,
    source_id: chunk.sourceId,
    slug: chunk.slug,
    chunk_index: chunk.chunkIndex,
    chunk_text: chunk.chunkText,
    content_hash: chunk.contentHash,
    embedding_model: chunk.embeddingModel,
    embedding_dimensions: chunk.embeddingDimensions,
    created_at: chunk.createdAt,
    updated_at: chunk.updatedAt,
  };
}

export function toPublicSearchResult(result: {
  chunkId: string;
  pageId: string;
  sourceId: string;
  sourceKind: string;
  sourceName: string;
  slug: string;
  title: string;
  chunkIndex: number;
  snippet: string;
  score: number;
  matchTypes: string[];
}) {
  return {
    chunk_id: result.chunkId,
    page_id: result.pageId,
    source_id: result.sourceId,
    source_kind: result.sourceKind,
    source_name: result.sourceName,
    slug: result.slug,
    title: result.title,
    chunk_index: result.chunkIndex,
    snippet: result.snippet,
    score: result.score,
    match_types: result.matchTypes,
  };
}

export function toPublicLink(link: {
  id: string;
  sourceId: string;
  fromPageId: string;
  fromSlug: string;
  toSourceId: string | null;
  toSlug: string;
  linkType: string;
  context: string | null;
  confidence: number;
  createdBy: string;
  createdAt: Date;
}) {
  return {
    id: link.id,
    source_id: link.sourceId,
    from_page_id: link.fromPageId,
    from_slug: link.fromSlug,
    to_source_id: link.toSourceId,
    to_slug: link.toSlug,
    link_type: link.linkType,
    context: link.context,
    confidence: link.confidence,
    created_by: link.createdBy,
    created_at: link.createdAt,
  };
}
