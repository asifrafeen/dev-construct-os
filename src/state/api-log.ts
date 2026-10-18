import { create } from 'zustand';

/**
 * Every Blocks call this tab made, newest first — the app's own request inspector.
 *
 * This exists for testing: when a call misbehaves, the status, latency and the trace id
 * the gateway echoed back are what you paste into Blocks OS → LMT to find the
 * server-side logs and spans for that exact request. The browser devtools show the same
 * traffic, but not grouped by service and not after a reload of the network tab.
 *
 * In memory only and capped, so it never grows without bound or outlives the tab.
 * Bodies are redacted before they get here (see `redact`) — this store is rendered
 * verbatim, and a login form posts a password.
 */

export interface ApiLogEntry {
  id: number;
  method: string;
  url: string;
  /** First path segment after the host, e.g. `iam`, `data`, `logic`. */
  service: string;
  status: number | null;
  ok: boolean;
  durationMs: number;
  startedAt: string;
  /**
   * Whatever correlation id the response exposed. Only headers listed in the gateway's
   * Access-Control-Expose-Headers are readable from JS, so this is often empty even
   * when the server did send one.
   */
  traceId: string | null;
  requestBody?: unknown;
  responseBody?: unknown;
  error?: string;
}

const MAX_ENTRIES = 300;

interface ApiLogState {
  entries: ApiLogEntry[];
  paused: boolean;
  add: (entry: Omit<ApiLogEntry, 'id'>) => void;
  clear: () => void;
  setPaused: (paused: boolean) => void;
}

let nextId = 1;

export const useApiLog = create<ApiLogState>()((set) => ({
  entries: [],
  paused: false,
  add: (entry) =>
    set((s) =>
      s.paused ? s : { entries: [{ ...entry, id: nextId++ }, ...s.entries].slice(0, MAX_ENTRIES) },
    ),
  clear: () => set({ entries: [] }),
  setPaused: (paused) => set({ paused }),
}));

export function serviceOf(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean)[0] ?? '';
  } catch {
    return '';
  }
}

/** Response headers a Blocks gateway or service may use to carry the request's trace. */
const TRACE_HEADERS = [
  'traceparent',
  'x-trace-id',
  'trace-id',
  'x-correlation-id',
  'x-request-id',
  'request-id',
];

export function traceIdOf(headers: Headers): string | null {
  for (const name of TRACE_HEADERS) {
    const value = headers.get(name);
    if (!value) continue;
    // W3C traceparent is `00-<trace-id>-<span-id>-<flags>`; LMT searches by the trace id.
    if (name === 'traceparent') return value.split('-')[1] ?? value;
    return value;
  }
  return null;
}

/**
 * Anchored on purpose: a loose /code/ would also mask `languageCode` and `shortCode`,
 * which are exactly the fields you want to read when testing.
 */
const SECRET_KEYS =
  /(password|secret|token)$|^(code|verificationcode|captchacode|captcharesponse|otp|authorization)$/i;
const MAX_BODY_CHARS = 20_000;

/** Masks credential-shaped fields at any depth, and truncates anything huge. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_BODY_CHARS ? `${value.slice(0, MAX_BODY_CHARS)}… (truncated)` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  if (value instanceof URLSearchParams) {
    const out: Record<string, string> = {};
    value.forEach((v, k) => (out[k] = SECRET_KEYS.test(k) ? '***' : v));
    return out;
  }
  if (value instanceof FormData) return '[multipart form data]';
  if (value instanceof Blob) return `[binary ${value.size} bytes]`;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) && typeof v !== 'object' ? '***' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}
