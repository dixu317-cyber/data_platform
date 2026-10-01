from __future__ import annotations

import json
import re
import zipfile
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree

from traditional_rag.core.errors import TraditionalRagError


@dataclass(frozen=True)
class ParsedSegment:
    text: str
    metadata: dict


@dataclass(frozen=True)
class ParsedDocument:
    text: str
    segments: list[ParsedSegment]
    metadata: dict


def parse_text_file(path: Path, *, parser: str) -> ParsedDocument:
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    return _segments_from_text(text, parser=parser)


class _TextHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() in {"script", "style", "noscript"}:
            self._skip_depth += 1
        elif tag.lower() in {"p", "div", "section", "article", "br", "li", "tr", "h1", "h2", "h3", "h4"}:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript"} and self._skip_depth > 0:
            self._skip_depth -= 1
        elif tag.lower() in {"p", "div", "section", "article", "li", "tr", "h1", "h2", "h3", "h4"}:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0 and data.strip():
            self._parts.append(data)

    def text(self) -> str:
        return unescape(" ".join(self._parts))


def parse_html_file(path: Path) -> ParsedDocument:
    parser = _TextHTMLParser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    return _segments_from_text(parser.text(), parser="html")


def _flatten_json(value: object, prefix: str = "") -> list[str]:
    if isinstance(value, dict):
        lines: list[str] = []
        for key, child in value.items():
            child_key = f"{prefix}.{key}" if prefix else str(key)
            lines.extend(_flatten_json(child, child_key))
        return lines
    if isinstance(value, list):
        lines = []
        for index, child in enumerate(value):
            child_key = f"{prefix}[{index}]" if prefix else f"[{index}]"
            lines.extend(_flatten_json(child, child_key))
        return lines
    normalized = json.dumps(value, ensure_ascii=False) if isinstance(value, (bool, type(None))) else str(value)
    return [f"{prefix}: {normalized}" if prefix else normalized]


def parse_json_file(path: Path) -> ParsedDocument:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise TraditionalRagError(f"JSON 解析失败：{error}", "parser_error") from error
    return _segments_from_text("\n".join(_flatten_json(data)), parser="json")


def parse_docx_file(path: Path) -> ParsedDocument:
    try:
        with zipfile.ZipFile(path) as archive:
            xml = archive.read("word/document.xml")
    except KeyError as error:
        raise TraditionalRagError("DOCX 文件缺少 word/document.xml", "parser_error") from error
    except zipfile.BadZipFile as error:
        raise TraditionalRagError("DOCX 文件损坏，无法解压", "parser_error") from error

    root = ElementTree.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    body = root.find("w:body", ns)
    if body is None:
        raise TraditionalRagError("DOCX 文件缺少正文", "parser_error")

    segments: list[ParsedSegment] = []
    paragraph_index = 0
    table_index = 0
    for child in list(body):
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            paragraph = _paragraph_text(child, ns)
            if paragraph:
                segments.append(ParsedSegment(paragraph, {"parser": "docx", "kind": "paragraph", "paragraph_index": paragraph_index}))
                paragraph_index += 1
        elif tag == "tbl":
            rows: list[str] = []
            for row in child.findall("w:tr", ns):
                cells: list[str] = []
                for cell in row.findall("w:tc", ns):
                    cell_text = " ".join(filter(None, (_paragraph_text(p, ns) for p in cell.findall("w:p", ns))))
                    cells.append(cell_text)
                if any(cells):
                    rows.append(" | ".join(cells))
            if rows:
                segments.append(
                    ParsedSegment(
                        "\n".join(rows),
                        {"parser": "docx", "kind": "table", "table_index": table_index, "row_count": len(rows)},
                    )
                )
                table_index += 1
    if not segments:
        raise TraditionalRagError("DOCX 未抽取到可索引文本", "parser_error")
    text = "\n\n".join(segment.text for segment in segments)
    return ParsedDocument(
        text=text,
        segments=segments,
        metadata={"parser": "docx", "paragraph_count": paragraph_index, "table_count": table_index, "char_count": len(text)},
    )


def _paragraph_text(node: ElementTree.Element, ns: dict[str, str]) -> str:
    parts = [text_node.text or "" for text_node in node.findall(".//w:t", ns)]
    return _normalize_text("".join(parts))


def _segments_from_text(text: str, *, parser: str) -> ParsedDocument:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = [_normalize_text(part) for part in re.split(r"\n\s*\n", normalized)]
    segments = [
        ParsedSegment(paragraph, {"parser": parser, "kind": "paragraph", "paragraph_index": index})
        for index, paragraph in enumerate(paragraph for paragraph in paragraphs if paragraph)
    ]
    if not segments and _normalize_text(normalized):
        segments = [ParsedSegment(_normalize_text(normalized), {"parser": parser, "kind": "text", "paragraph_index": 0})]
    if not segments:
        raise TraditionalRagError("文档未抽取到可索引文本", "parser_error")
    joined = "\n\n".join(segment.text for segment in segments)
    return ParsedDocument(
        text=joined,
        segments=segments,
        metadata={"parser": parser, "paragraph_count": len(segments), "char_count": len(joined)},
    )


def _normalize_text(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text).strip()
