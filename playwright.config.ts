import { defineConfig, devices } from "@playwright/test";

// E2E runs against the PRODUCTION build on its own port + throw-away database, using the locally installed Google Chrome
// (no browser download needed).
const PORT = 8793;
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: "chrome", trace: "retain-on-failure", screenshot: "only-on-failure", colorScheme: "light" },
  webServer: {
    // Everything the test server writes (database, uploads, exports) lives in data/e2e/, which is wiped each run.
    // It never touches data/app.db, data/uploads or data/exports (the real local demo data).
    command: `sh -c "rm -rf data/e2e && mkdir -p data/e2e && npm run build >/dev/null && DB_PATH=data/e2e/e2e.db PORT=${PORT} NODE_ENV=production npx tsx server/index.ts"`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: "desktop", testMatch: /demo\.spec\.ts/, use: { viewport: { width: 1360, height: 860 } } },
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
});
