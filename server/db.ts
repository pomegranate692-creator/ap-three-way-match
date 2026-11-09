import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

export type DB = DatabaseSync;

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL, base_currency TEXT NOT NULL,
  synthetic INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('clerk','controller','purchasing')), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  org_id TEXT PRIMARY KEY REFERENCES organizations(id), json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), doc_type TEXT NOT NULL CHECK (doc_type IN ('PO','GRN','INVOICE')),
  filename TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, page_count INTEGER NOT NULL, stored_path TEXT NOT NULL,
  doc_number TEXT, po_ref TEXT, classification_conf REAL NOT NULL, classification_reason TEXT NOT NULL,
  text_layer_json TEXT NOT NULL, risk_flags_json TEXT NOT NULL, extractors TEXT NOT NULL, warnings_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('upload','demo')), uploaded_by TEXT, created_at TEXT NOT NULL,
  UNIQUE (org_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_docs_org_type_num ON documents(org_id, doc_type, doc_number);

CREATE TABLE IF NOT EXISTS bundles (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), seq INTEGER NOT NULL,
  label TEXT NOT NULL, fixture_id TEXT, po_number TEXT, state TEXT NOT NULL, recommendation TEXT,
  current_run_id TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bundles_org ON bundles(org_id, seq);

CREATE TABLE IF NOT EXISTS bundle_docs (
  bundle_id TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE, document_id TEXT NOT NULL REFERENCES documents(id),
  role TEXT NOT NULL CHECK (role IN ('po','grn','invoice')), PRIMARY KEY (bundle_id, document_id)
);

CREATE TABLE IF NOT EXISTS fields (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, key TEXT NOT NULL,
  value TEXT, raw TEXT NOT NULL, bbox_json TEXT, word_ids_json TEXT NOT NULL, confidence REAL NOT NULL, reason TEXT NOT NULL,
  extractor TEXT NOT NULL, corrected INTEGER NOT NULL DEFAULT 0, original_value TEXT, updated_at TEXT NOT NULL, updated_by TEXT,
  UNIQUE (document_id, key)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, bundle_id TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE, version INTEGER NOT NULL,
  engine_version TEXT NOT NULL, settings_hash TEXT NOT NULL, trigger TEXT NOT NULL, input_hash TEXT NOT NULL,
  result_json TEXT NOT NULL, recommendation TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT,
  UNIQUE (bundle_id, version)
);

CREATE TABLE IF NOT EXISTS exceptions (
  id TEXT PRIMARY KEY, bundle_id TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE, run_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL, code TEXT NOT NULL, severity TEXT NOT NULL, line_key TEXT, title TEXT NOT NULL,
  data_json TEXT NOT NULL, evidence_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','waived','overridden')),
  note TEXT, resolved_by TEXT, resolved_role TEXT, resolved_at TEXT, first_run_version INTEGER NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (bundle_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_exc_status ON exceptions(status, severity);

-- "agent decisions": every automated output (classification, extraction, recommendation, explanation) with who/what produced it
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, bundle_id TEXT, document_id TEXT, run_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('classification','extraction','recommendation','explanation')),
  actor TEXT NOT NULL, model TEXT, input_hash TEXT, output_json TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, bundle_id TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE, run_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve','reject','hold','reopen')),
  status TEXT NOT NULL CHECK (status IN ('approved','rejected','held','reopened','executed','superseded')),
  proposed_by TEXT NOT NULL, proposed_recommendation TEXT NOT NULL, proposed_at TEXT NOT NULL,
  decided_by TEXT NOT NULL, decided_role TEXT NOT NULL, decided_at TEXT NOT NULL, reason TEXT,
  idempotency_key TEXT, executed_at TEXT, execution_ref TEXT
);

CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, bundle_ids_json TEXT NOT NULL, document_id TEXT NOT NULL, field_key TEXT NOT NULL,
  before_value TEXT, after_value TEXT, reason TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corr_doc ON corrections(document_id);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, kind TEXT NOT NULL, format TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  bundle_ids_json TEXT NOT NULL, row_count INTEGER NOT NULL, sha256 TEXT NOT NULL, filename TEXT NOT NULL, stored_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  scope TEXT NOT NULL, key TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT NOT NULL, at TEXT NOT NULL, actor_id TEXT, actor_name TEXT, actor_role TEXT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human','system','agent')), action TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT, bundle_id TEXT, before_json TEXT, after_json TEXT, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_org_at ON audit_events(org_id, at);
CREATE INDEX IF NOT EXISTS idx_audit_bundle ON audit_events(bundle_id);
`;

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  const v = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined;
  if (!v) db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?)").run(String(SCHEMA_VERSION));
  return db;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

/** Run `fn` inside a transaction; rolls back on throw. Re-entrant (nested calls join the outer transaction). */
const depth = new WeakMap<DB, number>();
export function tx<T>(db: DB, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  if (d > 0) return fn();
  db.exec("BEGIN IMMEDIATE");
  depth.set(db, 1);
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    depth.set(db, 0);
  }
}

export function all<T = Record<string, unknown>>(db: DB, sql: string, ...params: (string | number | null)[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function get<T = Record<string, unknown>>(db: DB, sql: string, ...params: (string | number | null)[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function run(db: DB, sql: string, ...params: (string | number | null)[]) {
  return db.prepare(sql).run(...params);
}
