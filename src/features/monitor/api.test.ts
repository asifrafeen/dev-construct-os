import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@/lib/blocks-client';
import { mockFetch } from '@/test/mock-fetch';
import { MONITOR_BASE, monitor } from './api';

const API = 'https://blocksapi.example.com';
const MON = `${API}/monitor/v4`;
const PK = 'test-project-key';

/** An in-memory stand-in for window.localStorage, which zustand persists to. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
}

/** A fresh copy of the module, so the heartbeat store is re-seeded from the env each time. */
async function freshModule(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const storage = memoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  const mod = await import('./api');
  return { ...mod, storage };
}

describe('MONITOR_BASE', () => {
  it('defaults to the monitor/v4 gateway segment', () => {
    expect(MONITOR_BASE).toBe(MON);
  });

  it('can be routed elsewhere with VITE_BLOCKS_MONITOR_PATH', async () => {
    const fresh = await freshModule({ VITE_BLOCKS_MONITOR_PATH: '/health-monitor/v1' });
    expect(fresh.MONITOR_BASE).toBe(`${API}/health-monitor/v1`);
  });
});

describe('monitor', () => {
  it('pings a heartbeat with the tenant key in the query, without renewing on a 401', async () => {
    const http = mockFetch({ body: { message: 'pong' } });
    await expect(monitor.ping('hb 1')).resolves.toEqual({ message: 'pong' });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${MON}/Health/Ping/hb%201?x-blocks-key=${PK}` });
    expect(http.last().headers['x-blocks-key']).toBe(PK);

    const denied = mockFetch({ status: 401 });
    await expect(monitor.ping('hb 1')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(denied.requests).toHaveLength(1);
  });

  it('saves an active heartbeat under OtherServices for this project', async () => {
    const http = mockFetch({ body: { isSuccess: true, data: { itemId: 'hb-1' } } });
    const input = { name: 'Browser', intervalInSeconds: 60, gracePeriodInSeconds: 30, emails: ['ops@example.com'] };
    await expect(monitor.saveHeartbeat(input)).resolves.toEqual({ isSuccess: true, data: { itemId: 'hb-1' } });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${MON}/Health/SaveHealth` });
    expect(http.last().body).toEqual({ projectKey: PK, isActive: true, monitorSourceType: 'OtherServices', ...input });

    await monitor.saveHeartbeat({ ...input, isActive: false });
    expect(http.last().body).toMatchObject({ isActive: false });
  });

  it('updates a heartbeat with exactly the input given', async () => {
    const http = mockFetch();
    await monitor.updateHeartbeat({ itemId: 'hb-1', isActive: false });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${MON}/Health/UpdateHealth` });
    expect(http.last().body).toEqual({ itemId: 'hb-1', isActive: false });
  });

  it('deletes heartbeats and monitors with the id in the query', async () => {
    const http = mockFetch();
    await monitor.deleteHeartbeat('hb-1');
    expect(http.last()).toMatchObject({ method: 'DELETE', url: `${MON}/Health/DeleteHealth?itemId=hb-1`, body: undefined });

    await monitor.deleteMonitor('m-1');
    expect(http.last()).toMatchObject({ method: 'DELETE', url: `${MON}/Monitor/DeleteMonitor?itemId=m-1`, body: undefined });
  });

  it('lists the project monitors from page 0 by 50', async () => {
    const http = mockFetch({ body: { data: [{ itemId: 'm1' }], totalCount: 1 } });
    await expect(monitor.list()).resolves.toEqual({ data: [{ itemId: 'm1' }], totalCount: 1 });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${MON}/Monitor/GetMonitorList?projectKey=${PK}&pageNumber=0&pageSize=50` });

    await monitor.list({ pageNumber: 2, pageSize: 10 });
    expect(http.last().url).toBe(`${MON}/Monitor/GetMonitorList?projectKey=${PK}&pageNumber=2&pageSize=10`);
  });

  it.each([
    ['get', () => monitor.get('m1'), `${MON}/Monitor/GetMonitorById?monitorId=m1`],
    ['details', () => monitor.details('m1'), `${MON}/Monitor/GetMonitorDetails?monitorId=m1`],
    ['incidents', () => monitor.incidents('m1'), `${MON}/Monitor/GetIncidentList?monitorId=m1&pageNumber=0&pageSize=20`],
    ['incidents paged', () => monitor.incidents('m1', 3, 5), `${MON}/Monitor/GetIncidentList?monitorId=m1&pageNumber=3&pageSize=5`],
    ['responseTime', () => monitor.responseTime('m1'), `${MON}/Monitor/GetMonitorResponseTime?monitorId=m1`],
    [
      'responseTime in a window',
      () => monitor.responseTime('m1', '2026-01-01', '2026-01-31'),
      `${MON}/Monitor/GetMonitorResponseTime?monitorId=m1&startDate=2026-01-01&endDate=2026-01-31`,
    ],
    ['downtime', () => monitor.downtime('m1'), `${MON}/Monitor/GetMonitorDownTime?monitorId=m1`],
    [
      'downtime in a window',
      () => monitor.downtime('m1', '2026-01-01', '2026-01-31'),
      `${MON}/Monitor/GetMonitorDownTime?monitorId=m1&startDate=2026-01-01&endDate=2026-01-31`,
    ],
  ])('%s is a GET on its route', async (_name, call, url) => {
    const http = mockFetch({ body: { isSuccess: true } });
    await expect(call()).resolves.toEqual({ isSuccess: true });
    expect(http.last()).toMatchObject({ method: 'GET', url, body: undefined });
  });

  it('saves an HTTPS request monitor with the platform defaults', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await monitor.saveRequestMonitor({ name: 'App', url: 'https://app.example.com/healthz' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${MON}/Monitor/SaveMonitor` });
    expect(http.last().body).toEqual({
      projectKey: PK,
      monitorType: 'HTTP',
      protocolType: 'HTTPS',
      authorizationType: 'NONE',
      monitorSourceType: 'DeployedServices',
      isActive: true,
      customHttpHeaders: '{}',
      regions: [],
      name: 'App',
      url: 'https://app.example.com/healthz',
    });
  });

  it('picks the HTTP protocol for a plain http URL and keeps the caller options', async () => {
    const http = mockFetch();
    await monitor.saveRequestMonitor({
      name: 'Legacy',
      url: 'http://legacy.example.com/',
      httpMethodType: 'GET',
      intervalInSeconds: 300,
      successHttpResponseCodes: ['200', '204'],
    });
    expect(http.last().body).toMatchObject({
      protocolType: 'HTTP',
      httpMethodType: 'GET',
      intervalInSeconds: 300,
      successHttpResponseCodes: ['200', '204'],
    });
  });
});

describe('useHeartbeat', () => {
  it('is off with a 60 second interval when the env sets nothing', async () => {
    const { useHeartbeat } = await freshModule();
    expect(useHeartbeat.getState()).toMatchObject({
      monitorId: '',
      intervalSeconds: 60,
      enabled: false,
      lastPingAt: null,
      lastResult: null,
      lastOk: null,
    });
  });

  it('is seeded and switched on by the env', async () => {
    const { useHeartbeat } = await freshModule({ VITE_BLOCKS_HEARTBEAT_ID: 'hb-1', VITE_BLOCKS_HEARTBEAT_INTERVAL: '30' });
    expect(useHeartbeat.getState()).toMatchObject({ monitorId: 'hb-1', intervalSeconds: 30, enabled: true });
  });

  it('stays off without a positive interval, even with a monitor id', async () => {
    const { useHeartbeat } = await freshModule({ VITE_BLOCKS_HEARTBEAT_ID: 'hb-1', VITE_BLOCKS_HEARTBEAT_INTERVAL: '0' });
    expect(useHeartbeat.getState()).toMatchObject({ monitorId: 'hb-1', intervalSeconds: 60, enabled: false });
  });

  it('records a ping result with the time it happened', async () => {
    const { useHeartbeat } = await freshModule();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    try {
      useHeartbeat.getState().record(false, 'timeout');
    } finally {
      vi.useRealTimers();
    }
    expect(useHeartbeat.getState()).toMatchObject({ lastOk: false, lastResult: 'timeout', lastPingAt: '2026-06-15T12:00:00.000Z' });
  });

  it('persists only the configuration, not the last result', async () => {
    const { useHeartbeat, storage } = await freshModule();
    useHeartbeat.getState().configure({ monitorId: 'hb-2', intervalSeconds: 15, enabled: true });
    useHeartbeat.getState().record(true, 'ok');

    expect(useHeartbeat.getState()).toMatchObject({ monitorId: 'hb-2', intervalSeconds: 15, enabled: true });
    const saved: unknown = JSON.parse(storage.items.get('blocks.heartbeat') ?? 'null');
    expect(saved).toMatchObject({ state: { monitorId: 'hb-2', intervalSeconds: 15, enabled: true } });
    expect((saved as { state: Record<string, unknown> }).state).not.toHaveProperty('lastResult');
  });
});

describe('sendHeartbeat', () => {
  it('does nothing without a monitor id', async () => {
    const { sendHeartbeat, useHeartbeat } = await freshModule();
    const http = mockFetch();
    await sendHeartbeat();
    expect(http.requests).toHaveLength(0);
    expect(useHeartbeat.getState().lastPingAt).toBeNull();
  });

  it('pings the configured monitor and records the server message', async () => {
    const { sendHeartbeat, useHeartbeat } = await freshModule({ VITE_BLOCKS_HEARTBEAT_ID: 'hb-1' });
    const http = mockFetch({ body: { message: 'Pinged' } });
    await sendHeartbeat();
    expect(http.last().url).toBe(`${MON}/Health/Ping/hb-1?x-blocks-key=${PK}`);
    expect(useHeartbeat.getState()).toMatchObject({ lastOk: true, lastResult: 'Pinged' });
    expect(useHeartbeat.getState().lastPingAt).toEqual(expect.any(String));
  });

  it('records ok when the reply has no message', async () => {
    const { sendHeartbeat, useHeartbeat } = await freshModule({ VITE_BLOCKS_HEARTBEAT_ID: 'hb-1' });
    mockFetch({ status: 204 });
    await sendHeartbeat();
    expect(useHeartbeat.getState()).toMatchObject({ lastOk: true, lastResult: 'ok' });
  });

  it('records a failure instead of throwing', async () => {
    const { sendHeartbeat, useHeartbeat } = await freshModule({ VITE_BLOCKS_HEARTBEAT_ID: 'hb-1' });
    mockFetch({ status: 503 });
    await expect(sendHeartbeat()).resolves.toBeUndefined();
    expect(useHeartbeat.getState()).toMatchObject({
      lastOk: false,
      lastResult: `Blocks 503 — ${MON}/Health/Ping/hb-1?x-blocks-key=${PK}`,
    });
  });

  it('records a non-Error rejection as text', async () => {
    const { sendHeartbeat, useHeartbeat } = await freshModule({ VITE_BLOCKS_HEARTBEAT_ID: 'hb-1' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('offline'));
    await sendHeartbeat();
    expect(useHeartbeat.getState()).toMatchObject({ lastOk: false, lastResult: 'offline' });
  });
});
