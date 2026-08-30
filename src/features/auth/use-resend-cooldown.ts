import { useCallback, useEffect, useState } from 'react';

/**
 * The wait between "send another code" presses.
 *
 * Well short of the code's own 5-minute life, on purpose: someone whose mail never
 * arrived should not have to sit through the full expiry before trying again. It is
 * only here to stop a held-down button from mailing a dozen codes.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

export interface ResendCooldown {
  /** Whole seconds left, 0 when the control is free again. */
  remaining: number;
  /** "0:45" — empty string once the cooldown has run out. */
  label: string;
  start(): void;
  clear(): void;
}

/**
 * A countdown for resend buttons, shared by the login MFA step and the profile
 * enrolment dialog.
 *
 * Counts to a deadline rather than decrementing a number: a tab that gets thrown into
 * the background has its timers throttled, and a decrementing counter would come back
 * still claiming 40 seconds after two minutes away.
 */
export function useResendCooldown(seconds: number = RESEND_COOLDOWN_SECONDS): ResendCooldown {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (endsAt === null) return;

    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setEndsAt(null);
    };

    tick(); // paint the first value now, not a quarter-second late
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [endsAt]);

  const start = useCallback(() => setEndsAt(Date.now() + seconds * 1000), [seconds]);

  const clear = useCallback(() => {
    setEndsAt(null);
    setRemaining(0);
  }, []);

  const label = remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : '';

  return { remaining, label, start, clear };
}
