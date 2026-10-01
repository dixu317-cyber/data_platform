// P35 Phase2 · 主题级聚合相位 theme_compile。
//   聚类策略(已拍板):一个 source = 一个主题簇——把该 source 全部已编译 source_entry 页(raw_document_compile_state
//   status='compiled')熔成 1 个 theme_entry。复用 core/theme-compile.ts 的 compileTheme(幂等/singleton/降级语义现成),
//   不自造聚类/合成逻辑。
//   诚实边界(不静默假成功):
//     - 成员 <2(单篇)→ compileTheme 返回 'skipped_singleton' → 相位 skipped(退化为纯文档级,不假装有主题页)。
//     - LLM 网关不可用 → compileTheme 返回 'skipped' → 相位 skipped(诚实降级)。
//     - 无已编译 source_entry(memberCount=0)→ 相位 clean(无可聚合内容,未改任何派生数据)。
//     - 成功熔合 → 相位 ok。
import { getNanoBrainPool } from '../../../db';
import { COMPILE_PROMPT_VERSION } from '../../compile';
import { archiveStaleThemeEntry, compileTheme, DEFAULT_MIN_CLUSTER_SIZE, type CompileThemeOutcome, type ThemeMemberInput } from '../../theme-compile';
import { createOpenRouterThemeClient, type ThemeCompileLlmClient } from '../../llm';
import type { DreamPhaseHandlerContext } from '../runner';
import type { DreamPhaseResult } from '../types';

export const THEME_COMPILE_PHASE_VERSION = 'theme_compile.phase.v1';

type ThemeMemberRow = {
  raw_document_id: string;
  compiled_page_id: string | null;
  created_by: string;
};

// 载入某 source 全部已编译 source_entry(status='compiled')作为一个簇的成员。
//   member_page_id = 该 raw_document 的编译页(compiled_page_id);createdBy 取首成员 raw_document 的作者
//   (theme_entry 归该 source 作者,与直建/文档级 compile 作者归属一致)。
//   Round-4 复审⑥:此前只查 compile_state.status='compiled'，未 JOIN pages 校验 compiled_page_id 真实指向一个
//   仍然有效的 source_entry 页——compiled_page_id 可为 NULL(pages 行被删,ON DELETE SET NULL)，此时旧代码会把
//   该行降成 sourceEntryPageId=null 的 'raw_document' 成员静默混入簇。改为 INNER JOIN pages 强制
//   compiled_page_id 非空、同 source、entry_kind='source_entry'、compile_status='compiled'，不满足的行直接被
//   JOIN 排除(不再降级为 raw_document 成员)。
async function loadSourceThemeMembers(
  sourceId: string,
): Promise<{ members: ThemeMemberInput[]; createdBy: string | null }> {
  const result = await getNanoBrainPool().query<ThemeMemberRow>(
    `SELECT s.raw_document_id, s.compiled_page_id, r.created_by
       FROM raw_document_compile_state s
       JOIN raw_documents r ON r.id = s.raw_document_id
       JOIN pages p ON p.id = s.compiled_page_id AND p.source_id = s.source_id
      WHERE s.source_id = $1
        AND s.status = 'compiled'
        AND s.compiled_page_id IS NOT NULL
        AND p.entry_kind = 'source_entry'
        AND p.compile_status = 'compiled'
      ORDER BY r.created_at ASC, r.id ASC`,
    [sourceId],
  );
  const rows = result.rows;
  const members: ThemeMemberInput[] = rows.map((row) => ({
    rawDocumentId: row.raw_document_id,
    sourceEntryPageId: row.compiled_page_id,
  }));
  return { members, createdBy: rows[0]?.created_by ?? null };
}

export type ThemeCompileOutcome =
  | { status: 'clean'; memberCount: 0 }
  | { status: 'skipped_singleton'; memberCount: number }
  | { status: 'skipped'; memberCount: number }
  | { status: 'compiled'; memberCount: number; theme: CompileThemeOutcome };

export type CompileSourceThemeInput = {
  sourceId: string;
  llm: ThemeCompileLlmClient;
  createdBy?: string;
  title?: string;
  compileVersion?: string;
  minClusterSize?: number;
};

/**
 * 主题级聚合相位主体(一个 source = 一个簇)。加载该 source 全部已编译 source_entry 页 → 组成 1 个簇 →
 *   调 compileTheme。complileTheme 承担幂等(重编先清成员记账+溯源再写)/ singleton 边界 / LLM 降级语义。
 *   memberCount=0 → clean;compileTheme 的 skipped_singleton/skipped 如实透传(不假装成功)。
 */
export async function compileSourceTheme(input: CompileSourceThemeInput): Promise<ThemeCompileOutcome> {
  const compileVersion = input.compileVersion ?? COMPILE_PROMPT_VERSION;
  const minClusterSize = Math.max(1, input.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE);
  const { members, createdBy } = await loadSourceThemeMembers(input.sourceId);
  // Round-5 收敛(STILL-OPEN #5 归档没覆盖):下面两条早退路径根本不调用 compileTheme,此前从未归档——
  //   若该 source 曾经有过 theme_entry(如成员被删减到 0、或跌破最小簇大小),旧主题页会孤儿化继续可见。
  //   两条短路都要显式归档同一 source 的旧活跃 theme_entry,覆盖 compileTheme 内部归档触达不到的这两条路径。
  const archivedBy = input.createdBy ?? createdBy ?? 'system';

  if (members.length === 0) {
    await archiveStaleThemeEntry(input.sourceId, archivedBy);
    return { status: 'clean', memberCount: 0 };
  }
  // 成员 <2:不硬熔(与 compileTheme 的 skipped_singleton 边界一致),提前短路避免无谓 LLM 调用。
  if (members.length < minClusterSize) {
    await archiveStaleThemeEntry(input.sourceId, archivedBy);
    return { status: 'skipped_singleton', memberCount: members.length };
  }

  const theme = await compileTheme({
    sourceId: input.sourceId,
    members,
    llm: input.llm,
    createdBy: input.createdBy ?? createdBy ?? 'system',
    title: input.title,
    compileVersion,
    minClusterSize,
  });

  if (theme.status === 'compiled') {
    return { status: 'compiled', memberCount: theme.memberCount, theme };
  }
  if (theme.status === 'skipped_singleton') {
    return { status: 'skipped_singleton', memberCount: theme.memberCount };
  }
  return { status: 'skipped', memberCount: theme.memberCount };
}

// ThemeCompileOutcome → DreamPhaseStatus 映射。
function toPhaseStatus(status: ThemeCompileOutcome['status']): DreamPhaseResult['status'] {
  switch (status) {
    case 'clean':
      return 'clean';
    case 'compiled':
      return 'ok';
    case 'skipped_singleton':
    case 'skipped':
      return 'skipped';
  }
}

/**
 * dream theme_compile 相位处理器(runner 注册)。测试主体打在 compileSourceTheme(注入 fake 客户端);
 *   本处理器用默认 openrouter 主题客户端(网关不可用 → skipped 不伪造)。
 */
export async function runThemeCompilePhase(
  ctx: DreamPhaseHandlerContext,
): Promise<Omit<DreamPhaseResult, 'phase' | 'durationMs'>> {
  if (ctx.target.type === 'review_queue') {
    return {
      status: 'skipped',
      summary: 'theme_compile is not applicable to review_queue targets',
      details: { reason: 'not_applicable', phaseVersion: THEME_COMPILE_PHASE_VERSION },
    };
  }

  const sourceId = ctx.target.sourceId;

  if (ctx.dryRun) {
    const { members } = await loadSourceThemeMembers(sourceId);
    const wouldCompile = members.length >= DEFAULT_MIN_CLUSTER_SIZE;
    return {
      status: members.length === 0 ? 'clean' : wouldCompile ? 'ok' : 'skipped',
      summary: `dry-run: theme_compile would ${wouldCompile ? 'fuse' : 'skip'} ${members.length} member(s)`,
      details: { phaseVersion: THEME_COMPILE_PHASE_VERSION, dryRun: true, memberCount: members.length },
    };
  }

  const outcome = await compileSourceTheme({ sourceId, llm: createOpenRouterThemeClient() });
  const details: Record<string, unknown> = {
    phaseVersion: THEME_COMPILE_PHASE_VERSION,
    dryRun: false,
    memberCount: outcome.memberCount,
    outcome: outcome.status,
  };
  if (outcome.status === 'compiled') {
    details.themePageId = outcome.theme.themePageId;
    details.slug = outcome.theme.slug;
    details.sectionsTotal = outcome.theme.sectionsTotal;
    details.sectionsCited = outcome.theme.sectionsCited;
    details.provenanceRawDocumentIds = outcome.theme.provenanceRawDocumentIds;
    details.fidelityFlag = outcome.theme.fidelityFlag;
  }
  const summaryByStatus: Record<ThemeCompileOutcome['status'], string> = {
    clean: 'theme_compile: no compiled source_entry to fuse',
    compiled: `theme_compile: fused ${outcome.memberCount} member(s) into 1 theme_entry`,
    skipped_singleton: `theme_compile: single member (${outcome.memberCount}), skipped (degraded to document-level)`,
    skipped: 'theme_compile: LLM gateway unavailable, skipped (honest degrade)',
  };
  return {
    status: toPhaseStatus(outcome.status),
    summary: summaryByStatus[outcome.status],
    details,
  };
}
