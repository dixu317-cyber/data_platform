from __future__ import annotations

import http.client
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from traditional_rag.config import get_settings
from traditional_rag.core.errors import TraditionalRagError
from traditional_rag.storage import resolve_storage_path


@dataclass(frozen=True)
class MinerUParseResult:
    metadata: dict[str, Any]


def _retry_network(operation, *, attempts: int = 3, delays: tuple[float, ...] = (1.0, 2.0, 4.0)):
    """I88：MinerU 网络原语有界重试。仅重试网络层瞬时异常(SSL EOF/连接 reset/DNS 抖动等)；
    HTTPError(应用层 4xx/5xx)先于网络分支显式 raise 不重试；TraditionalRagError(如上传 status 非 200)
    不在捕获列表、直接上抛不重试。用尽 attempts 抛最后一次异常，交由各函数原有 except 映射为稳定错误。"""
    last_exception: Exception | None = None
    for i in range(attempts):
        try:
            return operation()
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, OSError, TimeoutError, http.client.HTTPException) as exc:
            last_exception = exc
            if i < attempts - 1:
                time.sleep(delays[min(i, len(delays) - 1)])
    if last_exception is not None:
        raise last_exception
    raise RuntimeError("MinerU 网络重试意外结束")  # 理论不可达(attempts>=1)


def _json_request(method: str, url: str, *, token: str, body: dict[str, Any] | None = None, timeout: int = 60) -> dict[str, Any]:
    # 网络层瞬时错误(SSL EOF 等)有界重试，应用层 HTTP 错误不重试。
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {
        "Accept": "*/*",
        "Authorization": f"Bearer {token}",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"

    def _do() -> dict[str, Any]:
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read().decode("utf-8")
            return json.loads(payload) if payload else {}

    try:
        return _retry_network(_do)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise TraditionalRagError(f"MinerU API HTTP {error.code}: {detail}", "mineru_error") from error
    except urllib.error.URLError as error:
        raise TraditionalRagError(f"MinerU API 网络错误：{error.reason}", "mineru_error") from error


def _put_file(url: str, path: Path, *, timeout: int = 120) -> None:
    # MinerU precise API documentation explicitly says not to set Content-Type
    # when PUT-ing to the signed OSS URL. urllib.request adds
    # application/x-www-form-urlencoded for byte bodies, which breaks the OSS
    # signature, so use http.client and send only Content-Length.
    # 网络层瞬时错误(SSL EOF 等)有界重试；每次重试新建连接，应用层(status 非 200/201)不重试。
    parsed = urllib.parse.urlparse(url)
    body = path.read_bytes()
    connection_class = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    target = parsed.path + (f"?{parsed.query}" if parsed.query else "")

    def _do() -> None:
        connection = connection_class(parsed.netloc, timeout=timeout)
        try:
            connection.request("PUT", target, body=body, headers={"Content-Length": str(len(body))})
            response = connection.getresponse()
            detail = response.read().decode("utf-8", errors="replace")
            if response.status not in (200, 201):
                raise TraditionalRagError(f"MinerU 文件上传失败：HTTP {response.status}: {detail}", "mineru_error")
        finally:
            connection.close()

    try:
        _retry_network(_do)
    except OSError as error:
        raise TraditionalRagError(f"MinerU 文件上传网络错误：{error}", "mineru_error") from error


def _download(url: str, destination: Path, *, timeout: int = 120) -> None:
    # 网络层瞬时错误(SSL EOF 等)有界重试，应用层 HTTP 错误不重试；写盘在重试成功后一次完成。
    request = urllib.request.Request(url, headers={"Accept": "*/*"}, method="GET")

    def _do() -> bytes:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()

    try:
        data = _retry_network(_do)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise TraditionalRagError(f"MinerU 结果下载失败：HTTP {error.code}: {detail}", "mineru_error") from error
    except urllib.error.URLError as error:
        raise TraditionalRagError(f"MinerU 结果下载网络错误：{error.reason}", "mineru_error") from error
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)


def _ensure_code_zero(payload: dict[str, Any], operation: str) -> dict[str, Any]:
    if payload.get("code") != 0:
        raise TraditionalRagError(f"MinerU {operation}失败：{payload.get('msg') or payload}", "mineru_error")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise TraditionalRagError(f"MinerU {operation}响应缺少 data", "mineru_error")
    return data


def _safe_extract(zip_path: Path, destination: Path) -> list[Path]:
    destination.mkdir(parents=True, exist_ok=True)
    extracted: list[Path] = []
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            target = (destination / member.filename).resolve()
            if destination.resolve() != target and destination.resolve() not in target.parents:
                raise TraditionalRagError("MinerU 结果压缩包包含非法路径", "mineru_error")
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, target.open("wb") as output:
                output.write(source.read())
            extracted.append(target)
    return extracted


def _rel(path: Path) -> str:
    root = resolve_storage_path()
    resolved = path.resolve()
    return str(resolved.relative_to(root))


def _find_first(paths: list[Path], predicate) -> str | None:
    for path in paths:
        if predicate(path):
            return _rel(path)
    return None


def _find_all(paths: list[Path], predicate) -> list[str]:
    return [_rel(path) for path in paths if predicate(path)]


def _read_json_if_exists(path: Path | None) -> Any | None:
    if not path or not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _extract_page_refs(content_list: Any) -> dict[str, Any]:
    if not isinstance(content_list, list):
        return {"page_count": None, "blocks": []}
    blocks: list[dict[str, Any]] = []
    pages: set[int] = set()
    for index, item in enumerate(content_list):
        if not isinstance(item, dict):
            continue
        page_idx = item.get("page_idx")
        if isinstance(page_idx, int):
            pages.add(page_idx)
        blocks.append(
            {
                "index": index,
                "type": item.get("type"),
                "page_idx": page_idx,
                "bbox": item.get("bbox"),
                "text_level": item.get("text_level"),
            }
        )
    return {"page_count": (max(pages) + 1) if pages else None, "blocks": blocks[:500]}


def _build_result_metadata(
    *,
    content_hash: str,
    batch_id: str,
    result: dict[str, Any],
    zip_path: Path,
    extracted_paths: list[Path],
) -> dict[str, Any]:
    markdown_path = _find_first(extracted_paths, lambda path: path.name == "full.md" or path.suffix.lower() == ".md")
    content_list_path = _find_first(extracted_paths, lambda path: path.name.endswith("content_list.json"))
    content_list_v2_path = _find_first(extracted_paths, lambda path: path.name.endswith("content_list_v2.json"))
    middle_json_path = _find_first(extracted_paths, lambda path: path.name.endswith("middle.json"))
    model_json_path = _find_first(extracted_paths, lambda path: path.name.endswith("model.json"))
    image_paths = _find_all(
        extracted_paths,
        lambda path: path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"},
    )
    content_list_abs = resolve_storage_path(*content_list_path.split("/")) if content_list_path else None
    page_refs = _extract_page_refs(_read_json_if_exists(content_list_abs))
    settings = get_settings()
    return {
        "provider": "mineru",
        "api": "precise",
        "model_version": settings.mineru_model_version,
        "batch_id": batch_id,
        "state": "done",
        "parsed_at": datetime.now(timezone.utc).isoformat(),
        "content_hash": content_hash,
        "full_zip_url": result.get("full_zip_url"),
        "zip_path": _rel(zip_path),
        "extracted_dir": f"mineru/{content_hash}/extracted",
        "markdown_path": markdown_path,
        "content_list_path": content_list_path,
        "content_list_v2_path": content_list_v2_path,
        "middle_json_path": middle_json_path,
        "model_json_path": model_json_path,
        "image_paths": image_paths,
        "image_count": len(image_paths),
        "page_refs": page_refs,
    }


def parse_pdf_with_precise_api(*, document_id: str, filename: str, content_hash: str, file_path: Path) -> MinerUParseResult:
    settings = get_settings()
    if not settings.mineru_api_key:
        raise TraditionalRagError("MinerU API Key 未配置：请设置 MINERU_API_KEY", "config_error")

    base_url = settings.mineru_base_url.rstrip("/")
    token = settings.mineru_api_key
    timeout = max(settings.mineru_timeout_seconds, 60)
    apply_payload = {
        "files": [
            {
                "name": filename,
                "data_id": document_id,
                "is_ocr": settings.mineru_is_ocr,
            }
        ],
        "model_version": settings.mineru_model_version,
        "language": settings.mineru_language,
        "enable_table": settings.mineru_enable_table,
        "enable_formula": settings.mineru_enable_formula,
    }
    submit = _json_request("POST", f"{base_url}/api/v4/file-urls/batch", token=token, body=apply_payload)
    submit_data = _ensure_code_zero(submit, "申请上传链接")
    batch_id = submit_data.get("batch_id")
    file_urls = submit_data.get("file_urls")
    if not batch_id or not isinstance(file_urls, list) or not file_urls:
        raise TraditionalRagError(f"MinerU 上传链接响应无效：{submit_data}", "mineru_error")

    parse_root = resolve_storage_path("mineru", content_hash)
    parse_root.mkdir(parents=True, exist_ok=True)
    (parse_root / "submit.json").write_text(
        json.dumps({"batch_id": batch_id, "request": apply_payload, "trace_id": submit.get("trace_id")}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    _put_file(file_urls[0], file_path)

    started = time.monotonic()
    interval = max(settings.mineru_poll_interval_seconds, 1)
    last_payload: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    # C4：轮询 GET 有界重试——单次网络抖动不再终结整个长解析；连续失败 >K 才 raise。
    consecutive_failures = 0
    backoff_delays = [0.5, 1.0, 2.0]
    while time.monotonic() - started <= timeout:
        try:
            query = _json_request("GET", f"{base_url}/api/v4/extract-results/batch/{batch_id}", token=token)
            consecutive_failures = 0
        except TraditionalRagError:
            # 仅网络/请求层抖动(_json_request 抛)走重试；_ensure_code_zero 的 API 错误不在此 try、仍立即上抛。
            consecutive_failures += 1
            if consecutive_failures > 3:
                raise
            delay = backoff_delays[min(consecutive_failures - 1, len(backoff_delays) - 1)]
            if time.monotonic() - started + delay > timeout:
                break  # 重试会超总 timeout → 跳出走下方"超时"分支
            time.sleep(delay)
            continue
        query_data = _ensure_code_zero(query, "查询解析结果")
        last_payload = query
        extract_result = query_data.get("extract_result")
        if isinstance(extract_result, list) and extract_result:
            current = extract_result[0]
            if isinstance(current, dict):
                state = current.get("state")
                if state == "done":
                    result = current
                    break
                if state == "failed":
                    raise TraditionalRagError(f"MinerU PDF 解析失败：{current.get('err_msg') or current}", "mineru_error")
        time.sleep(interval)

    if result is None:
        if last_payload:
            (parse_root / "last_result.json").write_text(json.dumps(last_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        raise TraditionalRagError("MinerU PDF 解析超时", "mineru_error")

    full_zip_url = result.get("full_zip_url")
    if not full_zip_url:
        raise TraditionalRagError(f"MinerU 完成结果缺少 full_zip_url：{result}", "mineru_error")

    result_payload = {"batch_id": batch_id, "result": result, "last_response": last_payload}
    (parse_root / "result.json").write_text(json.dumps(result_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    zip_path = parse_root / "full.zip"
    _download(full_zip_url, zip_path)
    extracted_paths = _safe_extract(zip_path, parse_root / "extracted")
    metadata = _build_result_metadata(
        content_hash=content_hash,
        batch_id=batch_id,
        result=result,
        zip_path=zip_path,
        extracted_paths=extracted_paths,
    )
    return MinerUParseResult(metadata=metadata)
