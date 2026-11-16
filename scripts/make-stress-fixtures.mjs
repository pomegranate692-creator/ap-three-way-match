// Builds fixtures/stress/: 10 synthetic invoices (fictional vendors, new layouts) degraded like phone photos, plus an exact
// ground_truth.json computed from the source numbers. Deterministic. Uses @napi-rs/canvas (already installed as a pdfjs-dist dependency).
// Usage: node scripts/make-stress-fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SPECS, compute } from "./stress/specs.mjs";
import { renderInvoice } from "./stress/render.mjs";
import { degrade } from "./stress/degrade.mjs";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "stress");
mkdirSync(out, { recursive: true });
const docs = [];
SPECS.forEach((spec, i) => {
  const calc = compute(spec);
  const page = renderInvoice(spec, calc);
  const img = degrade(page, spec.damage, 9100 + i);
  const file = `${spec.id}.${spec.damage}.jpg`;
  writeFileSync(join(out, file), img.bytes);
  docs.push({
    id: spec.id, file, damage: spec.damage, applied: img.applied, pixels: `${img.width}x${img.height}`,
    hint: { numberLocale: spec.locale, dateOrder: spec.dateOrder }, gold: calc.gold,
  });
  console.log(file, `${img.width}x${img.height}`, `${(img.bytes.length / 1024).toFixed(0)} KB`);
});
writeFileSync(join(out, "ground_truth.json"), JSON.stringify({
  note: "SYNTHETIC STRESS TEST. Fictional vendors; invoices drawn from source data and degraded to imitate phone photos. Ground truth is computed from the source numbers, not read from the images. Not real-world accuracy.",
  damageLevels: ["light", "medium", "heavy"], docs,
}, null, 2) + "\n");
