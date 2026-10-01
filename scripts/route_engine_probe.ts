#!/usr/bin/env bun
// P37-T4e·019B probe runner（spec §五2）：跨语言 evalset → routeEnginesForProbe 探针。
//
// 输入：route_evalset.jsonl（每行 `{query, ...}`），从 stdin 读，或以第一个位置参数传路径。
// 输出：JSONL 到 stdout，每行 `{query, mode, engines: string[] | null, error?: string}`。
// 单条异常（含超时）捕获为 error 字段，不中断整批；stdout 只写 JSONL，诊断信息写 stderr。
//
// 用法：
//   echo '{"query":"你好"}' | bun scripts/route_engine_probe.ts
//   bun scripts/route_engine_probe.ts eval/route-optimization/route_evalset.jsonl
import { routeEnginesForProbe } from "@ff/platform/platform-store";

const PROBE_TIMEOUT_MS = Number(process.env.ROUTE_PROBE_TIMEOUT_MS) || 30_000;

async function readInput(): Promise<string> {
  const pathArg = process.argv[2];
  if (pathArg) {
    return await Bun.file(pathArg).text();
  }
  return await Bun.stdin.text();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`probe timeout after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function main() {
  const raw = await readInput();
  const lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  console.error(`route_engine_probe: ${lines.length} 条待探针`);

  for (const line of lines) {
    let query: string;
    try {
      const parsed = JSON.parse(line);
      query = parsed.query;
      if (typeof query !== "string") throw new Error("query 字段缺失或非字符串");
    } catch (error) {
      // 输入行本身损坏：无法拿到 query 也要输出一条 error 记录，不静默丢行（batch 不中断）。
      console.error(`route_engine_probe: 输入行解析失败：${line} -> ${String(error)}`);
      console.log(JSON.stringify({ query: line, mode: "", engines: null, error: `input parse error: ${String(error)}` }));
      continue;
    }
    try {
      const result = await withTimeout(routeEnginesForProbe(query), PROBE_TIMEOUT_MS);
      console.log(JSON.stringify(result));
    } catch (error) {
      // routeEnginesForProbe 内部已 try/catch，这里兜底捕获超时等 withTimeout 抛出的异常。
      console.log(JSON.stringify({ query, mode: "", engines: null, error: String(error) }));
    }
  }
  console.error("route_engine_probe: 完成");
}

main().catch((error) => {
  console.error(`route_engine_probe: 致命错误：${String(error)}`);
  process.exit(1);
});
