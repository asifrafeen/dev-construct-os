import { describe, expect, it, vi } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import {
  MAGIC_LINK_TYPE,
  UTIL_BASE,
  docJobs,
  geolocation,
  magicLinks,
  payments,
  pdf,
  sequences,
  settle,
  sms,
  subscriptions,
  type MagicLinkInput,
} from './api';

const UTIL = 'https://blocksapi.example.com/utilities/v4';
const PK = 'test-project-key';

describe('UTIL_BASE', () => {
  it('sits under the gateway without the service /api prefix', () => {
    expect(UTIL_BASE).toBe(UTIL);
  });
});

describe('magicLinks', () => {
  const input: MagicLinkInput = {
    type: MAGIC_LINK_TYPE.Redirect,
    uri: 'https://app.example.com/welcome',
    usageLimit: 1,
    expiryLifeSpan: 0,
    userCanLogin: true,
    persistent: false,
  };

  it('creates a link with the project key in the body', async () => {
    const http = mockFetch({ body: { isSuccess: true, linkId: 'l1', shortUri: 'https://s.example/l1' } });
    await expect(magicLinks.create(input)).resolves.toEqual({ isSuccess: true, linkId: 'l1', shortUri: 'https://s.example/l1' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${UTIL}/MagicLink/CreateLink` });
    expect(http.last().body).toEqual({ ...input, projectKey: PK });
  });

  it('lists from page 0 by 20, leaving out an empty search', async () => {
    const http = mockFetch({ body: { data: [], totalCount: 0 } });
    await magicLinks.list();
    expect(http.last()).toMatchObject({
      method: 'GET',
      url: `${UTIL}/MagicLink/GetLinks?PageNumber=0&PageSize=20&ProjectKey=${PK}`,
    });

    await magicLinks.list({ searchText: '' });
    expect(http.last().url).toBe(`${UTIL}/MagicLink/GetLinks?PageNumber=0&PageSize=20&ProjectKey=${PK}`);
  });

  it('lists with paging and a search', async () => {
    const http = mockFetch();
    await magicLinks.list({ pageNumber: 2, pageSize: 5, searchText: 'promo code' });
    expect(http.last().url).toBe(`${UTIL}/MagicLink/GetLinks?PageNumber=2&PageSize=5&ProjectKey=${PK}&SearchText=promo+code`);
  });

  it('reads one link by id', async () => {
    const http = mockFetch({ body: { data: { itemId: 'l1' } } });
    await expect(magicLinks.get('l1')).resolves.toEqual({ data: { itemId: 'l1' } });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${UTIL}/MagicLink/GetLink?ItemId=l1&ProjectKey=${PK}` });
  });

  it('removes several links at once', async () => {
    const http = mockFetch({ body: { removedCount: 2 } });
    await expect(magicLinks.remove(['l1', 'l2'])).resolves.toEqual({ removedCount: 2 });
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${UTIL}/MagicLink/RemoveLinks`,
      body: { linkIds: ['l1', 'l2'], projectKey: PK },
    });
  });

  it('builds the anonymous invoke URL without a request', () => {
    const http = mockFetch();
    expect(magicLinks.invokeUrl('a/b c')).toBe(`${UTIL}/MagicLink/Invoke/a%2Fb%20c?projectKey=${PK}`);
    expect(http.requests).toHaveLength(0);
  });
});

describe('sequences', () => {
  it('asks for the next decimal number by default', async () => {
    const http = mockFetch({ body: { context: 'orders', currentNumber: 7 } });
    await expect(sequences.next('orders')).resolves.toEqual({ context: 'orders', currentNumber: 7 });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${UTIL}/Sequence/Next?Context=orders&ProjectKey=${PK}` });
  });

  it('asks for a hex number when told to', async () => {
    const http = mockFetch();
    await sequences.next('orders', true);
    expect(http.last().url).toBe(`${UTIL}/Sequence/NextHex?Context=orders&ProjectKey=${PK}`);
  });

  it('resets a context to a value', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await sequences.reset('orders', 100);
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${UTIL}/Sequence/Reset`,
      body: { context: 'orders', value: 100, projectKey: PK },
    });
  });
});

describe('geolocation.locate', () => {
  it('repeats IpAddresses for each address', async () => {
    const http = mockFetch({ body: { success: true, data: [{ countryCode: 'CH' }] } });
    await expect(geolocation.locate(['1.1.1.1', '8.8.8.8'])).resolves.toEqual({ success: true, data: [{ countryCode: 'CH' }] });
    expect(http.last()).toMatchObject({
      method: 'GET',
      url: `${UTIL}/Geolocation/LocateIp?IpAddresses=1.1.1.1&IpAddresses=8.8.8.8`,
    });
  });

  it('sends at most ten addresses', async () => {
    const http = mockFetch();
    const ips = Array.from({ length: 12 }, (_, i) => `10.0.0.${i}`);
    await geolocation.locate(ips);
    expect(new URL(http.last().url).searchParams.getAll('IpAddresses')).toEqual(ips.slice(0, 10));
  });
});

describe('pdf.fromHtml', () => {
  it('turns page numbering off unless asked and adds the project key', async () => {
    const http = mockFetch({ body: { fileId: 'f1', isSuccess: true } });
    await expect(pdf.fromHtml({ htmlContent: '<p>hi</p>', outputFileName: 'hi.pdf' })).resolves.toEqual({ fileId: 'f1', isSuccess: true });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${UTIL}/PdfGenerator/CreateSinglePdfFromHtml` });
    expect(http.last().body).toEqual({
      isPageNumberEnabled: false,
      isTotalPageCountEnabled: false,
      htmlContent: '<p>hi</p>',
      outputFileName: 'hi.pdf',
      projectKey: PK,
    });
  });

  it('keeps the numbering choices of the caller', async () => {
    const http = mockFetch();
    await pdf.fromHtml({ htmlContent: 'x', outputFileName: 'x.pdf', isPageNumberEnabled: true, isTotalPageCountEnabled: true });
    expect(http.last().body).toMatchObject({ isPageNumberEnabled: true, isTotalPageCountEnabled: true });
  });
});

describe('docJobs', () => {
  it('starts a job on the job route with any extra options', async () => {
    const http = mockFetch({ body: { success: true, data: { jobId: 'j1' } } });
    await expect(docJobs.start('document-conversions', ['f1'], { targetFormat: 'pdf' })).resolves.toEqual({
      success: true,
      data: { jobId: 'j1' },
    });
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${UTIL}/document-conversions`,
      body: { fileIds: ['f1'], targetFormat: 'pdf' },
    });

    await docJobs.start('pdf-ingestions', ['f2']);
    expect(http.last()).toMatchObject({ url: `${UTIL}/pdf-ingestions`, body: { fileIds: ['f2'] } });
  });

  it('polls status on the job status route', async () => {
    const http = mockFetch({ body: { success: true, data: { results: [{ status: 2 }] } } });
    await docJobs.status('pdf-signature-validations', ['f1', 'f2']);
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${UTIL}/pdf-signature-validations/status`,
      body: { fileIds: ['f1', 'f2'] },
    });
  });
});

describe('sms', () => {
  it('sends a plain message', async () => {
    const http = mockFetch({ body: { isSuccess: true, messageId: 'm1' } });
    await expect(sms.send(['+41790000000'], 'Hello')).resolves.toEqual({ isSuccess: true, messageId: 'm1' });
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${UTIL}/Sms/Send`,
      body: { destinationNumbers: ['+41790000000'], messageText: 'Hello' },
    });
  });

  it('sends by template', async () => {
    const http = mockFetch();
    await sms.sendByTemplate(['+41790000000'], 'otp', 'en', { code: '1234' });
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${UTIL}/Sms/SendByTemplate`,
      body: { destinationNumbers: ['+41790000000'], templateName: 'otp', language: 'en', dataContext: { code: '1234' } },
    });
  });

  it('reads the first 50 templates and the provider configuration', async () => {
    const http = mockFetch({ body: { items: [], totalCount: 0 } });
    await sms.templates();
    expect(http.last()).toMatchObject({ method: 'GET', url: `${UTIL}/Sms/GetTemplates?Page=1&PageSize=50` });

    await sms.provider();
    expect(http.last()).toMatchObject({ method: 'GET', url: `${UTIL}/Sms/GetProviderConfiguration` });
  });

  it('saves a template as given', async () => {
    const http = mockFetch();
    const template = { templateId: 't1', name: 'otp', language: 'en', body: 'Your code is {{code}}' };
    await sms.saveTemplate(template);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${UTIL}/Sms/SaveTemplate`, body: template });
  });
});

describe('payments', () => {
  const input = { providerName: 'stripe', amount: 1000, currencyCode: 'CHF', orderId: 'o1' };

  it('creates a payment without an idempotency key by default', async () => {
    const http = mockFetch({ body: { success: true, data: { redirectUrl: 'https://pay.example/1' } } });
    await expect(payments.create(input)).resolves.toEqual({ success: true, data: { redirectUrl: 'https://pay.example/1' } });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${UTIL}/payments/create`, body: input });
    expect(http.last().headers).not.toHaveProperty('Idempotency-Key');
  });

  it('sends the idempotency key as a header when given', async () => {
    const http = mockFetch();
    await payments.create(input, 'idem-1');
    expect(http.last().headers).toMatchObject({ 'Idempotency-Key': 'idem-1', 'x-blocks-key': PK });
  });

  it('reads one payment, encoding the id', async () => {
    const http = mockFetch();
    await payments.get('pay/1');
    expect(http.last()).toMatchObject({ method: 'GET', url: `${UTIL}/payments/pay%2F1` });
  });

  it('lists 25 payments unless told otherwise', async () => {
    const http = mockFetch();
    await payments.list();
    expect(http.last().url).toBe(`${UTIL}/payments?pageSize=25`);
    await payments.list(5);
    expect(http.last().url).toBe(`${UTIL}/payments?pageSize=5`);
  });

  it('reads payment methods and providers', async () => {
    const http = mockFetch();
    await payments.paymentMethods();
    expect(http.last()).toMatchObject({ method: 'GET', url: `${UTIL}/payments/payment-methods` });
    await payments.providers();
    expect(http.last()).toMatchObject({ method: 'GET', url: `${UTIL}/payments/providers` });
  });
});

describe('subscriptions', () => {
  it.each([
    ['entitlements', () => subscriptions.entitlements(), `${UTIL}/entitlements`],
    ['entitlement', () => subscriptions.entitlement('max seats'), `${UTIL}/entitlements/max%20seats`],
    ['mine', () => subscriptions.mine(), `${UTIL}/subscriptions/mine`],
    ['current', () => subscriptions.current(), `${UTIL}/subscriptions/current`],
    ['usageMine', () => subscriptions.usageMine(), `${UTIL}/subscription-usage/mine`],
    ['plans', () => subscriptions.plans(), `${UTIL}/subscription-plans?status=Active`],
  ])('%s is a GET on its route', async (_name, call, url) => {
    const http = mockFetch({ body: { success: true, data: {} } });
    await expect(call()).resolves.toEqual({ success: true, data: {} });
    expect(http.last()).toMatchObject({ method: 'GET', url, body: undefined });
  });

  it('records usage with a fresh idempotency key and enforcement off', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-2222-3333-4444-555555555555');
    const http = mockFetch();
    await subscriptions.recordUsage('api-calls', 3);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${UTIL}/subscription-usage` });
    expect(http.last().body).toEqual({
      meterKey: 'api-calls',
      quantity: 3,
      idempotencyKey: '11111111-2222-3333-4444-555555555555',
      enforce: false,
      metadata: {},
    });
  });

  it('uses a different idempotency key for each call', async () => {
    const http = mockFetch();
    await subscriptions.recordUsage('api-calls', 1);
    await subscriptions.recordUsage('api-calls', 1);
    const keys = http.requests.map((r) => (r.body as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe('settle', () => {
  it('wraps a resolved call as ok', async () => {
    mockFetch({ body: { isSuccess: true } });
    await expect(settle(sms.provider())).resolves.toEqual({ ok: true, status: 200, body: { isSuccess: true } });
  });

  it('turns a Blocks error into data', async () => {
    mockFetch({ status: 422, body: { error: { code: 'invalid' } } });
    await expect(settle(sms.send([], 'x'))).resolves.toEqual({ ok: false, status: 422, body: { error: { code: 'invalid' } } });
  });

  it('rethrows anything that is not a Blocks error', async () => {
    await expect(settle(Promise.reject(new TypeError('Failed to fetch')))).rejects.toThrow(TypeError);
  });
});
