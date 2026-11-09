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

test("mobile decision bar is compact: Approve stays in reach, Hold/Reject open under More", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("ap.onboarded", "1"));
  await page.reload();
  await page.getByLabel("Organisation").selectOption({ label: "Harbor & Pine Hardware" });
  // a controller can hold and reject, so the bar has secondary actions to tuck away
  const controller = await page.getByLabel("Acting as").evaluate((el: HTMLSelectElement) => Array.from(el.options).find((o) => /Controller/.test(o.text))?.text ?? "");
  expect(controller).not.toBe("");
  await page.getByLabel("Acting as").selectOption({ label: controller });
  await page.getByRole("link", { name: "B05", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: "B05" })).toBeVisible();

  const bar = page.locator(".decision");
  await expect(bar).toBeVisible();
  const compact = (await bar.boundingBox())!;
  expect(compact.height).toBeLessThan(110); // one status/Approve/More row plus the short "why disabled" line
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  const approveBox = (await page.getByRole("button", { name: "Approve", exact: true }).boundingBox())!;
  expect(approveBox.height).toBeGreaterThanOrEqual(44); // thumb-sized
  const more = page.getByRole("button", { name: "More", exact: true });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeHidden();
  await page.screenshot({ path: join(SHOTS, "15-mobile-decision-bar.png") });

  await more.click();
  await expect(page.getByRole("button", { name: "Less", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Hold", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: join(SHOTS, "16-mobile-decision-more.png") });
  await page.getByRole("button", { name: "Less", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeHidden();
  await expect(bar).toBeVisible();
});
