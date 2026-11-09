import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SHOTS = join(import.meta.dirname, "..", "..", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });

async function pickUser(page: Page, org: string, user: string) {
  const orgSel = page.getByLabel("Organisation");
  const current = await orgSel.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.text);
  if (current !== org) await orgSel.selectOption({ label: org }); // switching organisation returns to its inbox
  await page.getByLabel("Acting as").selectOption({ label: user });
}
async function openBundle(page: Page, label: string) {
  await page.getByRole("link", { name: label, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: label })).toBeVisible();
}
async function axeCheck(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${where}: ${v.id} (${v.nodes.length}) ${v.help} :: ${v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} → ${(n.any[0]?.message ?? '').slice(0, 110)}`).join(' | ')}`), `axe on ${where}`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test("AT-12 · first run → demo data → success path → exception path → human correction → trustworthy export", async ({ page }) => {
  /* ---------- first-run onboarding ---------- */
  await page.goto("/");
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("heading", { name: /Check three documents/ })).toBeVisible();
  await shot(page, "01-onboarding");
  await dlg.getByRole("button", { name: "Next" }).click();
  await expect(dlg.getByRole("heading", { name: /who you're acting as/ })).toBeVisible();
  await dlg.getByRole("button", { name: "Next" }).click();
  // empty state first: say no to the tour's data load, look at the honest empty inbox
  await dlg.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("heading", { name: "No invoices yet" })).toBeVisible();
  await shot(page, "02-empty-state");

  /* ---------- load synthetic data through the real pipeline ---------- */
  await pickUser(page, "Harbor & Pine Hardware", "Dana Whitfield · AP Clerk");
  await page.getByRole("button", { name: "Load synthetic demo data" }).click();
  await expect(page.getByText("Loaded 9 synthetic bundles")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("table.t tbody tr")).toHaveCount(9);
  await shot(page, "03-inbox");
  await axeCheck(page, "inbox");

  /* ---------- SUCCESS PATH: clean bundle approved with one click ---------- */
  await openBundle(page, "B01");
  await expect(page.getByText("System recommendation: Ready for approval")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved. Recorded with your name")).toBeVisible();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();

  /* ---------- FAILURE PATH: quantity mismatch, evidence on the original page ---------- */
  await page.goto("/#/");
  await openBundle(page, "B05");
  await expect(page.getByText("System recommendation: Exception review")).toBeVisible();
  await expect(page.locator("table.t").first().getByText("Billed > received")).toBeVisible();
  await shot(page, "04-review-match");
  const billed = page.locator("table.t td a", { hasText: /^100$/ }).first();
  await billed.click();
  await expect(page.locator(".hl.sel")).toHaveCount(1);
  await expect(page.getByText("Printed text")).toBeVisible();
  await expect(page.locator("dl.kv")).toContainText("100");
  await expect(page.locator("canvas").first()).toBeVisible();
  await shot(page, "05-source-highlight");
  await page.getByRole("tab", { name: /Exceptions/ }).click();
  await expect(page.getByText(/only 80 were received/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark resolved" })).toBeDisabled(); // a clerk doesn't own receiving disputes
  await shot(page, "06-exception-card");
  await axeCheck(page, "review/exceptions");

  // approval is blocked and says why
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect(page.getByText(/Can't approve yet/)).toBeVisible();

  /* ---------- export an exception record for approval routing ---------- */
  await page.getByRole("link", { name: "Exports" }).click();
  await page.getByLabel(/Exception record/).check();
  await page.getByLabel(/CSV/).check();
  await expect(page.getByText("Preview", { exact: true })).toBeVisible();
  await expect(page.locator("table.t").first()).toContainText("QTY_OVER_RECEIVED");
  await shot(page, "07-export-preview");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Create CSV/ }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^exception-record_.*\.csv$/);

  /* ---------- HUMAN CORRECTION on Cobalt Bay: B14 stated total is $90 too high ---------- */
  await pickUser(page, "Cobalt Bay Foods", "Elena Torres · AP Clerk");
  await page.getByRole("button", { name: "Load synthetic demo data" }).click();
  await expect(page.getByText("Loaded 9 synthetic bundles")).toBeVisible({ timeout: 60_000 });
  await openBundle(page, "B14");
  await page.getByRole("tab", { name: /Exceptions/ }).click();
  await expect(page.getByText(/Invoice total does not add up/)).toBeVisible();
  await expect(page.getByText(/a difference of 90\.00/)).toBeVisible();
  await page.getByRole("tab", { name: "Fields" }).click();
  // select the invoice "Total" row value
  await page.locator("tr.field-row", { hasText: "Total" }).filter({ hasNotText: "Subtotal" }).locator("button.mono").last().click();
  await expect(page.locator(".hl.sel")).toHaveCount(1);
  await page.getByRole("button", { name: "Correct this value" }).click();
  const before = await page.getByLabel("Correct value").inputValue();
  expect(Number(before)).toBeGreaterThan(0);
  await page.getByLabel("Correct value").fill(String((Number(before) - 90).toFixed(2)));
  await page.getByLabel(/Why are you changing it/).fill("Total re-keyed from supplier's corrected PDF");
  await page.getByRole("button", { name: "Save and re-run match" }).click();
  await expect(page.getByText(/match re-ran \(v2\)/)).toBeVisible();
  await expect(page.locator(".badge", { hasText: "Ready for approval" }).first()).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("Human corrections (1)")).toBeVisible();
  await shot(page, "08-correction-history");

  // separation of duties: the corrector cannot approve; the controller can
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect(page.getByText(/someone else must approve/)).toBeVisible();
  await pickUser(page, "Cobalt Bay Foods", "Samir Haddad · Controller");
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("dialog").getByLabel(/Note/).fill("Checked corrected total against supplier PDF");
  await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved. Recorded with your name")).toBeVisible();

  /* ---------- regenerated, trustworthy output ---------- */
  await page.getByRole("link", { name: "Exports" }).click();
  await page.getByLabel(/Approved register/).check();
  await page.getByLabel(/Excel/).check();
  await expect(page.locator("table.t").first()).toContainText("B14");
  await shot(page, "09-approved-register-preview");
  const [xl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Create XLSX/ }).click()]);
  expect(xl.suggestedFilename()).toMatch(/^approved-register_.*\.xlsx$/);
  await expect(page.getByText(/No payment or posting happened/)).toBeVisible();

  /* ---------- audit trail shows proposal → human → execution ---------- */
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.locator("table.t").first()).toContainText("field.corrected");
  await expect(page.locator("table.t").first()).toContainText("approval.approved");
  await expect(page.locator("table.t").first()).toContainText("export.executed");
  await shot(page, "10-audit-log");
  await axeCheck(page, "audit");
});

test("keyboard: skip link, tab order, dialog focus trap and Escape", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("ap.onboarded", "1"));
  await page.reload();
  await expect(page.getByLabel("Organisation")).toHaveValue("org-harbor");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  // reach a bundle link and open it with Enter
  await page.getByRole("link", { name: "B05", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: "B05" })).toBeVisible();
  // open the hold dialog by keyboard, verify focus is inside it, Escape returns focus
  const hold = page.getByRole("button", { name: "Hold", exact: true });
  await hold.focus();
  await page.keyboard.press("Enter");
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel(/Reason/)).toBeFocused();
  for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true); }
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(hold).toBeFocused();
});

test("errors are explained and recoverable: wrong file type, role denial, server-side validation", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("ap.onboarded", "1"));
  await page.reload();
  await page.getByLabel("Organisation").selectOption({ label: "Harbor & Pine Hardware" });
  await page.setInputFiles('input[type="file"]', [{ name: "scan.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex") }, { name: "bad.pdf", mimeType: "application/pdf", buffer: Buffer.from("hello") }]);
  await expect(page.getByText("Rejected").first()).toBeVisible();
  await expect(page.getByText(/OCR engine/)).toBeVisible();
  await expect(page.getByText(/missing %PDF header/)).toBeVisible();
  await shot(page, "11-upload-rejections");
  // a purchasing lead is told clearly that they cannot approve
  await page.getByLabel("Acting as").selectOption({ label: "Priya Raman · Purchasing Lead" });
  await page.getByRole("link", { name: "B02", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect(page.getByText(/do not approve payment/)).toBeVisible();
  // settings are read-only unless controller
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText(/Only a Controller can change/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save settings" })).toBeDisabled();
});

test("keyboard: tab strips follow the ARIA arrow-key pattern (roving focus, wrap, Home/End, Tab leaves the strip)", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("ap.onboarded", "1"));
  await page.reload();
  await page.getByLabel("Organisation").selectOption({ label: "Harbor & Pine Hardware" });
  await openBundle(page, "B05");

  const strip = page.getByRole("tablist", { name: "Analysis sections" });
  const tab = (name: string | RegExp) => strip.getByRole("tab", { name, exact: typeof name === "string" });
  const onlyOneTabStop = async () => expect(await strip.getByRole("tab").evaluateAll((els) => els.filter((e) => e.getAttribute("tabindex") === "0").length)).toBe(1);

  await onlyOneTabStop(); // roving tabindex: the strip is a single stop in the Tab order
  await tab("Match").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(/^Exceptions/)).toBeFocused();
  await expect(tab(/^Exceptions/)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toBeVisible();
  await onlyOneTabStop();
  await page.keyboard.press("End");
  await expect(tab("How it was decided")).toBeFocused();
  await expect(tab("How it was decided")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight"); // wraps to the first tab
  await expect(tab("Match")).toBeFocused();
  await page.keyboard.press("ArrowLeft"); // wraps to the last tab
  await expect(tab("How it was decided")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tab("Match")).toBeFocused();
  await expect(tab("Match")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Tab"); // leaves the strip instead of stepping through every tab
  await expect(strip.getByRole("tab").and(page.locator(":focus"))).toHaveCount(0);

  // the document strip works the same way, and skips a disabled "missing" tab
  const docs = page.getByRole("tablist", { name: "Documents in this bundle" });
  const enabled = docs.getByRole("tab").and(page.locator(":not([disabled])"));
  const n = await enabled.count();
  expect(n).toBeGreaterThanOrEqual(2);
  await enabled.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(enabled.nth(1)).toBeFocused();
  await expect(enabled.nth(1)).toHaveAttribute("aria-selected", "true");
});
