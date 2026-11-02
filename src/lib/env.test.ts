import { describe, expect, it, vi } from 'vitest';
import { BLOCKS, DATA_BASE, IAM_BASE, LOCALIZATION_BASE, configIssues, withoutPort } from './env';

describe('BLOCKS', () => {
  it('reads the build-time config, without the trailing slash on the API URL', () => {
    expect(BLOCKS.apiUrl).toBe('https://blocksapi.example.com');
    expect(BLOCKS.projectKey).toBe('test-project-key');
    expect(BLOCKS.hostedLogin).toBe(true);
  });

  it('derives the service bases from the API URL', () => {
    expect(IAM_BASE).toBe('https://blocksapi.example.com/iam/v4');
    expect(DATA_BASE).toBe('https://blocksapi.example.com/data/v4');
    expect(LOCALIZATION_BASE).toBe('https://blocksapi.example.com/localization/v4');
  });
});

describe('trailing-slash trimming', () => {
  it.each([
    ['https://a.io', 'https://a.io'],
    ['https://a.io/', 'https://a.io'],
    ['https://a.io///', 'https://a.io'],
    ['///', ''],
    ['', ''],
  ])('%j → %j', async (input, expected) => {
    vi.resetModules();
    vi.stubEnv('VITE_BLOCKS_API_URL', input);
    const fresh = await import('./env');
    expect(fresh.BLOCKS.apiUrl).toBe(expected);
  });
});

describe('withoutPort', () => {
  it('drops an explicit port and keeps the path', () => {
    expect(withoutPort('https://app.example.com:5173/login/callback')).toBe('https://app.example.com/login/callback');
  });

  it('does not invent a trailing slash for a bare origin', () => {
    expect(withoutPort('https://app.example.com:5173')).toBe('https://app.example.com');
    expect(withoutPort('https://app.example.com:5173/')).toBe('https://app.example.com/');
  });

  it('returns anything that is not a URL unchanged', () => {
    expect(withoutPort('not a url')).toBe('not a url');
  });
});

describe('configIssues', () => {
  it('has nothing to report for a complete, same-site config', () => {
    expect(configIssues()).toEqual([]);
  });

  it('flags an API domain that is not same-site with the app', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_BLOCKS_REDIRECT_URI', 'https://app.other.org/login/callback');
    const fresh = await import('./env');
    const issues = fresh.configIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/\(example\.com\) is not same-site with the app domain \(other\.org\)/);
    expect(issues[0]).toContain('https://blocksapi.other.org');
  });

  it('reports every missing value', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_BLOCKS_API_URL', '');
    vi.stubEnv('VITE_BLOCKS_PROJECT_KEY', '');
    vi.stubEnv('VITE_BLOCKS_OIDC_CLIENT_ID', '');
    vi.stubEnv('VITE_BLOCKS_REDIRECT_URI', '');
    vi.stubGlobal('location', { origin: 'https://app.example.com' });
    const fresh = await import('./env');
    expect(fresh.configIssues()).toEqual([
      'VITE_BLOCKS_API_URL is not set.',
      'VITE_BLOCKS_PROJECT_KEY is not set.',
      expect.stringMatching(/^VITE_BLOCKS_OIDC_CLIENT_ID is not set/),
      'VITE_BLOCKS_REDIRECT_URI is not set.',
    ]);
  });

  it('accepts a same-site API, and skips the OIDC checks when hosted login is off', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_BLOCKS_API_URL', 'https://blocksapi.example.org');
    vi.stubEnv('VITE_BLOCKS_HOSTED_LOGIN', 'false');
    vi.stubEnv('VITE_BLOCKS_OIDC_CLIENT_ID', '');
    vi.stubEnv('VITE_BLOCKS_REDIRECT_URI', '');
    vi.stubGlobal('location', { origin: 'https://app.example.org' });
    const fresh = await import('./env');
    expect(fresh.configIssues()).toEqual([]);
  });

  it('reports a malformed URL', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_BLOCKS_REDIRECT_URI', 'not a url');
    const fresh = await import('./env');
    expect(fresh.configIssues()).toEqual(['VITE_BLOCKS_API_URL or VITE_BLOCKS_REDIRECT_URI is not a valid URL.']);
  });
});
