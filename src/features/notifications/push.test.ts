import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessagePayload } from 'firebase/messaging';
import { mockFetch } from '@/test/mock-fetch';
import { NOTIFIER_BASE } from './api';
import {
  browserCanPush,
  deviceName,
  disablePush,
  enablePush,
  forgetPushDevice,
  refreshPush,
  resumePush,
  usePushStatus,
  type PushState,
} from './push';

type Permission = 'default' | 'denied' | 'granted';

/** Stand-ins for the Firebase SDK, which push.ts imports lazily on first connect. */
const fb = vi.hoisted(() => ({
  getApps: vi.fn((): { name: string }[] => []),
  deleteApp: vi.fn((_app: unknown) => Promise.resolve()),
  initializeApp: vi.fn((_options: unknown, name: string) => ({ name })),
  getMessaging: vi.fn((_app: unknown) => ({ messaging: true })),
  onMessage: vi.fn((_messaging: unknown, _next: (payload: MessagePayload) => void) => vi.fn()),
  isSupported: vi.fn(() => Promise.resolve(true)),
  getToken: vi.fn((_messaging: unknown, _options: unknown) => Promise.resolve('tok-new')),
  deleteToken: vi.fn((_messaging: unknown) => Promise.resolve(true)),
}));

vi.mock('firebase/app', () => ({
  SDK_VERSION: '12.0.0',
  getApps: fb.getApps,
  deleteApp: fb.deleteApp,
  initializeApp: fb.initializeApp,
}));

vi.mock('firebase/messaging', () => ({
  getMessaging: fb.getMessaging,
  onMessage: fb.onMessage,
  isSupported: fb.isSupported,
  getToken: fb.getToken,
  deleteToken: fb.deleteToken,
}));

const CONFIG_URL = `${NOTIFIER_BASE}/push-web-config`;
const WEB_CONFIG = { apiKey: 'k', appId: 'a', messagingSenderId: 's', vapidKey: 'v', projectId: 'p' };
const CONFIGURED = { body: { isSuccess: true, data: WEB_CONFIG } };
const NOT_CONFIGURED = { body: { isSuccess: false, errors: { push: 'Push is off for this project.' } } };

/** A Map-backed localStorage, returned so tests can read what was stored. */
function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  });
  return data;
}

/** A browser with everything web push needs, and the given permission state. */
function stubPushBrowser(permission: Permission, answer: Permission = permission) {
  const requestPermission = vi.fn(() => Promise.resolve(answer));
  vi.stubGlobal('navigator', { userAgent: 'test', serviceWorker: {} });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission, requestPermission });
  return requestPermission;
}

/** Every state the push card passes through while `op` runs. */
async function statesDuring(op: () => Promise<void>): Promise<PushState[]> {
  const seen: PushState[] = [];
  const unsubscribe = usePushStatus.subscribe((s) => {
    seen.push(s.state);
  });
  try {
    await op();
  } finally {
    unsubscribe();
  }
  return seen;
}

const payload = (notification?: MessagePayload['notification']): MessagePayload => ({
  notification,
  from: 'sender',
  collapseKey: 'ck',
  messageId: 'm1',
});

beforeEach(() => {
  usePushStatus.setState({ state: 'idle', detail: null, projectId: null, token: null, received: [] });
});

describe('deviceName', () => {
  const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)';
  const MAC_WEBKIT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko)';
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  const CHROME = 'Chrome/120.0.0.0 Safari/537.36';

  it.each([
    [`${WIN} ${CHROME}`, 'Chrome on Windows'],
    [`${MAC} ${CHROME}`, 'Chrome on macOS'],
    [`${LINUX} ${CHROME}`, 'Chrome on Linux'],
    [`${ANDROID} Chrome/120.0.0.0 Mobile Safari/537.36`, 'Chrome on Android'],
    [`${WIN} ${CHROME} Edg/120.0.0.0`, 'Edge on Windows'],
    [`${MAC} ${CHROME} Edg/120.0.0.0`, 'Edge on macOS'],
    [`${WIN} ${CHROME} OPR/106.0.0.0`, 'Opera on Windows'],
    [`${ANDROID} Chrome/120.0.0.0 Mobile Safari/537.36 OPR/79.0.0.0`, 'Opera on Android'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0', 'Firefox on Windows'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0', 'Firefox on Linux'],
    ['Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0', 'Firefox on Android'],
    [`${MAC_WEBKIT} Version/17.2 Safari/605.1.15`, 'Safari on macOS'],
    [`${IPHONE} Version/17.2 Mobile/15E148 Safari/604.1`, 'Safari on iOS'],
    [`${IPAD} Version/17.2 Mobile/15E148 Safari/604.1`, 'Safari on iOS'],
  ])('%s → %s', (userAgent, expected) => {
    vi.stubGlobal('navigator', { userAgent });
    expect(deviceName()).toBe(expected);
  });

  it('lets the first matching rule win when a user agent names several browsers and systems', () => {
    // Edge also says Chrome and Safari; iOS also says Mac OS X; Android also says Linux.
    vi.stubGlobal('navigator', { userAgent: `${IPHONE} Edg/1 Chrome/1 Safari/1` });
    expect(deviceName()).toBe('Edge on iOS');
    vi.stubGlobal('navigator', { userAgent: `${ANDROID} Firefox/1 Safari/1` });
    expect(deviceName()).toBe('Firefox on Android');
  });

  it.each([
    ['', 'Browser'],
    ['curl/8.4.0', 'Browser'],
    [`${WIN} SomeBrowser/1.0`, 'Browser on Windows'],
    ['Mozilla/5.0 (X11; FreeBSD amd64; rv:121.0) Gecko/20100101 Firefox/121.0', 'Firefox'],
  ])('falls back for unknown parts: %j → %s', (userAgent, expected) => {
    vi.stubGlobal('navigator', { userAgent });
    expect(deviceName()).toBe(expected);
  });
});

describe('browserCanPush', () => {
  it('is true with a service worker, PushManager and Notification', () => {
    stubPushBrowser('default');
    expect(browserCanPush()).toBe(true);
  });

  it('is false without a service worker', () => {
    stubPushBrowser('default');
    vi.stubGlobal('navigator', { userAgent: 'test' });
    expect(browserCanPush()).toBe(false);
  });

  it('is false without the Push API', () => {
    vi.stubGlobal('navigator', { serviceWorker: {} });
    vi.stubGlobal('Notification', { permission: 'default' });
    expect(browserCanPush()).toBe(false);
  });

  it('is false without notifications', () => {
    vi.stubGlobal('navigator', { serviceWorker: {} });
    vi.stubGlobal('PushManager', class {});
    expect(browserCanPush()).toBe(false);
  });
});

describe('usePushStatus', () => {
  it('sets a state, with no detail unless given one', () => {
    usePushStatus.getState().set('failed', 'boom');
    expect(usePushStatus.getState()).toMatchObject({ state: 'failed', detail: 'boom' });
    usePushStatus.getState().set('off');
    expect(usePushStatus.getState()).toMatchObject({ state: 'off', detail: null });
  });

  it('records the project and token once connected', () => {
    usePushStatus.getState().set('working', 'x');
    usePushStatus.getState().connected('proj', 'tok');
    expect(usePushStatus.getState()).toMatchObject({ state: 'on', detail: null, projectId: 'proj', token: 'tok' });
  });

  it('records foreground pushes newest first, with fallbacks for a missing title and body', () => {
    const { record } = usePushStatus.getState();
    record(payload({ title: 'Hello', body: 'World' }));
    record(payload());

    const [latest, earlier] = usePushStatus.getState().received;
    expect(latest).toMatchObject({ title: 'Notification', body: '' });
    expect(earlier).toMatchObject({ title: 'Hello', body: 'World' });
    expect(earlier.payload.messageId).toBe('m1');
    expect(latest.id).toBeGreaterThan(earlier.id);
    expect(Number.isNaN(Date.parse(latest.at))).toBe(false);
  });

  it('keeps only the latest 20 pushes and clears them on request', () => {
    const { record, clearReceived } = usePushStatus.getState();
    for (let i = 0; i < 25; i++) record(payload({ title: `n${i}` }));

    const { received } = usePushStatus.getState();
    expect(received).toHaveLength(20);
    expect(received[0].title).toBe('n24');
    expect(received.at(-1)?.title).toBe('n5');

    clearReceived();
    expect(usePushStatus.getState().received).toEqual([]);
  });
});

describe('resumePush', () => {
  it('does nothing in a browser without web push', async () => {
    vi.stubGlobal('navigator', {});
    const http = mockFetch(CONFIGURED);
    await resumePush('u1');
    expect(http.requests).toEqual([]);
    expect(usePushStatus.getState().state).toBe('idle');
  });

  it.each<[string, Permission, Record<string, string>]>([
    ['permission was never granted', 'default', { 'blocks-push-on:u1': '1' }],
    ['the user never opted in', 'granted', {}],
    ['another user opted in', 'granted', { 'blocks-push-on:u2': '1' }],
  ])('does nothing when %s', async (_label, permission, stored) => {
    stubPushBrowser(permission);
    stubStorage(stored);
    const http = mockFetch(CONFIGURED);

    await resumePush('u1');
    expect(http.requests).toEqual([]);
    expect(usePushStatus.getState().state).toBe('idle');
  });

  it('reports a project without push set up, with Blocks’ reason', async () => {
    stubPushBrowser('granted');
    stubStorage({ 'blocks-push-on:u1': '1' });
    const http = mockFetch(NOT_CONFIGURED);

    const states = await statesDuring(() => resumePush('u1'));

    expect(http.last()).toMatchObject({ method: 'GET', url: CONFIG_URL });
    expect(states).toEqual(['working', 'not-set-up']);
    expect(usePushStatus.getState().detail).toBe('Push is off for this project.');
  });
});

describe('refreshPush', () => {
  it('reports a browser without web push as unsupported, without asking Blocks', async () => {
    vi.stubGlobal('navigator', {});
    const http = mockFetch(CONFIGURED);

    const states = await statesDuring(() => refreshPush('u1'));
    expect(states).toEqual(['working', 'unsupported']);
    expect(http.requests).toEqual([]);
  });

  it.each([
    ['refuses with a reason', NOT_CONFIGURED, 'Push is off for this project.'],
    ['refuses without one', { body: { isSuccess: false } }, null],
    ['succeeds without data', { body: { isSuccess: true, data: null } }, null],
  ])('reports not-set-up when Blocks %s', async (_label, reply, detail) => {
    stubPushBrowser('granted');
    stubStorage();
    mockFetch(reply);

    await refreshPush('u1');
    expect(usePushStatus.getState()).toMatchObject({ state: 'not-set-up', detail });
  });

  it.each<[Permission, Record<string, string>, PushState]>([
    ['denied', { 'blocks-push-on:u1': '1' }, 'blocked'],
    ['default', {}, 'off'],
    ['granted', {}, 'off'],
  ])('with permission %s and opt-in %j the card shows %s', async (permission, stored, expected) => {
    stubPushBrowser(permission);
    stubStorage(stored);
    mockFetch(CONFIGURED);

    await refreshPush('u1');
    expect(usePushStatus.getState()).toMatchObject({ state: expected, detail: null });
  });

  it('shows a failure instead of throwing it', async () => {
    stubPushBrowser('default');
    mockFetch({ status: 500, body: 'down' });

    await expect(refreshPush('u1')).resolves.toBeUndefined();
    expect(usePushStatus.getState()).toMatchObject({ state: 'failed', detail: `Blocks 500 — ${CONFIG_URL}` });
  });
});

describe('enablePush', () => {
  it('asks for permission before anything is awaited', () => {
    const requestPermission = stubPushBrowser('default', 'denied');
    stubStorage();
    mockFetch(CONFIGURED);

    const pending = enablePush('u1');
    expect(requestPermission).toHaveBeenCalledTimes(1);
    return pending;
  });

  it('shows blocked when the user refuses, and does not opt in', async () => {
    stubPushBrowser('default', 'denied');
    const stored = stubStorage();
    const http = mockFetch(CONFIGURED);

    await enablePush('u1');
    expect(usePushStatus.getState()).toMatchObject({ state: 'blocked', detail: null });
    expect(stored.size).toBe(0);
    expect(http.requests).toEqual([]);
  });

  it('stays off when the prompt is dismissed', async () => {
    stubPushBrowser('default', 'default');
    const stored = stubStorage();

    await enablePush('u1');
    expect(usePushStatus.getState()).toMatchObject({
      state: 'off',
      detail: 'The prompt was closed without an answer.',
    });
    expect(stored.size).toBe(0);
  });

  it('opts this user in before connecting, so a failed first attempt is retried later', async () => {
    stubPushBrowser('default', 'granted');
    const stored = stubStorage();
    const http = mockFetch(NOT_CONFIGURED);

    await enablePush('u1');
    expect(stored.get('blocks-push-on:u1')).toBe('1');
    expect(http.last().url).toBe(CONFIG_URL);
    expect(usePushStatus.getState().state).toBe('not-set-up');
  });

  it('keeps going when storage refuses to save the opt-in', async () => {
    stubPushBrowser('default', 'granted');
    const blocked = () => {
      throw new Error('QuotaExceededError');
    };
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: blocked, removeItem: blocked });
    mockFetch(NOT_CONFIGURED);

    await enablePush('u1');
    expect(usePushStatus.getState().state).toBe('not-set-up');
  });
});

describe('disablePush', () => {
  it('opts out, removes the filed device from Blocks and shows off', async () => {
    const stored = stubStorage({ 'blocks-push-on:u1': '1', 'blocks-push-on:u2': '1', 'blocks-push-token': 'tok/1' });
    const http = mockFetch({ status: 204 });

    const states = await statesDuring(() => disablePush('u1'));

    expect(states).toEqual(['working', 'off']);
    expect(http.requests).toHaveLength(1);
    expect(http.last()).toMatchObject({ method: 'DELETE', url: `${NOTIFIER_BASE}/devices/tok%2F1` });
    expect([...stored.keys()]).toEqual(['blocks-push-on:u2']);
  });

  it('skips the removal when no device was filed', async () => {
    stubStorage({ 'blocks-push-on:u1': '1' });
    const http = mockFetch();

    await disablePush('u1');
    expect(http.requests).toEqual([]);
    expect(usePushStatus.getState().state).toBe('off');
  });

  it('still turns off when Blocks no longer knows the device', async () => {
    stubStorage({ 'blocks-push-token': 'gone' });
    mockFetch({ status: 404, body: { error: 'not found' } });

    await disablePush('u1');
    expect(usePushStatus.getState()).toMatchObject({ state: 'off', detail: null });
  });
});

describe('forgetPushDevice', () => {
  it('removes the device and resets the card, but keeps the opt-in for the next sign-in', async () => {
    const stored = stubStorage({ 'blocks-push-on:u1': '1', 'blocks-push-token': 'tok' });
    const http = mockFetch({ status: 204 });
    usePushStatus.getState().connected('proj', 'tok');
    usePushStatus.getState().record(payload({ title: 'x' }));

    await forgetPushDevice();

    expect(http.last()).toMatchObject({ method: 'DELETE', url: `${NOTIFIER_BASE}/devices/tok` });
    expect([...stored.keys()]).toEqual(['blocks-push-on:u1']);
    expect(usePushStatus.getState()).toMatchObject({
      state: 'idle',
      detail: null,
      projectId: null,
      token: null,
      received: [],
    });
  });

  it('sends nothing when no device was filed', async () => {
    stubStorage();
    const http = mockFetch();
    await forgetPushDevice();
    expect(http.requests).toEqual([]);
  });

  it('never throws, even when the removal fails', async () => {
    stubStorage({ 'blocks-push-token': 'tok' });
    mockFetch({ status: 500 });
    await expect(forgetPushDevice()).resolves.toBeUndefined();
  });

  it('copes with storage that throws on access', async () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    const http = mockFetch();
    usePushStatus.getState().connected('proj', 'tok');

    await expect(forgetPushDevice()).resolves.toBeUndefined();
    expect(http.requests).toEqual([]);
    expect(usePushStatus.getState().state).toBe('idle');
  });
});

describe('connecting with Firebase', () => {
  const CHROME_ON_WINDOWS =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const REGISTERED = { body: { isSuccess: true } };
  const WORKER_URL = '/firebase-messaging-sw.js?apiKey=k&appId=a&messagingSenderId=s&projectId=p&v=12.0.0';

  /** push.ts keeps its Firebase session and worker per page load, so each test gets a fresh copy. */
  async function freshPush() {
    vi.resetModules();
    return import('./push');
  }

  /** A service worker still installing; `settle` moves it to a new state and fires statechange. */
  function incomingWorker() {
    const listeners: (() => void)[] = [];
    const sw = {
      state: 'installing',
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        listeners.push(listener);
      }),
      settle(state: string) {
        sw.state = state;
        listeners.forEach((listener) => listener());
      },
    };
    return sw;
  }

  const registrationWith = (active: object | null, installing?: ReturnType<typeof incomingWorker>) => ({
    active,
    installing,
    showNotification: vi.fn((_title: string, _options: unknown) => Promise.resolve()),
  });

  type Registration = ReturnType<typeof registrationWith>;

  /** A push-capable browser, permission granted and user u1 opted in, whose worker registers as given. */
  function stubConnectable(registration: Registration, stored: Record<string, string> = {}) {
    const register = vi.fn((_url: string, _options: unknown) => Promise.resolve(registration));
    vi.stubGlobal('navigator', { userAgent: CHROME_ON_WINDOWS, serviceWorker: { register } });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    const storage = stubStorage({ 'blocks-push-on:u1': '1', ...stored });
    return { register, storage };
  }

  beforeEach(() => {
    for (const mock of Object.values(fb)) mock.mockReset();
  });

  it('registers this browser with Firebase and Blocks, and replaces a rotated token', async () => {
    const push = await freshPush();
    const registration = registrationWith({});
    const { register, storage } = stubConnectable(registration, { 'blocks-push-token': 'tok-old' });
    const http = mockFetch([CONFIGURED, REGISTERED, { status: 204 }]);

    await push.resumePush('u1');

    expect(push.usePushStatus.getState()).toMatchObject({
      state: 'on',
      detail: null,
      projectId: 'p',
      token: 'tok-new',
    });
    expect(fb.initializeApp).toHaveBeenCalledWith(
      { apiKey: 'k', appId: 'a', messagingSenderId: 's', projectId: 'p' },
      'blocks-push',
    );
    expect(fb.deleteApp).not.toHaveBeenCalled();
    expect(register).toHaveBeenCalledWith(WORKER_URL, { scope: '/firebase-cloud-messaging-push-scope' });
    expect(fb.getToken).toHaveBeenCalledWith(
      { messaging: true },
      { vapidKey: 'v', serviceWorkerRegistration: registration },
    );
    expect(http.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET ${CONFIG_URL}`,
      `POST ${NOTIFIER_BASE}/devices`,
      `DELETE ${NOTIFIER_BASE}/devices/tok-old`,
    ]);
    expect(http.requests[1].body).toEqual({ token: 'tok-new', platform: 'web', name: 'Chrome on Windows' });
    expect(storage.get('blocks-push-token')).toBe('tok-new');
  });

  it('keeps the filed device when the token has not changed', async () => {
    const push = await freshPush();
    stubConnectable(registrationWith({}), { 'blocks-push-token': 'tok-new' });
    const http = mockFetch([CONFIGURED, REGISTERED]);

    await push.resumePush('u1');

    expect(http.requests).toHaveLength(2);
    expect(push.usePushStatus.getState().state).toBe('on');
  });

  it('connects from refreshPush with the config it already read', async () => {
    const push = await freshPush();
    stubConnectable(registrationWith({}));
    const http = mockFetch([CONFIGURED, REGISTERED]);

    await push.refreshPush('u1');

    expect(http.requests.map((r) => r.url)).toEqual([CONFIG_URL, `${NOTIFIER_BASE}/devices`]);
    expect(push.usePushStatus.getState().state).toBe('on');
  });

  it('reuses the Firebase app for the same config, and replaces it when the config changes', async () => {
    const push = await freshPush();
    const stopForeground = vi.fn();
    fb.onMessage.mockReturnValue(stopForeground);
    stubConnectable(registrationWith({}));
    const changed = { body: { isSuccess: true, data: { ...WEB_CONFIG, projectId: 'p2' } } };
    mockFetch([CONFIGURED, REGISTERED, CONFIGURED, REGISTERED, changed, REGISTERED]);

    await push.resumePush('u1');
    await push.resumePush('u1');
    expect(fb.initializeApp).toHaveBeenCalledTimes(1);

    fb.getApps.mockReturnValue([{ name: 'other' }, { name: 'blocks-push' }]);
    await push.resumePush('u1');

    expect(fb.deleteApp).toHaveBeenCalledWith({ name: 'blocks-push' });
    expect(stopForeground).toHaveBeenCalledTimes(1);
    expect(fb.initializeApp).toHaveBeenCalledTimes(2);
    expect(push.usePushStatus.getState()).toMatchObject({ state: 'on', projectId: 'p2' });
  });

  it('reports unsupported when Firebase Messaging is not available', async () => {
    const push = await freshPush();
    fb.isSupported.mockResolvedValue(false);
    const { register } = stubConnectable(registrationWith({}));
    mockFetch(CONFIGURED);

    await push.resumePush('u1');

    expect(push.usePushStatus.getState()).toMatchObject({
      state: 'unsupported',
      detail: 'Firebase Messaging is not available here.',
    });
    expect(register).not.toHaveBeenCalled();
  });

  it.each([
    [
      'with its reason',
      { body: { isSuccess: false, errors: { token: 'Token is malformed.' } } },
      'Token is malformed.',
    ],
    ['without one', { body: { isSuccess: false } }, 'Blocks refused the device.'],
  ])('fails when Blocks refuses the device, %s', async (_label, refusal, detail) => {
    const push = await freshPush();
    const { storage } = stubConnectable(registrationWith({}));
    mockFetch([CONFIGURED, refusal]);

    await push.resumePush('u1');

    expect(push.usePushStatus.getState()).toMatchObject({ state: 'failed', detail });
    expect(storage.has('blocks-push-token')).toBe(false);
  });

  it('shows a failure that is not an Error as text', async () => {
    const push = await freshPush();
    fb.getToken.mockRejectedValue('token request refused');
    stubConnectable(registrationWith({}));
    mockFetch(CONFIGURED);

    await push.resumePush('u1');

    expect(push.usePushStatus.getState()).toMatchObject({ state: 'failed', detail: 'token request refused' });
  });

  it('waits for an installing worker to activate before asking for a token', async () => {
    const push = await freshPush();
    const sw = incomingWorker();
    stubConnectable(registrationWith(null, sw));
    mockFetch([CONFIGURED, REGISTERED]);

    const pending = push.resumePush('u1');
    await vi.waitFor(() => expect(sw.addEventListener).toHaveBeenCalledWith('statechange', expect.any(Function)));
    sw.settle('installed');
    expect(fb.getToken).not.toHaveBeenCalled();
    sw.settle('activated');
    await pending;

    expect(fb.getToken).toHaveBeenCalledTimes(1);
    expect(push.usePushStatus.getState().state).toBe('on');
  });

  it('fails when the worker is discarded while installing', async () => {
    const push = await freshPush();
    const sw = incomingWorker();
    stubConnectable(registrationWith(null, sw));
    mockFetch(CONFIGURED);

    const pending = push.resumePush('u1');
    await vi.waitFor(() => expect(sw.addEventListener).toHaveBeenCalled());
    sw.settle('redundant');
    await pending;

    expect(push.usePushStatus.getState()).toMatchObject({
      state: 'failed',
      detail: 'The push service worker could not be installed.',
    });
    expect(fb.getToken).not.toHaveBeenCalled();
  });

  it('fails when there is no worker to wait for', async () => {
    const push = await freshPush();
    stubConnectable(registrationWith(null));
    mockFetch(CONFIGURED);

    await push.resumePush('u1');

    expect(push.usePushStatus.getState()).toMatchObject({
      state: 'failed',
      detail: 'The push service worker did not start.',
    });
  });

  it('gives up on a worker that does not activate within 10 seconds', async () => {
    const push = await freshPush();
    const sw = incomingWorker();
    stubConnectable(registrationWith(null, sw));
    mockFetch(CONFIGURED);
    // Only the worker's start timer is faked; setImmediate still turns the event loop.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = push.resumePush('u1');
      for (let turn = 0; turn < 100 && sw.addEventListener.mock.calls.length === 0; turn++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(sw.addEventListener).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(9_999);
      expect(push.usePushStatus.getState().state).toBe('working');
      await vi.advanceTimersByTimeAsync(1);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    expect(push.usePushStatus.getState()).toMatchObject({
      state: 'failed',
      detail: 'The push service worker did not start in time.',
    });
  });

  it('records a push that arrives while the page is visible and shows it through the worker', async () => {
    const push = await freshPush();
    const registration = registrationWith({});
    stubConnectable(registration);
    mockFetch([CONFIGURED, REGISTERED]);
    await push.resumePush('u1');
    const onForeground = fb.onMessage.mock.calls[0][1];

    onForeground({ ...payload({ title: 'Hi', body: 'There', icon: '/i.png' }), fcmOptions: { link: '/inbox' } });
    onForeground({ ...payload({}), data: { link: '/orders' } });

    expect(push.usePushStatus.getState().received.map((r) => r.title)).toEqual(['Notification', 'Hi']);
    expect(registration.showNotification).toHaveBeenNthCalledWith(1, 'Hi', {
      body: 'There',
      icon: '/i.png',
      data: { link: '/inbox' },
    });
    expect(registration.showNotification).toHaveBeenNthCalledWith(2, 'Notification', {
      body: undefined,
      icon: undefined,
      data: { link: '/orders' },
    });
  });

  it('records a data-only push without showing it, and survives a failed display', async () => {
    const push = await freshPush();
    const registration = registrationWith({});
    registration.showNotification.mockRejectedValue(new Error('no permission'));
    stubConnectable(registration);
    mockFetch([CONFIGURED, REGISTERED]);
    await push.resumePush('u1');
    const onForeground = fb.onMessage.mock.calls[0][1];

    onForeground(payload());
    expect(registration.showNotification).not.toHaveBeenCalled();

    onForeground(payload({ title: 'Shown?' }));
    await Promise.resolve();
    expect(registration.showNotification).toHaveBeenCalledTimes(1);
    expect(push.usePushStatus.getState().received).toHaveLength(2);
  });

  it('drops the Firebase subscription on disable, even if Firebase fails to', async () => {
    const push = await freshPush();
    stubConnectable(registrationWith({}));
    mockFetch([CONFIGURED, REGISTERED, { status: 204 }]);
    await push.resumePush('u1');

    fb.deleteToken.mockRejectedValue(new Error('offline'));
    await push.disablePush('u1');

    expect(fb.deleteToken).toHaveBeenCalledWith({ messaging: true });
    expect(push.usePushStatus.getState()).toMatchObject({ state: 'off', detail: null });
  });
});
