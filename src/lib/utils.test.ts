import { describe, expect, it, vi } from 'vitest';
import { cn, displayName, formatDate, formatRelative, initials, toText } from './utils';

describe('cn', () => {
  it('merges conflicting Tailwind classes, last one wins', () => {
    expect(cn('p-2 text-sm', 'p-4')).toBe('text-sm p-4');
  });

  it('drops falsy entries', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
  });
});

describe('initials', () => {
  it('takes the first letter of each name, upper-cased', () => {
    expect(initials('ada', 'lovelace')).toBe('AL');
  });

  it('ignores surrounding whitespace', () => {
    expect(initials('  grace ', ' hopper')).toBe('GH');
  });

  it('falls back when there is nothing to use', () => {
    expect(initials()).toBe('?');
    expect(initials('', '  ', '–')).toBe('–');
  });
});

describe('formatDate', () => {
  it('renders a dash for empty and unparsable values', () => {
    expect(formatDate()).toBe('—');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not a date')).toBe('—');
  });

  it('formats a valid timestamp', () => {
    expect(formatDate('2026-01-02T03:04:05Z')).toMatch(/2026/);
  });
});

describe('formatRelative', () => {
  it('renders a dash for empty and unparsable values', () => {
    expect(formatRelative()).toBe('—');
    expect(formatRelative('nope')).toBe('—');
  });

  it('picks the largest unit that fits', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    try {
      expect(formatRelative('2026-06-15T09:00:00Z')).toMatch(/3 hours ago/);
      expect(formatRelative('2026-06-18T12:00:00Z')).toMatch(/in 3 days/);
      expect(formatRelative('2026-06-15T12:00:10Z')).toMatch(/now/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('toText', () => {
  it('passes primitives through as strings', () => {
    expect(toText('abc')).toBe('abc');
    expect(toText(42)).toBe('42');
    expect(toText(false)).toBe('false');
    expect(toText(10n)).toBe('10');
  });

  it('uses the fallback for null and undefined only', () => {
    expect(toText(undefined)).toBe('');
    expect(toText(null, '—')).toBe('—');
    expect(toText(0, '—')).toBe('0');
    expect(toText('', '—')).toBe('');
  });

  it('serialises objects instead of printing [object Object]', () => {
    expect(toText({ a: 1 })).toBe('{"a":1}');
    expect(toText([1, 'x'])).toBe('[1,"x"]');
  });

  it('falls back when an object cannot be serialised', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toText(circular, '?')).toBe('?');
  });
});

describe('displayName', () => {
  it('prefers the full name, then the email, then a placeholder', () => {
    expect(displayName({ firstName: 'Ada', lastName: 'Lovelace', email: 'a@x.io' })).toBe('Ada Lovelace');
    expect(displayName({ firstName: 'Ada' })).toBe('Ada');
    expect(displayName({ email: 'a@x.io' })).toBe('a@x.io');
    expect(displayName({})).toBe('this user');
  });
});
