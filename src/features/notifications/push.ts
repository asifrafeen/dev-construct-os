import { create } from 'zustand';
import type { MessagePayload, Messaging } from 'firebase/messaging';
import { notifier, type NotifierAck, type PushWebConfig } from './api';

/**
 * Web push for this browser: Firebase Cloud Messaging, registered with the Blocks Notifier.
 *
 * How the pieces fit (blocks-logic Notifier + Blocks OS push settings):
 *   - Blocks OS holds the project's Firebase service account key and web config. The browser
 *     reads the public half from `GET Notifier/push-web-config`, so no Firebase value is baked
 *     into this bundle and a change in OS reaches every user without a rebuild.
 *   - Firebase gives this browser a registration token; `POST Notifier/devices` files it under
 *     the signed-in user. Blocks sends to it when a notification configuration with the Push
 *     channel targets that user, and deletes it on its own once Firebase refuses it.
 *   - Blocks skips devices it has not seen for 60 days, so an opted-in user re-registers on
 *     every load (`resumePush`).
 *   - The text of a push is the configuration's push template (localization keys), not the
 *     payload of the `Notify` call.
 *
 * Firebase is imported on first use: a user who never turns push on never downloads it.
 */

export type PushState =
  | 'idle'
  | 'working'
  /** This browser has no web push (on iOS: only an installed Home Screen app has it). */
  | 'unsupported'
  /** Blocks OS has no web config for the project, or Push / its Web platform is off. */
  | 'not-set-up'
  /** The user refused notifications for this site; only the browser's site settings undo that. */
  | 'blocked'
  /** Possible, but this user has not turned it on in this browser. */
  | 'off'
  | 'on'
  | 'failed';

export interface ReceivedPush {
  id: number;
  at: string;
  title: string;
  body: string;
  payload: MessagePayload;
}

interface PushStatus {
  state: PushState;
  detail: string | null;
  projectId: string | null;
  token: string | null;
  /** Pushes that arrived while a tab was visible — Firebase hands those to the page, not the worker. */
  received: ReceivedPush[];
  set: (state: PushState, detail?: string | null) => void;
  connected: (projectId: string, token: string) => void;
  record: (payload: MessagePayload) => void;
  clearReceived: () => void;
}

let nextId = 1;

export const usePushStatus = create<PushStatus>()((set) => ({
  state: 'idle',
  detail: null,
  projectId: null,
  token: null,
  received: [],
  set: (state, detail = null) => set({ state, detail }),
  connected: (projectId, token) => set({ state: 'on', detail: null, projectId, token }),
  record: (payload) =>
    set((s) => ({
      received: [
        {
          id: nextId++,
          at: new Date().toISOString(),
          title: payload.notification?.title ?? 'Notification',
          body: payload.notification?.body ?? '',
          payload,
        },
        ...s.received,
      ].slice(0, 20),
    })),
  clearReceived: () => set({ received: [] }),
}));

/** The token this browser last filed with Blocks, kept so it can be removed again. */
const TOKEN_KEY = 'blocks-push-token';
/** Per user: one person turning push on must not opt in everyone who signs in on this browser. */
const optInKey = (userId: string) => `blocks-push-on:${userId}`;

// Private windows and blocked site data throw on access; push then lasts for the session only.
const storage = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* session only */
    }
  },
  remove: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing was stored */
    }
  },
};

const BASE = import.meta.env.BASE_URL;
/** Firebase's own default scope: the worker controls no page, it only receives pushes. */
const SW_SCOPE = `${BASE}firebase-cloud-messaging-push-scope`;
const APP_NAME = 'blocks-push';

/** The APIs web push needs. Firebase's `isSupported()` checks a few more once it is loaded. */
export const browserCanPush = () =>
  'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis;

type UaRule = readonly [pattern: RegExp, name: string];

const BROWSERS: readonly UaRule[] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: readonly UaRule[] = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

const firstMatch = (ua: string, rules: readonly UaRule[]) => rules.find(([pattern]) => pattern.test(ua))?.[1];

/** What the device list in Blocks OS shows for this browser, e.g. "Chrome on Windows". */
export function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = firstMatch(ua, BROWSERS) ?? 'Browser';
  const os = firstMatch(ua, SYSTEMS) ?? '';
  return os ? `${browser} on ${os}` : browser;
}

type FirebaseApp = typeof import('firebase/app');
type FirebaseMessaging = typeof import('firebase/messaging');

interface Session {
  key: string;
  fm: FirebaseMessaging;
  messaging: Messaging;
  sdkVersion: string;
}

let session: Session | null = null;
let worker: ServiceWorkerRegistration | null = null;
let stopForeground: (() => void) | null = null;

const configKey = (c: PushWebConfig) => [c.projectId, c.appId, c.apiKey, c.messagingSenderId].join('|');

/**
 * One Firebase app per config. A config changed in Blocks OS mid-session replaces the app —
 * Firebase refuses a second app under the same name with different options.
 */
async function openSession(config: PushWebConfig): Promise<Session> {
  const key = configKey(config);
  if (session?.key === key) return session;

  const [fa, fm]: [FirebaseApp, FirebaseMessaging] = await Promise.all([
    import('firebase/app'),
    import('firebase/messaging'),
  ]);
  const existing = fa.getApps().find((a) => a.name === APP_NAME);
  if (existing) await fa.deleteApp(existing);
  stopForeground?.();

  const app = fa.initializeApp(
    {
      apiKey: config.apiKey,
      appId: config.appId,
      messagingSenderId: config.messagingSenderId,
      projectId: config.projectId,
    },
    APP_NAME,
  );
  const messaging = fm.getMessaging(app);
  stopForeground = fm.onMessage(messaging, onForeground);
  session = { key, fm, messaging, sdkVersion: fa.SDK_VERSION };
  return session;
}

/**
 * The worker reads the config from its own URL — it cannot import the bundle or reach this
 * page's state — and loads the Firebase CDN build of the same version as the bundle.
 */
async function registerWorker(config: PushWebConfig, sdkVersion: string) {
  const qs = new URLSearchParams({
    apiKey: config.apiKey,
    appId: config.appId,
    messagingSenderId: config.messagingSenderId,
    projectId: config.projectId,
    v: sdkVersion,
  });
  const registration = await navigator.serviceWorker.register(`${BASE}firebase-messaging-sw.js?${qs}`, {
    scope: SW_SCOPE,
  });
  await untilActive(registration);
  return registration;
}

const WORKER_START_TIMEOUT_MS = 10_000;

/**
 * `register()` resolves before a new worker is active, and subscribing then fails with "no active
 * Service Worker". Firebase waits for this only when it registers its own default worker, not for
 * one handed to it, and `serviceWorker.ready` never resolves for a scope that controls no page.
 */
function untilActive(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active) return Promise.resolve();
  const incoming = registration.installing ?? registration.waiting;
  if (!incoming) return Promise.reject(new Error('The push service worker did not start.'));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('The push service worker did not start in time.')),
      WORKER_START_TIMEOUT_MS,
    );
    incoming.addEventListener('statechange', () => {
      if (incoming.state === 'activated') {
        clearTimeout(timer);
        resolve();
      } else if (incoming.state === 'redundant') {
        clearTimeout(timer);
        reject(new Error('The push service worker could not be installed.'));
      }
    });
  });
}

/**
 * Firebase routes a push to the page, not the worker, whenever a tab of the app is visible —
 * so without this a push sent while you look at the app would show nothing. It is recorded for
 * the Notifications page and shown as a system notification, the same as in the background.
 */
function onForeground(payload: MessagePayload) {
  usePushStatus.getState().record(payload);
  const n = payload.notification;
  if (!worker || !n) return;
  void worker
    .showNotification(n.title ?? 'Notification', {
      body: n.body,
      icon: n.icon,
      // The worker's click handler opens this, as it does for a background notification.
      data: { link: payload.fcmOptions?.link ?? payload.data?.link },
    })
    .catch(() => undefined);
}

const firstError = (ack: NotifierAck | null | undefined) =>
  ack?.errors ? Object.values(ack.errors)[0] : undefined;

async function removeQuietly(token: string) {
  try {
    await notifier.removeDevice(token);
  } catch {
    // Already gone, or the session has ended. Blocks drops the row itself once Firebase refuses it.
  }
}

async function webConfig(): Promise<{ config: PushWebConfig | null; reason: string | null }> {
  const res = await notifier.pushWebConfig();
  return res?.isSuccess && res.data
    ? { config: res.data, reason: null }
    : { config: null, reason: firstError(res) ?? null };
}

/** Config → worker → Firebase token → Blocks. Permission must already be granted. */
async function connect(known?: PushWebConfig): Promise<void> {
  const status = usePushStatus.getState();
  const { config, reason } = known ? { config: known, reason: null } : await webConfig();
  if (!config) return status.set('not-set-up', reason);

  const s = await openSession(config);
  if (!(await s.fm.isSupported())) return status.set('unsupported', 'Firebase Messaging is not available here.');

  worker = await registerWorker(config, s.sdkVersion);
  // getToken is deprecated in favour of Firebase installation ids, but Blocks sends to the FCM
  // `token` target — which is exactly this registration token.
  const token = await s.fm.getToken(s.messaging, { vapidKey: config.vapidKey, serviceWorkerRegistration: worker });
  const ack = await notifier.registerDevice(token, deviceName());
  if (ack?.isSuccess === false) throw new Error(firstError(ack) ?? 'Blocks refused the device.');

  // Firebase rotates tokens now and then; the old row would otherwise linger until a send fails.
  const previous = storage.get(TOKEN_KEY);
  if (previous && previous !== token) await removeQuietly(previous);
  storage.set(TOKEN_KEY, token);
  status.connected(config.projectId, token);
}

/** Every operation ends in a settled state; a failure is shown, never thrown at the caller. */
async function run(op: () => Promise<void>): Promise<void> {
  usePushStatus.getState().set('working');
  try {
    await op();
  } catch (e) {
    usePushStatus.getState().set('failed', e instanceof Error ? e.message : String(e));
  }
}

const optedIn = (userId: string) => storage.get(optInKey(userId)) === '1';

/**
 * On every load of the signed-in app. Only an opted-in user with permission already granted is
 * touched, and silently: the token is refreshed with Blocks and may have rotated.
 */
export function resumePush(userId: string): Promise<void> {
  if (!browserCanPush() || Notification.permission !== 'granted' || !optedIn(userId)) return Promise.resolve();
  return run(() => connect());
}

/** Works out what the push card can offer, registering this browser if the user already opted in. */
export function refreshPush(userId: string): Promise<void> {
  return run(async () => {
    const status = usePushStatus.getState();
    if (!browserCanPush()) return status.set('unsupported');

    const { config, reason } = await webConfig();
    if (!config) return status.set('not-set-up', reason);
    if (Notification.permission === 'denied') return status.set('blocked');
    if (Notification.permission === 'granted' && optedIn(userId)) return connect(config);
    status.set('off');
  });
}

/**
 * The permission prompt is requested before anything is awaited: browsers only show it while
 * the click that asked for it is still fresh.
 */
export function enablePush(userId: string): Promise<void> {
  const permission = Notification.requestPermission();
  return run(async () => {
    const answer = await permission;
    if (answer === 'denied') return usePushStatus.getState().set('blocked');
    if (answer !== 'granted') return usePushStatus.getState().set('off', 'The prompt was closed without an answer.');
    // Before connecting, so a failed first attempt is retried on the next load.
    storage.set(optInKey(userId), '1');
    await connect();
  });
}

/** Off for this user in this browser: removed from Blocks, and the Firebase subscription dropped. */
export function disablePush(userId: string): Promise<void> {
  return run(async () => {
    storage.remove(optInKey(userId));
    const token = storage.get(TOKEN_KEY);
    storage.remove(TOKEN_KEY);
    if (token) await removeQuietly(token);
    if (session) await session.fm.deleteToken(session.messaging).catch(() => false);
    usePushStatus.getState().set('off');
  });
}

/**
 * Sign-out: the device leaves the user before the session does, because removing it needs the
 * session. The opt-in stays, so signing back in re-registers this browser on its own. Never
 * throws — a failed removal must not hold up signing out.
 */
export async function forgetPushDevice(): Promise<void> {
  const token = storage.get(TOKEN_KEY);
  storage.remove(TOKEN_KEY);
  usePushStatus.setState({ state: 'idle', detail: null, projectId: null, token: null, received: [] });
  if (token) await removeQuietly(token);
}
