import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildDeliveryDemoDataPlan, buildTemplateDemoWalkthroughs, type DemoAsset } from "@ff/platform";

const OUT_DIR = "_seed-data/companybrain";

async function main() {
  const plan = buildDeliveryDemoDataPlan();
  const walkthroughs = buildTemplateDemoWalkthroughs();
  await mkdir(OUT_DIR, { recursive: true });

  for (const asset of plan.assets) {
    const filePath = join(OUT_DIR, asset.templateId, asset.scenarioId, asset.fileName);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, asset.format === "pdf" ? simplePdf(asset) : asset.text);
  }

  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify({ ...plan, templateWalkthroughs: walkthroughs }, null, 2));
  console.log(JSON.stringify({
    ok: true,
    out_dir: OUT_DIR,
    scenarios: plan.scenarios.length,
    assets: plan.assets.length,
    walkthroughs: walkthroughs.length
  }, null, 2));
}

function simplePdf(asset: DemoAsset): Buffer {
  const text = asset.text.replace(/[^\x20-\x7E]/g, " ").slice(0, 1400);
  const stream = `BT /F1 10 Tf 50 760 Td (${escapePdf(text)}) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`
  ];
  const body = objects.join("\n");
  return Buffer.from(`%PDF-1.4\n${body}\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
