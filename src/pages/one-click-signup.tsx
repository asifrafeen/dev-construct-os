import { useMemo, useState } from 'react';
import { Check, Copy, UserPlus } from 'lucide-react';
import {
  credentialModeLabel,
  inviteUrl,
  modeLabel,
  type GeneratedSignupLink,
  type SignupLinkConfiguration,
} from '@/features/signup-links/api';
import { useGenerateSignupLink, useSignupLinkConfigurations } from '@/features/signup-links/hooks';
import { useRoles } from '@/features/roles/hooks';
import { BlocksError } from '@/lib/blocks-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Field, Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';

const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

/** `null` single use, `0` unlimited, otherwise the count. */
function redemptionsLabel(max?: number | null) {
  if (max === 0) return 'Unlimited';
  if (max == null || max === 1) return 'Single use';
  return `${max} uses`;
}

/**
 * IAM refuses with `{ errors: { Field: "message" } }`; the bare BlocksError message is
 * only a status and a URL, which tells an admin nothing they can fix.
 */
function generateErrorMessage(error: unknown): string {
  if (error instanceof BlocksError) {
    const errors = (error.body as { errors?: Record<string, string> } | null)?.errors;
    if (errors && typeof errors === 'object') {
      const messages = Object.entries(errors).map(([field, message]) => `${field}: ${message}`);
      if (messages.length) return messages.join(' · ');
    }
    if (error.status === 403) return 'You are not allowed to generate signup links.';
  }
  return error instanceof Error ? error.message : String(error);
}

export function OneClickSignupPage() {
  const { data, isPending, isError, error } = useSignupLinkConfigurations();
  const configurations = data?.items ?? [];

  const [inviting, setInviting] = useState<{ configurationId: string } | null>(null);
  const [generated, setGenerated] = useState<{
    link: GeneratedSignupLink;
    email: string;
    configuration?: SignupLinkConfiguration;
  } | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">One-Click Sign-Up</h1>
          <p className="text-sm text-muted-foreground">
            Generate a signup link for a named invitee. They open it and land signed in, with
            the roles the link carries.
          </p>
        </div>
        <Button onClick={() => setInviting({ configurationId: '' })}>
          <UserPlus className="h-4 w-4" />
          Invite users
        </Button>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Signup link configurations</CardTitle>
            <CardDescription>{data?.totalCount ?? 0} active</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          {isPending ? (
            <Spinner />
          ) : isError ? (
            <ErrorNote error={error} />
          ) : configurations.length === 0 ? (
            <EmptyState
              title="No configurations"
              description="Create a signup link configuration in IAM first — every link is cut from one."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Configuration</th>
                    <th className="px-2 py-2 font-medium">Mode</th>
                    <th className="px-2 py-2 font-medium">Default roles</th>
                    <th className="px-2 py-2 font-medium">Lifetime</th>
                    <th className="px-2 py-2 font-medium">Redemptions</th>
                    <th className="px-2 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {configurations.map((c) => (
                    <tr key={c.itemId} className="border-b last:border-0">
                      <td className="px-2 py-3">
                        <span className="font-medium">{c.name}</span>
                        {c.description && (
                          <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">
                            {c.description}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Badge>{modeLabel(c.mode)}</Badge>
                          <Badge tone="muted">{credentialModeLabel(c.credentialMode)}</Badge>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-muted-foreground">
                        {c.defaultRoles?.length ? c.defaultRoles.join(', ') : '—'}
                      </td>
                      <td className="px-2 py-3 text-muted-foreground">
                        {c.defaultLifetimeMinutes} min
                      </td>
                      <td className="px-2 py-3 text-muted-foreground">
                        {redemptionsLabel(c.defaultMaxRedemptions)}
                      </td>
                      <td className="px-2 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setInviting({ configurationId: c.itemId })}
                        >
                          <UserPlus className="h-4 w-4" />
                          Invite
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {inviting && (
        <InviteUserModal
          configurations={configurations}
          loadingConfigurations={isPending}
          initialConfigurationId={inviting.configurationId}
          onClose={() => setInviting(null)}
          onGenerated={(link, email, configuration) => {
            setInviting(null);
            setGenerated({ link, email, configuration });
          }}
        />
      )}
      {generated && (
        <GeneratedLinkModal
          link={generated.link}
          email={generated.email}
          configuration={generated.configuration}
          onClose={() => setGenerated(null)}
          onInviteAnother={() => {
            setGenerated(null);
            setInviting({ configurationId: generated.configuration?.itemId ?? '' });
          }}
        />
      )}
    </div>
  );
}

/** The editable part of the form — everything a configuration can pre-fill. */
interface Defaults {
  roles: string[];
  permissions: string;
  forwardedTo: string;
  expiresInMinutes: string;
  maxRedemptions: string;
}

function defaultsFrom(c: SignupLinkConfiguration | undefined): Defaults {
  return {
    roles: c?.defaultRoles ?? [],
    permissions: (c?.defaultPermissions ?? []).join(', '),
    forwardedTo: c?.defaultForwardedTo ?? '',
    expiresInMinutes: c?.defaultLifetimeMinutes ? String(c.defaultLifetimeMinutes) : '',
    // null on the configuration means single use.
    maxRedemptions: String(c?.defaultMaxRedemptions ?? 1),
  };
}

function InviteUserModal({
  configurations,
  loadingConfigurations,
  initialConfigurationId,
  onClose,
  onGenerated,
}: {
  configurations: SignupLinkConfiguration[];
  loadingConfigurations: boolean;
  initialConfigurationId: string;
  onClose: () => void;
  onGenerated: (
    link: GeneratedSignupLink,
    email: string,
    configuration: SignupLinkConfiguration | undefined,
  ) => void;
}) {
  const generate = useGenerateSignupLink();
  const orgRoles = useRoles({ pageSize: 200 });

  const [configurationId, setConfigurationId] = useState(initialConfigurationId);
  const configuration = configurations.find((c) => c.itemId === configurationId);

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [language, setLanguage] = useState('en');
  const [form, setForm] = useState<Defaults>(() => defaultsFrom(configuration));

  // Switching configuration replaces the pre-filled part; who is invited stays.
  const selectConfiguration = (id: string) => {
    setConfigurationId(id);
    setForm(defaultsFrom(configurations.find((c) => c.itemId === id)));
    generate.reset();
  };

  // Org roles plus any configuration default that isn't in this org's list, so a
  // pre-selected role never silently disappears from the checkboxes.
  const roleOptions = useMemo(() => {
    const options = (orgRoles.data?.data ?? [])
      .filter((r) => r.slug)
      .map((r) => ({ slug: r.slug as string, name: r.name || (r.slug as string) }));
    const known = new Set(options.map((o) => o.slug));
    for (const slug of form.roles) if (!known.has(slug)) options.push({ slug, name: slug });
    return options;
  }, [orgRoles.data, form.roles]);

  const toggleRole = (slug: string) =>
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(slug) ? f.roles.filter((r) => r !== slug) : [...f.roles, slug],
    }));

  const forwardedTo = form.forwardedTo.trim();
  const forwardedToInvalid = !!forwardedTo && (!forwardedTo.startsWith('/') || forwardedTo.startsWith('//'));
  const expires = form.expiresInMinutes.trim() ? Number(form.expiresInMinutes) : undefined;
  const expiresInvalid =
    expires !== undefined && (!Number.isInteger(expires) || expires < 5 || expires > 10080);
  const maxRedemptions = form.maxRedemptions.trim() ? Number(form.maxRedemptions) : undefined;
  const maxInvalid =
    maxRedemptions !== undefined && (!Number.isInteger(maxRedemptions) || maxRedemptions < 0);

  const canSubmit =
    !!configurationId &&
    /^\S+@\S+\.\S+$/.test(email.trim()) &&
    !!firstName.trim() &&
    !!lastName.trim() &&
    !forwardedToInvalid &&
    !expiresInvalid &&
    !maxInvalid &&
    !generate.isPending;

  const submit = () => {
    if (!canSubmit) return;
    const permissions = form.permissions
      .split(/[\s,]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const trimmedEmail = email.trim();
    generate.mutate(
      {
        configurationId,
        email: trimmedEmail,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        language: language.trim() || undefined,
        roles: form.roles,
        permissions,
        ...(forwardedTo ? { forwardedTo } : {}),
        ...(expires !== undefined ? { expiresInMinutes: expires } : {}),
        ...(maxRedemptions !== undefined ? { maxRedemptions } : {}),
      },
      { onSuccess: (link) => onGenerated(link, trimmedEmail, configuration) },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      className="max-w-2xl"
      title="Invite users"
      description="Pick a configuration — its defaults are pre-filled and can be changed for this one link."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={generate.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {generate.isPending ? 'Generating…' : 'Generate link'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Configuration" htmlFor="invite-config">
          <select
            id="invite-config"
            className={selectClass}
            value={configurationId}
            disabled={loadingConfigurations}
            onChange={(e) => selectConfiguration(e.target.value)}
          >
            <option value="">
              {loadingConfigurations ? 'Loading configurations…' : '— select a configuration —'}
            </option>
            {configurations.map((c) => (
              <option key={c.itemId} value={c.itemId}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        {configuration && (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              <Badge>{modeLabel(configuration.mode)}</Badge>
              <Badge tone="muted">{credentialModeLabel(configuration.credentialMode)}</Badge>
              {configuration.joinUrl && (
                <span className="truncate">
                  Join URL: <code>{configuration.joinUrl}</code>
                </span>
              )}
              {configuration.description && (
                <span className="w-full">{configuration.description}</span>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" htmlFor="invite-first">
                <Input
                  id="invite-first"
                  autoFocus
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </Field>
              <Field label="Last name" htmlFor="invite-last">
                <Input
                  id="invite-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </Field>
              <Field label="Email" htmlFor="invite-email">
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </Field>
              <Field label="Language" htmlFor="invite-language">
                <Input
                  id="invite-language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="en"
                />
              </Field>
            </div>

            <Field
              label="Roles"
              hint="Pre-selected from the configuration. Leaving none selected falls back to the configuration's defaults."
            >
              {orgRoles.isPending ? (
                <Spinner label="Loading roles…" />
              ) : roleOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No roles in this organization.</p>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                  {roleOptions.map((r) => (
                    <label
                      key={r.slug}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={form.roles.includes(r.slug)}
                        onChange={() => toggleRole(r.slug)}
                      />
                      <span>{r.name}</span>
                      <code className="text-xs text-muted-foreground">{r.slug}</code>
                    </label>
                  ))}
                </div>
              )}
            </Field>

            <Field
              label="Permissions"
              htmlFor="invite-permissions"
              hint="Comma-separated permission names. Empty falls back to the configuration's defaults."
            >
              <Input
                id="invite-permissions"
                value={form.permissions}
                onChange={(e) => setForm((f) => ({ ...f, permissions: e.target.value }))}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Forward to" htmlFor="invite-forward" hint="Relative path, e.g. /organizations">
                <Input
                  id="invite-forward"
                  value={form.forwardedTo}
                  onChange={(e) => setForm((f) => ({ ...f, forwardedTo: e.target.value }))}
                  placeholder="/"
                />
              </Field>
              <Field label="Expires in (min)" htmlFor="invite-expires" hint="5 – 10080">
                <Input
                  id="invite-expires"
                  type="number"
                  min={5}
                  max={10080}
                  value={form.expiresInMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, expiresInMinutes: e.target.value }))}
                />
              </Field>
              <Field label="Max redemptions" htmlFor="invite-max" hint="0 = unlimited">
                <Input
                  id="invite-max"
                  type="number"
                  min={0}
                  value={form.maxRedemptions}
                  onChange={(e) => setForm((f) => ({ ...f, maxRedemptions: e.target.value }))}
                />
              </Field>
            </div>

            {forwardedToInvalid && (
              <p className="text-sm text-destructive">Forward to must be a relative path starting with /.</p>
            )}
            {expiresInvalid && (
              <p className="text-sm text-destructive">Expiry must be a whole number between 5 and 10080.</p>
            )}
            {maxInvalid && (
              <p className="text-sm text-destructive">Max redemptions must be 0 or a positive whole number.</p>
            )}
          </>
        )}

        {generate.isError && <ErrorNote error={new Error(generateErrorMessage(generate.error))} />}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function GeneratedLinkModal({
  link,
  email,
  configuration,
  onClose,
  onInviteAnother,
}: {
  link: GeneratedSignupLink;
  email: string;
  configuration?: SignupLinkConfiguration;
  onClose: () => void;
  onInviteAnother: () => void;
}) {
  const url = inviteUrl(link);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions) — the link is still
      // selectable in the field below.
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      className="max-w-2xl"
      title="Signup link generated"
      description={
        <>
          For <span className="font-medium text-foreground">{email}</span>
          {configuration && <> via {configuration.name}</>}. Send it to the invitee — this is the
          only time it is shown.
        </>
      }
      footer={
        <>
          <Button variant="outline" onClick={onInviteAnother}>
            Invite another
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="flex gap-2">
        <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
        <Button variant="outline" onClick={copy} title="Copy link">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Expires</dt>
        <dd>{formatDate(link.expiresAtUtc)}</dd>
        <dt className="text-muted-foreground">Link id</dt>
        <dd className="font-mono text-xs">{link.linkId}</dd>
      </dl>

      {link.emailAlreadyExists && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          This email already has an account. Opening the link signs them in and applies the
          link's roles instead of creating a new user.
        </p>
      )}
      {!link.url && (
        <p className="text-xs text-muted-foreground">
          The configuration has no join URL, so this link points at this app's /invitation page.
        </p>
      )}
    </Modal>
  );
}
