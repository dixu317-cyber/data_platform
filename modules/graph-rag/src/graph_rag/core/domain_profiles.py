"""012 · GraphRAG 领域建图 · T1 簇(schema per-source profile 库 + 绑定 + addon_params 注入)。

G-5 心脏(FR-320/321/322/324):领域 schema = **每个 source 可绑定的模板**(`schema_profile_id`)。
`get_lightrag(source)` 按绑定 profile 构造 `LightRAG(..., addon_params={...})` 注入该 workspace 实例;
未绑定 → 不传 addon_params(出厂 11 类,零回归)。**非全局硬词表、非运行时自由手填**。

- profile 库(本模块 `PROFILES`,SSOT 集中定义)declared ≥3 命名 profile:
  `generic`(出厂 fallback)/ `customer_profile`(客户/供应商类型分立)/ `due_diligence`(关联方/股东/合规)。
- 每 profile 含 `entity_types_guidance`(str,注入 LightRAG 抽取 prompt 的类型集,LightRAG
  `prompt.py:resolve_entity_extraction_prompt_profile` 直读)+ `entity_extraction_examples`(list,few-shot)。
- `build_addon_params(profile_id)`:domain profile → {entity_types_guidance, entity_extraction_examples};
  `generic` / 未知 → **None**(= 出厂默认,不注入 addon_params,零回归)。
- per-source 绑定存 `graph_sources.metadata->>'schema_profile_id'`(011/006 source 表叠加,迁移见 migrations.py)。
- schema 变更(FR-324):`change_source_schema_profile` 仅改绑定,**不回溯重抽**既有文档
  (forward-only,显式提示),已入图实体类型不变。
"""

from __future__ import annotations

from graph_rag.db import get_connection

GENERIC_PROFILE_ID = "generic"

# ── profile 库(SSOT)。三命名 profile:generic / customer_profile / due_diligence。──────────
#
# entity_types_guidance:注入 LightRAG `{entity_types_guidance}` 抽取 prompt(prompt.py 直读),
#   驱动实体类型分立(customer_profile 下采购方→客户、供货方→供应商,非都 Organization)。
# entity_extraction_examples:few-shot 标注(list),随 profile 一起入 addon_params。
# is_fallback:generic=True → build_addon_params 返回 None(出厂 11 类,不注入,零回归)。

_GENERIC_GUIDANCE = """Classify each entity using one of the following types. If no type fits, use `Other`.

- Person: Human individuals, real or fictional
- Creature: Non-human living beings (animals, mythical beings, etc.)
- Organization: Companies, institutions, government bodies, groups
- Location: Geographic places (cities, countries, buildings, regions)
- Event: Occurrences, incidents, ceremonies, meetings
- Concept: Abstract ideas, theories, principles, beliefs
- Method: Procedures, techniques, algorithms, workflows
- Content: Creative or informational works (books, articles, films, reports)
- Data: Quantitative or structured information (statistics, datasets, measurements)
- Artifact: Physical or digital objects created by humans (tools, software, devices)
- NaturalObject: Natural non-living objects (minerals, celestial bodies, chemical compounds)"""

_CUSTOMER_GUIDANCE = """请按以下业务类型对每个实体分类;若都不匹配,用 `其他`。**采购方与供货方必须类型分立,不得都归为 Organization/组织**。

- 客户: 向本公司采购产品或服务的一方(采购方、买方、下游客户单位)
- 供应商: 向本公司提供产品或服务的一方(供货方、卖方、上游供应单位)
- 人员: 具体的自然人(客户对接人、供应商联系人、销售/采购负责人)
- 产品: 被采购或供应的具体产品、服务、货物
- 合同: 采购合同、供货合同、订单、协议(以合同号/协议号标识)
- 行业: 客户或供应商所属的行业领域
- 组织: 既非客户也非供应商的其他单位(监管方、第三方机构等)

注意:同一家公司在不同交易中可能既是客户又是供应商(双角色),按该条上下文的交易方向判定其在此关系中的类型。"""

_DUE_DILIGENCE_GUIDANCE = """请按尽职调查(尽调)业务类型对每个实体分类;若都不匹配,用 `其他`。

- 主体: 被尽调的目标公司/交易主体
- 关联方: 与主体存在关联关系的公司或个人(关联企业、同一控制下的实体)
- 股东: 持有主体股权的自然人或法人
- 实际控制人: 通过股权/协议实际支配主体的一方
- 合规: 合规事项、许可资质、监管备案、合规风险点
- 风险: 诉讼、担保、对赌、或有负债等风险事项
- 交易: 关联交易、重大交易、资金往来
- 人员: 董监高及关键自然人"""


PROFILES: dict[str, dict] = {
    GENERIC_PROFILE_ID: {
        "id": GENERIC_PROFILE_ID,
        "name": "通用",
        "is_fallback": True,
        "entity_types_guidance": _GENERIC_GUIDANCE,
        "entity_extraction_examples": [
            {
                "text": "张伟是华东区总经理,负责区域业务。",
                "entities": [
                    {"name": "张伟", "type": "Person"},
                    {"name": "华东区", "type": "Organization"},
                ],
            },
        ],
    },
    "customer_profile": {
        "id": "customer_profile",
        "name": "客户画像",
        "is_fallback": False,
        "entity_types_guidance": _CUSTOMER_GUIDANCE,
        "entity_extraction_examples": [
            {
                "text": "风行科技向本公司采购一批服务器,对接人为李强。",
                "entities": [
                    {"name": "风行科技", "type": "客户"},
                    {"name": "李强", "type": "人员"},
                    {"name": "服务器", "type": "产品"},
                ],
            },
            {
                "text": "本公司从鼎盛电子采购芯片,鼎盛电子的销售负责人是王敏。",
                "entities": [
                    {"name": "鼎盛电子", "type": "供应商"},
                    {"name": "王敏", "type": "人员"},
                    {"name": "芯片", "type": "产品"},
                ],
            },
            {
                "text": "恒通贸易既向本公司供货原材料,也采购本公司的成品。",
                "entities": [
                    {"name": "恒通贸易", "type": "供应商"},
                    {"name": "恒通贸易", "type": "客户"},
                ],
            },
        ],
    },
    "due_diligence": {
        "id": "due_diligence",
        "name": "尽职调查",
        "is_fallback": False,
        "entity_types_guidance": _DUE_DILIGENCE_GUIDANCE,
        "entity_extraction_examples": [
            {
                "text": "目标公司星辰科技的控股股东为陈氏投资,实际控制人为陈明。",
                "entities": [
                    {"name": "星辰科技", "type": "主体"},
                    {"name": "陈氏投资", "type": "股东"},
                    {"name": "陈明", "type": "实际控制人"},
                ],
            },
            {
                "text": "星辰科技与关联方明辰租赁存在一笔关联交易,涉及合规备案风险。",
                "entities": [
                    {"name": "明辰租赁", "type": "关联方"},
                    {"name": "关联交易", "type": "交易"},
                    {"name": "合规备案", "type": "合规"},
                ],
            },
        ],
    },
}


def get_profile(profile_id: str | None) -> dict | None:
    """返回 profile 库条目(未知 id → None)。"""
    if not profile_id:
        return None
    return PROFILES.get(profile_id)


def is_fallback_profile(profile_id: str | None) -> bool:
    """generic(出厂 fallback)或未知 profile → True(不注入 addon_params,落回出厂 11 类)。"""
    profile = get_profile(profile_id)
    return profile is None or bool(profile.get("is_fallback"))


def build_addon_params(profile_id: str | None) -> dict | None:
    """按 profile 构造 LightRAG `addon_params`。

    - domain profile(customer_profile/due_diligence)→
      `{"entity_types_guidance": <业务类型集>, "entity_extraction_examples": <few-shot list>}`。
    - `generic` / 未绑定 / 未知 → **None**(= 出厂默认,get_lightrag 不传 addon_params,零回归)。
    """
    if is_fallback_profile(profile_id):
        return None
    profile = PROFILES[profile_id]  # type: ignore[index]
    return {
        "entity_types_guidance": profile["entity_types_guidance"],
        "entity_extraction_examples": list(profile["entity_extraction_examples"]),
    }


# ── per-source 绑定(graph_sources.metadata->>'schema_profile_id')────────────────────────


def get_source_schema_profile_id(source_id: str) -> str | None:
    """读该 source 绑定的 schema_profile_id(未绑定 → None)。"""
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT metadata->>'schema_profile_id' AS pid FROM public.graph_sources WHERE id = %s",
                (source_id,),
            )
            row = cursor.fetchone()
    if not row:
        return None
    return row.get("pid") or None


def set_source_schema_profile(source_id: str, profile_id: str | None) -> None:
    """绑定/改绑 source 的 schema profile(profile_id=None → 解绑,落回出厂默认)。

    校验 profile_id 必须是已知 profile(防魔法串);写入 graph_sources.metadata。
    """
    if profile_id is not None and get_profile(profile_id) is None:
        from graph_rag.core.errors import GraphRagError

        raise GraphRagError(f"未知的 schema profile: {profile_id}", "invalid_schema_profile")
    with get_connection() as connection:
        with connection.cursor() as cursor:
            if profile_id is None:
                cursor.execute(
                    "UPDATE public.graph_sources SET metadata = metadata - 'schema_profile_id', "
                    "updated_at = now() WHERE id = %s AND delete_state = 'active'",
                    (source_id,),
                )
            else:
                cursor.execute(
                    "UPDATE public.graph_sources SET metadata = "
                    "jsonb_set(COALESCE(metadata, '{}'::jsonb), '{schema_profile_id}', to_jsonb(%s::text)), "
                    "updated_at = now() WHERE id = %s AND delete_state = 'active'",
                    (profile_id, source_id),
                )
            if cursor.rowcount != 1:
                from graph_rag.core.errors import GraphRagError

                raise GraphRagError("source 正在删除或删除失败，当前不可用", "source_unavailable")
        connection.commit()


def change_source_schema_profile(source_id: str, new_profile_id: str | None) -> dict:
    """FR-324:改 source 的 schema profile,**仅后续入图生效、不回溯重抽既有文档**。

    仅更新绑定(一次 DB UPDATE),**不触发**任何 re-ingest / 重抽 / 删旧重灌;返回显式
    forward-only 提示(非静默)——已入图文档的实体类型保持不变。
    """
    set_source_schema_profile(source_id, new_profile_id)
    return {
        "source_id": source_id,
        "schema_profile_id": new_profile_id,
        "forward_only": True,
        "reingested": False,
        "message": (
            "schema profile 已更新;仅新增文档按新 schema 抽取,"
            "已有实体类型不变(不回溯重抽既有文档)"
        ),
    }
