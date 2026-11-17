import { describe, expect, it } from 'vitest';
import { BlocksError } from '@/lib/blocks-client';
import { mockFetch } from '@/test/mock-fetch';
import {
  ORGANIZATION_CONFIG_KEY,
  SIGNUP_ORG_LIMITS,
  SIGNUP_SETTINGS_KEY,
  activate,
  activatedWithSession,
  attributeKeyProblem,
  checkOrganizationName,
  coerceAttributeValue,
  emailSignupAllowed,
  getOrganizationConfig,
  getSignupSettings,
  logout,
  orgSignupAllowed,
  recoverAccount,
  resetPassword,
  safeForwardedTo,
  signUp,
  signupErrorMessage,
  signupFailure,
} from './api';

const IAM = 'https://blocksapi.example.com/iam/v4';
const GENERIC = 'The request could not be completed. Please try again.';
const signupError = (body: unknown, status = 400) => new BlocksError(status, `${IAM}/auth/signup`, body);

describe('query keys', () => {
  it('are stable', () => {
    expect(SIGNUP_SETTINGS_KEY).toEqual(['auth', 'signup-settings']);
    expect(ORGANIZATION_CONFIG_KEY).toEqual(['iam', 'organization-config']);
  });
});

describe('recoverAccount', () => {
  it('POSTs the address with the project as tenant', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await expect(recoverAccount('ada@example.com')).resolves.toBeUndefined();
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/auth/recover` });
    expect(http.last().body).toEqual({ email: 'ada@example.com', tenantId: 'test-project-key' });
    expect(http.last().headers).toMatchObject({ 'x-blocks-key': 'test-project-key', 'Content-Type': 'application/json' });
  });

  it('adds the captcha answer in camelCase only when there is one', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await recoverAccount('ada@example.com', 'answer');
    expect(http.last().body).toEqual({ email: 'ada@example.com', tenantId: 'test-project-key', captchaCode: 'answer' });
    await recoverAccount('ada@example.com', '');
    expect(http.last().body).not.toHaveProperty('captchaCode');
  });

  it('throws the field message from a 200 that reports failure', async () => {
    mockFetch({ body: { isSuccess: false, errors: { Email: 'Email is invalid.' } } });
    await expect(recoverAccount('nope')).rejects.toThrow('Email is invalid.');
  });
});

describe('getSignupSettings', () => {
  it('GETs the anonymous signup settings', async () => {
    const settings = { isSignUpEnable: true, isEmailPasswordSignUpEnabled: true, isSSoSignUpEnabled: false };
    const http = mockFetch({ body: settings });
    await expect(getSignupSettings()).resolves.toEqual(settings);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/iam/signup-settings` });
  });
});

describe('emailSignupAllowed', () => {
  it.each([
    [{ isSignUpEnable: true, isEmailPasswordSignUpEnabled: true, isSSoSignUpEnabled: false }, true],
    [{ isSignUpEnable: false, isEmailPasswordSignUpEnabled: true, isSSoSignUpEnabled: true }, false],
    [{ isSignUpEnable: true, isEmailPasswordSignUpEnabled: false, isSSoSignUpEnabled: true }, false],
    [null, false],
    [undefined, false],
  ])('%j → %s', (settings, expected) => {
    expect(emailSignupAllowed(settings)).toBe(expected);
  });
});

describe('getOrganizationConfig', () => {
  it('GETs the organization config', async () => {
    const http = mockFetch({ body: { isMultiOrgEnabled: true } });
    await expect(getOrganizationConfig()).resolves.toEqual({ isMultiOrgEnabled: true });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/iam/organizations/config` });
  });
});

describe('orgSignupAllowed', () => {
  const config = {
    isMultiOrgEnabled: true,
    allowOrgCreationFromSignup: true,
    allowOrgCreationFromPortal: false,
    allowOrgCreationFromCloud: false,
    allowOrgCreationFromConstruct: false,
  };

  it.each([
    ['both flags on', config, true],
    ['multi-org off', { ...config, isMultiOrgEnabled: false }, false],
    ['signup creation off', { ...config, allowOrgCreationFromSignup: false }, false],
    ['no config', null, false],
    ['an unloaded config', undefined, false],
  ])('%s → %s', (_label, value, expected) => {
    expect(orgSignupAllowed(value)).toBe(expected);
  });
});

describe('signUp', () => {
  it('POSTs a password-less signup with trimmed names and returns the new ids', async () => {
    const http = mockFetch({ body: { isSuccess: true, itemId: 'u1' } });
    await expect(
      signUp({ email: 'ada@example.com', firstName: ' Ada ', lastName: 'Lovelace ', phoneNumber: ' +41 ' }),
    ).resolves.toEqual({ itemId: 'u1', organizationId: null });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/auth/signup` });
    expect(http.last().body).toEqual({
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phoneNumber: '+41',
      isSsoSignup: false,
    });
  });

  it('drops blank fields and adds the captcha answer', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await expect(signUp({ email: 'ada@example.com', firstName: '  ', captchaCode: 'answer' })).resolves.toEqual({
      itemId: null,
      organizationId: null,
    });
    expect(http.last().body).toEqual({ email: 'ada@example.com', isSsoSignup: false, captchaCode: 'answer' });
  });

  it('sends the organization nested and as the legacy flat pair', async () => {
    const http = mockFetch({ body: { isSuccess: true, itemId: 'u1', organizationId: 'o1' } });
    const organization = { name: 'Acme', description: 'Anvils', currency: 'CHF' };
    await expect(signUp({ email: 'ada@example.com', organization })).resolves.toEqual({
      itemId: 'u1',
      organizationId: 'o1',
    });
    expect(http.last().body).toEqual({
      email: 'ada@example.com',
      isSsoSignup: false,
      createOrganizationDuringSignup: true,
      organization,
      organizationName: 'Acme',
      organizationDescription: 'Anvils',
    });
  });

  it('throws on a 200 that reports failure', async () => {
    mockFetch({ body: { isSuccess: false, errors: { Email: 'ada@example.com is already registered' } } });
    await expect(signUp({ email: 'ada@example.com' })).rejects.toThrow('ada@example.com is already registered');
  });

  it('lets a 400 through as a BlocksError', async () => {
    mockFetch({ status: 400, body: { isSuccess: false, errors: { Email: 'Email is required.' } } });
    await expect(signUp({ email: '' })).rejects.toBeInstanceOf(BlocksError);
  });
});

describe('SIGNUP_ORG_LIMITS', () => {
  it('mirrors the server-side validator', () => {
    expect(SIGNUP_ORG_LIMITS).toMatchObject({ name: 150, description: 500, maxAddresses: 5, attributeKey: 64 });
  });
});

describe('attributeKeyProblem', () => {
  it.each([
    ['', 'Name is required.'],
    ['   ', 'Name is required.'],
    ['x'.repeat(65), 'Keep it under 64 characters.'],
    ['$where', 'Cannot start with $.'],
    ['a.b', 'Cannot contain a dot.'],
  ])('rejects %j', (key, problem) => {
    expect(attributeKeyProblem(key)).toBe(problem);
  });

  it.each([['plan'], ['  plan  '], ['x'.repeat(64)], ['price$']])('accepts %j', (key) => {
    expect(attributeKeyProblem(key)).toBeNull();
  });
});

describe('coerceAttributeValue', () => {
  it.each<[string, string | number | boolean]>([
    ['true', true],
    ['false', false],
    [' true ', true],
    ['10', 10],
    [' 10 ', 10],
    ['-2.5', -2.5],
    ['0', 0],
    ['0123', '0123'],
    ['1.50', '1.50'],
    ['1e3', '1e3'],
    ['True', 'True'],
    ['', ''],
    ['hello', 'hello'],
  ])('%j → %j', (raw, expected) => {
    expect(coerceAttributeValue(raw)).toBe(expected);
  });
});

describe('signupFailure', () => {
  it('unpacks a person-step failure', () => {
    const failure = signupFailure(signupError({ isSuccess: false, errors: { Email: 'Email is required.' } }));
    expect(failure).toEqual({
      errors: { Email: 'Email is required.' },
      message: 'Email is required.',
      isOrganizationError: false,
      isNameTaken: false,
      nameSuggestions: [],
    });
  });

  it('flags a name clash and keeps only string suggestions', () => {
    const body = JSON.stringify({
      errors: { name_already_exists: 'Acme is taken' },
      organizationNameSuggestions: ['Acme 2', 7, 'Acme HQ', null],
    });
    expect(signupFailure(signupError(body))).toEqual({
      errors: { name_already_exists: 'Acme is taken' },
      message: 'Acme is taken',
      isOrganizationError: true,
      isNameTaken: true,
      nameSuggestions: ['Acme 2', 'Acme HQ'],
    });
  });

  it.each([
    ['multi_org_disabled', 'x'],
    ['OrganizationName', 'x'],
    ['Addresses', 'x'],
    ['Addresses[0].City', 'City is required'],
    ['Theme.PrimaryColor', 'Must be hex'],
    ['Email', 'Email invalid'],
    ['Email', '  EMAIL INVALID '],
  ])('routes %s (%j) to the organization step', (key, message) => {
    expect(signupFailure(signupError({ errors: { [key]: message } }))?.isOrganizationError).toBe(true);
  });

  it.each([
    ['Email', 'Email is required.'],
    ['FirstName', 'Too long'],
    ['addresses', 'case matters'],
  ])('keeps %s (%j) on the person step', (key, message) => {
    expect(signupFailure(signupError({ errors: { [key]: message } }))?.isOrganizationError).toBe(false);
  });

  it('tolerates a null message under the ambiguous Email key', () => {
    const failure = signupFailure(signupError({ errors: { Email: null } }));
    expect(failure).toMatchObject({ message: GENERIC, isOrganizationError: false, isNameTaken: false });
  });

  it('is an organization error when any key is', () => {
    const failure = signupFailure(signupError({ errors: { FirstName: 'Too long', Currency: 'Three letters' } }));
    expect(failure?.isOrganizationError).toBe(true);
    expect(failure?.message).toBe('Too long');
  });

  it.each([
    ['a non-BlocksError', new Error('x')],
    ['a plain-text body', signupError('Bad request')],
    ['a null body', signupError(null)],
    ['a numeric body', signupError(400)],
    ['no errors', signupError({ isSuccess: false })],
    ['an empty errors map', signupError({ isSuccess: false, errors: {} })],
  ])('is null for %s', (_label, error) => {
    expect(signupFailure(error)).toBeNull();
  });
});

describe('checkOrganizationName', () => {
  it('asks whether the encoded name is free and returns the answer', async () => {
    const http = mockFetch({ body: { isAvailable: false, suggestions: ['Acme & Co 2', 3] } });
    await expect(checkOrganizationName('Acme & Co')).resolves.toEqual({
      isAvailable: false,
      suggestions: ['Acme & Co 2'],
    });
    expect(http.last()).toMatchObject({
      method: 'GET',
      url: `${IAM}/iam/organizations/name/available?name=Acme%20%26%20Co`,
    });
    expect(http.last().headers.accept).toBe('application/json');
  });

  it('defaults the suggestions to an empty list', async () => {
    mockFetch({ body: { isAvailable: true } });
    await expect(checkOrganizationName('Acme')).resolves.toEqual({ isAvailable: true, suggestions: [] });
  });

  it.each([
    ['an HTML page', { body: '<!doctype html><html></html>' }],
    ['an empty answer', { status: 204 }],
    ['an answer without isAvailable', { body: { available: true } }],
    ['a non-boolean isAvailable', { body: { isAvailable: 'yes' } }],
    ['a failed request', { status: 404, body: { error: 'not_found' } }],
  ])('says nothing (null) for %s', async (_label, reply) => {
    mockFetch(reply);
    await expect(checkOrganizationName('Acme')).resolves.toBeNull();
  });
});

describe('signupErrorMessage', () => {
  it.each([
    ['sign-up is disabled.', 'This project is not accepting new accounts right now.'],
    ['sso sign-up is disabled.', 'This project is not accepting new accounts right now.'],
    [
      'Organization creation is disabled because multi-organization mode is off.',
      'This project cannot create organizations. Ask an administrator to add you to an existing one.',
    ],
    ['ada@example.com is already registered', 'ada@example.com is already registered'],
  ])('words %j for a person', (message, expected) => {
    expect(signupErrorMessage(signupError({ isSuccess: false, errors: { Signup: message } }))).toBe(expected);
  });

  it('falls back to the auth wording for anything not account-shaped', () => {
    expect(signupErrorMessage(signupError({ error: 'captcha_invalid' }))).toBe(
      'That CAPTCHA response was rejected. Solve the new challenge and try again.',
    );
    expect(signupErrorMessage(new Error('Failed to fetch'))).toBe('Failed to fetch');
  });
});

describe('resetPassword', () => {
  it('POSTs the code and password, logging out other devices by default', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await expect(resetPassword({ code: 'c1', password: 'pw' })).resolves.toBeUndefined();
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/auth/reset-password` });
    expect(http.last().body).toEqual({ code: 'c1', password: 'pw', logoutFromAllDevices: true });
  });

  it('honours an explicit choice to stay signed in elsewhere', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await resetPassword({ code: 'c1', password: 'pw', logoutFromAllDevices: false });
    expect(http.last().body).toEqual({ code: 'c1', password: 'pw', logoutFromAllDevices: false });
  });

  it('throws on a 200 that reports failure', async () => {
    mockFetch({ body: { isSuccess: false, errors: { Code: 'The code has expired.' } } });
    await expect(resetPassword({ code: 'old', password: 'pw' })).rejects.toThrow('The code has expired.');
  });

  it('throws the generic message when IAM gives no reason', async () => {
    mockFetch({ body: {} });
    await expect(resetPassword({ code: 'c1', password: 'pw' })).rejects.toThrow(GENERIC);
  });
});

describe('logout', () => {
  it('POSTs an empty body to the capital-L Logout route', async () => {
    const http = mockFetch({ status: 204 });
    await expect(logout()).resolves.toBeUndefined();
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/auth/Logout`, body: {} });
    expect(http.last().headers).toMatchObject({ accept: 'application/json', 'x-blocks-key': 'test-project-key' });
  });
});

describe('activate', () => {
  const input = { code: 'inv-1', password: 'pw', firstName: 'Ada', lastName: 'Lovelace' };

  it('POSTs the invitation with credentials included and the IAM defaults filled in', async () => {
    const http = mockFetch({ body: { isSuccess: true, itemId: 'u1' } });
    await expect(activate(input)).resolves.toEqual({ isSuccess: true, itemId: 'u1' });

    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/auth/activate` });
    expect(http.last().headers).toEqual({ 'Content-Type': 'application/json', 'x-blocks-key': 'test-project-key' });
    expect(http.last().body).toEqual({ captchaCode: '', mailPurpose: '', preventPostEvent: false, ...input });
    expect(http.fetchMock.mock.calls[0][1]?.credentials).toBe('include');
  });

  it('returns the session fields when the link signs the invitee in', async () => {
    const body = { isSuccess: true, token_type: 'Bearer', cookie_set: true, forwardedTo: '/welcome' };
    mockFetch({ body });
    await expect(activate(input)).resolves.toEqual(body);
  });

  it('resolves to an empty object when the success has no JSON body', async () => {
    mockFetch({ body: 'OK' });
    await expect(activate(input)).resolves.toEqual({});
  });

  it('throws with the status and the response text', async () => {
    mockFetch({ status: 400, body: { errors: { Code: 'Invalid code' } } });
    await expect(activate(input)).rejects.toThrow('activation failed (400): {"errors":{"Code":"Invalid code"}}');
  });

  it('says so when a failure has no body', async () => {
    mockFetch({ status: 500, body: '' });
    await expect(activate(input)).rejects.toThrow('activation failed (500): no response body');
  });
});

describe('activatedWithSession', () => {
  it.each([
    [{ token_type: 'Bearer', cookie_set: true }, true],
    [{ id_token: 'jwt' }, true],
    [{ token_type: 'Bearer', cookie_set: false }, false],
    [{ isSuccess: true, access_token: 'jwt' }, false],
    [{ isSuccess: true }, false],
  ])('%j → %s', (res, expected) => {
    expect(activatedWithSession(res)).toBe(expected);
  });
});

describe('safeForwardedTo', () => {
  it.each([
    ['/projects', '/projects'],
    ['/projects?tab=1#x', '/projects?tab=1#x'],
    ['/', '/'],
  ])('keeps the in-app path %j', (value, expected) => {
    expect(safeForwardedTo(value)).toBe(expected);
  });

  it.each([['//evil.example.com'], ['https://evil.example.com'], ['projects'], [''], [null], [undefined]])(
    'drops %j',
    (value) => {
      expect(safeForwardedTo(value)).toBeNull();
    },
  );
});
