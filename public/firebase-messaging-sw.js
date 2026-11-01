/**
 * Background web push for Construct OS: Blocks Notifier → Firebase Cloud Messaging → this worker.
 *
 * Plain JS in `public/` because a service worker cannot share the app bundle, and served from
 * the site root because that is where Firebase looks for it by default.
 *
 * Nothing project-specific is hard-coded. The page registers this file with the Firebase web
 * config in the query string (it reads that config from `GET /logic/v4/Notifier/push-web-config`,
 * where Blocks OS keeps it), plus the SDK version so the CDN build loaded here always matches the
 * `firebase` package in the bundle. See src/features/notifications/push.ts.
 *
 * While a tab of the app is visible, Firebase hands the message to that tab instead of showing
 * it here; the tab decides what to do with it.
 */

const params = new URL(self.location.href).searchParams;

// Only a plain x.y.z reaches importScripts — the version is the one value here that picks code.
const FALLBACK_SDK = '12.19.0';
const sdk = /^\d+\.\d+\.\d+$/.test(params.get('v') || '') ? params.get('v') : FALLBACK_SDK;

/** A page of this site, or null — a mobile deep link (`myapp://…`) must not be opened here. */
function sameSite(link) {
  if (typeof link !== 'string' || !link.trim()) return null;
  try {
    const url = new URL(link, self.location.origin);
    return url.origin === self.location.origin ? url.href : null;
  } catch {
    return null;
  }
}

async function focusOrOpen(href) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const exact = windows.find((w) => w.url === href);
  // The app's home is a "just bring me back" click: any open tab of the app will do.
  const any = href === new URL('/', self.location.origin).href ? windows[0] : undefined;
  const tab = exact || any;
  if (tab) return tab.focus();
  return self.clients.openWindow(href);
}

/**
 * Registered before Firebase's own listener on purpose. Firebase opens the notification's web
 * link (`webpush.fcm_options.link`, set in Blocks OS) and stops the event there; without a web
 * link it closes the notification and does nothing. This fills that gap: open the app link from
 * `data.link` when it is a page of this site, else the app's home.
 */
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  const fcm = data.FCM_MSG; // where the Firebase SDK keeps the message it displayed
  const webLink = fcm && ((fcm.fcmOptions && fcm.fcmOptions.link) || (fcm.notification && fcm.notification.click_action));
  if (webLink) return; // Firebase's listener opens it

  event.notification.close();
  const href = sameSite(fcm && fcm.data && fcm.data.link) || sameSite(data.link) || new URL('/', self.location.origin).href;
  event.waitUntil(focusOrOpen(href));
});

// A new worker takes over at once, so a changed config (new query string) applies without
// waiting for every tab to close. Its scope controls no page, so there is nothing to claim.
self.addEventListener('install', () => self.skipWaiting());

importScripts(
  `https://www.gstatic.com/firebasejs/${sdk}/firebase-app-compat.js`,
  `https://www.gstatic.com/firebasejs/${sdk}/firebase-messaging-compat.js`,
);

const config = {
  apiKey: params.get('apiKey'),
  appId: params.get('appId'),
  messagingSenderId: params.get('messagingSenderId'),
  projectId: params.get('projectId'),
};

// Without a config there is nothing to receive; the worker stays inert rather than throwing.
// With one, `messaging()` adds Firebase's push and click listeners and shows background
// notifications itself — Blocks always sends a `notification` block, so no handler is needed.
if (config.apiKey && config.appId && config.messagingSenderId && config.projectId) {
  firebase.initializeApp(config);
  firebase.messaging();
}
