// A5：监听前校验。占位/空/过短 RAG_INTERNAL_TOKEN 不能让任何模块 HTTP 服务真正 listen。
// 只做纯校验，无副作用；调用方负责在 serve()/uvicorn.run() 前调用，校验失败即让进程非 0 退出。
const PLACEHOLDER_INTERNAL_TOKEN = "change-me-internal-token";
const MIN_INTERNAL_TOKEN_LENGTH = 32;

export function assertInternalTokenValid(token: string | undefined | null): asserts token is string {
  if (!token) {
    throw new Error("RAG_INTERNAL_TOKEN 未配置，进程拒绝启动");
  }
  if (token === PLACEHOLDER_INTERNAL_TOKEN) {
    throw new Error("RAG_INTERNAL_TOKEN 仍是出厂占位值，进程拒绝启动");
  }
  if (token.length < MIN_INTERNAL_TOKEN_LENGTH) {
    throw new Error(`RAG_INTERNAL_TOKEN 长度不足 ${MIN_INTERNAL_TOKEN_LENGTH}，进程拒绝启动`);
  }
}
