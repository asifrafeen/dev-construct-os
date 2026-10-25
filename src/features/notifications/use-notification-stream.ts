import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection } from '@microsoft/signalr';
import { BLOCKS } from '@/lib/env';
import { useMe } from '@/features/users/hooks';
import { INBOX_KEY } from './hooks';
import { useRealtimeStatus } from './realtime';

/**
 * Live notifications over the Logic notifier's SignalR hub.
 *
 * How the hub expects to be used (blocks-logic NotificationHub):
 *   - `[Authorize]`: the session cookie authenticates it, the same as any API call. The
 *     negotiate request is a fetch, so `withCredentials` carries the cookie; the WebSocket
 *     upgrade carries it automatically.
 *   - The tenant is resolved like every `/api/*` request, but a WebSocket cannot set
 *     headers — so `x-blocks-key` rides in the query string, which the tenant middleware
 *     also reads.
 *   - Connecting only registers the connection. `Subscribe(json)` is what binds it to a
 *     user id and/or subscription filters; until then nothing is delivered.
 *   - The server invokes whatever method name the notification configuration's
 *     `NotifyMethod` says (the platform's tests use `ReceiveNotification`). Rather than guess,
 *     every invocation is captured — see `captureAll` — and shown on the Notifications page.
 *
 * Set `VITE_BLOCKS_NOTIFIER_REALTIME=false` to switch it off.
 */

const HUB_URL = `${BLOCKS.apiUrl}/logic/v4/notificationHub?x-blocks-key=${encodeURIComponent(BLOCKS.projectKey)}`;
const KNOWN_METHODS = (import.meta.env.VITE_BLOCKS_NOTIFY_METHODS || 'ReceiveNotification')
  .split(',')
  .map((m: string) => m.trim())
  .filter(Boolean);

/**
 * The JS client has no wildcard `on()`. Its private dispatcher sees every invocation
 * before looking up a handler, so wrapping it is the only way to observe a method whose
 * name this app was never told. Guarded: if the private member is gone in a future client
 * version, only the catch-all stops working and the named handlers still fire.
 */
function captureAll(connection: HubConnection, onAny: (method: string, args: unknown[]) => void) {
  const c = connection as unknown as {
    _invokeClientMethod?: (msg: { target: string; arguments: unknown[] }) => unknown;
  };
  const original = c._invokeClientMethod;
  if (typeof original !== 'function') return false;
  c._invokeClientMethod = function (msg) {
    try {
      onAny(msg.target, msg.arguments);
    } catch {
      /* observing must never break delivery */
    }
    return original.call(this, msg);
  };
  return true;
}

export function useNotificationStream() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const userId = me?.itemId;

  useEffect(() => {
    const status = useRealtimeStatus.getState();
    if (import.meta.env.VITE_BLOCKS_NOTIFIER_REALTIME === 'false') {
      status.set('off', 'disabled by VITE_BLOCKS_NOTIFIER_REALTIME');
      return;
    }
    if (!userId || !BLOCKS.apiUrl) return;

    const connection = new HubConnectionBuilder()
      .withUrl(HUB_URL, { withCredentials: true })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    const onEvent = (method: string, args: unknown[]) => {
      useRealtimeStatus.getState().push(method, args);
      void qc.invalidateQueries({ queryKey: INBOX_KEY });
    };

    const capturing = captureAll(connection, onEvent);
    // Named handlers keep the client from logging "no client method" for the expected
    // ones; when the catch-all is active they must not record the event a second time.
    for (const m of KNOWN_METHODS) connection.on(m, (...args: unknown[]) => !capturing && onEvent(m, args));

    const subscribe = () =>
      connection.invoke('Subscribe', JSON.stringify({ UserIds: [userId], SubscriptionFilters: [] }));

    connection.onreconnecting((e) => useRealtimeStatus.getState().set('reconnecting', e?.message ?? null));
    connection.onreconnected(async (id) => {
      useRealtimeStatus.getState().setConnectionId(id ?? null);
      // A reconnect is a new connection id on the server; the subscription does not carry over.
      await subscribe().catch(() => undefined);
      useRealtimeStatus.getState().set('connected');
    });
    connection.onclose((e) => {
      useRealtimeStatus.getState().setConnectionId(null);
      useRealtimeStatus.getState().set(e ? 'failed' : 'off', e?.message ?? null);
    });

    let cancelled = false;
    status.set('connecting');
    connection
      .start()
      .then(async () => {
        if (cancelled) return;
        useRealtimeStatus.getState().setConnectionId(connection.connectionId ?? null);
        await subscribe();
        useRealtimeStatus.getState().set('connected', capturing ? null : `listening for ${KNOWN_METHODS.join(', ')}`);
      })
      .catch((e: unknown) => {
        if (!cancelled) useRealtimeStatus.getState().set('failed', e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      if (connection.state !== HubConnectionState.Disconnected) void connection.stop();
    };
  }, [userId, qc]);
}
