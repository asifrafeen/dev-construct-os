import { BlocksError, blocksFetch } from '@/lib/blocks-client';
import { BLOCKS } from '@/lib/env';

/**
 * Blocks Utilities — magic links, sequences, geolocation, PDF generation, async document
 * jobs, SMS, payments and subscriptions. Gateway base `/utilities/v4` (the service's own
 * `/api` prefix never appears).
 *
 * Three envelopes coexist here, by controller generation:
 *   legacy   `{ isSuccess, errors, …fields }`        MagicLink, Sequence, PdfGenerator
 *   SMS      `{ isSuccess, messageId, errors }`
 *   modern   `{ success, data, error, meta }`        Payments, Subscriptions, Geolocation, jobs
 *
 * Several legacy controllers take `projectKey` from the body and trust it (falling back to
 * the platform's root tenant when absent), so it is ALWAYS sent here.
 */

export const UTIL_BASE = `${BLOCKS.apiUrl}/utilities/v4`;
const PK = BLOCKS.projectKey;

export interface Modern<T> {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string; fields?: unknown; traceId?: string } | null;
  meta?: { correlationId?: string; timestampUtc?: string; replayed?: boolean };
}

const qs = (p: Record<string, string | number | boolean | undefined | null | string[]>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else q.set(k, String(v));
  }
  return q.toString();
};

/** MagicLink type: 0 Action (server performs a request), 1 Redirect. */
export const MAGIC_LINK_TYPE = { Action: 0, Redirect: 1 } as const;

export interface MagicLinkInput {
  type: number;
  name?: string;
  uri: string;
  uriOnForbidden?: string;
  requestMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  requestPayload?: string;
  requestHeaders?: string;
  redirectUrl?: string;
  /** 0 = unlimited. */
  usageLimit: number;
  /** Milliseconds; 0 = never expires. */
  expiryLifeSpan: number;
  userCanLogin: boolean;
  persistent: boolean;
}

export interface MagicLink {
  itemId: string;
  type?: number | string;
  name?: string;
  uri?: string;
  shortUri?: string;
  usageLimit?: number;
  usageCount?: number;
  expiryDate?: string;
  isExpired?: boolean;
  status?: string;
  createdAt?: string;
  [k: string]: unknown;
}

export const magicLinks = {
  create: (input: MagicLinkInput) =>
    blocksFetch<{ isSuccess?: boolean; linkId?: string; shortUri?: string; errorMessage?: string; errors?: unknown }>(
      `${UTIL_BASE}/MagicLink/CreateLink`,
      { method: 'POST', body: { ...input, projectKey: PK } },
    ),
  list: (p: { pageNumber?: number; pageSize?: number; searchText?: string } = {}) =>
    blocksFetch<{ data?: MagicLink[]; totalCount?: number }>(
      `${UTIL_BASE}/MagicLink/GetLinks?${qs({ PageNumber: p.pageNumber ?? 0, PageSize: p.pageSize ?? 20, ProjectKey: PK, SearchText: p.searchText })}`,
    ),
  get: (itemId: string) => blocksFetch<{ data?: MagicLink }>(`${UTIL_BASE}/MagicLink/GetLink?${qs({ ItemId: itemId, ProjectKey: PK })}`),
  remove: (linkIds: string[]) =>
    blocksFetch<{ removedCount?: number }>(`${UTIL_BASE}/MagicLink/RemoveLinks`, { method: 'POST', body: { linkIds, projectKey: PK } }),
  /** The anonymous invoke URL a link's shortUri resolves to, via the gateway. */
  invokeUrl: (linkId: string) => `${UTIL_BASE}/MagicLink/Invoke/${encodeURIComponent(linkId)}?${qs({ projectKey: PK })}`,
};

export const sequences = {
  next: (context: string, hex = false) =>
    blocksFetch<{ context?: string; currentNumber?: number | string }>(
      `${UTIL_BASE}/Sequence/${hex ? 'NextHex' : 'Next'}?${qs({ Context: context, ProjectKey: PK })}`,
    ),
  reset: (context: string, value: number) =>
    blocksFetch<{ isSuccess?: boolean }>(`${UTIL_BASE}/Sequence/Reset`, { method: 'POST', body: { context, value, projectKey: PK } }),
};

export interface IpLookup {
  startIp?: string;
  countryCode?: string;
  countryName?: string;
  city?: string;
  region?: string;
  continentName?: string;
  latitude?: number;
  longitude?: number;
  ispName?: string;
  countryFlagSvgUrl?: string;
  [k: string]: unknown;
}

export const geolocation = {
  /** At most 10 IPs; unlocatable ones are left out, and 404 means none were found. */
  locate: (ips: string[]) => blocksFetch<Modern<IpLookup[]>>(`${UTIL_BASE}/Geolocation/LocateIp?${qs({ IpAddresses: ips.slice(0, 10) })}`),
};

export const pdf = {
  /** The one synchronous generator — returns the stored file id. ≤ 2 MB of HTML. */
  fromHtml: (input: {
    htmlContent: string;
    outputFileName: string;
    headerHtml?: string;
    footerHtml?: string;
    isPageNumberEnabled?: boolean;
    isTotalPageCountEnabled?: boolean;
    accessModifier?: 'Public';
  }) =>
    blocksFetch<{ fileId?: string; message?: string; isSuccess?: boolean; errors?: unknown }>(`${UTIL_BASE}/PdfGenerator/CreateSinglePdfFromHtml`, {
      method: 'POST',
      body: { isPageNumberEnabled: false, isTotalPageCountEnabled: false, ...input, projectKey: PK },
    }),
};

/** Async, queue-backed jobs over files already in Storage. Status: 0 Queued, 1 Processing, 2 Done, 3 Failed. */
export type DocJob = 'document-conversions' | 'pdf-ingestions' | 'pdf-signature-validations';
export const JOB_STATUS = ['Queued', 'Processing', 'Completed', 'Failed'];

export const docJobs = {
  start: (job: DocJob, fileIds: string[], extra: Record<string, unknown> = {}) =>
    blocksFetch<Modern<Record<string, unknown>>>(`${UTIL_BASE}/${job}`, { method: 'POST', body: { fileIds, ...extra } }),
  status: (job: DocJob, fileIds: string[]) =>
    blocksFetch<Modern<{ results?: Record<string, unknown>[] }>>(`${UTIL_BASE}/${job}/status`, { method: 'POST', body: { fileIds } }),
};

export const sms = {
  send: (destinationNumbers: string[], messageText: string) =>
    blocksFetch<{ isSuccess?: boolean; messageId?: string; errors?: unknown }>(`${UTIL_BASE}/Sms/Send`, {
      method: 'POST',
      body: { destinationNumbers, messageText },
    }),
  sendByTemplate: (destinationNumbers: string[], templateName: string, language: string, dataContext: Record<string, string>) =>
    blocksFetch<{ isSuccess?: boolean; messageId?: string; errors?: unknown }>(`${UTIL_BASE}/Sms/SendByTemplate`, {
      method: 'POST',
      body: { destinationNumbers, templateName, language, dataContext },
    }),
  templates: () => blocksFetch<{ items?: Record<string, unknown>[]; totalCount?: number }>(`${UTIL_BASE}/Sms/GetTemplates?Page=1&PageSize=50`),
  saveTemplate: (input: { templateId?: string; name: string; language: string; body: string }) =>
    blocksFetch<unknown>(`${UTIL_BASE}/Sms/SaveTemplate`, { method: 'POST', body: input }),
  provider: () => blocksFetch<{ configuration?: Record<string, unknown> }>(`${UTIL_BASE}/Sms/GetProviderConfiguration`),
};

export interface PaymentInput {
  providerName: string;
  amount: number;
  currencyCode: string;
  orderId: string;
  description?: string;
  language?: string;
  customerName?: string;
  customerEmail?: string;
  productName?: string;
}

export interface Payment {
  paymentDetailId?: string;
  providerName?: string;
  paymentStatus?: string;
  orderId?: string;
  amount?: number;
  currencyCode?: string;
  redirectUrl?: string;
  expiresAtUtc?: string;
  [k: string]: unknown;
}

export const payments = {
  /** Hosted checkout: create, then send the browser to `data.redirectUrl`. */
  create: (input: PaymentInput, idempotencyKey?: string) =>
    blocksFetch<Modern<Payment>>(`${UTIL_BASE}/payments/create`, {
      method: 'POST',
      body: input,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    }),
  get: (paymentDetailId: string) => blocksFetch<Modern<Payment>>(`${UTIL_BASE}/payments/${encodeURIComponent(paymentDetailId)}`),
  list: (pageSize = 25) => blocksFetch<Modern<Payment[] | { items?: Payment[] }>>(`${UTIL_BASE}/payments?${qs({ pageSize })}`),
  paymentMethods: () => blocksFetch<Modern<unknown[]>>(`${UTIL_BASE}/payments/payment-methods`),
  providers: () => blocksFetch<Modern<unknown>>(`${UTIL_BASE}/payments/providers`),
};

export const subscriptions = {
  entitlements: () => blocksFetch<Modern<Record<string, unknown>>>(`${UTIL_BASE}/entitlements`),
  entitlement: (key: string) => blocksFetch<Modern<Record<string, unknown>>>(`${UTIL_BASE}/entitlements/${encodeURIComponent(key)}`),
  mine: () => blocksFetch<Modern<unknown>>(`${UTIL_BASE}/subscriptions/mine`),
  current: () => blocksFetch<Modern<unknown>>(`${UTIL_BASE}/subscriptions/current`),
  usageMine: () => blocksFetch<Modern<unknown>>(`${UTIL_BASE}/subscription-usage/mine`),
  plans: () => blocksFetch<Modern<unknown>>(`${UTIL_BASE}/subscription-plans?status=Active`),
  /** Record metered usage against the caller's subscription. */
  recordUsage: (meterKey: string, quantity: number) =>
    blocksFetch<Modern<unknown>>(`${UTIL_BASE}/subscription-usage`, {
      method: 'POST',
      body: { meterKey, quantity, idempotencyKey: crypto.randomUUID(), enforce: false, metadata: {} },
    }),
};

/** For calls whose non-2xx answer is itself the thing being tested. */
export async function settle<T>(p: Promise<T>): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    return { ok: true, status: 200, body: await p };
  } catch (e) {
    if (e instanceof BlocksError) return { ok: false, status: e.status, body: e.body };
    throw e;
  }
}
