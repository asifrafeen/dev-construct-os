import { BlocksError, blocksFetch } from '@/lib/blocks-client';
import { BLOCKS } from '@/lib/env';

/**
 * Blocks Logic — workflows, their executions, the scheduler, and the public function and
 * proxy gateways.
 *
 * The Workflow API only checks "signed in" (no permission), so any project user can list,
 * edit and publish. Functions/Proxies *management* is permission-gated; their public
 * `/fn/...` and `/proxy/gateway/...` routes are governed by each function's/proxy's own
 * access policy.
 *
 * Execution push notifications go to the console's root tenant, not to project users —
 * so progress here is polled, never streamed.
 */

export const LOGIC_BASE = `${BLOCKS.apiUrl}/logic/v4`;
const WF = `${LOGIC_BASE}/Workflow`;

/** Workflow execution status (numeric on the wire). */
export const EXECUTION_STATUS = ['Init', 'Queued', 'Pending', 'Running', 'Completed', 'Failed'];
export const EXECUTION_MODE = ['Test', 'Production'];
export const isTerminal = (status?: number) => status === 4 || status === 5;

export interface WorkflowSummary {
  itemId: string;
  name: string;
  isDirty?: boolean;
  isPublished?: boolean;
  settings?: unknown;
  createdDate?: string;
  lastUpdatedDate?: string;
  createdBy?: string;
}

export interface WorkflowNode {
  id: string;
  name: string;
  category?: string;
  /** webhook, email, schedule, dataGateway (triggers); agent, httpRequest, sendMail, code, if, … */
  type: string;
  version?: number;
  position?: unknown;
  parameters?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export interface WorkflowDetail extends WorkflowSummary {
  description?: string;
  nodes?: WorkflowNode[];
  edges?: unknown[];
  publishedVersion?: { versionId?: string; name?: string; description?: string };
}

export interface ExecutionSummary {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: number;
  executionMode?: number;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
  attemptNumber?: number;
}

export interface WebhookResult {
  executionId?: string | null;
  /** "Queued", "Completed", "Failed" — or a soft error sentence with a null executionId. */
  status?: string;
  data?: unknown;
}

export const isTriggerNode = (n: WorkflowNode) =>
  n.category === 'trigger' || ['webhook', 'email', 'schedule', 'dataGateway'].includes(n.type);

export const workflows = {
  list: (p: { search?: string; isPublished?: boolean; pageNumber?: number; pageSize?: number } = {}) =>
    blocksFetch<{ data?: WorkflowSummary[]; totalCount?: number }>(`${WF}/GetAll`, {
      method: 'POST',
      body: { pageNumber: 0, pageSize: 20, ...p },
    }),
  get: (workflowId: string) =>
    blocksFetch<{ data?: WorkflowDetail; isSuccess?: boolean }>(`${WF}/Get?WorkflowId=${encodeURIComponent(workflowId)}`),
  create: (body: { name: string; description?: string; nodes?: unknown[]; edges?: unknown[]; settings?: Record<string, unknown> }) =>
    blocksFetch<{ itemId?: string; isSuccess?: boolean }>(`${WF}/Create`, { method: 'POST', body: { edges: [], settings: {}, ...body } }),
  update: (body: { itemId: string; name?: string; nodes?: unknown[]; edges?: unknown[]; settings?: Record<string, unknown> }) =>
    blocksFetch<{ isSuccess?: boolean }>(`${WF}/Update`, { method: 'PUT', body }),
  duplicate: (workflowId: string, name: string) =>
    blocksFetch<{ itemId?: string }>(`${WF}/Duplicate`, { method: 'POST', body: { workflowId, name } }),
  remove: (id: string) => blocksFetch<unknown>(`${WF}/Delete?Id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  versions: (workflowId: string) =>
    blocksFetch<{ data?: { itemId: string; name?: string; description?: string; isPublished?: boolean; createdDate?: string }[] }>(
      `${WF}/GetVersions`,
      { method: 'POST', body: { workflowId } },
    ),
  /** "Activation" in Logic is publishing: production webhooks run the published snapshot. */
  publishNewVersion: (workflowId: string, name: string, description?: string) =>
    blocksFetch<unknown>(`${WF}/PublishNewVersion`, { method: 'POST', body: { workflowId, name, description } }),
  publishVersion: (workflowId: string, versionId?: string) =>
    blocksFetch<unknown>(`${WF}/PublishVersion`, { method: 'POST', body: { workflowId, ...(versionId ? { versionId } : {}) } }),
  unpublish: (workflowId: string) => blocksFetch<unknown>(`${WF}/Unpublish`, { method: 'POST', body: { workflowId } }),
  restore: (workflowId: string, versionId: string) =>
    blocksFetch<unknown>(`${WF}/Restore`, { method: 'POST', body: { workflowId, versionId } }),

  /** Turn a trigger's test listener on or off — a draft (`webhook-test`) run needs it on. */
  listen: (workflowId: string, triggerId: string, enableListener: boolean) =>
    blocksFetch<unknown>(`${WF}/TriggerListener`, { method: 'POST', body: { workflowId, triggerId, enableListener } }),
  stepExecute: (workflowId: string, nodeId: string) =>
    blocksFetch<Record<string, unknown>>(`${WF}/StepExecute`, { method: 'POST', body: { workflowId, nodeId } }),

  executions: (workflowId: string, p: { pageSize?: number; beforeId?: string } = {}) => {
    const q = new URLSearchParams({ WorkflowId: workflowId, PageSize: String(p.pageSize ?? 20) });
    if (p.beforeId) q.set('BeforeId', p.beforeId);
    return blocksFetch<{ data?: ExecutionSummary[]; totalCount?: number }>(`${WF}/GetExecutions?${q}`);
  },
  execution: (executionId: string) =>
    blocksFetch<{ data?: Record<string, unknown> & ExecutionSummary }>(`${WF}/GetExecution?ExecutionId=${encodeURIComponent(executionId)}`),
  executionLogs: (executionId: string) =>
    blocksFetch<{ data?: { availability?: number; logs?: { timestamp?: string; level?: string; nodeName?: string; message?: string }[]; traceId?: string } }>(
      `${WF}/GetExecutionLogs?ExecutionId=${encodeURIComponent(executionId)}`,
    ),
  resume: (executionId: string) =>
    blocksFetch<Record<string, unknown>>(`${WF}/ResumeExecution`, { method: 'POST', body: { executionId } }),

  webhookUrl: (workflowId: string, nodeId: string, test: boolean) =>
    `${WF}/${test ? 'webhook-test' : 'Webhook'}/${encodeURIComponent(workflowId)}/${encodeURIComponent(nodeId)}`,

  /**
   * POST JSON to a webhook trigger. Framework-anonymous; the trigger's own `authType`
   * decides whether the session cookie matters. Soft failures ("Workflow is not
   * published", "…not listening…") come back as 200 with a null executionId.
   */
  trigger: (workflowId: string, nodeId: string, payload: unknown, test: boolean) =>
    blocksFetch<WebhookResult>(workflows.webhookUrl(workflowId, nodeId, test), { method: 'POST', body: payload ?? {} }),
};

export interface Schedule {
  itemId: string;
  name?: string;
  description?: string;
  cronExpression?: string;
  isActive?: boolean;
  startDate?: string;
  endDate?: string;
  payload?: unknown;
  webhook?: { url?: string; method?: string; headers?: Record<string, string> };
  [k: string]: unknown;
}

export interface ScheduleInput {
  itemId?: string;
  name: string;
  description?: string;
  payload?: string;
  cronExpression: string;
  startDate?: string;
  endDate?: string;
  isActive?: boolean;
  webhook: { url: string; method: string; headers?: Record<string, string>; signingSecret?: string };
}

const SCHED = `${LOGIC_BASE}/Scheduler`;

export const scheduler = {
  list: (searchKey = '', pageNumber = 0, pageSize = 20) =>
    blocksFetch<{ data?: Schedule[]; totalCount?: number } | Schedule[]>(`${SCHED}/GetSchedules`, {
      method: 'POST',
      body: { searchKey, pageNumber, pageSize },
    }),
  create: (input: ScheduleInput) => blocksFetch<unknown>(`${SCHED}/CreateSchedule`, { method: 'POST', body: input }),
  update: (input: ScheduleInput & { itemId: string }) => blocksFetch<unknown>(`${SCHED}/UpdateSchedule`, { method: 'POST', body: input }),
  remove: (itemId: string) => blocksFetch<unknown>(`${SCHED}/DeleteSchedule`, { method: 'POST', body: { itemId } }),
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Outcome of a raw gateway call — non-2xx is data here, not an exception. */
export interface RawResult {
  ok: boolean;
  status: number;
  body: unknown;
}

async function raw(url: string, method: HttpMethod, body: unknown, headers?: Record<string, string>): Promise<RawResult> {
  try {
    const res = await blocksFetch<unknown>(url, { method, body: method === 'GET' ? undefined : body, headers });
    return { ok: true, status: 200, body: res };
  } catch (e) {
    if (e instanceof BlocksError) return { ok: false, status: e.status, body: e.body };
    throw e;
  }
}

export const functions = {
  /** Default is async: 202 `{ runId, status, pollToken }` — poll `result` with that token. */
  invoke: (functionId: string, subPath: string, method: HttpMethod, body: unknown, waitSeconds?: number) =>
    raw(
      `${LOGIC_BASE}/fn/${encodeURIComponent(functionId)}${subPath ? `/${subPath.replace(/^\/+/, '')}` : ''}`,
      method,
      body,
      waitSeconds ? { Prefer: `wait=${waitSeconds}` } : undefined,
    ),
  result: (runId: string, pollToken: string) =>
    raw(`${LOGIC_BASE}/fn/runs/${encodeURIComponent(runId)}/result`, 'GET', undefined, { 'x-poll-token': pollToken }),
};

export const proxies = {
  call: (slug: string, subPath: string, method: HttpMethod, body: unknown) =>
    raw(`${LOGIC_BASE}/proxy/gateway/${encodeURIComponent(slug)}${subPath ? `/${subPath.replace(/^\/+/, '')}` : ''}`, method, body),
};
