import { describe, expect, it } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import { CREATED_FROM_CONSTRUCT, orgs, type OrgConfig, type SaveOrgInput } from './api';

const IAM = 'https://blocksapi.example.com/iam/v4/iam';

describe('orgs.list', () => {
  it('is a GET that pages from 0 by 20 and sends no filters by default', async () => {
    const http = mockFetch({ body: { isSuccess: true, organizations: [{ itemId: 'o1' }], totalCount: 1 } });
    const res = await orgs.list();

    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/organizations?Page=0&PageSize=20`, body: undefined });
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');
    expect(res).toEqual({ isSuccess: true, organizations: [{ itemId: 'o1' }], totalCount: 1 });
  });

  it('sends every set filter with PascalCase dotted names', async () => {
    const http = mockFetch();
    await orgs.list({
      page: 2,
      pageSize: 5,
      search: '  acme ',
      isDisabled: false,
      parentOrganizationId: 'parent-1',
      sortProperty: 'Name',
      sortDescending: true,
    });
    expect(http.last().url).toBe(
      `${IAM}/organizations?Page=2&PageSize=5&Filter.Search=acme&Filter.IsDisabled=false` +
        '&Filter.ParentOrganizationId=parent-1&Sort.Property=Name&Sort.IsDescending=true',
    );
  });

  it('skips a blank search and sorts ascending when no direction is given', async () => {
    const http = mockFetch();
    await orgs.list({ search: '   ', sortProperty: 'CreatedDate' });
    expect(http.last().url).toBe(`${IAM}/organizations?Page=0&PageSize=20&Sort.Property=CreatedDate&Sort.IsDescending=false`);
  });

  it('sends a true disabled filter', async () => {
    const http = mockFetch();
    await orgs.list({ isDisabled: true });
    expect(http.last().url).toBe(`${IAM}/organizations?Page=0&PageSize=20&Filter.IsDisabled=true`);
  });
});

describe('orgs reads', () => {
  it('reads the organizations of the signed-in user', async () => {
    const http = mockFetch({ body: { isSuccess: true, organizations: [{ itemId: 'o1', name: 'Acme' }] } });
    await expect(orgs.my()).resolves.toEqual({ isSuccess: true, organizations: [{ itemId: 'o1', name: 'Acme' }] });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/organizations/my` });
  });

  it('reads one organization by id', async () => {
    const http = mockFetch({ body: { isSuccess: true, organization: { itemId: 'o1' } } });
    await expect(orgs.get('o1')).resolves.toEqual({ isSuccess: true, organization: { itemId: 'o1' } });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/organizations/o1` });
  });
});

describe('orgs.create', () => {
  it('marks the organization as created from the portal', async () => {
    const http = mockFetch({ body: { isSuccess: true, itemId: 'o9' } });
    await expect(orgs.create({ name: 'Acme', email: 'hi@acme.io' })).resolves.toEqual({ isSuccess: true, itemId: 'o9' });
    expect(CREATED_FROM_CONSTRUCT).toBe(3);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/organizations/create` });
    expect(http.last().body).toEqual({ createdFrom: 3, name: 'Acme', email: 'hi@acme.io' });
  });
});

describe('orgs.update', () => {
  it('turns isDisabled into its inverse, isEnable', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await orgs.update('o1', { name: 'Acme', isDisabled: true });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/organizations/o1` });
    expect(http.last().body).toEqual({ name: 'Acme', isEnable: false });

    await orgs.update('o1', { isDisabled: false });
    expect(http.last().body).toEqual({ isEnable: true });
  });

  it('sends no enabled flag when isDisabled is not given', async () => {
    const http = mockFetch();
    await orgs.update('o1', { description: 'About', locale: 'en-US' });
    expect(http.last().body).toEqual({ description: 'About', locale: 'en-US' });
  });

  it('drops read-only entity fields and undefined values', async () => {
    const http = mockFetch();
    const entity = { itemId: 'o1', shortCode: 'AC', createdDate: '2026-01-01', name: 'Acme', description: undefined };
    await orgs.update('o1', entity);
    expect(http.last().body).toEqual({ name: 'Acme' });
  });

  it('passes every allowed field through', async () => {
    const http = mockFetch();
    const all: Required<SaveOrgInput> = {
      name: 'Acme',
      description: 'About',
      email: 'hi@acme.io',
      phoneNumber: '+100',
      websiteUrl: 'https://acme.io',
      defaultRoleForMembers: ['member'],
      defaultPermissionsForMembers: ['read'],
      addresses: [{ city: 'Zurich', isPrimary: true }],
      attributes: { tier: 'gold' },
      theme: { primaryColor: '#000' },
      logoUrl: 'https://acme.io/logo.png',
      logoId: 'logo-1',
      industry: 'Retail',
      timeZone: 'UTC',
      currency: 'CHF',
      dateFormat: 'dd.MM.yyyy',
      timeFormat: 'HH:mm',
      locale: 'de-CH',
    };
    await orgs.update('o1', all);
    expect(http.last().body).toEqual(all);
  });
});

describe('orgs.switchOrg', () => {
  it('posts the snake_case organization_id to auth/switch-org', async () => {
    const http = mockFetch();
    await orgs.switchOrg('o2');
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: 'https://blocksapi.example.com/iam/v4/auth/switch-org',
      body: { organization_id: 'o2' },
    });
  });
});

describe('orgs config', () => {
  const cfg: OrgConfig = {
    allowOrgCreationFromCloud: false,
    allowOrgCreationFromConstruct: true,
    allowOrgCreationFromSignup: false,
    allowOrgCreationFromPortal: true,
    isMultiOrgEnabled: true,
    consentForMultiOrgEnable: true,
  };

  it('reads the flat config', async () => {
    const http = mockFetch({ body: cfg });
    await expect(orgs.getConfig()).resolves.toEqual(cfg);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/organizations/config` });
  });

  it('saves the config as given', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await orgs.setConfig(cfg);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/organizations/config`, body: cfg });
  });
});
