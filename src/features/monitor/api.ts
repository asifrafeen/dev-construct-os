import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { blocksFetch } from '@/lib/blocks-client';
import { BLOCKS } from '@/lib/env';

/**
 * Blocks Monitor — uptime checks for this deployment.
 *
 * Two kinds of monitor:
 *   - Request (OutboundPing): Monitor calls a URL on a schedule. Point it at this app's
 *     `/healthz` (served by nginx) or `/version.json`.
 *   - Heartbeat (InboundPing): Monitor waits to be called. The app pings
 *     `Health/Ping/{itemId}`; silence longer than interval + grace opens an incident, the
 *     next ping resolves it. The ping is anonymous — only the tenant key is needed.
 *
 * Management calls are `[ProtectedEndPoint]` (`blocks-monitor::health|monitor::*`), so a
 * project user needs those granted. Ids are compared against the caller's tenant, which
 * is why `projectKey` must be this project's key.
 *
 * The gateway segment is assumed to be `/monitor/v4` like the other services; override
 * with VITE_BLOCKS_MONITOR_PATH if the deployment routes it elsewhere.
 */

export const MONITOR_BASE = `${BLOCKS.apiUrl}${import.meta.env.VITE_BLOCKS_MONITOR_PATH || '/monitor/v4'}`;
const PK = BLOCKS.projectKey;

export const MONITOR_KIND = ['Request', 'Heartbeat'];
export const MONITOR_SOURCE = ['Infrastructure', 'DeployedServices', 'BlocksServices', 'ExternalServices', 'OtherServices'];

export interface MonitorConfig {
  itemId: string;
  name?: string;
  url?: string;
  /** 0 Request (OutboundPing), 1 Heartbeat (InboundPing). */
  monitorConfigurationType?: number;
  monitorSourceType?: number;
  intervalInSeconds?: number;
  timeoutInSeconds?: number;
  gracePeriodInSeconds?: number;
  isActive?: boolean;
  /** true = up. */
  currentStatus?: boolean;
  lastCheckedAt?: string;
  lastIncidentAt?: string;
  emails?: string[];
  incidentSummaries?: { startTime?: string; endTime?: string; downtimeDurationSeconds?: number }[];
  [k: string]: unknown;
}

interface ApiResponse<T> {
  isSuccess?: boolean;
  errors?: unknown;
  data?: T;
  message?: string;
  statusCode?: number;
  totalCount?: number;
}

const qs = (p: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '') q.set(k, String(v));
  return q.toString();
};

export const monitor = {
  /** Anonymous; the tenant rides in the query so no preflight is strictly needed. */
  ping: (itemId: string) =>
    blocksFetch<{ message?: string }>(`${MONITOR_BASE}/Health/Ping/${encodeURIComponent(itemId)}?${qs({ 'x-blocks-key': PK })}`, { noRetry: true }),

  saveHeartbeat: (input: { name: string; intervalInSeconds: number; gracePeriodInSeconds: number; emails: string[]; isActive?: boolean }) =>
    blocksFetch<ApiResponse<MonitorConfig>>(`${MONITOR_BASE}/Health/SaveHealth`, {
      method: 'POST',
      body: { projectKey: PK, isActive: true, monitorSourceType: 'OtherServices', ...input },
    }),
  updateHeartbeat: (input: { itemId: string; name?: string; intervalInSeconds?: number; gracePeriodInSeconds?: number; isActive?: boolean; emails?: string[] }) =>
    blocksFetch<ApiResponse<MonitorConfig>>(`${MONITOR_BASE}/Health/UpdateHealth`, { method: 'POST', body: input }),
  deleteHeartbeat: (itemId: string) =>
    blocksFetch<ApiResponse<unknown>>(`${MONITOR_BASE}/Health/DeleteHealth?${qs({ itemId })}`, { method: 'DELETE' }),

  list: (p: { pageNumber?: number; pageSize?: number } = {}) =>
    blocksFetch<ApiResponse<MonitorConfig[]>>(
      `${MONITOR_BASE}/Monitor/GetMonitorList?${qs({ projectKey: PK, pageNumber: p.pageNumber ?? 0, pageSize: p.pageSize ?? 50 })}`,
    ),
  get: (monitorId: string) => blocksFetch<ApiResponse<MonitorConfig>>(`${MONITOR_BASE}/Monitor/GetMonitorById?${qs({ monitorId })}`),

  /** A request monitor. Enums go as names; `customHttpHeaders` is a JSON *string*. */
  saveRequestMonitor: (input: {
    name: string;
    url: string;
    httpMethodType?: 'HEAD' | 'GET' | 'POST';
    intervalInSeconds?: number;
    timeoutInSeconds?: number;
    expectedContent?: string;
    successHttpResponseCodes?: string[];
    emails?: string[];
  }) =>
    blocksFetch<ApiResponse<MonitorConfig>>(`${MONITOR_BASE}/Monitor/SaveMonitor`, {
      method: 'POST',
      body: {
        projectKey: PK,
        monitorType: 'HTTP',
        protocolType: input.url.startsWith('https') ? 'HTTPS' : 'HTTP',
        authorizationType: 'NONE',
        monitorSourceType: 'DeployedServices',
        isActive: true,
        customHttpHeaders: '{}',
        regions: [],
        ...input,
      },
    }),
  deleteMonitor: (itemId: string) =>
    blocksFetch<ApiResponse<unknown>>(`${MONITOR_BASE}/Monitor/DeleteMonitor?${qs({ itemId })}`, { method: 'DELETE' }),

  incidents: (monitorId: string, pageNumber = 0, pageSize = 20) =>
    blocksFetch<ApiResponse<Record<string, unknown>[]>>(`${MONITOR_BASE}/Monitor/GetIncidentList?${qs({ monitorId, pageNumber, pageSize })}`),
  details: (monitorId: string) => blocksFetch<Record<string, unknown>>(`${MONITOR_BASE}/Monitor/GetMonitorDetails?${qs({ monitorId })}`),
  responseTime: (monitorId: string, startDate?: string, endDate?: string) =>
    blocksFetch<ApiResponse<{ timestamp?: string; responseTimeMs?: number; statusCode?: number }[]>>(
      `${MONITOR_BASE}/Monitor/GetMonitorResponseTime?${qs({ monitorId, startDate, endDate })}`,
    ),
  downtime: (monitorId: string, startDate?: string, endDate?: string) =>
    blocksFetch<unknown>(`${MONITOR_BASE}/Monitor/GetMonitorDownTime?${qs({ monitorId, startDate, endDate })}`),
};

interface HeartbeatState {
  /** Which heartbeat monitor this browser pings; seeded from VITE_BLOCKS_HEARTBEAT_ID. */
  monitorId: string;
  intervalSeconds: number;
  enabled: boolean;
  lastPingAt: string | null;
  lastResult: string | null;
  lastOk: boolean | null;
  configure: (p: Partial<Pick<HeartbeatState, 'monitorId' | 'intervalSeconds' | 'enabled'>>) => void;
  record: (ok: boolean, result: string) => void;
}

const envInterval = Number(import.meta.env.VITE_BLOCKS_HEARTBEAT_INTERVAL || 0);

export const useHeartbeat = create<HeartbeatState>()(
  persist(
    (set) => ({
      monitorId: import.meta.env.VITE_BLOCKS_HEARTBEAT_ID || '',
      intervalSeconds: envInterval > 0 ? envInterval : 60,
      enabled: !!import.meta.env.VITE_BLOCKS_HEARTBEAT_ID && envInterval > 0,
      lastPingAt: null,
      lastResult: null,
      lastOk: null,
      configure: (p) => set(p),
      record: (ok, result) => set({ lastOk: ok, lastResult: result, lastPingAt: new Date().toISOString() }),
    }),
    { name: 'blocks.heartbeat', partialize: (s) => ({ monitorId: s.monitorId, intervalSeconds: s.intervalSeconds, enabled: s.enabled }) },
  ),
);

export async function sendHeartbeat(): Promise<void> {
  const { monitorId, record } = useHeartbeat.getState();
  if (!monitorId) return;
  try {
    const res = await monitor.ping(monitorId);
    record(true, res?.message ?? 'ok');
  } catch (e) {
    record(false, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Pings the configured heartbeat monitor on an interval for as long as the signed-in area
 * is open. A browser tab is a poor heartbeat source in production (it sleeps, closes) —
 * this is for exercising the Monitor incident/resolve cycle on demand.
 */
export function useHeartbeatLoop() {
  const { monitorId, intervalSeconds, enabled } = useHeartbeat();
  useEffect(() => {
    if (!enabled || !monitorId || intervalSeconds < 5) return;
    void sendHeartbeat();
    const t = setInterval(() => void sendHeartbeat(), intervalSeconds * 1000);
    return () => clearInterval(t);
  }, [enabled, monitorId, intervalSeconds]);
}
