type AdminEngine = "Gbrain" | "Naive RAG" | "GraphRAG";

export type SmokeCase = {
  templateId: string;
  engine: AdminEngine;
  name: string;
  visibility: "private" | "team" | "company";
  fileName: string;
  mimeType: string;
  text: string;
  query: string;
  expectedAnswerHit: string;
};

type SmokeAnswerInput = {
  engine: AdminEngine;
  expectedAnswerHit: string;
  response: {
    answer?: {
      engine?: AdminEngine;
      text?: string;
      citations?: Array<{ excerpt?: string }>;
    };
  };
};

const memberCredentials = {
  username: process.env.FF_SMOKE_MEMBER_USERNAME ?? "muyu",
  password: process.env.FF_SMOKE_MEMBER_PASSWORD ?? "muyu123456"
};

const adminCredentials = {
  username: process.env.FF_SMOKE_ADMIN_USERNAME ?? "admin",
  password: process.env.FF_SMOKE_ADMIN_PASSWORD ?? "admin123456"
};

export function buildSmokeCases(): SmokeCase[] {
  return [
    {
      templateId: "personal-wiki",
      engine: "Gbrain",
      name: `梧桐计划交付知识库 ${Date.now()}`,
      visibility: "private",
      fileName: "wutong-plan.md",
      mimeType: "text/markdown",
      text: "# 梧桐计划\n\n梧桐计划的交付窗口是 7 月第一周，负责人是林乔。客户最关注数据迁移排期和上线培训。",
      query: "梧桐计划的交付窗口是什么时候？",
      expectedAnswerHit: "7 月第一周"
    },
    {
      templateId: "policy-evidence",
      engine: "Naive RAG",
      name: `星河差旅制度问答 ${Date.now()}`,
      visibility: "company",
      fileName: "xinghe-policy.pdf",
      mimeType: "application/pdf",
      text: "星河差旅报销制度：一线城市住宿报销上限为 680 元。超过 680 元需要直属负责人和财务审批。",
      query: "星河一线城市住宿报销上限是多少？",
      expectedAnswerHit: "680"
    },
    {
      templateId: "customer-360",
      engine: "GraphRAG",
      name: `曜石客户关系风险分析 ${Date.now()}`,
      visibility: "team",
      fileName: "yaoshi-relationship.md",
      mimeType: "text/markdown",
      text: "曜石客户关系：苏杭担心系统集成风险，周澈支持二期扩容。下一步需要确认集成排期。",
      query: "曜石客户当前主要风险是什么？",
      expectedAnswerHit: "系统集成风险"
    }
  ];
}

export function assertSmokeAnswer(input: SmokeAnswerInput) {
  const answer = input.response.answer;
  if (!answer) throw new Error(`${input.engine} smoke did not return an answer`);
  if (answer.engine !== input.engine) {
    throw new Error(`${input.engine} smoke returned engine ${answer.engine ?? "unknown"}`);
  }
  const citations = answer.citations ?? [];
  if (citations.length === 0) throw new Error(`${input.engine} smoke did not return citations`);
  const haystack = `${answer.text ?? ""}\n${citations.map((citation) => citation.excerpt ?? "").join("\n")}`.toLowerCase();
  if (!haystack.includes(input.expectedAnswerHit.toLowerCase())) {
    throw new Error(`${input.engine} smoke did not hit expected text: ${input.expectedAnswerHit}`);
  }
}

async function main() {
  const baseUrl = resolvePlatformBaseUrl(process.env.PLATFORM_BASE_URL ?? process.env.API_BASE_URL ?? `http://127.0.0.1:${process.env.WEB_PORT ?? "3000"}/api/platform`);
  const member = await login(baseUrl, memberCredentials);
  const admin = await login(baseUrl, adminCredentials);
  const summaries = [];

  for (const testCase of buildSmokeCases()) {
    const created = await createScenario(baseUrl, member.token, testCase);
    const approved = await approveScenario(baseUrl, admin.token, created.task.id, testCase.engine);
    const answer = await requestJson(baseUrl, `/scenarios/${created.scenario.id}/ask`, {
      method: "POST",
      token: member.token,
      body: { query: testCase.query }
    });
    assertSmokeAnswer({ engine: testCase.engine, expectedAnswerHit: testCase.expectedAnswerHit, response: answer });
    const assets = await requestJson(baseUrl, `/admin/knowledge-assets?engine=${encodeURIComponent(testCase.engine)}`, {
      method: "GET",
      token: admin.token
    });

    summaries.push({
      engine: testCase.engine,
      scenarioId: created.scenario.id,
      taskId: created.task.id,
      status: approved.request.status,
      selectedEngine: approved.request.selectedEngine,
      citations: answer.answer.citations.length,
      hit: true,
      assetCount: assets.assets.length,
      moduleReferences: (answer.answer.citations ?? []).map((citation: any) => ({
        sourceOriginalName: citation.sourceOriginalName,
        engine: citation.engine
      }))
    });
  }

  const dashboard = await requestJson(baseUrl, "/admin/dashboard", { method: "GET", token: admin.token });
  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    cases: summaries,
    dashboard: {
      requests: dashboard.dashboard.requests,
      assets: dashboard.dashboard.assets,
      health: dashboard.dashboard.healthCards.map((item: any) => ({ id: item.id, status: item.status, detail: item.detail }))
    }
  }, null, 2));
}

async function login(baseUrl: string, credentials: { username: string; password: string }) {
  return requestJson(baseUrl, "/auth/login", {
    method: "POST",
    body: credentials
  });
}

async function createScenario(baseUrl: string, token: string, testCase: SmokeCase) {
  const form = new FormData();
  form.set("template_id", testCase.templateId);
  form.set("name", testCase.name);
  form.set("visibility", testCase.visibility);
  form.set("description", `${testCase.name} 的业务资料包。`);
  form.set("processing_goal", "上传资料后由管理员选择真实 RAG 引擎入库，并在前台场景内直接提问。");
  form.append("files", await smokeFile(testCase));
  return requestJson(baseUrl, "/scenarios", { method: "POST", token, form });
}

async function approveScenario(baseUrl: string, token: string, taskId: string, engine: AdminEngine) {
  return requestJson(baseUrl, `/admin/requests/${encodeURIComponent(`request_${taskId}`)}`, {
    method: "PATCH",
    token,
    body: {
      action: "approve",
      selected_engine: engine
    }
  });
}

async function requestJson(
  baseUrl: string,
  path: string,
  input: { method: string; token?: string; body?: unknown; form?: FormData }
) {
  const headers = new Headers();
  if (input.token) headers.set("authorization", `Bearer ${input.token}`);
  if (input.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, {
    method: input.method,
    headers,
    body: input.form ?? (input.body === undefined ? undefined : JSON.stringify(input.body))
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${input.method} ${path} failed: HTTP ${response.status} ${text}`);
  }
  return body;
}

async function smokeFile(testCase: SmokeCase) {
  if (testCase.mimeType === "application/pdf") {
    return new File([simplePdfBytes(testCase.text)], testCase.fileName, { type: testCase.mimeType });
  }
  return new File([testCase.text], testCase.fileName, { type: testCase.mimeType });
}

function simplePdfBytes(text: string) {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT /F1 14 Tf 50 760 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${new TextEncoder().encode(stream).byteLength} >>\nstream\n${stream}\nendstream`
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

function resolvePlatformBaseUrl(value: string) {
  const normalized = value.replace(/\/+$/, "");
  if (normalized.endsWith("/api/platform") || normalized.endsWith("/platform")) return normalized;
  if (normalized.includes(":3120") || normalized.includes(":3000")) return `${normalized}/api/platform`;
  return `${normalized}/platform`;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
