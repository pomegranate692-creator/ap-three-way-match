export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details?: unknown, readonly network = false) {
    super(message);
  }
}

let identity = { orgId: "", userId: "" };
export function setIdentity(orgId: string, userId: string) { identity = { orgId, userId }; }
export const getIdentity = () => identity;

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { headers?: Record<string, string>; form?: FormData; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (identity.orgId) { headers["x-org-id"] = identity.orgId; headers["x-user-id"] = identity.userId; }
  let payload: BodyInit | undefined;
  if (opts.form) payload = opts.form;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new ApiError("Can't reach the server. Check that it is running (npm run dev) and try again. Nothing was changed.", 0, "NETWORK", undefined, true);
  }
  if (opts.raw) {
    if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status, "HTTP");
    return (await res.blob()) as T;
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(e?.message ?? `The server returned ${res.status}.`, res.status, e?.code ?? "HTTP", e?.details);
  }
  return data as T;
}

export const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export async function download(path: string, filename: string) {
  const blob = await api<Blob>("GET", path, undefined, { raw: true });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
