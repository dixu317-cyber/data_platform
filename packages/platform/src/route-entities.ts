// P50 · 静态 typed curated 实体表：进程内只读常量，启动即用，零 DB/scope/异步。
// 实体名是公开路由词表（非数据），不含权限语义。来源：eval 语料 curated。
export const ROUTE_ENTITIES = {
  companies: ["中安保险", "米粒电商", "启明星科技", "拓普汽车", "顺捷物流", "华远制造", "优康医疗", "清源资本", "红杉资本", "高瓴资本", "风行科技", "星辰教育"],
  persons: ["赵天成", "孙悦", "陈立"],
  products: ["智枢", "司脑", "鲸智"],
} as const;

// 别名归一：变体 -> 规范名。用于最长匹配前的归一化。
export const ROUTE_ENTITY_ALIASES: Record<string, string> = {
  "启明星": "启明星科技",
  "华远制造集团": "华远制造",
};

// 全角转半角 + 小写 + 去空白（中文实体名不受影响；仅做 latin/全半角/空格归一）。
export function normalizeRouteQuery(query: string): string {
  return query
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, " ")
    .toLowerCase()
    .replace(/\s+/g, "");
}

// 别名替换（先长后短，避免短别名截断长别名匹配窗口），在归一化之后进行。
function applyAliases(normalizedQuery: string): string {
  const aliases = Object.keys(ROUTE_ENTITY_ALIASES).sort((a, b) => b.length - a.length);
  let result = normalizedQuery;
  for (const alias of aliases) {
    result = result.split(normalizeRouteQuery(alias)).join(normalizeRouteQuery(ROUTE_ENTITY_ALIASES[alias]));
  }
  return result;
}

function normalizeAndAlias(query: string): string {
  return applyAliases(normalizeRouteQuery(query));
}

// 只有 allowlist 里的 typed 实体参与判定；未在表中的词（如"检索模块/引擎/算法/分词器"）恒 false。
export function hasCompanyEntity(query: string): boolean {
  const normalized = normalizeAndAlias(query);
  return ROUTE_ENTITIES.companies.some((name) => normalized.includes(normalizeRouteQuery(name)));
}

export function hasPersonEntity(query: string): boolean {
  const normalized = normalizeAndAlias(query);
  return ROUTE_ENTITIES.persons.some((name) => normalized.includes(normalizeRouteQuery(name)));
}

export function hasProductEntity(query: string): boolean {
  const normalized = normalizeAndAlias(query);
  return ROUTE_ENTITIES.products.some((name) => normalized.includes(normalizeRouteQuery(name)));
}

// 返回命中的 product 规范名（最长匹配优先），供 T1 模式4（实体-实体）用。
export function matchedProduct(query: string): string | null {
  const normalized = normalizeAndAlias(query);
  const byLengthDesc = [...ROUTE_ENTITIES.products].sort((a, b) => b.length - a.length);
  for (const name of byLengthDesc) {
    if (normalized.includes(normalizeRouteQuery(name))) return name;
  }
  return null;
}
