import { describe, expect, it, vi } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import {
  NOTIFICATION_CONFIG_BASE,
  NOTIFIER_BASE,
  describeNotification,
  effectiveAudience,
  notificationId,
  notifier,
  reachesConsumers,
  type InboxNotification,
  type NotificationConfig,
} from './api';

const config = (extra: Partial<NotificationConfig> = {}): NotificationConfig => ({ itemId: 'c1', name: 'c', ...extra });

describe('bases', () => {
  it('lives under logic/v4', () => {
    expect(NOTIFIER_BASE).toBe('https://blocksapi.example.com/logic/v4/Notifier');
    expect(NOTIFICATION_CONFIG_BASE).toBe('https://blocksapi.example.com/logic/v4/Notification');
  });
});

describe('reachesConsumers', () => {
  it.each([
    [0, true],
    [1, false],
    [2, true],
    [undefined, true],
  ])('scope %j → %j', (scope, expected) => {
    expect(reachesConsumers(config({ scope }))).toBe(expected);
  });
});

describe('effectiveAudience', () => {
  const own = { level: 2, roles: ['admin'] };
  const fallback = { level: 1 };

  it('uses the configuration’s own audience', () => {
    expect(effectiveAudience(config({ audience: own, defaultAudience: fallback }))).toBe(own);
  });

  it('uses the default audience when the configuration is locked', () => {
    const locked = config({ audience: own, defaultAudience: fallback, audienceLocked: true });
    expect(effectiveAudience(locked)).toBe(fallback);
  });

  it('uses the default audience when there is no own one', () => {
    expect(effectiveAudience(config({ audience: null, defaultAudience: fallback }))).toBe(fallback);
  });

  it('falls back to affected users only', () => {
    expect(effectiveAudience(config())).toEqual({ level: 0 });
    const lockedWithoutDefault = config({ audience: own, audienceLocked: true, defaultAudience: null });
    expect(effectiveAudience(lockedWithoutDefault)).toEqual({ level: 0 });
  });
});

describe('notificationId', () => {
  it('prefers id, then itemId, then an empty string', () => {
    expect(notificationId({ id: 'a', itemId: 'b' })).toBe('a');
    expect(notificationId({ itemId: 'b' })).toBe('b');
    expect(notificationId({})).toBe('');
  });
});

describe('describeNotification', () => {
  it.each<[string, InboxNotification, { title: string; body: string }]>([
    ['title/body', { payload: { title: 'Hi', body: 'There' } }, { title: 'Hi', body: 'There' }],
    ['Title/Body', { payload: { Title: 'Hi', Body: 'There' } }, { title: 'Hi', body: 'There' }],
    ['subject/message', { payload: { subject: 'S', message: 'M' } }, { title: 'S', body: 'M' }],
    ['Subject/Message', { payload: { Subject: 'S', Message: 'M' } }, { title: 'S', body: 'M' }],
    ['name/text', { payload: { name: 'N', text: 'T' } }, { title: 'N', body: 'T' }],
    ['a JSON string', { payload: '{"title":"From JSON","message":"parsed"}' }, { title: 'From JSON', body: 'parsed' }],
    ['plain text', { payload: 'just words' }, { title: 'Notification', body: 'just words' }],
    ['a JSON string holding a primitive', { payload: '42' }, { title: 'Notification', body: '42' }],
    ['a number', { payload: 42 }, { title: 'Notification', body: '42' }],
    ['no payload', {}, { title: 'Notification', body: '' }],
    ['numeric fields', { payload: { title: 7, body: 8 } }, { title: '7', body: '8' }],
    ['object fields', { payload: { title: { en: 'Hi' }, body: [1] } }, { title: '{"en":"Hi"}', body: '[1]' }],
    ['unknown keys', { payload: { orderId: 9 } }, { title: 'Notification', body: '{"orderId":9}' }],
    [
      'a null title',
      { payload: { title: null, Title: 'Second' } },
      { title: 'Second', body: '{"title":null,"Title":"Second"}' },
    ],
  ])('reads %s', (_label, notification, expected) => {
    expect(describeNotification(notification)).toEqual(expected);
  });

  it('prefers the denormalized payload over the payload', () => {
    expect(describeNotification({ denormalizedPayload: { title: 'D' }, payload: { title: 'P' } }).title).toBe('D');
    expect(describeNotification({ denormalizedPayload: null, payload: { title: 'P' } }).title).toBe('P');
  });
});

describe('notifier', () => {
  it('notify fills in the fields logic requires but never uses', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-2222-3333-4444-555555555555');

    const sent = notifier.notify({ configurationName: 'welcome', userIds: ['u1'], connectionId: '' });
    await expect(sent).resolves.toEqual({ isSuccess: true });
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${NOTIFIER_BASE}/Notify`,
      body: {
        configurationName: 'welcome',
        userIds: ['u1'],
        connectionId: 'construct-os',
        responseKey: 'construct-os',
        responseValue: '11111111-2222-3333-4444-555555555555',
      },
    });
  });

  it('notify keeps the caller’s own connection and response fields', async () => {
    const http = mockFetch();
    await notifier.notify({ configurationName: 'c', connectionId: 'conn', responseKey: 'k', responseValue: 'v' });
    expect(http.last().body).toMatchObject({ connectionId: 'conn', responseKey: 'k', responseValue: 'v' });
  });

  it('configurations reads the first 200', async () => {
    const http = mockFetch({ body: { totalCount: 1, configurations: [config()] } });
    await expect(notifier.configurations()).resolves.toEqual({ totalCount: 1, configurations: [config()] });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${NOTIFICATION_CONFIG_BASE}/Gets?Page=0&PageSize=200` });
  });

  it('inbox sends no query by default', async () => {
    const inbox = { notifications: [], totalNotificationsCount: 0, unReadNotificationsCount: 0 };
    const http = mockFetch({ body: inbox });
    await expect(notifier.inbox()).resolves.toEqual(inbox);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${NOTIFIER_BASE}/GetNotifications?` });
  });

  it('inbox maps every option onto the query string', async () => {
    const http = mockFetch();
    await notifier.inbox({ page: 0, pageSize: 10, isUnreadOnly: true, filter: 'a b', sortBy: 'CreatedTime' });
    expect(http.last().url).toBe(
      `${NOTIFIER_BASE}/GetNotifications?Page=0&PageSize=10&IsUnreadOnly=true&Filter=a+b` +
        '&Sort.Property=CreatedTime&Sort.IsDescending=true',
    );

    await notifier.inbox({ isUnreadOnly: false, sortBy: 'CreatedTime', sortDescending: false });
    expect(http.last().url).toBe(`${NOTIFIER_BASE}/GetNotifications?Sort.Property=CreatedTime&Sort.IsDescending=false`);
  });

  it('inbox ignores the sort direction without a sort property', async () => {
    const http = mockFetch();
    await notifier.inbox({ sortDescending: false });
    expect(http.last().url).toBe(`${NOTIFIER_BASE}/GetNotifications?`);
  });

  it('markRead and markAllRead post to their routes', async () => {
    const http = mockFetch();
    await notifier.markRead('n1');
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${NOTIFIER_BASE}/MarkNotificationAsRead`,
      body: { id: 'n1' },
    });

    await notifier.markAllRead();
    expect(http.last()).toMatchObject({ method: 'POST', url: `${NOTIFIER_BASE}/MarkAllNotificationAsRead`, body: {} });
  });

  it('unreadBySubscription puts the filter in the query string, newest first by default', async () => {
    const http = mockFetch({ body: [{ id: 'n1' }] });
    const unread = notifier.unreadBySubscription('u1', { context: 'orders', actionName: 'shipped', value: '9' });
    await expect(unread).resolves.toEqual([{ id: 'n1' }]);
    expect(http.last()).toMatchObject({
      method: 'GET',
      url:
        `${NOTIFIER_BASE}/GetUnreadNotificationsBySubscriptionFilter?UserId=u1&OrderBy=1` +
        '&SubscriptionFilterData.Context=orders' +
        '&SubscriptionFilterData.ActionName=shipped' +
        '&SubscriptionFilterData.Value=9',
    });
  });

  it('unreadBySubscription leaves out empty filter fields and honours orderBy', async () => {
    const http = mockFetch({ body: [] });
    await notifier.unreadBySubscription('u1', {}, 2);
    expect(http.last().url).toBe(`${NOTIFIER_BASE}/GetUnreadNotificationsBySubscriptionFilter?UserId=u1&OrderBy=2`);
  });

  it('pushWebConfig reads the project’s Firebase web config', async () => {
    const data = { apiKey: 'k', appId: 'a', messagingSenderId: 's', vapidKey: 'v', projectId: 'p' };
    const http = mockFetch({ body: { isSuccess: true, data } });
    await expect(notifier.pushWebConfig()).resolves.toEqual({ isSuccess: true, data });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${NOTIFIER_BASE}/push-web-config` });
  });

  it('registerDevice files a web device', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await expect(notifier.registerDevice('tok', 'Chrome on Windows')).resolves.toEqual({ isSuccess: true });
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${NOTIFIER_BASE}/devices`,
      body: { token: 'tok', platform: 'web', name: 'Chrome on Windows' },
    });
  });

  it('removeDevice deletes the device by its encoded token', async () => {
    const http = mockFetch({ status: 204 });
    await expect(notifier.removeDevice('a:b/c')).resolves.toBeNull();
    expect(http.last()).toMatchObject({ method: 'DELETE', url: `${NOTIFIER_BASE}/devices/a%3Ab%2Fc` });
  });
});
