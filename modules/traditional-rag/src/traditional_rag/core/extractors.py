"""FR-430 可插拔 extractor 注册接口(教学增补,对账表 O4 从 OUT 降级)。

开闭原则:按文件类型路由的 extractor 注册表(type→ExtractorSpec)。核心解析管线(complete_upload_job)
消费本注册表判定"该类型有无 extractor";**未注册类型 = 诚实拒收**(非静默 FAILED)。
注册新 extractor 即可支持新类型,不改核心管线——教学价值即"如何接入更多 extractor"(README R2)。

边界:本轮只提供注册接口 + 现有类型注册 + 未注册即拒;图片/音视频**默认不注册 = 诚实拒收**,
真支持(如 OCR)是新能力独立立项(FR-431 门控,需评估新依赖后再注册示例 extractor)。
"""

from __future__ import annotations

from dataclasses import dataclass

from traditional_rag.core.errors import TraditionalRagError

# extractor 类别:text=文本切分+嵌入、pdf=MinerU、table=表格解析
ExtractorKind = str


@dataclass(frozen=True)
class ExtractorSpec:
    file_type: str
    kind: ExtractorKind
    description: str


_REGISTRY: dict[str, ExtractorSpec] = {}


def register_extractor(spec: ExtractorSpec) -> None:
    """注册(或覆盖)一个 file_type 的 extractor。接新类型只需 register,不动核心管线。"""
    _REGISTRY[spec.file_type] = spec


def get_extractor(file_type: str) -> ExtractorSpec | None:
    return _REGISTRY.get(file_type)


def has_extractor(file_type: str) -> bool:
    return file_type in _REGISTRY


def registered_file_types() -> set[str]:
    return set(_REGISTRY)


def file_types_for_kind(kind: ExtractorKind) -> set[str]:
    return {ft for ft, spec in _REGISTRY.items() if spec.kind == kind}


def require_extractor(file_type: str) -> ExtractorSpec:
    """无注册 extractor → 诚实拒收(unsupported_file_type),非静默 FAILED。"""
    spec = _REGISTRY.get(file_type)
    if spec is None:
        raise TraditionalRagError(
            f"暂无「{file_type}」类型的 extractor,诚实拒收(未注册解析器)。"
            "注册对应 extractor 即可支持该类型(见 FR-430);图片/音视频真支持为独立立项。",
            "unsupported_file_type",
        )
    return spec


# 现有支持类型的内建注册(与核心管线一致):text / pdf / table。
# 图片/音视频**不注册** → 诚实拒收(FR-147/430)。
for _text_type in ("docx", "markdown", "txt", "html", "json"):
    register_extractor(ExtractorSpec(_text_type, "text", "INDEXABLE_TEXT:切分+嵌入,可检索"))
register_extractor(ExtractorSpec("pdf", "pdf", "MinerU 解析 PDF 文本层"))
for _table_type in ("csv", "xlsx"):
    register_extractor(ExtractorSpec(_table_type, "table", "结构化表格解析"))
