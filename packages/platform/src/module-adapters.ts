import type { ModuleId } from "@ff/contracts";
import type { TemplateModulePlan } from "./types";

export type ModuleExecutionMode = "mock" | "real";

export type IngestFile = {
  name: string;
  text: string;
  mimeType?: string;
};

export type MockIngestInput = {
  moduleId: ModuleId;
  ingestMode: TemplateModulePlan["ingestMode"];
  sourceId: string;
  file: IngestFile;
};

export type MockIngestResult = {
  moduleObjectId: string;
  objectKind: "page" | "job" | "document";
  status: "submitted" | "ready";
  sourceId: string;
};

export type PlatformModuleReference = {
  moduleId: ModuleId;
  sourceId: string;
  moduleObjectId: string;
  objectKind: "page" | "job" | "document";
  status: "submitted" | "ready";
};

export function resolveModuleExecutionMode(env: Record<string, string | undefined> = process.env): ModuleExecutionMode {
  const value = env.PLATFORM_MODULE_MODE ?? "mock";
  if (value === "mock" || value === "real") return value;
  throw new Error("PLATFORM_MODULE_MODE must be mock or real");
}

export function buildCreateSourceRequest(moduleId: ModuleId, name: string, description: string) {
  return {
    moduleId,
    body: {
      name,
      description,
      kind: "private"
    }
  };
}

export function createMockModuleSource(input: { moduleId: ModuleId; sourceName: string }) {
  return {
    sourceId: `${input.moduleId}_${slug(input.sourceName)}_source`,
    status: "ready" as const
  };
}

export function ingestTextIntoMockModule(input: MockIngestInput): MockIngestResult {
  const objectKind = objectKindForIngest(input.ingestMode);
  const status = input.ingestMode === "traditional_document" ? "submitted" : "ready";
  return {
    moduleObjectId: `${input.moduleId}_${objectKind}_${slug(input.sourceId)}_${slug(input.file.name)}`,
    objectKind,
    status,
    sourceId: input.sourceId
  };
}

export function platformReferenceFromIngestResult(input: {
  moduleId: ModuleId;
  ingestMode: TemplateModulePlan["ingestMode"];
  sourceId: string;
  result: MockIngestResult;
}): PlatformModuleReference {
  return {
    moduleId: input.moduleId,
    sourceId: input.sourceId,
    moduleObjectId: input.result.moduleObjectId,
    objectKind: input.result.objectKind,
    status: input.result.status
  };
}

export function platformReferenceFromRealResponse(input: {
  moduleId: ModuleId;
  ingestMode: TemplateModulePlan["ingestMode"];
  sourceId: string;
  body: Record<string, unknown>;
}): PlatformModuleReference {
  const objectKind = objectKindForIngest(input.ingestMode);
  const moduleObjectId = String(
    input.body.document_id ??
      input.body.job_id ??
      input.body.page_id ??
      input.body.id ??
      `${input.moduleId}_${objectKind}_${slug(input.sourceId)}`
  );
  const rawStatus = String(input.body.status ?? "submitted");
  return {
    moduleId: input.moduleId,
    sourceId: input.sourceId,
    moduleObjectId,
    objectKind,
    status: rawStatus === "ready" ? "ready" : "submitted"
  };
}

function objectKindForIngest(ingestMode: TemplateModulePlan["ingestMode"]): PlatformModuleReference["objectKind"] {
  if (ingestMode === "nano_page") return "page";
  if (ingestMode === "graph_document") return "document";
  return "job";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "item";
}
