#!/usr/bin/env python3
"""Create a private Compose env from a local root env without printing secrets."""

from __future__ import annotations

import argparse
import os
import re
import secrets
import sys
import tempfile
from pathlib import Path


KEY_PATTERN = re.compile(r"^([A-Z_][A-Z0-9_]*)=(.*)$")

REQUIRED_SOURCE_KEYS = (
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD",
    "RAG_INTERNAL_TOKEN",
    "EMBEDDING_API_KEY",
    "EMBEDDING_BASE_URL",
    "EMBEDDING_MODEL",
    "AGENT_API_KEY",
    "AGENT_BASE_URL",
    "AGENT_MODEL",
)

OPTIONAL_SOURCE_KEYS = (
    "EMBEDDING_PROVIDER",
    "EMBEDDING_DIMENSIONS",
    "AGENT_PROVIDER",
    "AGENT_STREAM_USAGE",
    "AGENT_TEMPERATURE",
    "DASHSCOPE_API_KEY",
    "MINERU_API_KEY",
    "MINERU_BASE_URL",
    "RERANK_BASE_URL",
    "RERANK_MODEL",
)

LOCAL_SECRET_KEYS = (
    "POSTGRES_BOOTSTRAP_PASSWORD",
    "POSTGRES_MIGRATOR_PASSWORD",
    "IDENTITY_APP_PASSWORD",
    "PLATFORM_APP_PASSWORD",
    "NANO_APP_PASSWORD",
    "AGENT_APP_PASSWORD",
    "TRADITIONAL_APP_PASSWORD",
    "GRAPH_APP_PASSWORD",
    "NEO4J_PASSWORD",
)


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:]
        match = KEY_PATTERN.match(line)
        if match:
            values[match.group(1)] = match.group(2)
    return values


def local_secret() -> str:
    # Keep generated database passwords away from a leading dash: Neo4j's
    # initialization CLI treats such a value as an option instead of a
    # positional password argument.
    return "m5_" + secrets.token_urlsafe(32).rstrip("=")


def render(template: Path, values: dict[str, str]) -> str:
    rendered: list[str] = []
    for raw_line in template.read_text(encoding="utf-8").splitlines(keepends=True):
        match = KEY_PATTERN.match(raw_line.rstrip("\n"))
        if match and match.group(1) in values:
            rendered.append(f"{match.group(1)}={values[match.group(1)]}\n")
        else:
            rendered.append(raw_line)
    return "".join(rendered)


def write_private(path: Path, content: str) -> None:
    descriptor, temporary_path = tempfile.mkstemp(prefix=".env.m5-", dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
        os.replace(temporary_path, path)
        os.chmod(path, 0o600)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
        raise


def main() -> int:
    compose_dir = Path(__file__).resolve().parent
    repository_root = compose_dir.parent.parent
    parser = argparse.ArgumentParser(
        description="Create deploy/compose/.env from a private root .env without echoing values."
    )
    parser.add_argument("--template", type=Path, default=compose_dir / ".env.example")
    parser.add_argument("--source", type=Path, default=repository_root / ".env")
    parser.add_argument("--target", type=Path, default=compose_dir / ".env")
    parser.add_argument("--force", action="store_true", help="replace an existing private target env")
    args = parser.parse_args()

    for path, label in ((args.template, "template"), (args.source, "source")):
        if not path.is_file():
            print(f"Missing {label} env file: {path}", file=sys.stderr)
            return 2
    if args.target.exists() and not args.force:
        print(f"Refusing to replace existing private env: {args.target} (pass --force to replace)", file=sys.stderr)
        return 2

    source_values = parse_env(args.source)
    missing = [key for key in REQUIRED_SOURCE_KEYS if not source_values.get(key)]
    if missing:
        print("Source env is missing required keys: " + ", ".join(missing), file=sys.stderr)
        return 2

    values = {key: source_values[key] for key in REQUIRED_SOURCE_KEYS}
    for key in OPTIONAL_SOURCE_KEYS:
        if source_values.get(key):
            values[key] = source_values[key]
    for key in LOCAL_SECRET_KEYS:
        values[key] = local_secret()

    output = render(args.template, values)
    args.target.parent.mkdir(parents=True, exist_ok=True)
    write_private(args.target, output)
    print(f"Created private deployment env: {args.target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
