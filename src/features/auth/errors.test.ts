import { describe, expect, it } from 'vitest';
import { BlocksError } from '@/lib/blocks-client';
import {
  accountErrorFromError,
  accountErrorMessage,
  assertAccountOk,
  authErrorCode,
  authErrorMessage,
  describeAuthError,
} from './errors';

const LOGIN_URL = 'https://blocksapi.example.com/iam/v4/auth/login';
const blocksError = (body: unknown, status = 400) => new BlocksError(status, LOGIN_URL, body);

const HELP = {
  invalidPassword: 'That email and password combination is not correct.',
  locked: 'This account is temporarily locked after too many failed attempts. Wait a few minutes and try again.',
  inactive: 'That account is not active yet. Check your inbox for the activation email.',
  mfaEnabled: 'This account needs a verification code. Enter the one that was just sent to you.',
  captchaEnabled: 'This project requires a CAPTCHA. Complete the challenge below and try again.',
  captchaInvalid: 'That CAPTCHA response was rejected. Solve the new challenge and try again.',
  userNotFound:
    'There is no account with that email address on this project. An administrator has to invite it first.',
  accessDenied: 'You cancelled the sign-in, or the identity provider refused it.',
  noEmail: 'The identity provider did not release an email address, so Blocks cannot match you to an account.',
  deactivated: 'That account exists but is deactivated. An administrator has to re-enable it.',
};

describe('describeAuthError', () => {
  describe('matching a known code', () => {
    it.each([
      ['invalid_username_password', HELP.invalidPassword],
      ['account_locked', HELP.locked],
      ['user_inactive_or_not_verified', HELP.inactive],
      ['mfa_enabled', HELP.mfaEnabled],
      ['mfa_enrollment_required', 'This account has to finish multi-factor enrolment before signing in.'],
      ['invalid_mfa_code', 'That verification code is not correct.'],
      ['mfa_session_expired', 'The verification step timed out. Start signing in again.'],
      ['captcha_enabled', HELP.captchaEnabled],
      ['captcha_invalid', HELP.captchaInvalid],
      ['user_not_found', HELP.userNotFound],
      ['provider_not_found', 'That sign-in provider is not configured on this project.'],
      ['provider_inactive', 'That sign-in provider is switched off on this project.'],
      ['invalid_provider_type', 'That provider is not a social identity provider.'],
      [
        'state_data_not_found',
        'This sign-in link has already been used or has expired. Start again from the sign-in page.',
      ],
      ['state_data_invalid', 'This sign-in link is malformed. Start again from the sign-in page.'],
      ['code_require', 'The identity provider returned no authorization code.'],
      ['state_require', 'The identity provider returned no state value.'],
      ['access_denied', HELP.accessDenied],
      [
        'invalid_client',
        'This app is not registered correctly with Blocks — the OIDC client id or redirect URI does not match.',
      ],
      ['redirect_uri_mismatch', 'The redirect URI this app sent does not match the one registered on the provider.'],
    ])('explains %s from the error field of an object body', (code, help) => {
      expect(describeAuthError(400, { error: code, error_description: 'raw server text' })).toBe(help);
    });

    it('reads a JSON-string body', () => {
      const body = JSON.stringify({ error: 'account_locked', error_description: 'Locked' });
      expect(describeAuthError(400, body)).toBe(HELP.locked);
    });

    it('finds the code inside the description when the error field is empty', () => {
      expect(describeAuthError(400, { error: '', error_description: 'Rejected: captcha_invalid' })).toBe(
        HELP.captchaInvalid,
      );
    });

    it('finds the code anywhere in a plain-text body', () => {
      expect(describeAuthError(400, 'upstream said invalid_client, giving up')).toBe(
        'This app is not registered correctly with Blocks — the OIDC client id or redirect URI does not match.',
      );
    });

    it.each([
      ['an object description', { error_description: 'Access denied by the resource owner' }, HELP.accessDenied],
      [
        'a JSON-string description',
        JSON.stringify({ error_description: 'User not found in this tenant' }),
        HELP.userNotFound,
      ],
      ['a plain-text body', 'Invalid username password', HELP.invalidPassword],
    ])('matches the space-separated form of a code in %s', (_label, body, expected) => {
      expect(describeAuthError(400, body)).toBe(expected);
    });

    it('ignores case', () => {
      expect(describeAuthError(400, { error: 'MFA_ENABLED' })).toBe(HELP.mfaEnabled);
      expect(describeAuthError(400, 'CAPTCHA ENABLED for this project')).toBe(HELP.captchaEnabled);
    });

    it('takes the first entry in table order when several codes appear', () => {
      // captcha_enabled is listed before user_not_found, whatever order the text names them in.
      expect(describeAuthError(400, { error: 'user_not_found', error_description: 'captcha_enabled' })).toBe(
        HELP.captchaEnabled,
      );
      expect(describeAuthError(400, 'captcha_invalid and invalid_username_password')).toBe(HELP.invalidPassword);
    });

    it('prefers a known code over the special phrases', () => {
      expect(
        describeAuthError(400, { error: 'user_not_found', error_description: 'Provider did not provide any email' }),
      ).toBe(HELP.userNotFound);
    });
  });

  describe('special phrases', () => {
    it.each([
      [{ error: 'x', error_description: 'The provider did not provide any email address.' }],
      [JSON.stringify({ error_description: 'Google DID NOT PROVIDE ANY EMAIL' })],
      ['identity provider did not provide any email'],
    ])('explains a missing provider email (%j)', (body) => {
      expect(describeAuthError(400, body)).toBe(HELP.noEmail);
    });

    it.each([
      [{ error: 'login_failed', error_description: 'User is not active' }],
      [JSON.stringify({ error: 'login_failed', error_description: 'Account NOT ACTIVE' })],
      ['this user is not active'],
    ])('explains a deactivated account (%j)', (body) => {
      expect(describeAuthError(400, body)).toBe(HELP.deactivated);
    });
  });

  describe('fallbacks', () => {
    it('prints an unrecognised description as is', () => {
      expect(describeAuthError(400, { error: 'weird_code', error_description: 'Something odd happened' })).toBe(
        'Something odd happened',
      );
      expect(describeAuthError(400, JSON.stringify({ error: 'weird_code', error_description: 'Odd' }))).toBe('Odd');
    });

    it('prints the bare code when there is no description', () => {
      expect(describeAuthError(400, { error: 'weird_code' })).toBe('weird_code');
      expect(describeAuthError(400, JSON.stringify({ error: 'weird_code' }))).toBe('weird_code');
    });

    it('prints an unrecognised plain-text body as is', () => {
      expect(describeAuthError(502, 'Bad gateway')).toBe('Bad gateway');
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a number', 42],
      ['an empty string', ''],
      ['an empty object', {}],
      ['an empty JSON object', '{}'],
    ])('names the status when the body (%s) says nothing', (_label, body) => {
      expect(describeAuthError(503, body)).toBe('Sign-in failed (503).');
    });
  });
});

describe('authErrorMessage', () => {
  it('describes a BlocksError from its body', () => {
    expect(authErrorMessage(blocksError({ error: 'invalid_mfa_code' }))).toBe('That verification code is not correct.');
    expect(authErrorMessage(blocksError(null, 500))).toBe('Sign-in failed (500).');
  });

  it('uses the message of any other Error', () => {
    expect(authErrorMessage(new TypeError('Failed to fetch'))).toBe('Failed to fetch');
  });

  it('stringifies anything else', () => {
    expect(authErrorMessage('plain')).toBe('plain');
    expect(authErrorMessage(7)).toBe('7');
  });
});

describe('authErrorCode', () => {
  it.each([
    ['an object body', { error: 'mfa_session_expired', error_description: 'x' }, 'mfa_session_expired'],
    ['a JSON-string body', JSON.stringify({ error: 'invalid_mfa_code' }), 'invalid_mfa_code'],
    ['an object without a code', { error_description: 'x' }, ''],
    ['a JSON string without a code', '{"error_description":"x"}', ''],
    ['a plain-text body', 'not json', ''],
    ['a JSON null body', 'null', ''],
    ['a null body', null, ''],
    ['a numeric body', 42, ''],
  ])('reads %s', (_label, body, expected) => {
    expect(authErrorCode(blocksError(body))).toBe(expected);
  });

  it('is empty for anything that is not a BlocksError', () => {
    expect(authErrorCode(new Error('mfa_session_expired'))).toBe('');
    expect(authErrorCode({ body: { error: 'mfa_session_expired' } })).toBe('');
  });
});

describe('accountErrorMessage', () => {
  it('is null for a success', () => {
    expect(accountErrorMessage({ isSuccess: true, errors: { Email: 'ignored' } })).toBeNull();
  });

  it('returns the first non-empty field message', () => {
    expect(accountErrorMessage({ isSuccess: false, errors: { Email: '', Password: 'Too short' } })).toBe('Too short');
  });

  it.each([
    ['undefined', undefined],
    ['no errors', { isSuccess: false }],
    ['null errors', { isSuccess: false, errors: null }],
    ['only empty messages', { isSuccess: false, errors: { Email: '' } }],
  ])('falls back to a generic message for %s', (_label, response) => {
    expect(accountErrorMessage(response)).toBe('The request could not be completed. Please try again.');
  });
});

describe('accountErrorFromError', () => {
  it('reads the first field message from an object body', () => {
    expect(accountErrorFromError(blocksError({ isSuccess: false, errors: { Email: 'Email is required.' } }))).toBe(
      'Email is required.',
    );
  });

  it('reads the first field message from a JSON-string body', () => {
    const body = JSON.stringify({ isSuccess: false, errors: { Email: 'x@y.io is already registered' } });
    expect(accountErrorFromError(blocksError(body))).toBe('x@y.io is already registered');
  });

  it('falls back to the generic message when the errors map has nothing printable', () => {
    expect(accountErrorFromError(blocksError({ isSuccess: false, errors: {} }))).toBe(
      'The request could not be completed. Please try again.',
    );
  });

  it.each([
    ['a non-BlocksError', new Error('x')],
    ['a plain-text body', blocksError('Bad request')],
    ['a null body', blocksError(null)],
    ['a JSON null body', blocksError('null')],
    ['a numeric body', blocksError(42)],
    ['an OAuth-shaped body', blocksError({ error: 'invalid_request' })],
    ['an errors field that is not an object', blocksError({ errors: 'nope' })],
    ['a null errors field', blocksError({ errors: null })],
  ])('is null for %s', (_label, error) => {
    expect(accountErrorFromError(error)).toBeNull();
  });
});

describe('assertAccountOk', () => {
  it('passes a success', () => {
    expect(() => assertAccountOk({ isSuccess: true })).not.toThrow();
  });

  it('throws the readable message otherwise', () => {
    expect(() => assertAccountOk({ isSuccess: false, errors: { Code: 'Invalid code' } })).toThrow('Invalid code');
    expect(() => assertAccountOk(undefined)).toThrow('The request could not be completed. Please try again.');
  });
});
