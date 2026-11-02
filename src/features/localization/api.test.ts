import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@/lib/blocks-client';
import { useAuthStore } from '@/state/auth-store';
import { mockFetch } from '@/test/mock-fetch';
import { languageCode, languageLabel, localization, moduleName, type Language } from './api';

const L = 'https://blocksapi.example.com/localization/v4';

describe('languageCode', () => {
  it.each<[string, Language, string]>([
    ['languageCode first', { languageCode: 'en-US', code: 'en', culture: 'en-GB', name: 'English' }, 'en-US'],
    ['then code', { code: 'de', culture: 'de-DE', name: 'German' }, 'de'],
    ['then culture', { culture: 'fr-FR', name: 'French' }, 'fr-FR'],
    ['then name', { name: 'es' }, 'es'],
    ['skipping undefined links', { languageCode: undefined, code: undefined, culture: 'it-IT' }, 'it-IT'],
    ['skipping null links', { code: null, culture: null, name: 'pt' }, 'pt'],
    ['and nothing at all', {}, ''],
    ['stringifying a number', { code: 42 }, '42'],
    ['serialising an object instead of [object Object]', { culture: { tag: 'nl' } }, '{"tag":"nl"}'],
  ])('%s', (_case, language, expected) => {
    expect(languageCode(language)).toBe(expected);
  });
});

describe('languageLabel', () => {
  it.each<[string, Language, string]>([
    ['languageName first', { languageName: 'English', displayName: 'Eng', name: 'en-name', languageCode: 'en' }, 'English'],
    ['then displayName', { displayName: 'Deutsch', name: 'de-name', languageCode: 'de' }, 'Deutsch'],
    ['then name', { name: 'Français', languageCode: 'fr' }, 'Français'],
    ['then the languageCode', { languageCode: 'it' }, 'it'],
    ['then the code', { code: 'pt' }, 'pt'],
    ['then the culture', { culture: 'nl-NL' }, 'nl-NL'],
    ['and nothing at all', {}, ''],
    ['skipping null links', { displayName: null, name: null, culture: 'sv' }, 'sv'],
    ['stringifying a number', { displayName: 7 }, '7'],
    ['serialising an object instead of [object Object]', { displayName: { en: 'English' } }, '{"en":"English"}'],
  ])('%s', (_case, language, expected) => {
    expect(languageLabel(language)).toBe(expected);
  });
});

describe('moduleName', () => {
  it('prefers moduleName, then name, then an empty string', () => {
    expect(moduleName({ moduleName: 'common', name: 'other' })).toBe('common');
    expect(moduleName({ name: 'auth' })).toBe('auth');
    expect(moduleName({})).toBe('');
  });
});

describe('localization.languages', () => {
  it('reads the public list and accepts it bare', async () => {
    const http = mockFetch({ body: [{ languageCode: 'en' }] });
    await expect(localization.languages()).resolves.toEqual([{ languageCode: 'en' }]);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${L}/Language/Gets`, body: undefined });
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');
  });

  it('unwraps a data envelope', async () => {
    mockFetch({ body: { data: [{ languageCode: 'de' }] } });
    await expect(localization.languages()).resolves.toEqual([{ languageCode: 'de' }]);
  });

  it.each([
    ['an empty reply', { status: 204 }],
    ['a non-array data', { body: { data: { languageCode: 'en' } } }],
    ['a plain object', { body: { isSuccess: true } }],
  ])('returns [] for %s', async (_case, reply) => {
    mockFetch(reply);
    await expect(localization.languages()).resolves.toEqual([]);
  });

  it('does not try to renew the session on a 401', async () => {
    const http = mockFetch({ status: 401, body: { error: 'unauthorized' } });
    await expect(localization.languages()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(http.requests).toHaveLength(1);
  });
});

describe('localization.modules', () => {
  it('reads the public module list without renewing on a 401', async () => {
    const http = mockFetch({ body: { data: [{ moduleName: 'common' }] } });
    await expect(localization.modules()).resolves.toEqual([{ moduleName: 'common' }]);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${L}/Module/Gets` });

    const denied = mockFetch({ status: 401 });
    await expect(localization.modules()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(denied.requests).toHaveLength(1);
  });
});

describe('the tenant reads', () => {
  it('reads languages for the current tenant', async () => {
    const http = mockFetch({ body: { data: [{ languageCode: 'en' }] } });
    await expect(localization.languagesForTenant()).resolves.toEqual([{ languageCode: 'en' }]);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${L}/Language/GetLanguagesForCurrentTenant` });
  });

  it('reads modules for the current tenant', async () => {
    const http = mockFetch({ body: [{ name: 'auth' }] });
    await expect(localization.modulesForTenant()).resolves.toEqual([{ name: 'auth' }]);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${L}/Module/GetModulesForCurrentTenant` });
  });
});

describe('localization.dictionary', () => {
  it('asks for the public UILM file, module and language in the query', async () => {
    const http = mockFetch({ body: { HELLO: 'Hello' } });
    await expect(localization.dictionary('common', 'en-US')).resolves.toEqual({ HELLO: 'Hello' });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${L}/Key/GetUilmFile?Language=en-US&ModuleName=common` });
  });

  it('asks for the cloud file when told to', async () => {
    const http = mockFetch({ body: {} });
    await localization.dictionary('common', 'de', true);
    expect(http.last().url).toBe(`${L}/Key/GetCloudUilmFile?Language=de&ModuleName=common`);
  });

  it('keeps only real string translations', async () => {
    mockFetch({ body: { A: 'Alpha', B: '[ KEY MISSING ]', C: 5, D: { nested: 'x' }, F: null } });
    await expect(localization.dictionary('common', 'en')).resolves.toEqual({ A: 'Alpha' });
  });

  it('unwraps a data envelope', async () => {
    mockFetch({ body: { data: { A: 'Alpha', B: '[ KEY MISSING ]' } } });
    await expect(localization.dictionary('common', 'en')).resolves.toEqual({ A: 'Alpha' });
  });

  it('reads the record itself when data is not an object', async () => {
    mockFetch({ body: { data: 'oops', A: 'Alpha' } });
    await expect(localization.dictionary('common', 'en')).resolves.toEqual({ data: 'oops', A: 'Alpha' });
  });

  it.each([
    ['an empty reply', { status: 204 }],
    ['a plain-text reply', { body: 'not json' }],
  ])('returns an empty dictionary for %s', async (_case, reply) => {
    mockFetch(reply);
    await expect(localization.dictionary('common', 'en')).resolves.toEqual({});
  });

  it('does not renew the session for the public file', async () => {
    const refresh = vi.spyOn(useAuthStore.getState(), 'refreshSession').mockResolvedValue(undefined);
    const http = mockFetch({ status: 401 });
    await expect(localization.dictionary('common', 'en')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(refresh).not.toHaveBeenCalled();
    expect(http.requests).toHaveLength(1);
  });

  it('renews the session and retries for the cloud file', async () => {
    const refresh = vi.spyOn(useAuthStore.getState(), 'refreshSession').mockResolvedValue(undefined);
    const http = mockFetch([{ status: 401 }, { body: { A: 'Alpha' } }]);
    await expect(localization.dictionary('common', 'en', true)).resolves.toEqual({ A: 'Alpha' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(http.requests).toHaveLength(2);
  });
});

describe('localization.keysByNames', () => {
  it('posts the key names', async () => {
    const http = mockFetch({ body: { keys: [{ keyName: 'HELLO' }] } });
    await expect(localization.keysByNames(['HELLO', 'BYE'])).resolves.toEqual({ keys: [{ keyName: 'HELLO' }] });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${L}/Key/GetsByKeyNames` });
    expect(http.last().body).toEqual({ keyNames: ['HELLO', 'BYE'] });
  });

  it('scopes to a module when given one', async () => {
    const http = mockFetch();
    await localization.keysByNames(['HELLO'], 'mod-1');
    expect(http.last().body).toEqual({ keyNames: ['HELLO'], moduleId: 'mod-1' });
  });
});
