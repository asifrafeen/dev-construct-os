import { BLOCKS } from '@/lib/env';
import { useAuthStore } from '@/state/auth-store';

/**
 * The one fetch wrapper every Blocks call goes through.
 *
 * Two platform rules are encoded here and nowhere else:
 *   1. `x-blocks-key: <project key>` rides on every request.
 *   2. Runtime auth is the hosted SSO cookie — `credentials: "include"`, no Bearer token.
 *
 * On a 401 it renews the session once and replays the request; a second 401 is a real
 * "logged out" and is surfaced to the caller.
 */

export class BlocksError extends Error {
  constructor(
    public status: number,
    public url: string,
    public body: unknown,
  ) {
    super(`Blocks ${status} — ${url}`);
    this.name = 'BlocksError';
  }
}

/** A 401 that survived a session refresh: the user is genuinely signed out. */
export class UnauthorizedError extends BlocksError {
  constructor(url: string, body: unknown) {
    super(401, url, body);
    this.name = 'UnauthorizedError';
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface BlocksRequest extends Omit<RequestInit, 'body'> {
  /** Plain objects are JSON-encoded; URLSearchParams / FormData / string pass through. */
  body?: unknown;
  /** Skip the refresh-and-retry dance (used by the auth probes themselves). */
  noRetry?: boolean;
}

export async function blocksFetch<T>(url: string, init: BlocksRequest = {}): Promise<T> {
  const { body, noRetry, headers, ...rest } = init;

  const isRaw =
    body === undefined ||
    typeof body === 'string' ||
    body instanceof URLSearchParams ||
    body instanceof FormData ||
    body instanceof Blob;

  // JSON-encoded bodies get the header for free; raw bodies (form-encoded, multipart)
  // carry their own Content-Type, so the caller decides.
  const finalHeaders: Record<string, string> = { 'x-blocks-key': BLOCKS.projectKey };
  if (body !== undefined && !isRaw) finalHeaders['Content-Type'] = 'application/json';
  Object.assign(finalHeaders, headers as Record<string, string> | undefined);

  const send = (): Promise<Response> =>
    fetch(url, {
      ...rest,
      credentials: 'include', // the SSO session cookie set by /idp/callback
      headers: finalHeaders,
      body: body === undefined ? undefined : isRaw ? (body as BodyInit) : JSON.stringify(body),
    });

  let res = await send();

  if (res.status === 401 && !noRetry) {
    try {
      await useAuthStore.getState().refreshSession();
      res = await send();
    } catch {
      throw new UnauthorizedError(url, await readBody(res));
    }
  }

  if (res.status === 401) throw new UnauthorizedError(url, await readBody(res));
  if (!res.ok) throw new BlocksError(res.status, url, await readBody(res));

  return (await readBody(res)) as T;
}
