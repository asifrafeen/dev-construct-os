import { describe, expect, it } from 'vitest';
import { BlocksError } from '@/lib/blocks-client';
import { mockFetch } from '@/test/mock-fetch';
import {
  EMAIL_CODE_LENGTH,
  EMAIL_CODE_TTL_MINUTES,
  MFA_TYPE,
  confirmEmailMfaEnrolment,
  disableMfa,
  getMfaPolicy,
  mfaErrorCode,
  mfaErrorMessage,
  resendMfaCode,
  startEmailMfaEnrolment,
} from './mfa';

const MFA = 'https://blocksapi.example.com/iam/v4/mfa';
const blocksError = (body: unknown, status = 400) => new BlocksError(status, `${MFA}/verify`, body);

describe('constants', () => {
  it('mirrors IAM’s UserMfaType numbering and the emailed-code limits', () => {
    expect(MFA_TYPE).toEqual({ none: 0, totp: 1, email: 2, sms: 3, whatsApp: 4 });
    expect(EMAIL_CODE_LENGTH).toBe(6);
    expect(EMAIL_CODE_TTL_MINUTES).toBe(5);
  });
});

describe('getMfaPolicy', () => {
  it('GETs the project MFA config with the project key', async () => {
    const policy = { enabled: true, allowedMethods: [1, 2] };
    const http = mockFetch({ body: policy });
    await expect(getMfaPolicy()).resolves.toEqual(policy);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${MFA}/config`, body: undefined });
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');
  });
});

describe('startEmailMfaEnrolment', () => {
  it('asks IAM to mail an email code and returns the mfaId', async () => {
    const http = mockFetch({ body: { mfaId: 'mfa-1' } });
    await expect(startEmailMfaEnrolment()).resolves.toBe('mfa-1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${MFA}/generate`, body: { mfaType: 2 } });
    expect(http.last().headers['Content-Type']).toBe('application/json');
  });

  it('rejects an answer without an mfaId', async () => {
    mockFetch({ body: {} });
    await expect(startEmailMfaEnrolment()).rejects.toThrow('IAM accepted the request but returned no mfaId.');
  });

  it('surfaces a refusal as a BlocksError', async () => {
    mockFetch({ status: 400, body: { errors: { mfa_not_enable: 'MFA is off' } } });
    await expect(startEmailMfaEnrolment()).rejects.toBeInstanceOf(BlocksError);
  });
});

describe('resendMfaCode', () => {
  it('POSTs the mfaId already held and ignores the id in the answer', async () => {
    const http = mockFetch({ body: { mfaId: 'a-different-id' } });
    await expect(resendMfaCode('mfa-1')).resolves.toBeUndefined();
    expect(http.last()).toMatchObject({ method: 'POST', url: `${MFA}/resend`, body: { mfaId: 'mfa-1' } });
  });
});

describe('confirmEmailMfaEnrolment', () => {
  it('sends the enrolling verify call, with isFromTokenCall false', async () => {
    const http = mockFetch({ body: { valid: true } });
    await expect(confirmEmailMfaEnrolment('mfa-1', '123456')).resolves.toBeUndefined();
    expect(http.last()).toMatchObject({ method: 'POST', url: `${MFA}/verify` });
    expect(http.last().body).toEqual({
      mfaId: 'mfa-1',
      verificationCode: '123456',
      authType: 2,
      isFromTokenCall: false,
    });
  });

  it('rejects a wrong code', async () => {
    mockFetch({ status: 400, body: { errors: { message: 'invalid_two_factor_code' } } });
    await expect(confirmEmailMfaEnrolment('mfa-1', '000000')).rejects.toMatchObject({ status: 400 });
  });
});

describe('disableMfa', () => {
  it('POSTs an empty body — the user comes from the session', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await expect(disableMfa()).resolves.toEqual({ isSuccess: true });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${MFA}/disable`, body: {} });
  });
});

describe('mfaErrorCode', () => {
  it.each([
    ['a known code in the key', { errors: { mfa_not_enable: 'MFA is not enabled' } }, 'mfa_not_enable'],
    ['a known code in the value', { errors: { message: 'invalid_two_factor_code' } }, 'invalid_two_factor_code'],
    ['the first known code', { errors: { Other: 'x', resend_too_soon: 'wait' } }, 'resend_too_soon'],
    ['the error field when no errors entry is known', { errors: { Other: 'x' }, error: 'mfa_x' }, 'mfa_x'],
    ['the error field alone', { error: 'invalid_mfa_code' }, 'invalid_mfa_code'],
    ['a JSON-string body', JSON.stringify({ errors: { message: 'invalid_two_factor_id' } }), 'invalid_two_factor_id'],
    ['an unknown errors map and no error field', { errors: { Other: 'x' } }, ''],
    ['a non-string error field', { error: 7 }, ''],
    ['a plain-text body', 'Bad request', ''],
    ['a null body', null, ''],
  ])('finds %s', (_label, body, expected) => {
    expect(mfaErrorCode(blocksError(body))).toBe(expected);
  });

  it('is empty for anything that is not a BlocksError', () => {
    expect(mfaErrorCode(new Error('invalid_two_factor_code'))).toBe('');
  });
});

describe('mfaErrorMessage', () => {
  it.each([
    [
      'a code named in the key',
      { errors: { mfa_not_enable: 'raw' } },
      'Two-step verification is switched off for this project. An administrator has to enable it first.',
    ],
    [
      'a code named in the value',
      { errors: { message: 'invalid_two_factor_code' } },
      'That code is not correct. Check the email and try again.',
    ],
    [
      'a known code after an unknown entry',
      { errors: { Other: 'Some prose', empty_user_id: 'x' } },
      'IAM could not tell which account this is. Sign in again and retry.',
    ],
    [
      'a JSON-string body',
      JSON.stringify({ errors: { message: 'resend_too_soon' } }),
      'A code was sent moments ago. Wait a little before asking for another.',
    ],
  ])('explains %s', (_label, body, expected) => {
    expect(mfaErrorMessage(blocksError(body))).toBe(expected);
  });

  it('includes the code lifetime in the expired-code advice', () => {
    expect(mfaErrorMessage(blocksError({ errors: { invalid_two_factor_id: 'x' } }))).toBe(
      'That code has expired — they are only good for 5 minutes. Send a new one.',
    );
  });

  it('prints the first non-empty unknown message, serialising non-strings', () => {
    expect(mfaErrorMessage(blocksError({ errors: { A: '', B: 'Server-side prose' } }))).toBe('Server-side prose');
    expect(mfaErrorMessage(blocksError({ errors: { A: { detail: 1 } } }))).toBe('{"detail":1}');
  });

  it('explains a known code in the error field', () => {
    expect(mfaErrorMessage(blocksError({ errors: { A: '' }, error: 'phonenumber_not_exist' }))).toBe(
      'That account has no phone number on file.',
    );
    expect(mfaErrorMessage(blocksError({ error: 'email_not_verified' }))).toBe(
      'Your email address is not verified yet, so it cannot be used for verification codes.',
    );
  });

  it('falls back to the shared auth wording', () => {
    expect(mfaErrorMessage(blocksError({ error: 'invalid_mfa_code' }))).toBe('That verification code is not correct.');
    expect(mfaErrorMessage(blocksError('Service unavailable', 503))).toBe('Service unavailable');
    expect(mfaErrorMessage(blocksError(null, 500))).toBe('Sign-in failed (500).');
    expect(mfaErrorMessage(new Error('Failed to fetch'))).toBe('Failed to fetch');
  });
});
