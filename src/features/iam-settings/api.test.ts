import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '@/lib/blocks-client';
import { mockFetch } from '@/test/mock-fetch';
import {
  ORG_CONFIG_KEYS,
  firstArray,
  iamSettings,
  pick,
  type ClientCredentialInput,
  type MfaPolicyInput,
  type OrgConfigAdmin,
  type SignupSettings,
} from './api';

const IAM_BASE = 'https://blocksapi.example.com/iam/v4';
const IAM = `${IAM_BASE}/iam`;
const AUTH = `${IAM_BASE}/auth`;

describe('pick', () => {
  it('keeps only the listed keys that are set, nulls included', () => {
    const stored = {
      itemId: 'cfg-1',
      isMultiOrgEnabled: true,
      consentForMultiOrgEnable: undefined,
      signupAutoJoinOrganizationId: null,
      createdDate: '2026-01-01',
    };
    expect(pick<OrgConfigAdmin>(stored, ORG_CONFIG_KEYS)).toEqual({ isMultiOrgEnabled: true, signupAutoJoinOrganizationId: null });
  });

  it('returns an empty object when nothing matches', () => {
    expect(pick<OrgConfigAdmin>({ other: 1 }, ORG_CONFIG_KEYS)).toEqual({});
  });
});

describe('firstArray', () => {
  it.each<[string, unknown, unknown[]]>([
    ['a bare array', [1, 2], [1, 2]],
    ['a data envelope', { data: ['a'] }, ['a']],
    ['the first array under a named key', { totalCount: 2, items: ['x'], more: ['y'] }, ['x']],
    ['an object without arrays', { a: 1 }, []],
    ['null', null, []],
    ['undefined', undefined, []],
    ['a string', 'abc', []],
  ])('reads %s', (_case, value, expected) => {
    expect(firstArray(value)).toEqual(expected);
  });
});

describe('iamSettings reads', () => {
  it.each([
    ['signupAdmin', () => iamSettings.signupAdmin(), `${IAM}/signup-settings/admin`],
    ['orgConfigAdmin', () => iamSettings.orgConfigAdmin(), `${IAM}/organizations/config/admin`],
    ['mfaPolicy', () => iamSettings.mfaPolicy(), `${IAM_BASE}/mfa/config`],
    ['clientCredentials', () => iamSettings.clientCredentials(), `${AUTH}/client-credentials`],
    ['identityProviders', () => iamSettings.identityProviders(), `${AUTH}/identity-providers`],
    ['authConfig', () => iamSettings.authConfig(), `${AUTH}/config`],
    ['oidcClients', () => iamSettings.oidcClients(), `${IAM_BASE}/oidc-clients`],
    ['loginOptions', () => iamSettings.loginOptions(), `${AUTH}/login-options`],
  ])('%s is a GET on its route', async (_name, call, url) => {
    const http = mockFetch({ body: { isSuccess: true } });
    await expect(call()).resolves.toEqual({ isSuccess: true });
    expect(http.last()).toMatchObject({ method: 'GET', url, body: undefined });
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');
  });

  it('reads the login options without renewing on a 401', async () => {
    const http = mockFetch({ status: 401 });
    await expect(iamSettings.loginOptions()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(http.requests).toHaveLength(1);
  });
});

describe('iamSettings saves', () => {
  it('saves the signup settings as given', async () => {
    const http = mockFetch();
    const body: SignupSettings = {
      isEmailPasswordSignUpEnabled: true,
      isSSoSignUpEnabled: false,
      defaultRolesForNewUserOnSignUp: ['member'],
      defaultPermissionsForNewUserOnSignUp: [],
    };
    await iamSettings.saveSignup(body);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/signup-settings`, body });
  });

  it('saves the organization config as given', async () => {
    const http = mockFetch();
    const body: OrgConfigAdmin = { isMultiOrgEnabled: true, isSignupAutoJoinEnabled: null };
    await iamSettings.saveOrgConfig(body);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/organizations/config` });
    expect(http.last().body).toEqual(body);
  });

  it('saves the MFA policy as given', async () => {
    const http = mockFetch();
    const body: MfaPolicyInput = {
      enableMfa: true,
      userMfaType: [1, 2],
      requireMfaForAllUsers: false,
      mfaRequiredRoles: ['admin'],
      mfaExemptRoles: [],
      allowUserOptOut: false,
      allowBackupCodes: true,
      backupCodesCount: 10,
    };
    await iamSettings.saveMfaPolicy(body);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM_BASE}/mfa/config` });
    expect(http.last().body).toEqual(body);
  });

  it('saves a client credential and returns the server reply', async () => {
    const http = mockFetch({ body: { clientId: 'c1', clientSecret: 's3cr3t' } });
    const body: ClientCredentialInput = {
      name: 'Backend',
      isActive: true,
      accessTokenValidForNumberMinutes: 15,
      roles: ['service'],
      permissions: [],
      organizationId: null,
    };
    await expect(iamSettings.saveClientCredential(body)).resolves.toEqual({ clientId: 'c1', clientSecret: 's3cr3t' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${AUTH}/client-credentials` });
    expect(http.last().body).toEqual(body);
  });

  it('rotates a client secret with an empty JSON body', async () => {
    const http = mockFetch({ body: { clientSecret: 'new' } });
    await expect(iamSettings.rotateClientSecret('cc/1')).resolves.toEqual({ clientSecret: 'new' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${AUTH}/client-credentials/cc%2F1/rotate-secret`, body: {} });
    expect(http.last().headers['Content-Type']).toBe('application/json');
  });

  it('deletes a client credential', async () => {
    const http = mockFetch();
    await iamSettings.deleteClientCredential('cc 1');
    expect(http.last()).toMatchObject({ method: 'DELETE', url: `${AUTH}/client-credentials/cc%201`, body: undefined });
  });

  it('switches an identity provider on or off with a PATCH', async () => {
    const http = mockFetch();
    await iamSettings.setIdentityProviderActive('google 1', false);
    expect(http.last()).toMatchObject({ method: 'PATCH', url: `${AUTH}/identity-providers/google%201/status`, body: { isActive: false } });
  });
});
