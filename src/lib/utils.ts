import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(first?: string, last?: string, fallback = '?') {
  const a = first?.trim()?.[0] ?? '';
  const b = last?.trim()?.[0] ?? '';
  return (a + b).toUpperCase() || fallback;
}

export function formatDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "14 hours ago", "in 3 days" — for timestamps where recency matters more than the minute. */
export function formatRelative(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const seconds = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, 'second');
}

/** A user's best available label: full name, then email, then a neutral placeholder. */
export function displayName(user: {
  firstName?: string;
  lastName?: string;
  email?: string;
}): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'this user';
}
