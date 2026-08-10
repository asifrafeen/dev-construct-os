import type { ReactElement } from 'react';
import type { SsoProvider } from './embedded';
import { Button } from '@/components/ui/button';

/**
 * Provider marks as inline SVG. The brand glyphs are drawn rather than loaded so
 * the login page stays a single self-contained bundle with no image requests.
 */
const MARKS: Record<string, ReactElement> = {
  google: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-3l-3.9-3a7.2 7.2 0 0 1-10.7-3.8h-4v3.1A12 12 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.3 14.2a7.1 7.1 0 0 1 0-4.6V6.5h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5A12 12 0 0 0 1.3 6.5l4 3.1A7.2 7.2 0 0 1 12 4.8Z"
      />
    </svg>
  ),
  microsoft: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden focusable="false">
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  ),
};

/** Sentence-case fallback for providers with no drawn mark. */
const label = (p: SsoProvider) =>
  (p.displayName || p.provider).replace(/^./, (c) => c.toUpperCase());

export function ProviderButton({
  provider,
  disabled,
  busy,
  compact,
  onSelect,
}: {
  provider: SsoProvider;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
  onSelect: (provider: SsoProvider) => void;
}) {
  const mark = MARKS[provider.provider];

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={disabled}
      onClick={() => onSelect(provider)}
    >
      {mark ?? <span className="text-xs font-semibold">{label(provider).slice(0, 1)}</span>}
      {!compact && <span>{busy ? `Redirecting to ${label(provider)}…` : label(provider)}</span>}
    </Button>
  );
}
