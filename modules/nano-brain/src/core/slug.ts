// 共享 slug 归一：links 抽链的 to_slug 与 pages 落库的 slug 必须同源，
// 否则 [[X]] 链目标永远连不到页 slug（P19 改造1-A）。
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}
