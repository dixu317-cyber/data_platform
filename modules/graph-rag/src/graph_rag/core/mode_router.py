"""Feature 011 · T3 簇 · mode 路由器(G-3,FR-308/309/311/312;spec §6.1)。

按问题类型把 graph 检索 mode 路由到 local/global/mix,替换编排层写死 mix。
三段式判决(spec §6.1,与编排层既有 routeGlobalChatQuery 同构):

  1. **规则先行**(确定、快、可 golden 钉死,主防线,准确率 100%):
     - 关系/邻域意图词(汇报、上级/下属、股东、上下游、关联方、供应商…)→ `local`
     - 格局/主题意图词(整体、格局、分布、概览、全貌、主要、有哪些、构成、排名…)→ `global`
     - 两意图皆含(复合)→ `mix`
  2. **LLM 兜底**(规则不定时,复用 LLM 网关轻分类,输出 local/global/hybrid/mix)。
  3. **默认 mix**(LLM 失败/超时/低置信)——安全最广集,保证不劣于存量写死 mix。

优先级链(FR-312):`admin_fixed`(009 §15 graph_query_mode 非 auto)> 调用方显式 mode(request)
> `auto` 路由(rule > llm > fallback)。越界 mode 值 → 回退 mix(SUPPORTED_QUERY_MODES 守卫)。

provenance(FR-311,016 钩子):mode_source ∈ {request, admin_fixed, rule, llm, fallback}。
mode 路由/QueryParam 构造均为无状态纯函数(规则部分),LLM 兜底为可注入 classifier(测试可 patch)。
"""

from __future__ import annotations

import asyncio
import logging
import os

from graph_rag.config import get_settings

logger = logging.getLogger("graph_rag")

# search.py 的白名单单一事实源(避免循环 import,此处平行声明,值必须一致)。
SUPPORTED_QUERY_MODES = {"local", "global", "hybrid", "naive", "mix"}
DEFAULT_MODE = "mix"  # spec §6.1 第3条:安全最广集托底。

# LLM 兜底轻分类允许输出的 mode(spec §6.1 第2条:local/global/hybrid/mix)。
_LLM_MODE_ALIASES = ("local", "global", "hybrid", "mix")

# LLM 兜底超时(秒):graph 检索本已慢,路由 LLM 不宜再叠大延迟;超时→fallback mix。
LLM_ROUTE_TIMEOUT_SECONDS = float(os.getenv("GRAPH_MODE_LLM_TIMEOUT_SECONDS", "8"))

# spec §6.1 规则关键词(关系/邻域 → local;格局/主题 → global)。
# 说明:刻意不纳入过于泛化的裸字(如"和""谁")以免长尾问法误命中规则——长尾交 LLM 兜底(AM-308)。
LOCAL_KEYWORDS: tuple[str, ...] = (
    "汇报", "上级", "下属", "股东", "上下游", "关联方", "供应商",
    "隶属", "任职", "向谁", "谁是", "谁向谁", "实际控制人",
)
GLOBAL_KEYWORDS: tuple[str, ...] = (
    "整体", "格局", "分布", "概览", "全貌", "主要", "有哪些", "构成", "排名", "总览",
)

_CLASSIFY_SYSTEM_PROMPT = (
    "你是知识图谱检索的 mode 分类器。给定一个用户问题,判断最合适的图谱检索模式,"
    "只输出一个词,不要解释:\n"
    "- local:问具体实体之间的关系/邻域(谁向谁汇报、股东、上下游、关联方等)\n"
    "- global:问整体格局/主题/分布/构成/排名/概览等宏观问题\n"
    "- mix:同时包含关系与格局两类意图,或难以判定但需兼顾\n"
    "- hybrid:关系与主题都需要但偏均衡\n"
    "严格只回 local / global / mix / hybrid 之一。"
)


def _guard_mode(mode: str | None) -> str:
    """越界/空 mode → 回退 mix(FR-312,存量 SUPPORTED_QUERY_MODES 守卫不变)。"""
    return mode if mode in SUPPORTED_QUERY_MODES else DEFAULT_MODE


def _hits(query: str, keywords: tuple[str, ...]) -> list[str]:
    return [kw for kw in keywords if kw in query]


def classify_by_rules(query: str) -> tuple[str | None, str | None]:
    """规则先行(确定性,不依赖 LLM/网络)。返回 (mode, matched_rule);未命中返回 (None, None)。

    复合(两意图皆含)→ mix;仅关系 → local;仅格局 → global。matched_rule 供 016 golden 断言。
    """
    local_hits = _hits(query, LOCAL_KEYWORDS)
    global_hits = _hits(query, GLOBAL_KEYWORDS)
    if local_hits and global_hits:
        return "mix", f"compound:{local_hits[0]}+{global_hits[0]}"
    if local_hits:
        return "local", f"local:{local_hits[0]}"
    if global_hits:
        return "global", f"global:{global_hits[0]}"
    return None, None


async def llm_classify_mode(query: str) -> str:
    """LLM 兜底轻分类(复用 AGENT_* 网关)。返回 local/global/hybrid/mix 之一。

    产品内唯一 LLM 决策点(AM-308 黄金集所测)。解析失败/歧义 → mix(交由上层视作低置信)。
    真网关慢/非确定,故被 route_query_mode 以 asyncio.wait_for 包裹超时守卫(超时→fallback mix)。
    """
    settings = get_settings()
    from openai import AsyncOpenAI  # 延迟 import:与 lightrag 共享的 openai 依赖,避免模块加载开销。

    client = AsyncOpenAI(api_key=settings.agent_api_key, base_url=settings.agent_base_url)
    resp = await client.chat.completions.create(
        model=settings.agent_model,
        messages=[
            {"role": "system", "content": _CLASSIFY_SYSTEM_PROMPT},
            {"role": "user", "content": query},
        ],
        temperature=0,
    )
    text = (resp.choices[0].message.content or "").strip().lower()
    for alias in _LLM_MODE_ALIASES:
        if alias in text:
            return alias
    return DEFAULT_MODE


async def route_query_mode(
    query: str,
    *,
    classifier=None,
    timeout: float | None = None,
) -> tuple[str, str, str | None]:
    """auto 路由主入口:规则先行 → LLM 兜底 → mix 默认。

    返回 (mode, mode_source, matched_rule):
      - 规则命中 → (mode, "rule", matched_rule)
      - 规则不定 → LLM 分类 → (mode, "llm", None)
      - LLM 超时/失败/越界输出 → (mix, "fallback", None)  # 不崩不空
    classifier 可注入(测试 patch 网关);默认 llm_classify_mode。
    """
    mode, matched_rule = classify_by_rules(query)
    if mode is not None:
        return mode, "rule", matched_rule

    classifier = classifier or llm_classify_mode
    timeout = LLM_ROUTE_TIMEOUT_SECONDS if timeout is None else timeout
    try:
        llm_mode = await asyncio.wait_for(classifier(query), timeout=timeout)
    except asyncio.TimeoutError:
        logger.warning("mode router LLM 超时 → fallback mix")
        return DEFAULT_MODE, "fallback", None
    except Exception:
        logger.exception("mode router LLM 失败 → fallback mix")
        return DEFAULT_MODE, "fallback", None

    if llm_mode in SUPPORTED_QUERY_MODES:
        return llm_mode, "llm", None
    logger.warning("mode router LLM 输出越界(%r)→ fallback mix", llm_mode)
    return DEFAULT_MODE, "fallback", None


async def resolve_mode(
    query: str,
    *,
    request_mode: str = "auto",
    admin_mode: str = "auto",
    classifier=None,
    timeout: float | None = None,
) -> tuple[str, str, str | None]:
    """优先级链(FR-312):admin_fixed > request 显式 > auto 路由(rule > llm > fallback)。

    - admin_mode 非 auto(009 §15 graph_query_mode 钉死)→ 覆盖一切,mode_source="admin_fixed";越界→mix。
    - request_mode 非 auto(调用方显式白名单 mode)→ mode_source="request";越界→mix。
    - 两者皆 auto → route_query_mode 按问题路由。
    """
    if admin_mode and admin_mode != "auto":
        return _guard_mode(admin_mode), "admin_fixed", None
    if request_mode and request_mode != "auto":
        return _guard_mode(request_mode), "request", None
    return await route_query_mode(query, classifier=classifier, timeout=timeout)
