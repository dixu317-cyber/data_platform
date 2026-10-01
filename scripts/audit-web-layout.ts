import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContextOptions } from "@playwright/test";

type Severity = "error" | "warning";

type LayoutIssue = {
  severity: Severity;
  code: string;
  message: string;
  selector?: string;
  metric?: Record<string, number | string | boolean | null>;
};

type RouteAudit = {
  route: string;
  viewport: string;
  url: string;
  title: string;
  redirectedTo: string;
  document: {
    clientWidth: number;
    scrollWidth: number;
    clientHeight: number;
    scrollHeight: number;
  };
  counts: {
    panels: number;
    grids: number;
    lists: number;
  };
  issues: LayoutIssue[];
};

type AuditSummary = {
  generatedAt: string;
  webBaseUrl: string;
  apiBaseUrl: string;
  routes: string[];
  audits: RouteAudit[];
};

const webBaseUrl = normalizeBaseUrl(process.env.WEB_BASE_URL ?? "http://localhost:3000");
const apiBaseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001");
const appDir = path.join(process.cwd(), "apps", "web", "app");
const outputPath = path.join(process.cwd(), "output", "playwright", "layout-audit.json");

const viewports = [
  { name: "desktop", width: 1440, height: 950 },
  { name: "mobile", width: 390, height: 844 },
];

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

async function collectRoutes(dir = appDir, relative = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const routes: string[] = [];

  if (entries.some((entry) => entry.isFile() && entry.name === "page.tsx")) {
    const route = relative
      .split(path.sep)
      .filter((segment) => segment && !segment.startsWith("_") && !segment.startsWith("("))
      .join("/");
    routes.push(route ? `/${route}` : "/");
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_")) continue;
    routes.push(...await collectRoutes(path.join(dir, entry.name), path.join(relative, entry.name)));
  }

  return routes;
}

function sortRoutes(routes: string[]): string[] {
  const preferred = [
    "/",
    "/login",
    "/dashboard",
    "/sources",
    "/pages",
    "/explore",
    "/facts",
    "/dream",
    "/traditional",
    "/traditional/documents",
    "/traditional/jobs",
    "/traditional/search",
    "/traditional/tables",
    "/graph",
    "/graph/documents",
    "/graph/search",
    "/agent",
  ];
  const rank = new Map(preferred.map((route, index) => [route, index]));
  return [...new Set(routes)].sort((a, b) => {
    const rankA = rank.get(a) ?? 999;
    const rankB = rank.get(b) ?? 999;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });
}

async function getAdminToken(): Promise<string | null> {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return null;

  const response = await fetch(`${apiBaseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error(`Admin login failed with HTTP ${response.status}`);
  }

  const body = await response.json() as { token?: string };
  if (!body.token) throw new Error("Admin login did not return a token");
  return body.token;
}

function storageStateForToken(token: string): BrowserContextOptions["storageState"] {
  return {
    cookies: [],
    origins: [
      {
        origin: new URL(webBaseUrl).origin,
        localStorage: [{ name: "ff_companybrain_token", value: token }],
      },
    ],
  };
}

async function auditRoute(input: {
  route: string;
  viewport: { name: string; width: number; height: number };
  storageState?: BrowserContextOptions["storageState"];
}): Promise<RouteAudit> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: input.viewport.width, height: input.viewport.height },
    storageState: input.storageState,
  });
  const page = await context.newPage();
  const url = `${webBaseUrl}${input.route}`;

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);

  const result = await page.evaluate((route) => {
    type RectInfo = {
      selector: string;
      label: string;
      top: number;
      left: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    };

    const panelSelector = [
      ".workspace-panel",
      ".detail-panel",
      ".admin-panel",
      ".page-list-panel",
      ".editor-panel",
      ".preview-panel",
      ".capture-panel",
      ".query-panel",
      ".graph-panel",
      ".graph-card",
      ".ask-panel",
      ".fact-submit-panel",
      ".submission-panel",
      ".submission-detail-panel",
      ".facts-panel",
      ".entity-panel",
      ".fact-detail-panel",
      ".dream-panel",
      ".agent-panel",
    ].join(",");
    const gridSelector = [
      ".page-layout",
      ".explore-grid",
      ".graph-grid",
      ".review-layout",
      ".queue-detail-layout",
      ".facts-review-grid",
      ".dream-layout",
      ".facts-section-grid",
      ".facts-lookup-grid",
      ".dream-trigger-grid",
      ".dream-runs-grid",
      ".agent-grid",
      ".agent-secondary-grid",
      ".agent-audit-grid",
      ".dashboard-layout",
      ".ops-metric-grid",
    ].join(",");
    const listSelector = [
      ".result-list",
      ".link-list",
      ".chunk-preview-list",
      ".submission-list",
      ".fact-list",
      ".dream-run-list",
      ".conversation-list",
      ".event-list",
      ".tool-call-list",
      ".page-list",
    ].join(",");

    function cssPath(element: Element): string {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.body && parts.length < 4) {
        const classes = Array.from(current.classList).slice(0, 2).map((item) => `.${CSS.escape(item)}`).join("");
        let part = `${current.tagName.toLowerCase()}${classes}`;
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    }

    function textLabel(element: Element): string {
      const heading = element.querySelector("h1,h2,h3,.eyebrow");
      return (heading?.textContent ?? element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    }

    function isVisible(element: Element): boolean {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
    }

    function rectInfo(element: Element): RectInfo {
      const rect = element.getBoundingClientRect();
      return {
        selector: cssPath(element),
        label: textLabel(element),
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left + window.scrollX),
        right: Math.round(rect.right + window.scrollX),
        bottom: Math.round(rect.bottom + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }

    function horizontalOverlapRatio(a: RectInfo, b: RectInfo): number {
      const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      return overlap / Math.max(1, Math.min(a.width, b.width));
    }

    function verticalGap(a: RectInfo, b: RectInfo): number {
      return b.top - a.bottom;
    }

    const issues: LayoutIssue[] = [];
    const panels = Array.from(document.querySelectorAll(panelSelector)).filter(isVisible).map(rectInfo);
    const grids = Array.from(document.querySelectorAll(gridSelector)).filter(isVisible);
    const lists = Array.from(document.querySelectorAll(listSelector)).filter(isVisible);

    const documentMetrics = {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    };

    if (documentMetrics.scrollWidth > documentMetrics.clientWidth + 2) {
      issues.push({
        severity: "error",
        code: "horizontal-overflow",
        message: "页面存在横向溢出",
        metric: {
          clientWidth: documentMetrics.clientWidth,
          scrollWidth: documentMetrics.scrollWidth,
          overflow: documentMetrics.scrollWidth - documentMetrics.clientWidth,
        },
      });
    }

    for (const panel of panels) {
      const element = document.elementFromPoint(panel.left + 2 - window.scrollX, panel.top + 2 - window.scrollY)?.closest(panelSelector);
      if (!element) continue;
      const children = Array.from(element.children).filter(isVisible).map(rectInfo).sort((a, b) => a.top - b.top);
      for (let index = 1; index < children.length; index += 1) {
        const previous = children[index - 1];
        const next = children[index];
        if (horizontalOverlapRatio(previous, next) < 0.62) continue;
        const gap = verticalGap(previous, next);
        if (gap >= 0 && gap < 8) {
          issues.push({
            severity: gap < 4 ? "error" : "warning",
            code: "panel-compact-children",
            message: "面板直接子元素垂直间距过小",
            selector: panel.selector,
            metric: {
              gap,
              previous: previous.label,
              next: next.label,
            },
          });
          break;
        }
      }
    }

    const sortedPanels = panels.sort((a, b) => a.top - b.top || a.left - b.left);
    for (const panel of sortedPanels) {
      const next = sortedPanels.find((candidate) => candidate.top > panel.bottom && horizontalOverlapRatio(panel, candidate) > 0.68);
      if (!next) continue;
      const gap = verticalGap(panel, next);
      if (gap > 180) {
        issues.push({
          severity: window.innerWidth < 720 || gap <= 260 ? "warning" : "error",
          code: "same-column-large-gap",
          message: "同一视觉列中两个面板之间存在大段空白",
          selector: panel.selector,
          metric: {
            gap,
            from: panel.label,
            to: next.label,
          },
        });
      }
    }

    for (const grid of grids) {
      const children = Array.from(grid.children).filter(isVisible).map(rectInfo);
      const rows = new Map<number, RectInfo[]>();
      for (const child of children) {
        const rowKey = Array.from(rows.keys()).find((top) => Math.abs(top - child.top) < 16);
        if (rowKey === undefined) rows.set(child.top, [child]);
        else rows.get(rowKey)?.push(child);
      }
      for (const row of rows.values()) {
        if (row.length < 2) continue;
        const heights = row.map((item) => item.height);
        const min = Math.min(...heights);
        const max = Math.max(...heights);
        if (min > 0 && max - min > 220 && max / min > 1.7) {
          issues.push({
            severity: "warning",
            code: "grid-row-height-imbalance",
            message: "同一 grid 行中面板高度差过大，可能造成下一行异常空白",
            selector: cssPath(grid),
            metric: {
              minHeight: min,
              maxHeight: max,
              ratio: Number((max / min).toFixed(2)),
            },
          });
        }
      }
    }

    for (const list of lists) {
      const rect = list.getBoundingClientRect();
      const style = getComputedStyle(list);
      if (list.scrollHeight > list.clientHeight + 8 && !["auto", "scroll"].includes(style.overflowY)) {
        issues.push({
          severity: "error",
          code: "list-no-internal-scroll",
          message: "列表内容超过容器但没有内部滚动",
          selector: cssPath(list),
          metric: {
            height: Math.round(rect.height),
            clientHeight: list.clientHeight,
            scrollHeight: list.scrollHeight,
            overflowY: style.overflowY,
          },
        });
      }
      if (rect.height > window.innerHeight * 0.72) {
        issues.push({
          severity: "warning",
          code: "list-too-tall",
          message: "列表占用视口高度过大",
          selector: cssPath(list),
          metric: {
            height: Math.round(rect.height),
            viewportHeight: window.innerHeight,
          },
        });
      }
    }

    const overflowingText = Array.from(document.querySelectorAll("button,a,p,span,small,dd,dt,label,h1,h2,h3,pre"))
      .filter(isVisible)
      .filter((element) => {
        const style = getComputedStyle(element);
        if (["auto", "scroll"].includes(style.overflowX)) return false;
        return element.scrollWidth > element.clientWidth + 3;
      })
      .slice(0, 6);
    for (const element of overflowingText) {
      issues.push({
        severity: "warning",
        code: "text-horizontal-overflow",
        message: "文本节点存在横向溢出风险",
        selector: cssPath(element),
        metric: {
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          text: textLabel(element),
        },
      });
    }

    if (route !== "/" && documentMetrics.scrollHeight > window.innerHeight * 3.2) {
      issues.push({
        severity: "warning",
        code: "page-too-tall",
        message: "工作台页面整体高度偏长，可能有列表或布局行撑开页面",
        metric: {
          viewportHeight: window.innerHeight,
          scrollHeight: documentMetrics.scrollHeight,
          ratio: Number((documentMetrics.scrollHeight / window.innerHeight).toFixed(2)),
        },
      });
    }

    return {
      title: document.title,
      redirectedTo: window.location.href,
      document: documentMetrics,
      counts: {
        panels: panels.length,
        grids: grids.length,
        lists: lists.length,
      },
      issues,
    };
  }, input.route);

  await context.close();
  await browser.close();

  return {
    route: input.route,
    viewport: input.viewport.name,
    url,
    ...result,
  };
}

function printSummary(audits: RouteAudit[]) {
  for (const audit of audits) {
    const errors = audit.issues.filter((issue) => issue.severity === "error").length;
    const warnings = audit.issues.filter((issue) => issue.severity === "warning").length;
    const suffix = audit.redirectedTo !== audit.url ? ` -> ${audit.redirectedTo}` : "";
    console.log(`${audit.viewport.padEnd(7)} ${audit.route.padEnd(24)} ${errors} error, ${warnings} warning${suffix}`);
    for (const issue of audit.issues.slice(0, 5)) {
      const selector = issue.selector ? ` ${issue.selector}` : "";
      console.log(`  ${issue.severity.toUpperCase()} ${issue.code}${selector}: ${issue.message}`);
    }
    if (audit.issues.length > 5) console.log(`  ... ${audit.issues.length - 5} more`);
  }
}

async function main() {
  const routes = sortRoutes(await collectRoutes());
  const token = await getAdminToken();
  if (!token) {
    console.warn("ADMIN_USERNAME/ADMIN_PASSWORD 未配置，将只能审计匿名可访问页面。");
  }

  const audits: RouteAudit[] = [];
  for (const viewport of viewports) {
    for (const route of routes) {
      const storageState = route === "/" || route === "/login" || !token ? undefined : storageStateForToken(token);
      audits.push(await auditRoute({ route, viewport, storageState }));
    }
  }

  const summary: AuditSummary = {
    generatedAt: new Date().toISOString(),
    webBaseUrl,
    apiBaseUrl,
    routes,
    audits,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);

  printSummary(audits);
  console.log(`\nLayout audit written to ${outputPath}`);

  const errorCount = audits.flatMap((audit) => audit.issues).filter((issue) => issue.severity === "error").length;
  if (errorCount > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
