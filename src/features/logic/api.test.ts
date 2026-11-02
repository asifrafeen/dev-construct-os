import { describe, expect, it, vi } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import {
  EXECUTION_STATUS,
  LOGIC_BASE,
  functions,
  isTerminal,
  isTriggerNode,
  proxies,
  scheduler,
  workflows,
  type ScheduleInput,
} from './api';

const LOGIC = 'https://blocksapi.example.com/logic/v4';
const WF = `${LOGIC}/Workflow`;
const SCHED = `${LOGIC}/Scheduler`;

describe('LOGIC_BASE', () => {
  it('is the logic service under the API URL', () => {
    expect(LOGIC_BASE).toBe(LOGIC);
  });
});

describe('isTerminal', () => {
  it.each([
    [4, true],
    [5, true],
    [0, false],
    [3, false],
    [undefined, false],
  ])('status %j → %j', (status, expected) => {
    expect(isTerminal(status)).toBe(expected);
  });

  it('agrees with the status names', () => {
    expect(EXECUTION_STATUS.filter((_, i) => isTerminal(i))).toEqual(['Completed', 'Failed']);
  });
});

describe('isTriggerNode', () => {
  it.each(['webhook', 'email', 'schedule', 'dataGateway'])('treats a %s node as a trigger', (type) => {
    expect(isTriggerNode({ id: 'n1', name: 'Start', type })).toBe(true);
  });

  it('treats any node in the trigger category as a trigger', () => {
    expect(isTriggerNode({ id: 'n1', name: 'Custom', type: 'customTrigger', category: 'trigger' })).toBe(true);
  });

  it('does not treat an action node as a trigger', () => {
    expect(isTriggerNode({ id: 'n2', name: 'Mail', type: 'sendMail', category: 'action' })).toBe(false);
  });
});

describe('workflows', () => {
  it('lists from page 0 by 20, merging the caller filters', async () => {
    const http = mockFetch({ body: { data: [{ itemId: 'w1', name: 'A' }], totalCount: 1 } });
    await expect(workflows.list()).resolves.toEqual({ data: [{ itemId: 'w1', name: 'A' }], totalCount: 1 });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${WF}/GetAll`, body: { pageNumber: 0, pageSize: 20 } });
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');

    await workflows.list({ search: 'onboard', isPublished: true, pageNumber: 2 });
    expect(http.last().body).toEqual({ pageNumber: 2, pageSize: 20, search: 'onboard', isPublished: true });
  });

  it('reads one workflow, encoding the id', async () => {
    const http = mockFetch({ body: { data: { itemId: 'w 1', name: 'A' } } });
    await expect(workflows.get('w 1')).resolves.toEqual({ data: { itemId: 'w 1', name: 'A' } });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${WF}/Get?WorkflowId=w%201` });
  });

  it('creates with empty edges and settings unless given', async () => {
    const http = mockFetch({ body: { itemId: 'w1', isSuccess: true } });
    await workflows.create({ name: 'A' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${WF}/Create` });
    expect(http.last().body).toEqual({ edges: [], settings: {}, name: 'A' });

    await workflows.create({ name: 'B', nodes: [{ id: 'n1' }], edges: [{ from: 'n1' }], settings: { retries: 1 } });
    expect(http.last().body).toEqual({ edges: [{ from: 'n1' }], settings: { retries: 1 }, name: 'B', nodes: [{ id: 'n1' }] });
  });

  it('updates with a PUT of exactly the body given', async () => {
    const http = mockFetch();
    const body = { itemId: 'w1', name: 'Renamed', nodes: [] };
    await workflows.update(body);
    expect(http.last()).toMatchObject({ method: 'PUT', url: `${WF}/Update`, body });
  });

  it('duplicates under a new name', async () => {
    const http = mockFetch({ body: { itemId: 'w2' } });
    await expect(workflows.duplicate('w1', 'Copy')).resolves.toEqual({ itemId: 'w2' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${WF}/Duplicate`, body: { workflowId: 'w1', name: 'Copy' } });
  });

  it('deletes with the id in the query', async () => {
    const http = mockFetch();
    await workflows.remove('w/1');
    expect(http.last()).toMatchObject({ method: 'DELETE', url: `${WF}/Delete?Id=w%2F1`, body: undefined });
  });

  it('lists versions', async () => {
    const http = mockFetch({ body: { data: [{ itemId: 'v1', isPublished: true }] } });
    await expect(workflows.versions('w1')).resolves.toEqual({ data: [{ itemId: 'v1', isPublished: true }] });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${WF}/GetVersions`, body: { workflowId: 'w1' } });
  });

  it('publishes a new version, the description being optional', async () => {
    const http = mockFetch();
    await workflows.publishNewVersion('w1', 'v2', 'Adds retries');
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${WF}/PublishNewVersion`,
      body: { workflowId: 'w1', name: 'v2', description: 'Adds retries' },
    });

    await workflows.publishNewVersion('w1', 'v3');
    expect(http.last().body).toEqual({ workflowId: 'w1', name: 'v3' });
  });

  it('publishes the latest version unless one is named', async () => {
    const http = mockFetch();
    await workflows.publishVersion('w1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${WF}/PublishVersion` });
    expect(http.last().body).toEqual({ workflowId: 'w1' });

    await workflows.publishVersion('w1', 'v1');
    expect(http.last().body).toEqual({ workflowId: 'w1', versionId: 'v1' });
  });

  it('unpublishes and restores', async () => {
    const http = mockFetch();
    await workflows.unpublish('w1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${WF}/Unpublish`, body: { workflowId: 'w1' } });

    await workflows.restore('w1', 'v1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${WF}/Restore`, body: { workflowId: 'w1', versionId: 'v1' } });
  });

  it('toggles a trigger listener and steps one node', async () => {
    const http = mockFetch({ body: { output: 1 } });
    await workflows.listen('w1', 't1', true);
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${WF}/TriggerListener`,
      body: { workflowId: 'w1', triggerId: 't1', enableListener: true },
    });

    await expect(workflows.stepExecute('w1', 'n1')).resolves.toEqual({ output: 1 });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${WF}/StepExecute`, body: { workflowId: 'w1', nodeId: 'n1' } });
  });

  it('lists executions 20 at a time, paging back with BeforeId', async () => {
    const http = mockFetch({ body: { data: [], totalCount: 0 } });
    await workflows.executions('w1');
    expect(http.last()).toMatchObject({ method: 'GET', url: `${WF}/GetExecutions?WorkflowId=w1&PageSize=20` });

    await workflows.executions('w1', { pageSize: 5, beforeId: 'e9' });
    expect(http.last().url).toBe(`${WF}/GetExecutions?WorkflowId=w1&PageSize=5&BeforeId=e9`);
  });

  it('reads one execution and its logs, encoding the id', async () => {
    const http = mockFetch({ body: { data: { id: 'e 1', status: 4 } } });
    await expect(workflows.execution('e 1')).resolves.toEqual({ data: { id: 'e 1', status: 4 } });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${WF}/GetExecution?ExecutionId=e%201` });

    await workflows.executionLogs('e 1');
    expect(http.last()).toMatchObject({ method: 'GET', url: `${WF}/GetExecutionLogs?ExecutionId=e%201` });
  });

  it('resumes an execution', async () => {
    const http = mockFetch();
    await workflows.resume('e1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${WF}/ResumeExecution`, body: { executionId: 'e1' } });
  });

  it('builds the production and test webhook URLs', () => {
    expect(workflows.webhookUrl('w/1', 'n 1', false)).toBe(`${WF}/Webhook/w%2F1/n%201`);
    expect(workflows.webhookUrl('w/1', 'n 1', true)).toBe(`${WF}/webhook-test/w%2F1/n%201`);
  });

  it('triggers a webhook with the payload and returns its result', async () => {
    const http = mockFetch({ body: { executionId: 'e1', status: 'Queued' } });
    await expect(workflows.trigger('w1', 'n1', { orderId: 7 }, false)).resolves.toEqual({ executionId: 'e1', status: 'Queued' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${WF}/Webhook/w1/n1`, body: { orderId: 7 } });

    await workflows.trigger('w1', 'n1', { orderId: 7 }, true);
    expect(http.last().url).toBe(`${WF}/webhook-test/w1/n1`);
  });

  it('sends an empty object when there is no payload', async () => {
    const http = mockFetch({ body: { executionId: null, status: 'Workflow is not published' } });
    await expect(workflows.trigger('w1', 'n1', null, false)).resolves.toEqual({ executionId: null, status: 'Workflow is not published' });
    expect(http.last().body).toEqual({});

    await workflows.trigger('w1', 'n1', undefined, false);
    expect(http.last().body).toEqual({});
  });
});

describe('scheduler', () => {
  const input: ScheduleInput = {
    name: 'Nightly',
    cronExpression: '0 0 * * *',
    webhook: { url: 'https://hooks.example.com/nightly', method: 'POST' },
  };

  it('lists with an empty search from page 0 by 20', async () => {
    const http = mockFetch({ body: { data: [], totalCount: 0 } });
    await scheduler.list();
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${SCHED}/GetSchedules`,
      body: { searchKey: '', pageNumber: 0, pageSize: 20 },
    });

    await scheduler.list('night', 1, 5);
    expect(http.last().body).toEqual({ searchKey: 'night', pageNumber: 1, pageSize: 5 });
  });

  it('creates, updates and deletes schedules', async () => {
    const http = mockFetch();
    await scheduler.create(input);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${SCHED}/CreateSchedule`, body: input });

    await scheduler.update({ ...input, itemId: 's1', isActive: false });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${SCHED}/UpdateSchedule`, body: { ...input, itemId: 's1', isActive: false } });

    await scheduler.remove('s1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${SCHED}/DeleteSchedule`, body: { itemId: 's1' } });
  });
});

describe('functions', () => {
  it('invokes a function on its sub-path and returns the body as data', async () => {
    const http = mockFetch({ body: { runId: 'r1', status: 'Queued', pollToken: 'tok' } });
    await expect(functions.invoke('fn 1', '/orders/7', 'POST', { qty: 2 })).resolves.toEqual({
      ok: true,
      status: 200,
      body: { runId: 'r1', status: 'Queued', pollToken: 'tok' },
    });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${LOGIC}/fn/fn%201/orders/7`, body: { qty: 2 } });
    expect(http.last().headers).not.toHaveProperty('Prefer');
  });

  it('adds no sub-path when it is empty, and strips leading slashes', async () => {
    const http = mockFetch();
    await functions.invoke('fn1', '', 'POST', {});
    expect(http.last().url).toBe(`${LOGIC}/fn/fn1`);

    await functions.invoke('fn1', '///a/b', 'POST', {});
    expect(http.last().url).toBe(`${LOGIC}/fn/fn1/a/b`);
  });

  it('asks the gateway to wait when waitSeconds is given', async () => {
    const http = mockFetch();
    await functions.invoke('fn1', '', 'PUT', { a: 1 }, 10);
    expect(http.last()).toMatchObject({ method: 'PUT', headers: { Prefer: 'wait=10' } });
  });

  it('never sends a body with a GET', async () => {
    const http = mockFetch();
    await functions.invoke('fn1', 'items', 'GET', { ignored: true });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${LOGIC}/fn/fn1/items`, body: undefined });
    expect(http.last().headers).not.toHaveProperty('Content-Type');
  });

  it('returns a non-2xx answer as data instead of throwing', async () => {
    mockFetch({ status: 404, body: { message: 'No such function' } });
    await expect(functions.invoke('missing', '', 'DELETE', undefined)).resolves.toEqual({
      ok: false,
      status: 404,
      body: { message: 'No such function' },
    });
  });

  it('lets a network failure through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(functions.invoke('fn1', '', 'POST', {})).rejects.toThrow('Failed to fetch');
  });

  it('polls a run result with its poll token', async () => {
    const http = mockFetch({ body: { status: 'Completed', output: 42 } });
    await expect(functions.result('run/1', 'tok-1')).resolves.toEqual({ ok: true, status: 200, body: { status: 'Completed', output: 42 } });
    expect(http.last()).toMatchObject({
      method: 'GET',
      url: `${LOGIC}/fn/runs/run%2F1/result`,
      headers: { 'x-poll-token': 'tok-1' },
      body: undefined,
    });
  });
});

describe('proxies.call', () => {
  it('calls the proxy gateway with the slug and sub-path', async () => {
    const http = mockFetch({ body: { items: [] } });
    await expect(proxies.call('my proxy', '/v1/items', 'POST', { q: 1 })).resolves.toEqual({ ok: true, status: 200, body: { items: [] } });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${LOGIC}/proxy/gateway/my%20proxy/v1/items`, body: { q: 1 } });
    expect(http.last().headers).not.toHaveProperty('Prefer');
  });

  it('returns a gateway refusal as data', async () => {
    mockFetch({ status: 502, body: 'Bad gateway' });
    await expect(proxies.call('p', '', 'GET', undefined)).resolves.toEqual({ ok: false, status: 502, body: 'Bad gateway' });
  });
});
