import { redact, serviceOf, traceIdOf, useApiLog } from '@/state/api-log';

/**
 * `fetch`, plus an entry in the request inspector (src/state/api-log.ts).
 *
 * Separate from blocks-client so the auth store — which blocks-client itself imports —
 * can use it for the refresh call without an import cycle. It adds no headers and no
 * credentials of its own — callers decide those — so it is also safe for requests that
 * leave the Blocks API, like the pre-signed storage PUT.
 */
export async function trackedFetch(
  url: string,
  init: RequestInit & { logBody?: unknown } = {},
): Promise<Response> {
  const { logBody, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const requestBody = redact(logBody ?? parseMaybeJson(rest.body));

  let res: Response;
  try {
    res = await fetch(url, rest);
  } catch (error) {
    useApiLog.getState().add({
      method,
      url,
      service: serviceOf(url),
      status: null,
      ok: false,
      durationMs: Math.round(performance.now() - t0),
      startedAt,
      traceId: null,
      requestBody,
      // A CORS refusal and a dead network look identical from here — both are a
      // TypeError with no status.
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const durationMs = Math.round(performance.now() - t0);
  const entry = {
    method,
    url,
    service: serviceOf(url),
    status: res.status,
    ok: res.ok,
    durationMs,
    startedAt,
    traceId: traceIdOf(res.headers),
    requestBody,
  };

  // A secret's value comes back under the innocuous key `value`, which field-name
  // redaction cannot tell apart from every other `value` — so that route is masked whole.
  if (SECRET_VALUE_ROUTE.test(url)) {
    useApiLog.getState().add({ ...entry, responseBody: '[redacted: secret value]' });
    return res;
  }

  // Read a clone so the caller still gets an unread body. Opaque/no-cors responses and
  // binary downloads simply log without one.
  res
    .clone()
    .text()
    .then((text) => useApiLog.getState().add({ ...entry, responseBody: redact(parseMaybeJson(text)) }))
    .catch(() => useApiLog.getState().add(entry));

  return res;
}

const SECRET_VALUE_ROUTE = /\/Secrets\/values?(\?|$)|\/RepoSecret\/value/i;

function parseMaybeJson(body: unknown): unknown {
  if (typeof body !== 'string') return body ?? undefined;
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
