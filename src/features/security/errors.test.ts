import { describe, expect, it } from 'vitest';
import { BlocksError, UnauthorizedError } from '@/lib/blocks-client';
import { securityErrorMessage } from './errors';

const URL_SUMMARY = 'https://blocksapi.example.com/iam/v4/security/summary';

describe('securityErrorMessage', () => {
  it('names the missing permission on a 403', () => {
    expect(securityErrorMessage(new BlocksError(403, URL_SUMMARY, null))).toBe(
      'Your role is missing the blocks-iam::iam::security-audit permission, so IAM refused this (403).',
    );
  });

  it('names the permission the caller passes', () => {
    const forbidden = new BlocksError(403, URL_SUMMARY, null);
    expect(securityErrorMessage(forbidden, 'blocks-iam::iam::mutate-security-audit')).toBe(
      'Your role is missing the blocks-iam::iam::mutate-security-audit permission, so IAM refused this (403).',
    );
  });

  it.each([
    ['another Blocks status', new BlocksError(404, URL_SUMMARY, null), `Blocks 404 — ${URL_SUMMARY}`],
    ['a signed-out 401', new UnauthorizedError(URL_SUMMARY, null), `Blocks 401 — ${URL_SUMMARY}`],
    ['a plain Error', new TypeError('Failed to fetch'), 'Failed to fetch'],
  ])('uses the message of %s', (_label, error, expected) => {
    expect(securityErrorMessage(error)).toBe(expected);
  });

  it.each([
    ['a string', 'went wrong', 'went wrong'],
    ['a number', 42, '42'],
    ['undefined', undefined, 'undefined'],
  ])('stringifies %s', (_label, error, expected) => {
    expect(securityErrorMessage(error)).toBe(expected);
  });
});
