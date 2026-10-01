// 014 · §6.4 · FR-363/364:nano-brain 编译 LLM 客户端。
//   镜像编排层 openrouter 网关(apps/web/lib/server/platform-store.ts:3866 `callAgentChatModel`)的
//   openai-compatible `chat/completions` 契约 —— 共享 AGENT_API_KEY / AGENT_BASE_URL / AGENT_MODEL 约定,
//   `FF_PLATFORM_AGENT_MODE=off|local` 或无 key → 返回 null(诚实降级,不伪造条目,§6.4 / AM-1410)。
//   nano-brain 模块此前无任何 LLM 调用(spec §13-1),本文件是编译层新增的同契约客户端,不自造新协议。
//
// 分层:
//   - callCompileChatModel(messages, options):底层 chat/completions 调用(mirror callAgentChatModel,返回文本或 null)。
//   - CompileLlmClient:编译领域接口(compile(req) → 结构化产物),测试在此接口层 patch/spy(manifest 存疑#2)。
//   - createOpenRouterCompileClient:默认实现,底层走 callCompileChatModel,提示词要求 JSON 结构化产物 + evidence 为原文子串。

export type CompileChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

// 编译 LLM 领域请求:对一个原文段(短文=全文;长文=分段之一)通读产结构化条目。
export type CompileLlmRequest = {
  rawText: string; // 待编译原文段(短文=全文,长文=某分段)。evidence 应为其子串(定位失败→uncited)。
  title: string;
  segmentIndex: number; // 0-based
  segmentCount: number;
};

// LLM 通读产出的单个分节 + 其支撑原文引文(供溯源映射:evidence 定位回 raw_body → page_provenance)。
export type CompileLlmSection = {
  heading: string;
  level: number;
  content: string; // 编译后分节正文(markdown,非原文逐字)
  evidence: string[]; // 支撑该分节的原文引文,应为 rawText 的逐字子串(§7.5 忠实度地基)
};

export type CompileLlmResult = {
  model?: string;
  summary?: string; // 概览/lead
  keyPoints?: string[];
  sections: CompileLlmSection[];
};

// 编译 LLM 客户端接口。null = 网关不可用(诚实降级,AM-1410);测试注入 fake 返回确定性结构化产物。
export interface CompileLlmClient {
  compile(req: CompileLlmRequest): Promise<CompileLlmResult | null>;
}

function readAgentEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/**
 * 底层 chat/completions 调用,逐字镜像编排层 callAgentChatModel:
 *   FF_PLATFORM_AGENT_MODE=off|local 或无 key → null(不伪造);openrouter 抖动重试;返回文本内容或 null。
 */
export async function callCompileChatModel(
  messages: CompileChatMessage[],
  options: { temperature: number; maxTokens: number },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ content: string; model: string } | null> {
  if (env.FF_PLATFORM_AGENT_MODE === 'local' || env.FF_PLATFORM_AGENT_MODE === 'off') return null;
  const apiKey = readAgentEnv(env, 'AGENT_API_KEY') ?? readAgentEnv(env, 'OPENROUTER_API_KEY');
  if (!apiKey) return null;
  const baseUrl = (readAgentEnv(env, 'AGENT_BASE_URL') ?? readAgentEnv(env, 'OPENROUTER_BASE_URL') ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const model = readAgentEnv(env, 'AGENT_MODEL') ?? readAgentEnv(env, 'OPENROUTER_MODEL') ?? 'openai/gpt-4o-mini';
  const timeoutMs = Number(readAgentEnv(env, 'AGENT_TIMEOUT_MS') ?? 25000);
  const attempts = 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'ff-companybrain',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        if (attempt < attempts - 1) {
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        return null;
      }
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) {
        return { content: content.trim(), model };
      }
      if (attempt < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      return null;
    } catch {
      if (attempt < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      return null;
    }
  }
  return null;
}

const COMPILE_SYSTEM_PROMPT = [
  '你是企业知识库的编译器。通读用户给出的原始资料片段,产出结构化知识条目。',
  '严格只输出一个 JSON 对象(不要 markdown 代码围栏、不要解释),形如:',
  '{"summary":"概览1-3段","key_points":["要点1","要点2"],',
  '"sections":[{"heading":"分节标题","level":2,"content":"编译后的分节正文(可改写,不必逐字)",',
  '"evidence":["支撑该分节的原文逐字子串(必须从原文原样摘录,用于溯源)"]}]}',
  '要求:每个分节的 evidence 必须是原文中的逐字连续子串(用于点回原文 span);找不到可引原文的分节不要编造 evidence(留空数组)。',
].join('\n');

function stripJsonFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  return body.trim();
}

function normalizeSections(raw: unknown): CompileLlmSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s: any) => {
      const heading = typeof s?.heading === 'string' ? s.heading.trim() : '';
      const content = typeof s?.content === 'string' ? s.content : '';
      const level = Number.isFinite(s?.level) ? Number(s.level) : 2;
      const evidence = Array.isArray(s?.evidence) ? s.evidence.filter((e: unknown): e is string => typeof e === 'string' && e.length > 0) : [];
      return heading ? { heading, level, content, evidence } : null;
    })
    .filter((s): s is CompileLlmSection => s !== null);
}

// ────────────────────────────────────────────────────────────────────────────
// 014 · T4 · FR-372/373/374 · §6.1(阶段3):主题聚合 LLM 客户端(N 源熔一篇)。
//   区别于单源 compile:输入是同 source 同主题**多个成员**的原文,产出**跨文件**合成主题条目;
//   每个分节的 evidence 明确指向**具体某个成员**的原文子串(→ 多源 provenance,不静默只熔首篇,AM-1414)。
//   null = 网关不可用(诚实降级);测试在此接口层注入 fake 返回确定性跨源产物。
// ────────────────────────────────────────────────────────────────────────────

// 单个聚类成员(供 LLM 通读合成):原文全文 + 归属 raw_document_id(evidence 溯源锚点)。
export type ThemeLlmMember = { rawDocumentId: string; title: string; rawText: string };

// 主题分节的支撑引文:指向**具体某成员**的原文逐字子串(多源记账地基)。
export type ThemeLlmEvidence = { rawDocumentId: string; quote: string };

export type ThemeLlmSection = {
  heading: string;
  level: number;
  content: string; // 跨源合成后的分节正文(改写,非逐字)
  evidence: ThemeLlmEvidence[]; // 每条指向某成员的原文子串(§7.5 忠实度地基 · 多源)
};

export type ThemeLlmResult = {
  model?: string;
  summary?: string; // 跨文件主题概览
  keyPoints?: string[];
  sections: ThemeLlmSection[];
};

export type ThemeLlmRequest = { title: string; members: ThemeLlmMember[] };

// 主题聚合 LLM 客户端接口。null = 网关不可用(诚实降级);测试注入 fake 返回确定性跨源产物。
export interface ThemeCompileLlmClient {
  compileTheme(req: ThemeLlmRequest): Promise<ThemeLlmResult | null>;
}

const THEME_SYSTEM_PROMPT = [
  '你是企业知识库的主题合成器。给你同一知识库下同一主题的多份原始资料,请熔合成一篇主题知识条目。',
  '严格只输出一个 JSON 对象(不要 markdown 代码围栏、不要解释),形如:',
  '{"summary":"跨文件主题概览","key_points":["要点1"],',
  '"sections":[{"heading":"分节标题","level":2,"content":"跨源合成正文(可改写)",',
  '"evidence":[{"raw_document_id":"该引文所属成员的 id","quote":"该成员原文中的逐字连续子串"}]}]}',
  '要求:每条 evidence 必须标注其所属成员的 raw_document_id,quote 必须是该成员原文的逐字连续子串(用于多源溯源);',
  '合成结论应尽量覆盖多份成员资料(不要只引用第一篇),找不到可引原文的分节留空 evidence 数组。',
].join('\n');

/**
 * 默认 openrouter 主题聚合客户端:提示词要求跨源 JSON 产物(evidence 带 raw_document_id + 原文子串)。
 * 网关不可用 / 不可解析 → null(交由 compile 相位标 skipped,不伪造)。
 */
export function createOpenRouterThemeClient(env: NodeJS.ProcessEnv = process.env): ThemeCompileLlmClient {
  return {
    async compileTheme(req: ThemeLlmRequest): Promise<ThemeLlmResult | null> {
      const memberBlocks = req.members
        .map((m, i) => [`成员 ${i + 1}(raw_document_id=${m.rawDocumentId},标题:${m.title}):`, '"""', m.rawText, '"""'].join('\n'))
        .join('\n\n');
      const userPrompt = [`主题:${req.title}`, `共 ${req.members.length} 份同主题资料:`, memberBlocks].join('\n');
      const result = await callCompileChatModel(
        [
          { role: 'system', content: THEME_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0, maxTokens: 4096 },
        env,
      );
      if (!result) return null;
      let parsed: any;
      try {
        parsed = JSON.parse(stripJsonFences(result.content));
      } catch {
        return null; // 不可解析(§6.2 unparseable)
      }
      const sections: ThemeLlmSection[] = Array.isArray(parsed?.sections)
        ? parsed.sections
            .map((s: any) => {
              const heading = typeof s?.heading === 'string' ? s.heading.trim() : '';
              const content = typeof s?.content === 'string' ? s.content : '';
              const level = Number.isFinite(s?.level) ? Number(s.level) : 2;
              const evidence: ThemeLlmEvidence[] = Array.isArray(s?.evidence)
                ? s.evidence
                    .map((e: any) => ({
                      rawDocumentId: typeof e?.raw_document_id === 'string' ? e.raw_document_id : '',
                      quote: typeof e?.quote === 'string' ? e.quote : '',
                    }))
                    .filter((e: ThemeLlmEvidence) => e.rawDocumentId && e.quote)
                : [];
              return heading ? { heading, level, content, evidence } : null;
            })
            .filter((s: ThemeLlmSection | null): s is ThemeLlmSection => s !== null)
        : [];
      return {
        model: result.model,
        summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
        keyPoints: Array.isArray(parsed?.key_points) ? parsed.key_points.filter((k: unknown): k is string => typeof k === 'string') : [],
        sections,
      };
    },
  };
}

/**
 * 默认 openrouter 编译客户端:提示词要求 JSON 结构化产物,底层走 callCompileChatModel。
 * 网关不可用 / 产物不可解析 → 返回 null(交由 compile 相位标 skipped/failed,不伪造)。
 */
export function createOpenRouterCompileClient(env: NodeJS.ProcessEnv = process.env): CompileLlmClient {
  return {
    async compile(req: CompileLlmRequest): Promise<CompileLlmResult | null> {
      const userPrompt = [
        `资料标题:${req.title}`,
        req.segmentCount > 1 ? `(这是第 ${req.segmentIndex + 1}/${req.segmentCount} 段,只编译本段内容)` : '',
        '原始资料片段:',
        '"""',
        req.rawText,
        '"""',
      ]
        .filter(Boolean)
        .join('\n');
      const result = await callCompileChatModel(
        [
          { role: 'system', content: COMPILE_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0, maxTokens: 4096 },
        env,
      );
      if (!result) return null;
      let parsed: any;
      try {
        parsed = JSON.parse(stripJsonFences(result.content));
      } catch {
        return null; // 产物不可解析(§6.2 unparseable)
      }
      const sections = normalizeSections(parsed?.sections);
      return {
        model: result.model,
        summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
        keyPoints: Array.isArray(parsed?.key_points) ? parsed.key_points.filter((k: unknown): k is string => typeof k === 'string') : [],
        sections,
      };
    },
  };
}
