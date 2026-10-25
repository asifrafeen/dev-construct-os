/**
 * Ready-made requests for the API playground, grouped by service.
 *
 * Paths are relative to VITE_BLOCKS_API_URL. A body of `undefined` means none is sent.
 * These are starting points for poking at an endpoint by hand — the dedicated pages are
 * where each flow is exercised properly.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Preset {
  label: string;
  method: HttpMethod;
  path: string;
  body?: unknown;
  note?: string;
}

export const PRESETS: Record<string, Preset[]> = {
  IAM: [
    { label: 'Me', method: 'GET', path: '/iam/v4/iam/me' },
    { label: 'Login options (public)', method: 'GET', path: '/iam/v4/auth/login-options' },
    { label: 'Signup settings (public)', method: 'GET', path: '/iam/v4/iam/signup-settings' },
    { label: 'Users list', method: 'POST', path: '/iam/v4/iam/users', body: { page: 0, pageSize: 10, filter: {} } },
    { label: 'Roles list', method: 'POST', path: '/iam/v4/iam/roles', body: { page: 0, pageSize: 10, filter: { search: '' } } },
    {
      label: 'Permissions list',
      method: 'POST',
      path: '/iam/v4/iam/permissions',
      body: { page: 0, pageSize: 20, filter: { search: '', isArchived: false } },
    },
    { label: 'Permissions by severity', method: 'GET', path: '/iam/v4/iam/permissions/by-severity' },
    { label: 'Resource groups', method: 'GET', path: '/iam/v4/iam/resource-groups' },
    { label: 'Resource features', method: 'GET', path: '/iam/v4/iam/resource/features' },
    { label: 'Assignable roles', method: 'GET', path: '/iam/v4/iam/roles/assignable' },
    { label: 'My organizations', method: 'GET', path: '/iam/v4/iam/organizations/my' },
    { label: 'Organization config', method: 'GET', path: '/iam/v4/iam/organizations/config' },
    { label: 'MFA config', method: 'GET', path: '/iam/v4/mfa/config' },
    { label: 'MFA backup codes', method: 'GET', path: '/iam/v4/mfa/backup-codes' },
    { label: 'User exists', method: 'POST', path: '/iam/v4/iam/users/exists', body: { email: 'someone@example.com' } },
    { label: 'Email available', method: 'POST', path: '/iam/v4/iam/email/available', body: { email: 'someone@example.com' } },
    { label: 'Org name available (public)', method: 'GET', path: '/iam/v4/iam/organizations/name/available?name=Acme' },
    { label: 'Org config (admin view)', method: 'GET', path: '/iam/v4/iam/organizations/config/admin' },
    { label: 'Signup settings (admin)', method: 'GET', path: '/iam/v4/iam/signup-settings/admin' },
    { label: 'Token claims', method: 'GET', path: '/iam/v4/auth/me' },
    { label: 'Security summary', method: 'GET', path: '/iam/v4/security/summary' },
    { label: 'Sessions', method: 'GET', path: '/iam/v4/security/sessions' },
    { label: 'Activity', method: 'POST', path: '/iam/v4/security/activity', body: { page: 0, pageSize: 20 } },
    { label: 'Password policy check (public)', method: 'POST', path: '/iam/v4/idp/password-check', body: { password: 'Test1234!' } },
    { label: 'Validate activation code (public)', method: 'POST', path: '/iam/v4/auth/validate-activation', body: { activationCode: '<code>' } },
    { label: 'Client credentials', method: 'GET', path: '/iam/v4/auth/client-credentials' },
    { label: 'Identity providers', method: 'GET', path: '/iam/v4/auth/identity-providers' },
    { label: 'Auth config', method: 'GET', path: '/iam/v4/auth/config' },
    { label: 'OIDC clients', method: 'GET', path: '/iam/v4/oidc-clients' },
    { label: 'Signup-link configurations', method: 'POST', path: '/iam/v4/iam/signup-links/configurations/query', body: { page: 0, pageSize: 20, includeInactive: false } },
  ],
  Data: [
    { label: 'Schemas', method: 'GET', path: '/data/v4/schemas?PageNo=1&PageSize=50' },
    { label: 'Schemas aggregation', method: 'GET', path: '/data/v4/schemas/aggregation?PageNo=1&PageSize=50' },
    { label: 'Schema info', method: 'GET', path: '/data/v4/schemas/info' },
    { label: 'Schema info by name', method: 'GET', path: '/data/v4/schemas/info-by-name?schemaName=Product' },
    { label: 'Validations', method: 'GET', path: '/data/v4/data-validations?PageNo=1&PageSize=50' },
    { label: 'Mock data', method: 'GET', path: '/data/v4/mock-data' },
    {
      label: 'Generate regex',
      method: 'POST',
      path: '/data/v4/regex/generate-regex',
      body: { description: 'A Bangladeshi mobile number starting with 01' },
    },
    {
      label: 'GraphQL gateway',
      method: 'POST',
      path: '/data/v4/gateway',
      body: { query: 'query { __schema { queryType { fields { name } } } }' },
    },
    { label: 'Storage: root objects', method: 'GET', path: '/data/v4/objects/get-objects?limit=50' },
    { label: 'Storage: trash', method: 'GET', path: '/data/v4/objects/get-trash?limit=50' },
    { label: 'Storage: shared with me', method: 'GET', path: '/data/v4/objects/get-shared-objects?limit=50' },
  ],
  Localization: [
    { label: 'Languages (public)', method: 'GET', path: '/localization/v4/Language/Gets' },
    { label: 'Modules (public)', method: 'GET', path: '/localization/v4/Module/Gets' },
    { label: 'Languages (tenant)', method: 'GET', path: '/localization/v4/Language/GetLanguagesForCurrentTenant' },
    { label: 'Modules (tenant)', method: 'GET', path: '/localization/v4/Module/GetModulesForCurrentTenant' },
    { label: 'UILM file', method: 'GET', path: '/localization/v4/Key/GetUilmFile?Language=en-US&ModuleName=common' },
    {
      label: 'Keys by names',
      method: 'POST',
      path: '/localization/v4/Key/GetsByKeyNames',
      body: { keyNames: ['NAV_DASHBOARD'] },
    },
  ],
  Logic: [
    { label: 'Workflows', method: 'POST', path: '/logic/v4/Workflow/GetAll', body: { pageNumber: 0, pageSize: 20 } },
    { label: 'Workflow detail', method: 'GET', path: '/logic/v4/Workflow/Get?WorkflowId=<id>' },
    { label: 'Executions', method: 'GET', path: '/logic/v4/Workflow/GetExecutions?WorkflowId=<id>&PageSize=20' },
    { label: 'Webhook (published)', method: 'POST', path: '/logic/v4/Workflow/Webhook/<workflowId>/<triggerNodeId>', body: { hello: 'world' } },
    { label: 'Schedules', method: 'POST', path: '/logic/v4/Scheduler/GetSchedules', body: { searchKey: '', pageNumber: 0, pageSize: 20 } },
    { label: 'Notification configs', method: 'GET', path: '/logic/v4/Notification/Gets' },
    { label: 'Mail servers', method: 'GET', path: '/logic/v4/Mail/Gets' },
    { label: 'Mailbox', method: 'GET', path: '/logic/v4/Mail/GetMailBoxMails?PageNumber=1&PageSize=20' },
    { label: 'Invoke function', method: 'POST', path: '/logic/v4/fn/<functionId>', body: {} },
  ],
  Utilities: [
    { label: 'Magic links', method: 'GET', path: '/utilities/v4/MagicLink/GetLinks?PageNumber=0&PageSize=20&ProjectKey=<project key>' },
    { label: 'Next sequence number', method: 'GET', path: '/utilities/v4/Sequence/Next?Context=test&ProjectKey=<project key>' },
    { label: 'Locate IP', method: 'GET', path: '/utilities/v4/Geolocation/LocateIp?IpAddresses=8.8.8.8' },
    { label: 'Entitlements', method: 'GET', path: '/utilities/v4/entitlements' },
    { label: 'My subscription', method: 'GET', path: '/utilities/v4/subscriptions/mine' },
    { label: 'Payments', method: 'GET', path: '/utilities/v4/payments?pageSize=25' },
    { label: 'SMS templates', method: 'GET', path: '/utilities/v4/Sms/GetTemplates?Page=1&PageSize=20' },
  ],
  Agents: [
    { label: 'Agents', method: 'POST', path: '/agents/v4/agents/queries', body: { limit: 20, offset: 0 } },
    { label: 'My conversations', method: 'POST', path: '/agents/v4/collaboration/conversations', body: { page: 1, pageSize: 20, order: 'desc' } },
    { label: 'Chat (non-streaming)', method: 'POST', path: '/agents/v4/collaboration/completion', body: { agentId: '<agent id>', isStream: false, message: { content: 'Hello' } } },
    { label: 'Widget config (public)', method: 'GET', path: '/agents/v4/widget/config?widget_id=<widget id>' },
  ],
  'Monitor / Release / OS': [
    { label: 'Monitors', method: 'GET', path: '/monitor/v4/Monitor/GetMonitorList?projectKey=<project key>&pageNumber=0&pageSize=20' },
    { label: 'Heartbeat ping', method: 'GET', path: '/monitor/v4/Health/Ping/<monitor id>' },
    { label: 'Release test ping', method: 'GET', path: '/release/v4/auth/testping' },
    { label: 'OS version', method: 'GET', path: '/os/v4/Version' },
    { label: 'LMT services', method: 'GET', path: '/os/v4/Trace/GetBlocksServices' },
    { label: 'Traces', method: 'POST', path: '/os/v4/Trace/GetTraces', body: { page: 0, pageSize: 20, filter: {} } },
    { label: 'Secrets', method: 'GET', path: '/os/v4/Secrets/gets?pageNumber=1&pageSize=20' },
  ],
  Messaging: [
    { label: 'My notifications', method: 'GET', path: '/logic/v4/Notifier/GetNotifications?Page=0&PageSize=20' },
    { label: 'Mark all read', method: 'POST', path: '/logic/v4/Notifier/MarkAllNotificationAsRead' },
    {
      label: 'Notify user',
      method: 'POST',
      path: '/logic/v4/Notifier/Notify',
      body: { userIds: ['<user id>'], denormalizedPayload: '{"title":"Hello","body":"From the playground"}' },
    },
    {
      label: 'Send mail',
      method: 'POST',
      path: '/logic/v4/Mail/Send',
      body: { to: ['someone@example.com'], purpose: '<template purpose>', language: 'en-US', bodyDataContext: {} },
    },
  ],
};
