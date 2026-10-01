#!/usr/bin/env bash
# P7-B：下载 embedding 模型的 tokenizer.json 到本地 vendored 路径，供 chunk 按 token 空间切分。
# 优先 ModelScope（国内稳，Qwen 原厂源），失败回退 HuggingFace。文件不入库（见 .gitignore），首次 setup 跑一次即可。
# 用法：bash scripts/fetch-tokenizers.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$ROOT/assets/tokenizers/qwen3-embedding-8b"
DEST="$DEST_DIR/tokenizer.json"
MODEL_MS="Qwen/Qwen3-Embedding-8B"   # ModelScope namespace/model
MODEL_HF="Qwen/Qwen3-Embedding-8B"   # HuggingFace repo
MS_URL="https://modelscope.cn/models/${MODEL_MS}/resolve/master/tokenizer.json"
HF_URL="https://huggingface.co/${MODEL_HF}/resolve/main/tokenizer.json"

mkdir -p "$DEST_DIR"

if [ -f "$DEST" ]; then
  echo "已存在：$DEST（$(wc -c < "$DEST") bytes）。删除后重跑可强制刷新。"
  exit 0
fi

fetch() {
  local url="$1" label="$2"
  echo "尝试从 ${label} 下载：$url"
  if curl -fsSL --max-time 120 -o "$DEST.tmp" "$url"; then
    # 校验是合法 JSON（tokenizer.json 应含 model.type）
    if python3 -c "import json,sys; d=json.load(open('$DEST.tmp')); sys.exit(0 if d.get('model',{}).get('type') else 1)" 2>/dev/null; then
      mv "$DEST.tmp" "$DEST"
      echo "成功：$DEST（$(wc -c < "$DEST") bytes，来自 ${label}）"
      return 0
    fi
    echo "  ${label} 下载内容非合法 tokenizer.json，丢弃。"
  fi
  rm -f "$DEST.tmp"
  return 1
}

if fetch "$MS_URL" "ModelScope"; then exit 0; fi
echo "ModelScope 失败，回退 HuggingFace（国内可能需 HF_ENDPOINT=https://hf-mirror.com）..."
HF_TRY="${HF_ENDPOINT:-https://huggingface.co}/${MODEL_HF}/resolve/main/tokenizer.json"
if fetch "$HF_TRY" "HuggingFace"; then exit 0; fi

echo "两个源都失败。可手动下载 tokenizer.json 放到：$DEST" >&2
echo "（缺文件不致命：chunk 会退回字符兜底，只是尺寸精度下降）" >&2
exit 1
