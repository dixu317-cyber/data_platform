#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "缺少 Bun，请先安装 Bun 后再运行。"
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "缺少 uv，请先安装 uv 后再运行。"
  exit 1
fi

cd "$ROOT"

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  echo "已从 .env.example 创建 .env，请根据本机数据库和模型配置补齐后重新运行。"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  bun install
fi

exec bun run dev:all
