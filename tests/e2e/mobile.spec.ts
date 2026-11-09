import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SHOTS = join(import.meta.dirname, "..", "..", "screenshots");
mkdirSync(SHOTS, { recursive: true });

test("mobile layout: no horizontal page scroll, bottom navigation, document/analysis switch", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("ap.onboarded", "1"));
  await page.reload();
  await page.getByLabel("Organisation").selectOption({ label: "Harbor & Pine Hardware" });
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await noOverflow();
  await page.screenshot({ path: join(SHOTS, "12-mobile-inbox.png") });
  await page.getByRole("link", { name: "B05", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: "B05" })).toBeVisible();
  await noOverflow();
  await expect(page.getByRole("button", { name: /^Analysis/ })).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "13-mobile-review.png") });
  await page.getByRole("button", { name: "Document" }).click();
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "14-mobile-document.png") });
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toBeVisible();
  const box = await nav.boundingBox();
  expect(box!.y + box!.height).toBeGreaterThan(page.viewportSize()!.height - 80);
});
