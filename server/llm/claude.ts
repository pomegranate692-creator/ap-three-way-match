/**
 * Minimal, hardened Claude Messages API client.
 *  - API key is read server-side only and never sent to the browser.
 *  - timeout, bounded retries with backoff, circuit breaker, client-side rate limit.
 *  - transport is injectable so tests run with a mock (this client has NEVER been run against the live API in this repo).
 */
export interface ClaudeRequest {
  system: string;
  user: string;
  maxTokens: number;
}
export type Transport = (req: ClaudeRequest, opts: { signal: AbortSignal; model: string; apiKey: string }) => Promise<{ status: number; text: string }>;

export class LlmUnavailable extends Error {
  constructor(message: string, readonly reason: "disabled" | "circuit_open" | "rate_limited" | "timeout" | "http_error" | "bad_output") {
    super(message);
  }
}

export interface ClaudeClientOptions {
  apiKey: string;
  model: string;
  transport?: Transport;
  timeoutMs?: number;
  maxRetries?: number;
  failureThreshold?: number;
  cooldownMs?: number;
  maxPerMinute?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const defaultTransport: Transport = async (req, { signal, model, apiKey }) => {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: "user", content: req.user }] }),
  });
  const body = await res.text();
  if (!res.ok) return { status: res.status, text: body };
  try {
    const j = JSON.parse(body) as { content?: { type: string; text?: string }[] };
    return { status: 200, text: (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("") };
  } catch {
    return { status: 502, text: "unparseable response" };
  }
};

export class ClaudeClient {
  private failures = 0;
  private openedAt: number | null = null;
  private stamps: number[] = [];
  private readonly o: Required<Omit<ClaudeClientOptions, "transport">> & { transport: Transport };
  calls = 0;

  constructor(opts: ClaudeClientOptions) {
    this.o = {
      timeoutMs: 20_000, maxRetries: 2, failureThreshold: 3, cooldownMs: 60_000, maxPerMinute: 30,
      now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), transport: defaultTransport, ...opts,
    };
  }

  get model() { return this.o.model; }

  circuit(): "closed" | "open" | "half-open" {
    if (this.openedAt === null) return "closed";
    return this.o.now() - this.openedAt >= this.o.cooldownMs ? "half-open" : "open";
  }

  async complete(req: ClaudeRequest): Promise<string> {
    const state = this.circuit();
    if (state === "open") throw new LlmUnavailable("circuit breaker open after repeated failures", "circuit_open");
    const t = this.o.now();
    this.stamps = this.stamps.filter((s) => t - s < 60_000);
    if (this.stamps.length >= this.o.maxPerMinute) throw new LlmUnavailable("client-side rate limit reached", "rate_limited");
    this.stamps.push(t);

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.o.maxRetries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.o.timeoutMs);
      try {
        this.calls++;
        const r = await this.o.transport(req, { signal: ac.signal, model: this.o.model, apiKey: this.o.apiKey });
        clearTimeout(timer);
        if (r.status === 200) {
          this.failures = 0;
          this.openedAt = null;
          return r.text;
        }
        lastErr = new LlmUnavailable(`HTTP ${r.status}`, "http_error");
        if (r.status !== 429 && r.status < 500) break; // 4xx other than 429: do not retry
      } catch (e) {
        clearTimeout(timer);
        lastErr = (e as Error).name === "AbortError" ? new LlmUnavailable("request timed out", "timeout") : new LlmUnavailable(`network error: ${(e as Error).message}`, "http_error");
      }
      if (attempt < this.o.maxRetries) await this.o.sleep(200 * 2 ** attempt);
    }
    this.failures++;
    if (this.failures >= this.o.failureThreshold) this.openedAt = this.o.now();
    throw lastErr instanceof Error ? lastErr : new LlmUnavailable("unknown failure", "http_error");
  }
}

/** Pull the first balanced JSON object out of a model reply (models sometimes wrap JSON in prose or fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new LlmUnavailable("model reply contains no JSON object", "bad_output");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { throw new LlmUnavailable("model reply JSON is malformed", "bad_output"); }
    }
  }
  throw new LlmUnavailable("model reply JSON is truncated", "bad_output");
}
