import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SHOTS = process.env.SCREENSHOT_DIR ?? join(import.meta.dirname, "..", "..", "test-results", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const HARBOR = { "x-org-id": "org-harbor", "x-user-id": "u-harbor-ctrl" };

test.describe.configure({ mode: "serial" });

async function boot(page: Page, user = "Marcus") {
  await page.goto("/");
  await page.evaluate(() => { localStorage.setItem("ap.onboarded", "1"); localStorage.setItem("ap.org", "org-harbor"); localStorage.removeItem("ap.days"); localStorage.removeItem("ap.source"); });
  await page.reload();
  await expect(page.getByLabel("Organisation")).toHaveValue("org-harbor");
  const opt = await page.getByLabel("Acting as").evaluate((el: HTMLSelectElement, who) => [...el.options].find((o) => o.text.includes(who) || o.text.includes("Controller"))?.text ?? "", user);
  await page.getByLabel("Acting as").selectOption({ label: opt });
}
async function axe(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${where}: ${v.id} ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), `axe ${where}`).toEqual([]);
}
const kpi = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

test("Overview: every KPI equals what the API computes from the database, range filter and refresh work", async ({ page, request }) => {
  await boot(page);
  const api = await (await request.get("/api/dashboard?days=30", { headers: HARBOR })).json();
  await expect(kpi(page, "Invoices Processed")).toContainText(String(api.kpis.processed.value));
  await expect(kpi(page, "Auto-Match Rate")).toContainText(`${(api.kpis.autoMatchRate.value * 100).toFixed(1)}%`);
  await expect(kpi(page, "Exceptions")).toContainText(String(api.kpis.exceptions.value));
  await expect(kpi(page, "Total Invoice Value")).toContainText("$");
  // no comparison arrow without history (the demo has only one period of data)
  await expect(page.getByText(/vs\. prior period/)).toHaveCount(0);
  await expect(page.getByText(/Synthetic demo data\./)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Exception Alerts/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /invoices: .* Matched/ })).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "20-overview.png"), fullPage: true });

  await page.getByLabel("Date range").selectOption("7");
  const wk = await (await request.get("/api/dashboard?days=7", { headers: HARBOR })).json();
  await expect(kpi(page, "Invoices Processed")).toContainText(String(wk.kpis.processed.value));
  expect(wk.kpis.processed.value).toBeLessThan(api.kpis.processed.value);
  await page.getByLabel("Date range").selectOption("30");
  const before = page.waitForResponse((r) => r.url().includes("/api/dashboard"));
  await page.getByRole("button", { name: "Refresh" }).click();
  expect((await before).status()).toBe(200);
  await axe(page, "overview");
});

test("Invoice queue: search, status filter, sort, pagination, selection and row actions", async ({ page }) => {
  await boot(page);
  const q = page.locator("table.qt");
  await q.waitFor();
  await expect(page.getByText("Page 1 of 2")).toBeVisible(); // 9 invoices, 5 per page
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Previous page" }).click();
  await page.getByLabel("Search invoices, suppliers or PO numbers").fill("B05");
  await expect(q.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Search invoices, suppliers or PO numbers").fill("zzzz-nothing");
  await expect(page.getByText("Nothing matches these filters")).toBeVisible();
  await page.getByLabel("Search invoices, suppliers or PO numbers").fill("");
  await page.getByLabel("Filter by status").selectOption("review");
  const n = await q.locator("tbody tr").count();
  expect(n).toBeGreaterThanOrEqual(3); // B05, B06, B08 are seeded exceptions
  for (const s of await q.locator("tbody tr td:nth-child(7)").allInnerTexts()) expect(s).toMatch(/Needs Review/);
  await page.getByLabel("Filter by status").selectOption("all");
  // sort by amount ascending then descending
  const amounts = async () => (await q.locator("tbody tr td:nth-child(5)").allInnerTexts()).map((s) => Number(s.replace(/[^0-9.]/g, "")));
  await page.getByRole("button", { name: /^Amount/ }).click();
  const asc = await amounts();
  expect(asc).toEqual([...asc].sort((a, b) => a - b));
  await page.getByRole("button", { name: /^Amount/ }).click();
  const desc = await amounts();
  expect(desc).toEqual([...desc].sort((a, b) => b - a));
  // select a row: it appears in the approval panel; select-all + export
  await q.locator("tbody tr").nth(1).click();
  await expect(q.locator("tbody tr").nth(1)).toHaveAttribute("aria-selected", "true");
  // a selection with no open exceptions is refused with an explanation (nothing downloaded)
  await page.getByLabel("Filter by status").selectOption("ready");
  await q.getByLabel("Select all invoices on this page").check();
  await page.getByRole("button", { name: /Export exception record/ }).click();
  await expect(page.getByText(/nothing to put in an exception record/)).toBeVisible();
  await q.getByLabel("Select all invoices on this page").uncheck();
  await page.getByLabel("Filter by status").selectOption("review");
  await q.getByLabel("Select all invoices on this page").check();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export exception record/ }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^exception-record_.*\.csv$/);
  // row action menu
  await q.getByRole("button", { name: /^Actions for/ }).first().click();
  await expect(page.getByRole("menuitem", { name: "Open full detail" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Open full detail" })).toHaveCount(0);
});

test("Exception alerts and the donut link to filtered records", async ({ page }) => {
  await boot(page);
  await page.getByRole("link", { name: /Quantity mismatch/ }).click();
  await expect(page).toHaveURL(/#\/exceptions\?category=quantity/);
  await expect(page.getByRole("heading", { level: 1, name: "Exceptions" })).toBeVisible();
  const rows = page.locator("table.t tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("B05");
  await page.goto("/#/");
  await page.getByRole("link", { name: /Price \/ Amount Mismatch/ }).click();
  await expect(page).toHaveURL(/#\/invoices\?match=price/);
  await expect(page.getByLabel("Filter by match result")).toHaveValue("price");
  await expect(page.locator("table.qt tbody tr")).not.toHaveCount(0);
  for (const s of await page.locator("table.qt tbody tr td:nth-child(6)").allInnerTexts()) expect(s).toMatch(/Price Mismatch/);
});

test("Approval panel: real decisions persist, need a note where required, honour roles, and reach the audit trail", async ({ page, request }) => {
  await boot(page);
  const row = async (label: string) => page.locator("table.qt tbody tr", { has: page.locator(".scn", { hasText: new RegExp(`^${label}$`) }) });
  await page.getByLabel("Search invoices, suppliers or PO numbers").fill("B05");
  await (await row("B05")).first().click();
  const panel = page.getByRole("complementary").filter({ has: page.getByRole("heading", { name: "Approval Review" }) });
  await expect(panel).toContainText("only 80");
  await expect(panel.getByText("Three-Way Match Summary")).toBeVisible();
  await expect(panel.locator("table.li")).toContainText("100"); // invoiced quantity
  await expect(panel.getByRole("button", { name: "Approve" })).toBeDisabled();
  await page.screenshot({ path: join(SHOTS, "21-approval-panel.png") });

  // Request Information needs a note; the failure is explained and nothing changes
  await page.getByLabel("Search invoices, suppliers or PO numbers").fill("B08");
  await (await row("B08")).first().click();
  await panel.getByRole("button", { name: "Request Info" }).click();
  await expect(panel.getByRole("alert")).toContainText(/note of at least 3 characters/);
  await panel.getByLabel(/Approval Notes/).fill("Please confirm the shipped quantity with the supplier");
  await panel.getByRole("button", { name: "Request Info" }).click();
  await expect(page.getByText(/Information requested for/)).toBeVisible();
  await expect(panel.getByText("On Hold")).toBeVisible();

  // Reject a different invoice, then approve a clean one (clerk limit applies; controller here)
  await page.getByLabel("Search invoices, suppliers or PO numbers").fill("B06");
  await (await row("B06")).first().click();
  await panel.getByRole("button", { name: "Reject" }).click();
  await expect(panel.getByRole("alert")).toContainText(/to reject/);
  await panel.getByLabel(/Approval Notes/).fill("Price exceeds PO; supplier must reissue");
  await panel.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText(/rejected\./)).toBeVisible();
  await expect(panel.getByText(/Rejected by/)).toBeVisible();

  await page.getByLabel("Search invoices, suppliers or PO numbers").fill("B02");
  await (await row("B02")).first().click();
  await panel.getByRole("button", { name: "Approve" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toContainText(/does not pay the invoice/);
  await dlg.getByRole("button", { name: "Confirm approval" }).click();
  await expect(page.getByText(/approved\. Recorded in the audit trail/)).toBeVisible();
  await expect(panel.getByText(/Approved by/)).toBeVisible();

  // persisted server-side, with the three decisions in the audit trail
  const list = await (await request.get("/api/bundles", { headers: HARBOR })).json() as { label: string; state: string }[];
  const st = Object.fromEntries(list.map((b) => [b.label, b.state]));
  expect(st.B08).toBe("held"); expect(st.B05).not.toBe("held"); expect(st.B06).toBe("rejected"); expect(st.B02).toBe("approved");
  const aud = await (await request.get("/api/audit?action=approval.&limit=20", { headers: HARBOR })).json() as { action: string; note: string | null }[];
  expect(aud.map((a) => a.action)).toEqual(expect.arrayContaining(["approval.held", "approval.rejected", "approval.approved"]));
  expect(aud.find((a) => a.action === "approval.held")!.note).toContain("Information requested");
  await page.goto("/#/approvals");
  await expect(page.getByRole("heading", { name: "Decision history" })).toBeVisible();
  await expect(page.locator("table.t").filter({ hasText: "Reason" })).toContainText("Price exceeds PO");
  await axe(page, "approvals");
});

test("Documents, uploads and failure handling: validation, removal with re-match, scenario loader", async ({ page, request }) => {
  await boot(page);
  await page.goto("/#/documents");
  await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();
  await page.setInputFiles('input[type="file"]', [
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    { name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) },
    { name: "corrupt.pdf", mimeType: "application/pdf", buffer: Buffer.from("this is not a pdf at all") },
  ]);
  await expect(page.getByText(/Unsupported file type/)).toBeVisible();
  await expect(page.getByText(/file is empty/)).toBeVisible();
  await expect(page.locator(".uplist")).toContainText("corrupt.pdf");
  await expect(page.locator(".uplist li.rejected")).toHaveCount(3);
  // server unreachable: the failure is explained, nothing is claimed as uploaded, Retry is offered
  await page.route("**/api/upload", (r) => r.abort());
  await page.setInputFiles('input[type="file"]', [{ name: "offline.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 x") }]);
  await expect(page.locator(".uplist li.failed")).toContainText(/Can't reach the server/);
  await expect(page.locator(".uplist li.failed").getByRole("button", { name: "Retry" })).toBeVisible();
  await page.unroute("**/api/upload");

  // remove a receiving record: the bundle is re-evaluated and now reports a missing receipt
  const before = await (await request.get("/api/documents", { headers: HARBOR })).json() as { id: string; docType: string; bundles: { id: string }[] }[];
  const bundles = await (await request.get("/api/bundles", { headers: HARBOR })).json() as { id: string; label: string }[];
  const b09 = bundles.find((b) => b.label === "B09")!;
  const grn = before.find((d) => d.docType === "GRN" && d.bundles.length === 1 && d.bundles[0]!.id === b09.id)!;
  await page.getByLabel("Search documents").fill(grn.id ? (await (await request.get(`/api/bundles/${b09.id}`, { headers: HARBOR })).json()).documents.find((d: { id: string }) => d.id === grn.id).docNumber : "");
  const row = page.locator("table.t tbody tr").filter({ has: page.getByText("Receiving record") }).first();
  await row.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove document" }).click();
  await expect(page.getByText(/Removed .*re-run/)).toBeVisible();
  const detail = await (await request.get(`/api/bundles/${grn.bundles[0]!.id}`, { headers: HARBOR })).json();
  expect(detail.exceptions.some((e: { code: string }) => e.code === "MISSING_RECEIPT")).toBe(true);

  // missing-PO scenario through the UI
  await page.goto("/#/invoices");
  await page.getByRole("button", { name: "Load this scenario" }).click();
  await expect(page.getByText(/no purchase order on file/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open", exact: true }).last()).toBeVisible();
  await page.goto("/#/exceptions?category=missing_po");
  await expect(page.locator("table.t tbody tr")).toHaveCount(1);
  await expect(page.locator("table.t")).toContainText("No purchase order on file");
});

test("Every navigation item leads to a working screen; Three-Way Match drill-down; Settings tabs", async ({ page }) => {
  await boot(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  const expectH1: [string, string][] = [["Overview", "AP Document Intelligence"], ["Invoice Processing", "Invoice Processing"], ["Three-Way Match", "Three-Way Match"], ["Exceptions", "Exceptions"], ["Approvals", "Approvals"], ["Documents", "Documents"], ["Audit Trail", "Audit Trail"], ["Reports", "Reports"], ["Settings", "Settings"]];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const [link, h1] of expectH1) {
    await nav.getByRole("link", { name: link, exact: false }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
    await expect(nav.getByRole("link", { name: link, exact: false }).first()).toHaveAttribute("aria-current", "page");
  }
  await nav.getByRole("link", { name: "Three-Way Match" }).click();
  await page.locator("table.t tbody tr").first().click();
  await expect(page.getByText(/^Lines for /)).toBeVisible();
  await expect(page.locator("table.li")).toBeVisible();
  await nav.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Data & safety" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.getByRole("tab", { name: "Matching & approvals" }).click();
  await page.getByLabel("Theme").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel("Theme").selectOption("dark");
  expect(errors).toEqual([]);
});

test("Responsive: 1024, 768 and 375 widths have no horizontal overflow; approval review is a drawer", async ({ page }) => {
  await boot(page);
  for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024], [375, 812]] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const r of ["/", "/invoices", "/match", "/approvals", "/documents", "/settings"]) {
      await page.goto(`/#${r}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${w}px ${r}`).toBeLessThanOrEqual(1);
    }
  }
  // drawer at 375: opens from the floating button, closes with the X
  await page.goto("/#/");
  await page.screenshot({ path: join(SHOTS, "22-mobile-overview.png"), fullPage: true });
  await page.getByRole("button", { name: "Review selected invoice" }).click();
  const drawer = page.getByRole("complementary").filter({ has: page.getByRole("heading", { name: "Approval Review" }) });
  await expect(drawer).toBeInViewport();
  await page.screenshot({ path: join(SHOTS, "23-mobile-approval-drawer.png") });
  await expect((await drawer.getByRole("button", { name: "Approve" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await drawer.getByRole("button", { name: "Close approval review" }).click();
  await expect(drawer).not.toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "Approval Review" })).toBeInViewport();
  await page.screenshot({ path: join(SHOTS, "24-desktop-1440.png"), fullPage: true });
});
