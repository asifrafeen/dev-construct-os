import { blocksFetch } from '@/lib/blocks-client';
import { BLOCKS } from '@/lib/env';

/**
 * Blocks OS service — observability reads (LMT), the project secret store, and service
 * registration. Gateway base `/os/v4`.
 *
 * Every Blocks API call this app makes is traced by the platform under the project's
 * tenant, so the trace/log reads here show this app's own traffic — the other half of the
 * API inspector. All are `[ProtectedEndPoint]` (`blocks-os::trace::gets`,
 * `…::log::gets`, `…::secret::*`): the project must grant them to the user's role.
 *
 * There is no browser ingestion endpoint: logs/traces from your own backend go through the
 * LMT client packages after registering a service.
 */

export const OS_BASE = `${BLOCKS.apiUrl}/os/v4`;

export interface PageReq<F> {
  page?: number;
  pageSize?: number;
  sort?: { property: string; isDescending: boolean };
  search?: string;
  filter?: F;
}

export interface BlocksService {
  key?: string;
  label?: string;
  sortOrder?: number;
  apiServiceName?: string;
  workerServiceNames?: string[];
}

export interface TraceRow {
  timestamp?: string;
  traceId: string;
  operationName?: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  attributes?: Record<string, unknown>;
  serviceName?: string;
  status?: string;
}

export interface Span {
  traceId?: string;
  spanId: string;
  parentSpanId?: string;
  parentId?: string;
  kind?: string;
  operationName?: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  attributes?: Record<string, unknown>;
  status?: string;
  statusDescription?: string;
  serviceName?: string;
}

export interface LogRow {
  timestamp?: string;
  level?: string;
  message?: string;
  traceId?: string;
  spanId?: string;
  serviceName?: string;
  actionName?: string;
  exception?: string;
}

export interface Secret {
  secretId: string;
  name: string;
  description?: string;
  tags?: string[];
  type?: 'api' | 'service' | 'both' | string;
  status?: 'active' | 'locked' | 'deleted' | string;
  access?: { userIds?: string[]; roles?: string[] };
  createdDate?: string;
  createdBy?: string;
  lastRotatedDate?: string;
  rotationCount?: number;
  canReadValue?: boolean;
}

const qs = (p: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '') q.set(k, String(v));
  return q.toString();
};

export const lmt = {
  services: () => blocksFetch<BlocksService[]>(`${OS_BASE}/Trace/GetBlocksServices`),
  traces: (req: PageReq<{ startDate?: string; endDate?: string; services?: string[]; statusCodes?: number[]; statusCodeClasses?: string[] }>) =>
    blocksFetch<{ data?: TraceRow[]; totalCount?: number }>(`${OS_BASE}/Trace/GetTraces`, {
      method: 'POST',
      body: { page: 0, pageSize: 25, sort: { property: 'StartTime', isDescending: true }, ...req },
    }),
  trace: (traceId: string) => blocksFetch<Span[] | { data?: Span[] }>(`${OS_BASE}/Trace/GetTrace?${qs({ TraceId: traceId })}`),
  serviceAnalytics: (startTime: string, endTime: string, serviceName?: string) =>
    blocksFetch<unknown>(`${OS_BASE}/Trace/GetServiceAnalytics`, { method: 'POST', body: { startTime, endTime, ...(serviceName ? { serviceName } : {}) } }),
  /** A service name is required — it selects the log collection. */
  logs: (req: PageReq<{ startDate?: string; endDate?: string; level?: string; traceId?: string; spanId?: string }> & { serviceName?: string; serviceNames?: string[] }) =>
    blocksFetch<{ data?: LogRow[]; totalCount?: number }>(`${OS_BASE}/Log/GetLogs`, {
      method: 'POST',
      body: { page: 0, pageSize: 50, sort: { property: 'Timestamp', isDescending: true }, ...req },
    }),
};

export const secrets = {
  list: (p: { search?: string; status?: string; includeDeleted?: boolean; pageNumber?: number; pageSize?: number } = {}) =>
    blocksFetch<{ data?: Secret[]; totalCount?: number }>(
      `${OS_BASE}/Secrets/gets?${qs({ search: p.search, status: p.status, includeDeleted: p.includeDeleted, pageNumber: p.pageNumber ?? 1, pageSize: p.pageSize ?? 50 })}`,
    ),
  get: (secretId: string) => blocksFetch<Secret>(`${OS_BASE}/Secrets/get?${qs({ secretId })}`),
  /** The runtime read an app makes — `get-value`, audited, and refused for locked/deleted secrets. */
  value: (secretId: string) => blocksFetch<{ secretId?: string; value?: string }>(`${OS_BASE}/Secrets/value?${qs({ secretId })}`),
  set: (input: { name: string; value: string; description?: string; tags?: string[]; type?: 'api' | 'service' | 'both'; access?: { userIds?: string[]; roles?: string[] } }) =>
    blocksFetch<{ secretId?: string }>(`${OS_BASE}/Secrets/set`, { method: 'POST', body: { type: 'api', ...input } }),
  rotate: (secretId: string, value: string) => blocksFetch<unknown>(`${OS_BASE}/Secrets/rotate`, { method: 'POST', body: { secretId, value } }),
  lock: (secretId: string) => blocksFetch<unknown>(`${OS_BASE}/Secrets/lock`, { method: 'POST', body: { secretId } }),
  unlock: (secretId: string) => blocksFetch<unknown>(`${OS_BASE}/Secrets/unlock`, { method: 'POST', body: { secretId } }),
  restore: (secretId: string) => blocksFetch<unknown>(`${OS_BASE}/Secrets/restore`, { method: 'POST', body: { secretId } }),
  remove: (secretId: string) => blocksFetch<unknown>(`${OS_BASE}/Secrets/delete?${qs({ secretId })}`, { method: 'DELETE' }),
  setAccess: (secretId: string, access: { userIds?: string[]; roles?: string[] }) =>
    blocksFetch<unknown>(`${OS_BASE}/Secrets/access`, { method: 'POST', body: { secretId, access } }),
  audit: (secretId?: string) =>
    blocksFetch<{ data?: Record<string, unknown>[]; totalCount?: number }>(`${OS_BASE}/Secrets/audit?${qs({ secretId, pageNumber: 1, pageSize: 50 })}`),
};

export const osMisc = {
  /** Anonymous version probes — cheap liveness checks for the health page. */
  version: () => blocksFetch<unknown>(`${OS_BASE}/Version`, { noRetry: true }),
  releasePing: () => blocksFetch<unknown>(`${BLOCKS.apiUrl}/release/v4/auth/testping`, { noRetry: true }),
};
