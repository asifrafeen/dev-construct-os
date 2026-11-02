import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '@/lib/blocks-client';
import { mockFetch } from '@/test/mock-fetch';
import { OS_BASE, lmt, osMisc, secrets } from './api';

const OS = 'https://blocksapi.example.com/os/v4';

describe('OS_BASE', () => {
  it('is the os service under the API URL', () => {
    expect(OS_BASE).toBe(OS);
  });
});

describe('lmt', () => {
  it('reads the Blocks service catalogue', async () => {
    const http = mockFetch({ body: [{ key: 'iam', label: 'IAM' }] });
    await expect(lmt.services()).resolves.toEqual([{ key: 'iam', label: 'IAM' }]);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${OS}/Trace/GetBlocksServices`, body: undefined });
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');
  });

  it('pages traces 25 at a time, newest first', async () => {
    const http = mockFetch({ body: { data: [{ traceId: 't1' }], totalCount: 1 } });
    await expect(lmt.traces({})).resolves.toEqual({ data: [{ traceId: 't1' }], totalCount: 1 });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${OS}/Trace/GetTraces` });
    expect(http.last().body).toEqual({ page: 0, pageSize: 25, sort: { property: 'StartTime', isDescending: true } });
  });

  it('lets the caller page, sort and filter traces', async () => {
    const http = mockFetch();
    const filter = { startDate: '2026-01-01', services: ['iam'], statusCodeClasses: ['5xx'] };
    await lmt.traces({ page: 2, pageSize: 10, sort: { property: 'Duration', isDescending: false }, search: 'login', filter });
    expect(http.last().body).toEqual({
      page: 2,
      pageSize: 10,
      sort: { property: 'Duration', isDescending: false },
      search: 'login',
      filter,
    });
  });

  it('reads one trace by id', async () => {
    const http = mockFetch({ body: [{ spanId: 's1' }] });
    await expect(lmt.trace('abc 123')).resolves.toEqual([{ spanId: 's1' }]);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${OS}/Trace/GetTrace?TraceId=abc+123` });
  });

  it('reads service analytics, optionally for one service', async () => {
    const http = mockFetch();
    await lmt.serviceAnalytics('2026-01-01', '2026-01-02');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${OS}/Trace/GetServiceAnalytics` });
    expect(http.last().body).toEqual({ startTime: '2026-01-01', endTime: '2026-01-02' });

    await lmt.serviceAnalytics('2026-01-01', '2026-01-02', 'iam');
    expect(http.last().body).toEqual({ startTime: '2026-01-01', endTime: '2026-01-02', serviceName: 'iam' });
  });

  it('pages logs 50 at a time, newest first, for a service', async () => {
    const http = mockFetch({ body: { data: [{ message: 'hi' }] } });
    await lmt.logs({ serviceName: 'iam' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${OS}/Log/GetLogs` });
    expect(http.last().body).toEqual({ page: 0, pageSize: 50, sort: { property: 'Timestamp', isDescending: true }, serviceName: 'iam' });

    await lmt.logs({ serviceNames: ['iam', 'data'], filter: { level: 'Error', traceId: 't1' }, page: 1 });
    expect(http.last().body).toEqual({
      page: 1,
      pageSize: 50,
      sort: { property: 'Timestamp', isDescending: true },
      serviceNames: ['iam', 'data'],
      filter: { level: 'Error', traceId: 't1' },
    });
  });
});

describe('secrets', () => {
  it('lists from page 1 by 50, dropping unset filters', async () => {
    const http = mockFetch({ body: { data: [{ secretId: 's1', name: 'API_KEY' }], totalCount: 1 } });
    await expect(secrets.list()).resolves.toEqual({ data: [{ secretId: 's1', name: 'API_KEY' }], totalCount: 1 });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${OS}/Secrets/gets?pageNumber=1&pageSize=50` });

    await secrets.list({ search: '' });
    expect(http.last().url).toBe(`${OS}/Secrets/gets?pageNumber=1&pageSize=50`);
  });

  it('sends every list filter, false included', async () => {
    const http = mockFetch();
    await secrets.list({ search: 'api', status: 'Active', includeDeleted: false, pageNumber: 2, pageSize: 10 });
    expect(http.last().url).toBe(`${OS}/Secrets/gets?search=api&status=Active&includeDeleted=false&pageNumber=2&pageSize=10`);
  });

  it('reads the metadata and the value of one secret', async () => {
    const http = mockFetch([{ body: { secretId: 's1', name: 'API_KEY' } }, { body: { secretId: 's1', value: 'hunter2' } }]);
    await expect(secrets.get('s1')).resolves.toEqual({ secretId: 's1', name: 'API_KEY' });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${OS}/Secrets/get?secretId=s1` });

    await expect(secrets.value('s1')).resolves.toEqual({ secretId: 's1', value: 'hunter2' });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${OS}/Secrets/value?secretId=s1` });
  });

  it('sets an api secret unless another type is given', async () => {
    const http = mockFetch({ body: { secretId: 's1' } });
    await expect(secrets.set({ name: 'API_KEY', value: 'x' })).resolves.toEqual({ secretId: 's1' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${OS}/Secrets/set` });
    expect(http.last().body).toEqual({ type: 'api', name: 'API_KEY', value: 'x' });

    await secrets.set({ name: 'SVC', value: 'y', type: 'service', tags: ['prod'], access: { roles: ['admin'] } });
    expect(http.last().body).toEqual({ type: 'service', name: 'SVC', value: 'y', tags: ['prod'], access: { roles: ['admin'] } });
  });

  it('rotates a secret to a new value', async () => {
    const http = mockFetch();
    await secrets.rotate('s1', 'new-value');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${OS}/Secrets/rotate`, body: { secretId: 's1', value: 'new-value' } });
  });

  it.each([
    ['lock', (id: string) => secrets.lock(id)],
    ['unlock', (id: string) => secrets.unlock(id)],
    ['restore', (id: string) => secrets.restore(id)],
  ])('%s posts the secret id to its route', async (action, call) => {
    const http = mockFetch();
    await call('s1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${OS}/Secrets/${action}`, body: { secretId: 's1' } });
  });

  it('deletes with the id in the query', async () => {
    const http = mockFetch();
    await secrets.remove('s1');
    expect(http.last()).toMatchObject({ method: 'DELETE', url: `${OS}/Secrets/delete?secretId=s1`, body: undefined });
  });

  it('replaces the access list', async () => {
    const http = mockFetch();
    await secrets.setAccess('s1', { userIds: ['u1'], roles: [] });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${OS}/Secrets/access`, body: { secretId: 's1', access: { userIds: ['u1'], roles: [] } } });
  });

  it('reads the audit trail for all secrets or one', async () => {
    const http = mockFetch({ body: { data: [], totalCount: 0 } });
    await secrets.audit();
    expect(http.last()).toMatchObject({ method: 'GET', url: `${OS}/Secrets/audit?pageNumber=1&pageSize=50` });

    await secrets.audit('s1');
    expect(http.last().url).toBe(`${OS}/Secrets/audit?secretId=s1&pageNumber=1&pageSize=50`);
  });
});

describe('osMisc', () => {
  it('probes the os version without renewing on a 401', async () => {
    const http = mockFetch({ body: { version: '4.1.0' } });
    await expect(osMisc.version()).resolves.toEqual({ version: '4.1.0' });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${OS}/Version` });

    const denied = mockFetch({ status: 401 });
    await expect(osMisc.version()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(denied.requests).toHaveLength(1);
  });

  it('pings the release service without renewing on a 401', async () => {
    const http = mockFetch({ body: 'pong' });
    await expect(osMisc.releasePing()).resolves.toBe('pong');
    expect(http.last()).toMatchObject({ method: 'GET', url: 'https://blocksapi.example.com/release/v4/auth/testping' });

    const denied = mockFetch({ status: 401 });
    await expect(osMisc.releasePing()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(denied.requests).toHaveLength(1);
  });
});
