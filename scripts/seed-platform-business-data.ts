import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  buildDeliveryDemoDataPlan,
  type DemoAsset,
  type DemoAssetFormat,
  type DemoScenario,
} from "@ff/platform";
import {
  appendGlobalChatMessage,
  createGlobalChatSession,
  createScenarioChatSession,
  createStoredScenario,
  decideAdminIntakeRequest,
  listAdminKnowledgeAssetDetails,
  listAdminIntakeRequests,
  listStoredScenarios,
  resetPlatformStore,
  type AdminRagEngine,
  type StoreVisibility,
} from "@ff/platform/platform-store";
import { authenticateUser, resetAuthStore, userToStoreUser } from "../apps/web/lib/server/auth-store";

const dataDir = process.env.FF_PLATFORM_DATA_DIR || join(process.cwd(), "apps/web/.platform-data");
process.env.FF_PLATFORM_DATA_DIR = dataDir;
process.env.FF_PLATFORM_INGEST_MODE = process.env.FF_PLATFORM_INGEST_MODE || "local";
process.env.FF_PLATFORM_AGENT_MODE = process.env.FF_PLATFORM_AGENT_MODE || "local";

const engineByTemplate: Record<string, AdminRagEngine> = {
  "personal-wiki": "Gbrain",
  "team-handbook": "Gbrain",
  "policy-evidence": "Naive RAG",
  "contract-playbook": "Naive RAG",
  "rfp-security": "Naive RAG",
  "customer-360": "GraphRAG",
  "risk-investigation": "GraphRAG",
  "domain-relationship": "GraphRAG",
  "support-agent": "Naive RAG",
  "research-guide": "Gbrain",
  "data-analyst": "Naive RAG",
  "it-runbook": "Gbrain",
  "meeting-media-memory": "Gbrain",
  "voice-of-customer": "GraphRAG",
};

async function main() {
  await rm(join(process.cwd(), ".platform-data"), { recursive: true, force: true });
  await resetPlatformStore();
  await resetAuthStore();

  const memberAuth = await authenticateUser({ username: "muyu", password: "muyu123456" });
  const adminAuth = await authenticateUser({ username: "admin", password: "admin123456" });
  if (!memberAuth || !adminAuth) throw new Error("默认账号初始化失败。");
  const member = userToStoreUser(memberAuth.user);
  const admin = userToStoreUser(adminAuth.user);

  const plan = buildDeliveryDemoDataPlan();
  let created = 0;
  let published = 0;
  for (const scenario of plan.scenarios) {
    const assets = plan.assets.filter((asset) => asset.scenarioId === scenario.id);
    const createdScenario = await createStoredScenario(member, {
      templateId: scenario.templateId,
      name: scenario.name,
      description: scenario.description,
      visibility: scenario.visibility as StoreVisibility,
      processingGoal: scenario.question,
      files: assets.map(toUploadFile),
    });
    created += 1;

    const engine = engineByTemplate[scenario.templateId] ?? "Gbrain";
    const approved = await decideAdminIntakeRequest(admin, {
      requestId: `request_${createdScenario.task.id}`,
      action: "approve",
      selectedEngine: engine,
      strategyParameters: strategyParametersFor(engine, scenario),
    });
    if (approved?.status === "已发布") published += 1;
  }

  await createGlobalChatSession(member, {
    query: "赋范科技这个客户当前续约风险和机会是什么？",
    scope: "company",
  });
  const revenueSession = await createGlobalChatSession(member, {
    query: "过去三个季度华东区收入波动最大的原因是什么？",
    scope: "team",
  });
  await appendGlobalChatMessage(member, {
    sessionId: revenueSession.id,
    query: "把原因按客户阶段和渠道来源拆一下。",
  });

  const scenarios = await listStoredScenarios(member);
  const scenarioSamples = sampleScenariosForChat(scenarios);
  for (const scenario of scenarioSamples) {
    await createScenarioChatSession(member, {
      scenarioId: scenario.id,
      query: scenarioQuestionFor(scenario.templateId),
    });
  }

  const requests = await listAdminIntakeRequests(admin);
  const assets = await listAdminKnowledgeAssetDetails(admin);
  console.log(JSON.stringify({
    ok: true,
    dataDir,
    scenarios: created,
    published,
    intakeRequests: requests.length,
    knowledgeAssetRows: assets.length,
    engines: {
      gbrain: assets.filter((asset) => asset.engine === "Gbrain").length,
      naive: assets.filter((asset) => asset.engine === "Naive RAG").length,
      graph: assets.filter((asset) => asset.engine === "GraphRAG").length,
    },
  }, null, 2));
}

function toUploadFile(asset: DemoAsset) {
  return {
    name: asset.fileName,
    type: mimeType(asset.format),
    bytes: bytesForAsset(asset),
  };
}

function bytesForAsset(asset: DemoAsset) {
  if (asset.format === "pdf") return simplePdfBytes(asset.text);
  return new TextEncoder().encode(asset.text);
}

function mimeType(format: DemoAssetFormat) {
  const map: Record<DemoAssetFormat, string> = {
    md: "text/markdown",
    pdf: "application/pdf",
    csv: "text/csv",
    txt: "text/plain",
    json: "application/json",
  };
  return map[format];
}

function strategyParametersFor(engine: AdminRagEngine, scenario: DemoScenario): Record<string, string> {
  if (engine === "Naive RAG") {
    return {
      chunk_size: scenario.templateId === "policy-evidence" ? "720" : "900",
      chunk_overlap: "120",
      top_k: scenario.templateId === "data-analyst" ? "12" : "8",
      citation_threshold: "0.78",
      no_answer_policy: "严格拒答",
      rerank: "true",
    };
  }
  if (engine === "GraphRAG") {
    return {
      entity_schema: scenario.templateId === "voice-of-customer" ? "客户/需求/产品/行业" : "客户/人员/项目/事件",
      relation_schema: scenario.templateId === "risk-investigation" ? "负责/关联/风险/影响" : "负责/关联/风险/机会",
      max_hops: "3",
      min_confidence: "0.72",
      community_summary: "true",
      evidence_required: "true",
    };
  }
  return {
    page_depth: "2",
    fact_granularity: "业务事实",
    link_policy: "主题互链",
    publish_gate: scenario.visibility === "private" ? "个人自动发布" : "负责人复核",
    source_required: "true",
  };
}

function sampleScenariosForChat(scenarios: Array<{ id: string; templateId: string }>) {
  const picked = new Map<string, { id: string; templateId: string }>();
  for (const scenario of scenarios) {
    if (!picked.has(scenario.templateId)) picked.set(scenario.templateId, scenario);
    if (picked.size >= 8) break;
  }
  return [...picked.values()];
}

function scenarioQuestionFor(templateId: string) {
  const questions: Record<string, string> = {
    "customer-360": "这个客户当前续约风险和机会是什么？",
    "policy-evidence": "一线城市住宿报销标准是多少，需要什么审批？",
    "contract-playbook": "这份合同有哪些高风险条款，应该怎么改？",
    "support-agent": "客户说订单延迟三天，应该怎么回复？",
    "data-analyst": "过去三个季度华东区收入波动最大的原因是什么？",
    "it-runbook": "出现支付回调超时，值班同学应该先检查什么？",
    "meeting-media-memory": "这次会议确认了哪些风险、决策和行动项？",
    "voice-of-customer": "哪些权限相关需求最影响企业版续约？",
  };
  return questions[templateId] ?? "这个场景现在能回答哪些核心业务问题？";
}

function simplePdfBytes(text: string) {
  const escaped = text
    .replace(/[^\x20-\x7E\u4e00-\u9fa5，。；：！？、（）《》【】]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .slice(0, 1600);
  const stream = `BT /F1 12 Tf 50 760 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${new TextEncoder().encode(stream).byteLength} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(new TextEncoder().encode(body).byteLength);
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(body).byteLength;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
