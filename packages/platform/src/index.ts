export * from "./types";
export * from "./templates";
export * from "./demo-data";
export * from "./module-adapters";
export * from "./admin-governance";
export * from "./admin-settings";
// IngestFile 在 module-adapters 与 demo-data 同名同结构（{name,text,mimeType?}），
// 显式指定一处消除 `export *` re-export 歧义（TS2308）。
export type { IngestFile } from "./module-adapters";

// P12 Phase 0：port 接口（仅具名再导出 3 个接口，DTO 靠结构化类型透传，
// 不 `export *` 以免把 store-types 的同名类型带进 barrel，与 types.ts 冲突）。
export type { PlatformStore } from "./ports/platform-store";
export type { ModuleClient } from "./ports/module-client";
export type { AnswerOrchestrator } from "./ports/answer-orchestrator";

// P12 Phase 0/1：平台业务库（PG）迁移、连接池、拆解/重组存储层。
export { migratePlatformDatabase } from "./migrations";
export { getPlatformDatabaseUrl, getPlatformPool, closePlatformPool } from "./db";
export { loadDbFromPg, saveDbToPg, truncateAllPg } from "./platform-pg-store";
