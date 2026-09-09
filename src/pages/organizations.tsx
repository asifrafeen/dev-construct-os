import { useEffect, useState } from 'react';
import { Building2, Check, Loader2, Plus } from 'lucide-react';
import type { Organization } from '@/features/orgs/api';
import {
  useActiveOrg,
  useCreateOrg,
  useMyOrgs,
  useOrg,
  useOrgConfig,
  useOrgs,
  useSwitchOrg,
  useUpdateOrg,
} from '@/features/orgs/hooks';
import { authErrorMessage } from '@/features/auth/errors';
import { useRoles } from '@/features/roles/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Field, Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';

const PAGE_SIZE = 20;

export function OrganizationsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Organization | null>(null);

  const { activeOrgId } = useActiveOrg();
  const config = useOrgConfig();
  const switchOrg = useSwitchOrg();

  // This table lists every organization in the project, but switching is only possible
  // into one the signed-in user actually belongs to — IAM checks membership and answers
  // `organization_not_available` otherwise. `organizations/my` is that membership list,
  // so the button can say why it is unavailable instead of failing on click.
  const myOrgs = useMyOrgs();
  const memberOf = new Set((myOrgs.data ?? []).map((o) => o.itemId));

  useEffect(() => setPage(0), [search]);

  const { data, isPending, isError, error } = useOrgs({ page, pageSize: PAGE_SIZE, search });
  const rows = data?.organizations ?? [];
  const total = data?.totalCount ?? rows.length;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  // The server gates creation per surface; this app is the Construct surface.
  const creationBlocked = config.data && !config.data.allowOrgCreationFromConstruct;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
          <p className="text-sm text-muted-foreground">
            GET /iam/v4/iam/organizations — every organization in this project.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="w-full max-w-xs"
            placeholder="Search organizations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button onClick={() => setCreating(true)} disabled={!!creationBlocked}>
            <Plus className="h-4 w-4" />
            New organization
          </Button>
        </div>
      </div>

      {creationBlocked && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Organization creation from Construct is turned off for this project
          (<code>allowOrgCreationFromConstruct</code> is false). Enable it in the project's
          organization config to use the button above.
        </p>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">All organizations</CardTitle>
            <CardDescription>{total} total</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          {switchOrg.isError && (
            <div className="mb-4">
              <ErrorNote error={authErrorMessage(switchOrg.error)} />
            </div>
          )}

          {isPending ? (
            <Spinner />
          ) : isError ? (
            <ErrorNote error={error} />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No organizations"
              description={
                search ? 'Nothing matches your search.' : 'Create the first organization.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Organization</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">Default roles</th>
                    <th className="px-2 py-2 font-medium">Created</th>
                    <th className="px-2 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.itemId} className="border-b last:border-0">
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium">{o.name || '—'}</span>
                              {o.itemId === activeOrgId && <Badge tone="default">Active</Badge>}
                            </div>
                            {o.description && (
                              <p className="max-w-md truncate text-xs text-muted-foreground">
                                {o.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <Badge tone={o.isDisabled ? 'muted' : 'success'}>
                          {o.isDisabled ? 'Disabled' : 'Enabled'}
                        </Badge>
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap gap-1">
                          {o.defaultRoleForMembers?.length ? (
                            o.defaultRoleForMembers.map((r) => (
                              <Badge key={r} tone="muted">
                                {r}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-3 text-muted-foreground">{formatDate(o.createdDate)}</td>
                      <td className="px-2 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={
                              o.itemId === activeOrgId ||
                              switchOrg.isPending ||
                              // Still loading the membership list: better to wait than
                              // to offer a switch that would be refused.
                              myOrgs.isPending ||
                              !memberOf.has(o.itemId)
                            }
                            onClick={() => switchOrg.mutate(o.itemId)}
                            title={
                              memberOf.has(o.itemId)
                                ? 'Move your session into this organization'
                                : 'You are not a member of this organization'
                            }
                          >
                            {o.itemId === activeOrgId ? (
                              <Check className="h-4 w-4" />
                            ) : switchOrg.isPending && switchOrg.variables === o.itemId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Switch to'
                            )}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setViewing(o)}>
                            Details
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Page {page + 1} of {lastPage + 1}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= lastPage}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      {creating && <CreateOrgModal onClose={() => setCreating(false)} />}
      {viewing && <OrgDetailModal org={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/**
 * Creating an organization is a two-step affair on purpose.
 *
 * IAM creates the record, but the session stays where it is — and `/auth/switch-org`
 * only admits a user who is a *member* of the target. Whether creating one makes you a
 * member is the server's call, so rather than assume either way, the success step offers
 * the switch and reports plainly if it is refused.
 */
function CreateOrgModal({ onClose }: { onClose: () => void }) {
  const create = useCreateOrg();
  const switchOrg = useSwitchOrg();
  // Default roles are slugs from the *active* org's role list — the new org has none yet.
  const rolesQuery = useRoles({ pageSize: 200 });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [industry, setIndustry] = useState('');
  const [timeZone, setTimeZone] = useState(() => {
    // The browser already knows; pre-filling beats making someone hunt for it.
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    } catch {
      return '';
    }
  });
  const [currency, setCurrency] = useState('');
  const [locale, setLocale] = useState(() => navigator.language ?? '');
  const [primaryColor, setPrimaryColor] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [defaultRoles, setDefaultRoles] = useState<Set<string>>(new Set());

  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');

  /** Set once IAM accepts — flips the modal into its success step. */
  const [createdId, setCreatedId] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && !create.isPending;

  const toggleRole = (slug: string) =>
    setDefaultRoles((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const submit = () => {
    if (!canSubmit) return;

    // Send an address only if something was actually typed — an object of empty
    // strings is worse than no address at all.
    const [line1, town, region, postal, nation] = [
      addressLine1,
      city,
      state,
      postalCode,
      country,
    ].map((v) => v.trim());
    const hasAddress = [line1, town, region, postal, nation].some(Boolean);

    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        email: email.trim() || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        industry: industry.trim() || undefined,
        timeZone: timeZone.trim() || undefined,
        currency: currency.trim() || undefined,
        locale: locale.trim() || undefined,
        logoUrl: logoUrl.trim() || undefined,
        theme: primaryColor.trim() ? { primaryColor: primaryColor.trim() } : undefined,
        defaultRoleForMembers: defaultRoles.size ? [...defaultRoles] : undefined,
        addresses: hasAddress
          ? [
              {
                addressLine1: line1 || undefined,
                city: town || undefined,
                state: region || undefined,
                postalCode: postal || undefined,
                country: nation || undefined,
                isPrimary: true,
              },
            ]
          : undefined,
      },
      // The envelope keys the new id under `itemId`, not `data`.
      { onSuccess: (result) => setCreatedId(result.itemId ?? '') },
    );
  };

  if (createdId !== null) {
    return (
      <Modal
        open
        onClose={onClose}
        title={`${name.trim()} created`}
        description="The organization exists. Your session is still in the previous one."
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={switchOrg.isPending}>
              Stay here
            </Button>
            <Button
              disabled={!createdId || switchOrg.isPending}
              onClick={() => switchOrg.mutate(createdId, { onSuccess: () => onClose() })}
            >
              {switchOrg.isPending ? 'Switching…' : 'Switch to it'}
            </Button>
          </>
        }
      >
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Row label="Name">{name.trim()}</Row>
          <Row label="Id">
            <code className="break-all text-xs">{createdId || '— not returned —'}</code>
          </Row>
        </dl>

        <p className="text-sm text-muted-foreground">
          Switch in before creating roles here — a new role lands in whichever organization
          the session is in, so roles made now would go to the old one.
        </p>

        {switchOrg.isError && <ErrorNote error={authErrorMessage(switchOrg.error)} />}
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      className="max-w-2xl"
      title="New organization"
      description="Only a name is required; everything else can be filled in later."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {create.isPending ? 'Creating…' : 'Create organization'}
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
        <Field label="Name" htmlFor="org-name">
          <Input
            id="org-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Construction"
          />
        </Field>

        <Field label="Description" htmlFor="org-description">
          <textarea
            id="org-description"
            className="h-20 w-full resize-y rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact email" htmlFor="org-email">
            <Input
              id="org-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Phone" htmlFor="org-phone">
            <Input
              id="org-phone"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
            />
          </Field>
          <Field label="Website" htmlFor="org-website">
            <Input
              id="org-website"
              placeholder="https://example.com"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
            />
          </Field>
          <Field label="Industry" htmlFor="org-industry">
            <Input
              id="org-industry"
              placeholder="Construction"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            />
          </Field>
        </div>

        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Locale, branding and address
          </summary>
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Time zone" htmlFor="org-tz">
                <Input id="org-tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />
              </Field>
              <Field label="Locale" htmlFor="org-locale">
                <Input
                  id="org-locale"
                  placeholder="en-US"
                  value={locale}
                  onChange={(e) => setLocale(e.target.value)}
                />
              </Field>
              <Field label="Currency" htmlFor="org-currency">
                <Input
                  id="org-currency"
                  placeholder="USD"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary colour" htmlFor="org-color" hint="Any CSS colour, e.g. #2563eb">
                <div className="flex gap-2">
                  <Input
                    id="org-color"
                    placeholder="#2563eb"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                  />
                  <input
                    type="color"
                    aria-label="Pick primary colour"
                    className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background"
                    value={/^#[0-9a-f]{6}$/i.test(primaryColor) ? primaryColor : '#2563eb'}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                  />
                </div>
              </Field>
              <Field label="Logo URL" htmlFor="org-logo">
                <Input
                  id="org-logo"
                  placeholder="https://…/logo.png"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Primary address" htmlFor="org-address1">
              <Input
                id="org-address1"
                placeholder="Street address"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-4">
              <Input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
              <Input placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
              <Input
                placeholder="Postal code"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
              />
              <Input
                placeholder="Country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </div>
          </div>
        </details>

        <Field
          label="Default roles for new members"
          hint="Granted automatically to anyone who joins. Listed from the organization you are currently in."
        >
          {rolesQuery.isPending ? (
            <Spinner label="Loading roles…" />
          ) : !rolesQuery.data?.data?.length ? (
            <p className="text-sm text-muted-foreground">No roles to choose from.</p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
              {rolesQuery.data.data
                .filter((r) => !!r.slug && !r.isArchived)
                .map((r) => (
                  <label
                    key={r.itemId}
                    className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-sm hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={defaultRoles.has(r.slug as string)}
                      onChange={() => toggleRole(r.slug as string)}
                    />
                    <span>{r.name}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.slug}</code>
                  </label>
                ))}
            </div>
          )}
        </Field>

        {create.isError && <ErrorNote error={create.error} />}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function OrgDetailModal({ org: listRow, onClose }: { org: Organization; onClose: () => void }) {
  const update = useUpdateOrg();
  const detail = useOrg(listRow.itemId);
  const org = detail.data ?? listRow;

  const addresses = org.addresses ?? [];
  const attributes = Object.entries(org.attributes ?? {});

  return (
    <Modal
      open
      onClose={onClose}
      className="max-w-2xl"
      title={org.name || 'Organization'}
      description={org.description}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            Close
          </Button>
          <Button
            variant={org.isDisabled ? 'default' : 'destructive'}
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { id: org.itemId, isDisabled: !org.isDisabled },
                { onSuccess: () => onClose() },
              )
            }
          >
            {update.isPending ? 'Saving…' : org.isDisabled ? 'Enable' : 'Disable'}
          </Button>
        </>
      }
    >
      {detail.isPending && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading full details…
        </p>
      )}

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Row label="Id">
          <code className="break-all text-xs">{org.itemId}</code>
        </Row>
        <Row label="Short code">{org.shortCode || '—'}</Row>
        <Row label="Status">
          <Badge tone={org.isDisabled ? 'muted' : 'success'}>
            {org.isDisabled ? 'Disabled' : 'Enabled'}
          </Badge>
        </Row>
        <Row label="Email">{org.email || '—'}</Row>
        <Row label="Phone">{org.phoneNumber || '—'}</Row>
        <Row label="Website">{org.websiteUrl || '—'}</Row>
        <Row label="Industry">{org.industry || '—'}</Row>
        <Row label="Time zone">{org.timeZone || '—'}</Row>
        <Row label="Currency">{org.currency || '—'}</Row>
        <Row label="Locale">{org.locale || '—'}</Row>
        <Row label="Date format">{org.dateFormat || '—'}</Row>
        <Row label="Time format">{org.timeFormat || '—'}</Row>
        <Row label="Created">{formatDate(org.createdDate)}</Row>
        <Row label="Default roles">
          {org.defaultRoleForMembers?.length ? org.defaultRoleForMembers.join(', ') : '—'}
        </Row>
        <Row label="Parent org">{org.parentOrganizationId || '—'}</Row>
      </dl>

      {addresses.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Addresses</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {addresses.map((address, index) => (
              <div key={index} className="rounded-md border p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  {address.name || `Address ${index + 1}`}
                  {address.isPrimary && <Badge tone="default">Primary</Badge>}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {[
                    address.addressLine1,
                    address.addressLine2,
                    address.city,
                    address.state,
                    address.postalCode,
                    address.country,
                  ]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {attributes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Attributes</p>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {attributes.map(([key, value]) => (
              <Row key={key} label={key}>
                {/* Values are free-form JSON — a number and a string both land here. */}
                {typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
              </Row>
            ))}
          </dl>
        </div>
      )}

      {/* The row is still on screen, so a failed read degrades rather than blanks. */}
      {detail.isError && <ErrorNote error={detail.error} />}
      {update.isError && <ErrorNote error={update.error} />}
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}
