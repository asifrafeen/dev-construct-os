import { useState, type FormEvent } from 'react';
import { Check, Loader2, Mail, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, ErrorNote, Input } from '@/components/ui/misc';
import { Modal } from '@/components/ui/modal';
import type { Me } from '@/features/users/api';
import {
  useConfirmEmailMfa,
  useDisableMfa,
  useMfaPolicy,
  useResendMfaCode,
  useStartEmailMfa,
} from './hooks';
import { EMAIL_CODE_LENGTH, EMAIL_CODE_TTL_MINUTES, MFA_TYPE, mfaErrorMessage } from './mfa';
import { useResendCooldown } from './use-resend-cooldown';

/**
 * Self-service email two-step verification, for the profile page.
 *
 * Enrolling is a round trip, not a switch: IAM mails a code, and handing that code
 * back is what turns MFA on (see ./mfa.ts). So the button opens a dialog and the
 * account only changes when the dialog succeeds — closing it early leaves the user
 * exactly as they were, with a code that quietly expires.
 *
 * Only the Email method is offered here. TOTP needs a QR round trip and SMS needs a
 * verified number, so an account already on one of those is reported but not touched.
 */

/** IAM's UserMfaType, for reporting a method this screen does not manage. */
const METHOD_NAMES: Record<number, string> = {
  [MFA_TYPE.none]: 'None',
  [MFA_TYPE.totp]: 'Authenticator app',
  [MFA_TYPE.email]: 'Email',
  [MFA_TYPE.sms]: 'SMS',
  [MFA_TYPE.whatsApp]: 'WhatsApp',
};

export function MfaCard({ me }: { me: Me }) {
  const { policy } = useMfaPolicy();

  const start = useStartEmailMfa();
  const resend = useResendMfaCode();
  const confirm = useConfirmEmailMfa();
  const disable = useDisableMfa();

  /** Set while a code is outstanding — it is also what opens the dialog. */
  const [mfaId, setMfaId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  /** Sits on the card (not the dialog) so it survives the dialog closing. */
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const cooldown = useResendCooldown();

  const onEmail = me.mfaEnabled && me.userMfaType === MFA_TYPE.email;
  /** Enrolled, but on something this screen cannot re-issue codes for. */
  const onOtherMethod = me.mfaEnabled && me.userMfaType !== MFA_TYPE.email;

  // Unknown policy (a 403 on mfa/config is normal for a non-admin) is treated as
  // "go ahead" — IAM answers `mfa_not_enable` if the project really has it off, and
  // that message is far more useful than a button greyed out for no visible reason.
  const projectOff = policy ? !policy.enabled : false;
  const emailNotOffered = policy
    ? policy.enabled && !policy.allowedMethods.includes(MFA_TYPE.email)
    : false;

  async function onEnable() {
    setError(null);
    setNotice(null);
    setDialogError(null);
    setCode('');
    try {
      setMfaId(await start.mutateAsync());
      // Opening the dialog already mailed a code, so resend starts on cooldown.
      cooldown.start();
    } catch (e) {
      setError(mfaErrorMessage(e));
    }
  }

  async function onResend() {
    if (!mfaId || cooldown.remaining > 0) return;
    setDialogError(null);
    setCode('');
    try {
      // The replacement id retires the one we hold — keeping the old one would
      // verify a code the user can no longer be sent.
      setMfaId(await resend.mutateAsync(mfaId));
      cooldown.start();
    } catch (e) {
      setDialogError(mfaErrorMessage(e));
    }
  }

  async function onConfirm(event: FormEvent) {
    event.preventDefault();
    if (!mfaId) return;
    setDialogError(null);
    try {
      await confirm.mutateAsync({ mfaId, code: code.trim() });
      setMfaId(null);
      setCode('');
      setNotice('Two-step verification is on. You will be asked for a code at each sign-in.');
    } catch (e) {
      setDialogError(mfaErrorMessage(e));
      setCode('');
    }
  }

  /**
   * Abandoning enrolment is free: nothing is written until verify succeeds, so the
   * outstanding code is simply left to expire.
   */
  function closeEnrolment() {
    setMfaId(null);
    setDialogError(null);
    setCode('');
    cooldown.clear();
  }

  async function onDisable() {
    setError(null);
    setNotice(null);
    try {
      await disable.mutateAsync();
      setConfirmingDisable(false);
      setNotice('Two-step verification is off.');
    } catch (e) {
      setConfirmingDisable(false);
      setError(mfaErrorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Two-step verification
        </CardTitle>
        <CardDescription>
          Ask for a one-time code as well as your password when you sign in.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {projectOff ? (
          <p className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
            Two-step verification is switched off for this project. An administrator has to enable
            it before anyone can enrol.
          </p>
        ) : (
          <div className="rounded-md border">
            <div className="flex items-start justify-between gap-4 p-4">
              <div className="space-y-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  Email
                  {onEmail && (
                    <Badge tone="success">{me.isMfaVerified ? 'Active' : 'Pending'}</Badge>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  A {EMAIL_CODE_LENGTH}-digit code is sent to{' '}
                  <span className="font-medium text-foreground">{me.email}</span> each time you
                  sign in.
                </p>
              </div>

              {onEmail ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmingDisable(true)}
                  disabled={disable.isPending}
                >
                  Turn off
                </Button>
              ) : (
                !emailNotOffered && (
                  <Button variant="outline" size="sm" onClick={onEnable} disabled={start.isPending}>
                    {start.isPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      'Enable'
                    )}
                  </Button>
                )
              )}
            </div>

            {emailNotOffered && !onEmail && (
              <p className="border-t p-4 text-sm text-muted-foreground">
                This project does not offer email codes. Allowed:{' '}
                {(policy?.allowedMethods ?? [])
                  .map((m) => METHOD_NAMES[m] ?? `Type ${m}`)
                  .join(', ') || 'none'}
                .
              </p>
            )}

            {onOtherMethod && (
              <p className="border-t p-4 text-sm text-muted-foreground">
                This account already uses{' '}
                <span className="font-medium text-foreground">
                  {METHOD_NAMES[me.userMfaType] ?? `type ${me.userMfaType}`}
                </span>
                . Enabling email here replaces it.
              </p>
            )}
          </div>
        )}

        {notice && (
          <p className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
            <Check className="h-4 w-4 shrink-0" />
            {notice}
          </p>
        )}
        {error && <ErrorNote error={error} />}
      </CardContent>

      {/* ── Enrolment: the code that arrives is what actually switches MFA on ── */}
      <Modal
        open={mfaId !== null}
        onClose={closeEnrolment}
        title="Confirm your email"
        description={
          <>
            We sent a {EMAIL_CODE_LENGTH}-digit code to{' '}
            <span className="font-medium text-foreground">{me.email}</span>. It expires in{' '}
            {EMAIL_CODE_TTL_MINUTES} minutes.
          </>
        }
        className="max-w-md"
        footer={
          <>
            <Button variant="outline" type="button" onClick={closeEnrolment}>
              Cancel
            </Button>
            <Button
              type="submit"
              // The form lives in the modal body; `form` reaches it by id.
              form="mfa-enrol"
              disabled={confirm.isPending || code.length !== EMAIL_CODE_LENGTH}
            >
              {confirm.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying…
                </>
              ) : (
                'Verify and turn on'
              )}
            </Button>
          </>
        }
      >
        <form id="mfa-enrol" onSubmit={onConfirm} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="mfa-enrol-code" className="text-sm font-medium leading-none">
              Verification code
            </label>
            <Input
              id="mfa-enrol-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={EMAIL_CODE_LENGTH}
              placeholder={'0'.repeat(EMAIL_CODE_LENGTH)}
              className="text-center text-lg tracking-[0.4em]"
              value={code}
              // Digits only: the code is numeric, and pasting from a mail client
              // easily drags a space along with it.
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              disabled={confirm.isPending}
            />
          </div>

          {dialogError && <ErrorNote error={dialogError} />}

          <button
            type="button"
            onClick={onResend}
            disabled={resend.isPending || confirm.isPending || cooldown.remaining > 0}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-60"
          >
            {resend.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            {resend.isPending ? 'Sending a new code…' : 'Send a new code'}
            {cooldown.label && ` (${cooldown.label})`}
          </button>
        </form>
      </Modal>

      {/* ── Turning it off is one call and takes effect immediately ─────────── */}
      <Modal
        open={confirmingDisable}
        onClose={() => setConfirmingDisable(false)}
        title="Turn off two-step verification?"
        description="Your account will be protected by its password alone."
        className="max-w-md"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmingDisable(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDisable} disabled={disable.isPending}>
              {disable.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Turning off…
                </>
              ) : (
                'Turn off'
              )}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          You can turn it back on at any time — enrolling again sends a fresh code to{' '}
          {me.email}.
        </p>
      </Modal>
    </Card>
  );
}
