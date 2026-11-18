import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Shared-password gate for a public demo (HTTP Basic: any user name, the shared password).
 * It keeps strangers out of the demo and its identity switcher; it is NOT per-user authentication.
 * /api/health stays open so the host's health check works.
 */
export function passwordGate(password: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === "/api/health") return next();
    const h = c.req.header("authorization") ?? "";
    const m = h.match(/^Basic\s+(.+)$/i);
    let given = "";
    if (m) { const raw = Buffer.from(m[1]!, "base64").toString("utf8"); given = raw.slice(raw.indexOf(":") + 1); }
    if (m && safeEqual(given, password)) return next();
    return c.text("Password required.", 401, { "WWW-Authenticate": 'Basic realm="AP Three-Way Match demo (synthetic data)", charset="UTF-8"', "Cache-Control": "no-store" });
  };
}
