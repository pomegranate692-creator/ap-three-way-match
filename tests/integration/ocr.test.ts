import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tesseractOcr } from "../../server/ingest/ocr.ts";
import { analyzePdf } from "../../server/pipeline/analyze.ts";
import { U, makeApp, pdf, scan } from "../helpers.ts";

/**
 * Real tesseract.js on synthetic scans (PNG renders of the fixture PDFs). Needs the English language data cached in
 * data/ocr/ (downloaded once by the first real OCR run). Without it these tests are skipped, never faked.
 */
const cachePath = join(import.meta.dirname, "..", "..", "data", "ocr");
const ready = existsSync(join(cachePath, "eng.traineddata"));
const d = describe.skipIf(!ready);
const ocr = tesseractOcr({ cachePath });
const OPTS = { numberLocale: "us", dateOrder: "MDY" } as const;
const THRESHOLD = 0.8;

d("scanned documents (OCR) — AT-13", () => {
  const files = ["B01_INV_INV48137.hi.png", "B05_PO_PO-HA4035.hi.png", "B05_GRN_GRN-7055.hi.png", "B05_INV_INV48685.hi.png", "B06_INV_B48822.lo.png"];

  it("never reports a value confidently when it differs from what the PDF text layer says (uncertainty is surfaced)", async () => {
    let lowConfidence = 0;
    for (const f of files) {
      const truth = await analyzePdf(pdf(f.replace(/\.(hi|lo)\.png$/, ".pdf")), OPTS);
      const got = await analyzePdf(scan(f), { ...OPTS, ocr });
      expect(got.extractorsUsed[0]).toBe("ocr:tesseract.js");
      expect(got.extraction.docType).toBe(truth.extraction.docType);
      expect(got.extraction.warnings.join(" ")).toMatch(/scanned image by OCR/);
      const want = new Map(truth.extraction.fields.map((x) => [x.key, x.value]));
      for (const fld of got.extraction.fields) {
        if (fld.confidence >= THRESHOLD) expect(fld.value, `${f} ${fld.key} (conf ${fld.confidence})`).toBe(want.get(fld.key));
        else lowConfidence++;
      }
    }
    expect(lowConfidence).toBeGreaterThan(0); // the scans really do contain doubtful reads, and they are marked as such
  }, 120_000);

  it("a clean scanned bundle still finds the seeded quantity discrepancy and routes doubtful fields to a human", async () => {
    const t = makeApp(undefined, ocr);
    const dana = t.as(U.harbor, "clerk");
    const r = await dana.upload(["B05_PO_PO-HA4035.hi.png", "B05_GRN_GRN-7055.hi.png", "B05_INV_INV48685.hi.png"].map((name) => ({ name, bytes: scan(name) })));
    expect(r.data.results.map((x: any) => x.status)).toEqual(["created", "created", "created"]);
    const bundleId = r.data.bundleIds[0];
    const b = (await dana.get(`/api/bundles/${bundleId}`)).data;
    const codes = b.exceptions.map((e: any) => e.code);
    expect(codes).toContain("QTY_OVER_RECEIVED");
    expect(b.run.result.recommendation).toBe("EXCEPTION_REVIEW");
    expect(codes.some((c: string) => c === "LOW_CONFIDENCE" || c === "MISSING_DATA")).toBe(true);
    // the original image is served back as an image, and the audit trail records that OCR was used
    const inv = b.documents.find((x: any) => x.role === "invoice");
    const file = await dana.get(`/api/documents/${inv.id ?? inv.documentId}/file`);
    expect(file.headers.get("content-type")).toBe("image/png");
    const audit = (await dana.get("/api/audit")).data as any[];
    expect(audit.some((a) => a.action === "document.uploaded" && JSON.stringify(a.after ?? "").includes('"ocr":true'))).toBe(true);
  }, 120_000);

  it("a poor scan is held for a person, never auto-approved", async () => {
    const t = makeApp(undefined, ocr);
    const dana = t.as(U.harbor, "clerk");
    const r = await dana.upload([{ name: "B06_INV_B48822.lo.png", bytes: scan("B06_INV_B48822.lo.png") }]);
    const b = (await dana.get(`/api/bundles/${r.data.bundleIds[0]}`)).data;
    expect(["HOLD", "EXCEPTION_REVIEW"]).toContain(b.run.result.recommendation);
    expect(b.exceptions.map((e: any) => e.code)).toContain("MISSING_DATA");
  }, 120_000);
});
