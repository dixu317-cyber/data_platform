import type { ModuleId, UserContext } from "@ff/contracts";

export type Visibility = "private" | "team" | "company";
export type AccessControl = {
  scope: Visibility;
  ownerUserId: string;
  ownerUsername: string;
  organizationId: string;
  teamIds: string[];
};
export type ProcessingStatus = "draft" | "submitted" | "waiting_review" | "processing" | "needs_input" | "ready" | "failed" | "archived";
export type ScenarioTemplateKind = "compiled_knowledge" | "document_evidence" | "relationship_knowledge" | "hybrid";
export type KnowledgeObjectMode = "wiki" | "document" | "relationship" | "artifact";

export type TemplateState = "official" | "candidate" | "experimental" | "custom" | "paused" | "archived";
export type TemplateEvidenceLevel = "validated" | "partial" | "internal_only";
export type TemplateProductForm =
  | "chat"
  | "embedded_assistant"
  | "knowledge_portal"
  | "document_review"
  | "report_generator"
  | "graph_explorer"
  | "task_workflow"
  | "hybrid";

export type TemplateDemoWalkthrough = {
  scenarioName: string;
  sampleInputs: Array<{
    title: string;
    fileName: string;
    fileType: "md" | "pdf" | "csv" | "txt" | "json";
    description: string;
  }>;
  processingPreview: string[];
  sampleQuestion: string;
  sampleAnswer: string;
  citations: Array<{
    label: string;
    source: string;
    excerpt: string;
  }>;
  resultHighlights: string[];
};

export type TemplateModulePlan = {
  moduleId: ModuleId;
  sourcePurpose: "primary" | "evidence" | "relationship" | "wiki" | "supporting";
  createSourceName: string;
  ingestMode: "nano_page" | "traditional_document" | "graph_document";
  required: boolean;
};

export type ScenarioTemplate = {
  id: string;
  name: string;
  kind: ScenarioTemplateKind;
  state: TemplateState;
  evidenceLevel: TemplateEvidenceLevel;
  evidenceSources: string[];
  productForms: TemplateProductForm[];
  limitations: string[];
  headline: string;
  description: string;
  requiredInputs: string[];
  acceptedFileTypes: string[];
  outputCapabilities: string[];
  demoWalkthrough: TemplateDemoWalkthrough;
  needsAdminReview: boolean;
  defaultVisibility: Visibility;
  modulePlan: TemplateModulePlan[];
  createdAt: Date;
  updatedAt: Date;
};

export type ScenarioInstance = {
  id: string;
  templateId: string;
  name: string;
  description: string;
  ownerUserId: string;
  ownerUsername: string;
  organizationId: string;
  teamIds: string[];
  accessControl: AccessControl;
  visibility: Visibility;
  status: ProcessingStatus;
  businessOptions: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type ProcessingTask = {
  id: string;
  scenarioId: string;
  templateId: string;
  title: string;
  status: ProcessingStatus;
  progress: number;
  currentStep: string;
  userMessage: string;
  nextActions: string[];
  error: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type KnowledgeSpaceObject = {
  id: string;
  scenarioId: string;
  templateId: string;
  mode: KnowledgeObjectMode;
  title: string;
  summary: string;
  sourceLabel: string;
  accessControl: AccessControl;
  status: "ready" | "needs_review" | "draft";
  citations: Array<{ label: string; source: string; excerpt: string }>;
  actions: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type CreateScenarioInput = {
  templateId: string;
  name: string;
  description?: string;
  visibility?: Visibility;
  uploadedFiles?: Array<{ name: string; type?: string; size?: number; text?: string }>;
  assetIds?: string[];
  businessOptions?: Record<string, unknown>;
};

export type PlatformUser = UserContext;
