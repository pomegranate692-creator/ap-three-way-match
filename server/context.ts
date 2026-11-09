import type { DB } from "./db.ts";
import { run } from "./db.ts";
import type { Role } from "../shared/schemas.ts";
import type { LlmAdapters } from "./llm/adapters.ts";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, "BAD_REQUEST", msg, details);
export const forbidden = (msg: string, details?: unknown) => new HttpError(403, "FORBIDDEN", msg, details);
export const notFound = (what: string) => new HttpError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, "CONFLICT", msg, details);
export const unprocessable = (msg: string, details?: unknown) => new HttpError(422, "UNPROCESSABLE", msg, details);

export interface Actor {
  id: string;
  name: string;
  role: Role;
}

export interface Ctx {
  db: DB;
  orgId: string;
  actor: Actor;
  /** UTC ISO-8601 clock — injectable so tests are deterministic */
  now: () => string;
  dataDir: string;
  llm: LlmAdapters;
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  bundleId?: string | null;
  before?: unknown;
  after?: unknown;
  note?: string | null;
  kind?: "human" | "system" | "agent";
}

/** Every state change goes through here. `kind` distinguishes a human action from a system/agent action. */
export function audit(ctx: Ctx, e: AuditInput): void {
  const human = (e.kind ?? "human") === "human";
  run(
    ctx.db,
    `INSERT INTO audit_events(org_id, at, actor_id, actor_name, actor_role, actor_kind, action, entity_type, entity_id, bundle_id, before_json, after_json, note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ctx.orgId, ctx.now(), human ? ctx.actor.id : null, human ? ctx.actor.name : e.kind === "agent" ? "extraction/explanation agent" : "system", human ? ctx.actor.role : null,
    e.kind ?? "human", e.action, e.entityType, e.entityId ?? null, e.bundleId ?? null,
    e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after), e.note ?? null,
  );
}
