import { vi } from 'vitest';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** The body as sent: JSON bodies parsed back, anything else untouched. */
  body: unknown;
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/**
 * Replaces global fetch with one that records every request and answers from `reply`
 * (one reply for all calls, or one per call in order — the last one repeats).
 */
export function mockFetch(reply: Reply | Reply[] = {}) {
  const replies = Array.isArray(reply) ? reply : [reply];
  const requests: RecordedRequest[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = init.body;
    let body: unknown = raw;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    requests.push({
      url: String(input),
      method: (init.method ?? 'GET').toUpperCase(),
      headers: { ...(init.headers as Record<string, string> | undefined) },
      body,
    });

    const { status = 200, body: payload = {}, headers } = replies[Math.min(requests.length - 1, replies.length - 1)];
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return new Response(status === 204 ? null : text, { status, headers });
  });

  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    requests,
    /** The single most recent request. */
    last: () => requests.at(-1)!,
  };
}
