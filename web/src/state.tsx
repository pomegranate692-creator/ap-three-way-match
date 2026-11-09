import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, setIdentity } from "./lib/api";

export interface OrgInfo { id: string; name: string; timezone: string; baseCurrency: string; users: { id: string; name: string; role: "clerk" | "controller" | "purchasing" }[] }
export interface Meta { llm: { enabled: boolean; reason: string; model: string | null; mode: string }; connectors: { name: string; status: string; detail?: string }[]; limits: { maxFileMb: number; maxFilesPerBatch: number } }
interface Toast { id: number; kind: "ok" | "bad"; text: string }

interface AppState {
  orgs: OrgInfo[]; org: OrgInfo | null; user: OrgInfo["users"][number] | null; meta: Meta | null;
  loading: boolean; offline: string | null;
  setOrg(id: string): void; setUser(id: string): void;
  notify(text: string, kind?: "ok" | "bad"): void; toasts: Toast[]; dismiss(id: number): void;
  version: number; refresh(): void; openOnboarding(): void; onboardingOpen: boolean; closeOnboarding(): void;
  reportError(e: unknown, prefix?: string): void; retry(): void;
}
const Ctx = createContext<AppState | null>(null);
export const useApp = () => { const c = useContext(Ctx); if (!c) throw new Error("no provider"); return c; };

const ls = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [orgId, setOrgId] = useState<string>(ls.get("ap.org") ?? "");
  const [userId, setUserId] = useState<string>(ls.get("ap.user") ?? "");
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [version, setVersion] = useState(0);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([api<OrgInfo[]>("GET", "/api/orgs"), api<Meta>("GET", "/api/meta")])
      .then(([o, m]) => {
        if (!live) return;
        setOrgs(o); setMeta(m); setOffline(null);
        const org = o.find((x) => x.id === orgId) ?? o[0];
        if (org) {
          const user = org.users.find((u) => u.id === userId) ?? org.users[0]!;
          setOrgId(org.id); setUserId(user.id);
          if (!ls.get("ap.onboarded")) setOnboardingOpen(true);
        }
      })
      .catch((e) => live && setOffline(e instanceof ApiError ? e.message : "Unexpected error while starting."))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const org = orgs.find((o) => o.id === orgId) ?? null;
  const user = org?.users.find((u) => u.id === userId) ?? null;
  if (org && user) setIdentity(org.id, user.id);

  const notify = useCallback((text: string, kind: "ok" | "bad" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "bad" ? 9000 : 4500);
  }, []);

  const value = useMemo<AppState>(() => ({
    orgs, org, user, meta, loading, offline, toasts, version, onboardingOpen,
    setOrg(id) { const o = orgs.find((x) => x.id === id); if (!o) return; setOrgId(id); const u = o.users[0]!; setUserId(u.id); ls.set("ap.org", id); ls.set("ap.user", u.id); setVersion((v) => v + 1); },
    setUser(id) { setUserId(id); ls.set("ap.user", id); setVersion((v) => v + 1); },
    notify, dismiss: (id) => setToasts((t) => t.filter((x) => x.id !== id)),
    refresh: () => setVersion((v) => v + 1),
    openOnboarding: () => setOnboardingOpen(true),
    closeOnboarding: () => { ls.set("ap.onboarded", "1"); setOnboardingOpen(false); },
    reportError(e, prefix) {
      if (e instanceof ApiError && e.network) setOffline(e.message);
      notify(`${prefix ? prefix + " " : ""}${e instanceof Error ? e.message : "Unexpected error."}`, "bad");
    },
    retry: () => { setOffline(null); setAttempt((a) => a + 1); setVersion((v) => v + 1); },
  }), [orgs, org, user, meta, loading, offline, toasts, version, onboardingOpen, notify]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Fetch with loading/error state; re-runs when identity/version changes. */
export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const app = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path || !app.user) return;
    let live = true;
    setLoading(true);
    api<T>("GET", path)
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e) => { if (live) setError(e as ApiError); })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, app.user?.id, app.version, tick, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
