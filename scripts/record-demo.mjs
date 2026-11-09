/** Records the real local app against isolated synthetic data. Never uses data/app.db. */
import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(root, 'demos', stamp);
const scratch = resolve(root, 'data/e2e/demo-recording', stamp);
mkdirSync(output, { recursive: true });
mkdirSync(scratch, { recursive: true });
const env = { ...process.env, DB_PATH: resolve(scratch, 'app.db'), PORT: '8795', NODE_ENV: 'production', ENABLE_LLM: '0' };
const seed = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], { cwd: root, env, encoding: 'utf8' });
if (seed.status !== 0) throw new Error(seed.stderr || seed.stdout);
console.log(seed.stdout);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', b => process.stderr.write(b));
let browser;
let context;
const chapters = [];
let started;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://127.0.0.1:8795/api/health')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', recordVideo: { dir: output, size: { width: 1440, height: 1000 } } });
  await context.addInitScript(() => { localStorage.setItem('ap.onboarded', '1'); localStorage.setItem('ap.theme', 'light'); });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8795/');
  await expect(page.getByRole('link', { name: 'B01', exact: true })).toBeVisible();
  started = Date.now();
  // A recording-only caption margin keeps captions clear of real controls.
  await page.addStyleTag({ content: 'html { height: 910px !important; overflow: hidden !important; } body { height: 910px !important; min-height: 0 !important; } .app { min-height: 910px !important; } .rail { height:910px !important; } .viewer { height:calc(100vh - 170px) !important; } .decision { bottom:90px !important; } #recording-caption { position:fixed; z-index:999999; bottom:0; left:0; right:0; height:90px; background:#14202b; color:white; display:flex; align-items:center; justify-content:center; font:500 27px "IBM Plex Sans",sans-serif; box-sizing:border-box; border-top:4px solid #62aeea; pointer-events:none; padding:12px 30px; text-align:center; }' });
  async function caption(text, seconds = 4) {
    await page.evaluate(text => {
      let el = document.getElementById('recording-caption');
      if (!el) { el = document.createElement('div'); el.id = 'recording-caption'; document.body.appendChild(el); }
      el.textContent = text;
    }, text);
    chapters.push({ seconds: +((Date.now() - started) / 1000).toFixed(1), caption: text });
    console.log(text);
    await page.waitForTimeout(seconds * 1000);
  }
  async function open(label) {
    await page.getByRole('link', { name: label, exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: label })).toBeVisible();
  }
  const approve = () => page.getByRole('button', { name: 'Approve', exact: true });
  await caption('Three documents. One checked decision. Synthetic demo.', 5);
  await open('B01');
  await expect(page.getByText('System recommendation: Ready for approval')).toBeVisible();
  await caption('B01: ordered, received and billed all match.', 5);
  await approve().click();
  await page.getByRole('dialog').getByLabel(/Note/).fill('Demo: checked quantities, prices and totals.');
  await caption('A named person confirms the approval.', 3);
  await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved. Recorded with your name')).toBeVisible();
  await caption('Sign-off recorded. No payment is sent.', 4);
  await page.getByRole('link', { name: '← Inbox' }).click();
  await open('B05');
  await expect(page.locator('table.t').first().getByText('Billed > received')).toBeVisible();
  await caption('B05: 100 billed. Only 80 received.', 6);
  await page.locator('table.t td a', { hasText: /^100$/ }).first().click();
  await expect(page.locator('.hl.sel')).toHaveCount(1);
  await caption('Click a number to inspect its source.', 5);
  await page.getByRole('tab', { name: /Exceptions/ }).click();
  await expect(page.getByText(/only 80 were received/)).toBeVisible();
  await expect(approve()).toBeDisabled();
  await caption('$599 billed for goods not yet received.', 6);
  await caption('Approval blocked. Purchasing must investigate the delivery.', 4);
  await page.getByRole('link', { name: 'Exports', exact: true }).click();
  await page.getByLabel(/Exception record/).check();
  await page.getByLabel(/CSV/).check();
  await expect(page.locator('table.t').first()).toContainText('QTY_OVER_RECEIVED');
  await caption('Preview an exception report for follow-up.', 4);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Create CSV/ }).click();
  const csv = await downloadPromise;
  await csv.saveAs(resolve(output, 'sample-exception-record.csv'));
  await page.getByLabel('Organisation').selectOption({ label: 'Cobalt Bay Foods' });
  await open('B14');
  await page.getByRole('tab', { name: /Exceptions/ }).click();
  await expect(page.getByText(/a difference of 90\.00/)).toBeVisible();
  await caption('B14: the printed total is $90 too high.', 5);
  await page.getByRole('tab', { name: 'Fields', exact: true }).click();
  await page.locator('tr.field-row', { hasText: 'Total' }).filter({ hasNotText: 'Subtotal' }).locator('button.mono').last().click();
  await page.getByRole('button', { name: 'Correct this value' }).click();
  const before = await page.getByLabel('Correct value').inputValue();
  await page.getByLabel('Correct value').fill((Number(before) - 90).toFixed(2));
  await page.getByLabel(/Why are you changing it/).fill('Synthetic demo correction: replace erroneous total with the checked sum.');
  await caption('Demo correction: enter the checked total and reason.', 5);
  await page.getByRole('button', { name: 'Save and re-run match' }).click();
  await expect(page.getByText(/match re-ran \(v2\)/)).toBeVisible();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(page.getByText('Human corrections (1)')).toBeVisible();
  await expect(approve()).toBeDisabled();
  await caption('Rechecked automatically. The editor cannot also approve.', 5);
  await page.getByLabel('Acting as').selectOption({ label: 'Samir Haddad · Controller' });
  await expect(approve()).toBeEnabled();
  await approve().click();
  await page.getByRole('dialog').getByLabel(/Note/).fill('Synthetic demo: separately reviewed the corrected arithmetic.');
  await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved. Recorded with your name')).toBeVisible();
  await caption('A separate reviewer signs off.', 4);
  await page.getByRole('link', { name: 'Exports', exact: true }).click();
  await page.getByLabel(/Approved register/).check();
  await page.getByLabel(/Excel/).check();
  await expect(page.locator('table.t').first()).toContainText('B14');
  const xlPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Create XLSX/ }).click();
  await (await xlPromise).saveAs(resolve(output, 'sample-approved-register.xlsx'));
  await caption('Export the corrected, approved register to Excel.', 4);
  await page.getByRole('link', { name: 'Audit log', exact: true }).click();
  await expect(page.locator('table.t').first()).toContainText('field.corrected');
  await expect(page.locator('table.t').first()).toContainText('export.executed');
  await caption('Corrections, approvals and exports leave an audit trail.', 5);
  await caption('Exact maths. Human approval. No payments.', 5);
  await page.screenshot({ path: resolve(output, 'demo-final-frame.png') });
  const video = page.video();
  await context.close(); context = null;
  const raw = await video.path();
  writeFileSync(resolve(output, 'chapters.json'), JSON.stringify(chapters, null, 2));
  writeFileSync(resolve(output, 'README.txt'), 'Real browser recording of the app using a separate synthetic demo database. Captions are recording overlays; no AI services were used. No live demo data was changed. Silent video.\n');
  console.log(JSON.stringify({ output, raw, durationSeconds: (Date.now() - started) / 1000 }));
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
