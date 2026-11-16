// Rasterise a few synthetic fixture PDFs into PNG "scans" for the OCR tests (macOS `sips`; the PNGs are committed, so
// other platforms never need to run this). `hi` = clean ~220 dpi scan, `lo` = deliberately poor ~90 dpi scan.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "fixtures", "scanned");
mkdirSync(out, { recursive: true });
const jobs = [
  ["B01_INV_INV48137", "hi"],
  ["B05_PO_PO-HA4035", "hi"], ["B05_GRN_GRN-7055", "hi"], ["B05_INV_INV48685", "hi"],
  ["B06_INV_B48822", "lo"],
];
for (const [name, q] of jobs) {
  execFileSync("sips", ["-s", "format", "png", "--resampleHeightWidthMax", q === "hi" ? "2300" : "1000", join(root, "fixtures", "pdf", `${name}.pdf`), "--out", join(out, `${name}.${q}.png`)], { stdio: "ignore" });
  console.log("wrote", `${name}.${q}.png`);
}
