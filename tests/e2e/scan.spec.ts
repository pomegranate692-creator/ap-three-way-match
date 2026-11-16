import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const SHOTS = process.env.SCREENSHOT_DIR ?? join(ROOT, "test-results", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const ready = existsSync(join(ROOT, "data", "ocr", "eng.traineddata"));
const names = ["B05_PO_PO-HA4035.hi.png", "B05_GRN_GRN-7055.hi.png", "B05_INV_INV48685.hi.png"];

test.skip(!ready, "OCR language data not cached in data/ocr (run one real OCR first)");

test("AT-13 · scanned invoice: OCR warning, original image with source boxes, discrepancy still found", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("ap.onboarded", "1"));
  await page.reload();
  await page.getByLabel("Organisation").selectOption({ label: "Cobalt Bay Foods" });
  await page.setInputFiles('input[type="file"]', names.map((n) => ({ name: n, mimeType: "image/png", buffer: readFileSync(join(ROOT, "fixtures", "scanned", n)) })));
  await page.getByRole("link", { name: /Open bundle/ }).first().click({ timeout: 60_000 });
  await expect(page.getByText("Scanned · OCR")).toBeVisible();
  await expect(page.getByText("Original document · boxes mark where each value was read")).toBeVisible();
  await expect(page.locator('img[alt="Scanned document"]')).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  const box = page.locator(".hl").first();
  await expect(box).toBeVisible();
  await box.click();
  await expect(page.locator(".hl.sel")).toHaveCount(1);
  await expect(page.getByText(/scanned image by OCR/).first()).toBeVisible(); // the Fields tab carries the full OCR warning
  await page.getByRole("tab", { name: /Exceptions/ }).click();
  await expect(page.getByText(/only 80 were received/)).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "17-scanned-invoice.png") });
});
