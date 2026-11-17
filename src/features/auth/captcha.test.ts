import { describe, expect, it } from 'vitest';
import { BlocksError } from '@/lib/blocks-client';
import { mockFetch } from '@/test/mock-fetch';
import { CAPTCHA_CONFIG_KEY, captchaSiteKeyFromError, getCaptchaConfig, isCaptchaError } from './captcha';

const LOGIN = 'https://blocksapi.example.com/iam/v4/auth/login';
const rejected = (body: unknown) => new BlocksError(400, LOGIN, body);

describe('CAPTCHA_CONFIG_KEY', () => {
  it('is a stable query key', () => {
    expect(CAPTCHA_CONFIG_KEY).toEqual(['auth', 'captcha-config']);
  });
});

describe('getCaptchaConfig', () => {
  it('asks oidc-ui-config for this project and returns the public half', async () => {
    const captcha = { key: 'site-key', provider: 'recaptcha', generator: 'EasyCaptchaGenerator' };
    const http = mockFetch({ body: { captcha, other: 'ignored' } });

    await expect(getCaptchaConfig()).resolves.toEqual(captcha);

    expect(http.last()).toMatchObject({
      method: 'GET',
      url: 'https://blocksapi.example.com/iam/v4/idp/oidc-ui-config?tenantId=test-project-key',
    });
    expect(http.last().headers).toEqual({ 'x-blocks-key': 'test-project-key', accept: 'application/json' });
  });

  it.each([
    ['no captcha block', {}],
    ['a null captcha block', { captcha: null }],
    ['a captcha block without a key', { captcha: { key: '', provider: 'recaptcha' } }],
  ])('is null for %s', async (_label, body) => {
    mockFetch({ body });
    await expect(getCaptchaConfig()).resolves.toBeNull();
  });

  it('is null for an empty answer', async () => {
    mockFetch({ status: 204 });
    await expect(getCaptchaConfig()).resolves.toBeNull();
  });
});

describe('isCaptchaError', () => {
  it.each([
    ['captcha_enabled in an object body', rejected({ error: 'captcha_enabled' }), true],
    ['captcha_invalid in an object body', rejected({ error: 'captcha_invalid' }), true],
    ['captcha_enabled in a JSON-string body', rejected('{"error":"captcha_enabled"}'), true],
    ['a credentials failure', rejected({ error: 'invalid_username_password' }), false],
    ['a body without a code', rejected({ error_description: 'captcha_enabled' }), false],
    ['a plain-text body', rejected('captcha_enabled'), false],
    ['a null body', rejected(null), false],
    ['a plain Error', new Error('captcha_enabled'), false],
  ])('%s → %s', (_label, error, expected) => {
    expect(isCaptchaError(error)).toBe(expected);
  });
});

describe('captchaSiteKeyFromError', () => {
  it.each([
    ['the snake_case field', rejected({ error: 'captcha_enabled', captcha_site_key: 'k1' }), 'k1'],
    ['the camelCase field', rejected({ error: 'captcha_enabled', captchaSiteKey: 'k2' }), 'k2'],
    ['snake_case over camelCase', rejected({ captcha_site_key: 'k1', captchaSiteKey: 'k2' }), 'k1'],
    ['a JSON-string body', rejected('{"captcha_site_key":"k3"}'), 'k3'],
    ['a numeric key, as a string', rejected({ captcha_site_key: 123 }), '123'],
  ])('reads %s', (_label, error, expected) => {
    expect(captchaSiteKeyFromError(error)).toBe(expected);
  });

  it.each([
    ['no key', rejected({ error: 'captcha_enabled' })],
    ['an empty key', rejected({ captcha_site_key: '' })],
    ['a plain-text body', rejected('nope')],
    ['a plain Error', new Error('x')],
  ])('is null for %s', (_label, error) => {
    expect(captchaSiteKeyFromError(error)).toBeNull();
  });
});
