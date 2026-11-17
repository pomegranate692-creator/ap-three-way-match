import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tesseractOcr } from "../../server/ingest/ocr.ts";
import { analyzePdf } from "../../server/pipeline/analyze.ts";
import { STRESS_DIR, loadStressTruth, scoreStressDoc, summarize } from "../../server/eval/stress.ts";

/**
 * Regression guard for OCR preprocessing (lighting flattening, upscale, deskew) on the SYNTHETIC stress photos.
 * Real tesseract.js; needs the cached language data like the other OCR tests, otherwise skipped. Floors sit below measured values.
 */
const cachePath = join(import.meta.dirname, "..", "..", "data", "ocr");
const d = describe.skipIf(!existsSync(join(cachePath, "eng.traineddata")));
const truth = loadStressTruth();
const doc = (id: string) => truth.docs.find((x) => x.id === id)!;
const read = (id: string, ocr = tesseractOcr({ cachePath })) => analyzePdf(readFileSync(join(STRESS_DIR, doc(id).file)), { ...doc(id).hint, ocr });

d("OCR preprocessing on stress photos", () => {
  // measured at the time of writing: S02 34/35, S04 27/40, S06 29/34, S07 25/36 (all with 0 confident errors)
  it.each([["S02", 30], ["S04", 22], ["S06", 25], ["S07", 20]] as const)("%s: reads at least %d fields correctly and nothing wrong with confidence ≥ 0.8", async (id, floor) => {
    const s = summarize(scoreStressDoc((await read(id)).extraction, doc(id).gold));
    expect(s.correct).toBeGreaterThanOrEqual(floor);
    expect(s.confidentErrors).toBe(0);
  }, 90_000);

  it("a rotated photo still highlights the printed total in the ORIGINAL image (boxes are mapped back from the deskewed frame)", async () => {
    const a = await read("S06");
    expect(a.layer.frame).toBeUndefined();
    const total = a.extraction.fields.find((f) => f.key === "total")!;
    expect(total.value).toBe("1640.63");
    // in the 1020x1320 photo the total sits at about x 0.78–0.94, y 0.60–0.63
    const cx = total.bbox!.x + total.bbox!.w / 2, cy = total.bbox!.y + total.bbox!.h / 2;
    expect(cx).toBeGreaterThan(0.75);
    expect(cx).toBeLessThan(0.97);
    expect(cy).toBeGreaterThan(0.58);
    expect(cy).toBeLessThan(0.66);
  }, 90_000);

  it("with preprocessing switched off the engine still reads the image (no frame, boxes untouched)", async () => {
    const a = await read("S02", tesseractOcr({ cachePath, preprocess: false }));
    expect(a.layer.frame).toBeUndefined();
    expect(a.layer.pages[0]!.words.length).toBeGreaterThan(20);
  }, 90_000);
});
