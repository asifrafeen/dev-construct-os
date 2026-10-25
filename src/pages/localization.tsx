import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import {
  localization,
  languageCode,
  languageLabel,
  moduleName,
  type Language,
  type LocalizationModule,
} from '@/features/localization/api';
import { clearMissingKeys, I18N_MODULES, missingKeys, useI18n } from '@/features/localization/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Checkbox, Select, Textarea, splitList } from '@/components/ui/form';
import { JsonView, PageHeader, Tabs } from '@/components/ui/layout';

type Tab = 'languages' | 'dictionary' | 'keys' | 'missing';

export function LocalizationPage() {
  const [tab, setTab] = useState<Tab>('languages');
  const { language, dictionary, isLoading, t } = useI18n();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('LOCALIZATION_TITLE', 'Localization')}
        description={
          <>
            Runtime translations. The app is rendering <Badge tone="muted">{language}</Badge> from module(s){' '}
            {I18N_MODULES.map((m: string) => (
              <Badge key={m} className="mr-1">
                {m}
              </Badge>
            ))}
            — {isLoading ? 'loading…' : `${Object.keys(dictionary).length} keys loaded`}.
          </>
        }
        endpoints={[
          'GET /localization/v4/Language/Gets',
          'GET /localization/v4/Module/Gets',
          'GET /localization/v4/Key/GetUilmFile',
          'GET /localization/v4/Key/GetCloudUilmFile',
          'POST /localization/v4/Key/GetsByKeyNames',
        ]}
      />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'languages', label: 'Languages & modules' },
          { value: 'dictionary', label: 'Dictionary browser' },
          { value: 'keys', label: 'Key lookup' },
          { value: 'missing', label: 'Missing keys' },
        ]}
      />

      {tab === 'languages' && <LanguagesTab />}
      {tab === 'dictionary' && <DictionaryTab />}
      {tab === 'keys' && <KeysTab />}
      {tab === 'missing' && <MissingTab />}
    </div>
  );
}

function LanguagesTab() {
  const publicLangs = useQuery({ queryKey: ['loc', 'langs', 'public'], queryFn: localization.languages, retry: false });
  const tenantLangs = useQuery({ queryKey: ['loc', 'langs', 'tenant'], queryFn: localization.languagesForTenant, retry: false });
  const publicMods = useQuery({ queryKey: ['loc', 'mods', 'public'], queryFn: localization.modules, retry: false });
  const tenantMods = useQuery({ queryKey: ['loc', 'mods', 'tenant'], queryFn: localization.modulesForTenant, retry: false });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ListCard title="Languages (public)" subtitle="Language/Gets — no session needed" query={publicLangs} render={renderLanguage} />
      <ListCard
        title="Languages (current tenant)"
        subtitle="Language/GetLanguagesForCurrentTenant — under the session"
        query={tenantLangs}
        render={renderLanguage}
      />
      <ListCard title="Modules (public)" subtitle="Module/Gets" query={publicMods} render={renderModule} />
      <ListCard
        title="Modules (current tenant)"
        subtitle="Module/GetModulesForCurrentTenant"
        query={tenantMods}
        render={renderModule}
      />
    </div>
  );
}

function renderLanguage(l: Language) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{languageLabel(l)}</span>
      <span className="flex items-center gap-2">
        <code className="text-xs text-muted-foreground">{languageCode(l)}</code>
        {l.isDefault && <Badge tone="success">default</Badge>}
      </span>
    </div>
  );
}

function renderModule(m: LocalizationModule) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{moduleName(m)}</span>
      <code className="truncate text-xs text-muted-foreground">{m.itemId}</code>
    </div>
  );
}

function ListCard<T>({
  title,
  subtitle,
  query,
  render,
}: {
  title: string;
  subtitle: string;
  query: { data?: T[]; isPending: boolean; isError: boolean; error: unknown };
  render: (item: T) => ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <Spinner />
        ) : query.isError ? (
          <ErrorNote error={query.error} />
        ) : !query.data?.length ? (
          <EmptyState title="None configured" />
        ) : (
          <ul className="divide-y text-sm">
            {query.data.map((item, i) => (
              <li key={i} className="py-2">
                {render(item)}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DictionaryTab() {
  const { languages, language: active } = useI18n();
  const modules = useQuery({ queryKey: ['loc', 'mods', 'public'], queryFn: localization.modules, retry: false });
  const [module, setModule] = useState(I18N_MODULES[0] ?? '');
  const [language, setLanguage] = useState(active);
  const [cloud, setCloud] = useState(false);
  const [filter, setFilter] = useState('');

  const dict = useQuery({
    queryKey: ['loc', 'dict', module, language, cloud],
    queryFn: () => localization.dictionary(module, language, cloud),
    enabled: !!module && !!language,
    retry: false,
  });

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return Object.entries(dict.data ?? {})
      .filter(([k, v]) => !q || k.toLowerCase().includes(q) || v.toLowerCase().includes(q))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [dict.data, filter]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dictionary</CardTitle>
        <CardDescription>One module, one language — the flat key → text map an app renders from.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Module</span>
            <Select className="w-48" value={module} onChange={(e) => setModule(e.target.value)}>
              {Array.from(new Set([...I18N_MODULES, ...(modules.data ?? []).map(moduleName)]))
                .filter(Boolean)
                .map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
            </Select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Language</span>
            <Select className="w-48" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {Array.from(new Set([active, ...languages.map(languageCode)])).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </label>
          <Checkbox
            label="Cloud (authenticated) file"
            hint="GetCloudUilmFile instead of GetUilmFile"
            checked={cloud}
            onChange={setCloud}
          />
          <Input className="max-w-xs" placeholder="Filter keys or text…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Button variant="outline" size="sm" onClick={() => dict.refetch()}>
            <RefreshCw className="h-4 w-4" /> Reload
          </Button>
        </div>

        {dict.isPending ? (
          <Spinner />
        ) : dict.isError ? (
          <ErrorNote error={dict.error} />
        ) : rows.length === 0 ? (
          <EmptyState title="No keys" description="This module has no translations for that language, or the filter excludes them." />
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Key</th>
                  <th className="px-2 py-2 font-medium">Text</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="px-2 py-2 font-mono text-xs">{k}</td>
                    <td className="px-2 py-2">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="pt-2 text-xs text-muted-foreground">{rows.length} keys</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KeysTab() {
  const [names, setNames] = useState('');
  const [moduleId, setModuleId] = useState('');
  const lookup = useMutation({ mutationFn: () => localization.keysByNames(splitList(names), moduleId.trim() || undefined) });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Look up keys by name</CardTitle>
        <CardDescription>Full key records — every language's value, routes and context — without loading a module.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea mono placeholder="KEY_ONE, KEY_TWO" value={names} onChange={(e) => setNames(e.target.value)} />
        <Input placeholder="Module id (optional)" value={moduleId} onChange={(e) => setModuleId(e.target.value)} />
        <Button disabled={!splitList(names).length || lookup.isPending} onClick={() => lookup.mutate()}>
          <Search className="h-4 w-4" /> {lookup.isPending ? 'Looking up…' : 'Look up'}
        </Button>
        {lookup.isError && <ErrorNote error={lookup.error} />}
        {lookup.data && <JsonView value={lookup.data} />}
      </CardContent>
    </Card>
  );
}

function MissingTab() {
  const [snapshot, setSnapshot] = useState(() => missingKeys());
  const asJson = JSON.stringify(Object.fromEntries(snapshot), null, 2);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Keys the app asked for but the project lacks</CardTitle>
          <CardDescription>
            Collected as you browse. Add these to the loaded module(s) in Blocks OS → Localization and they
            replace the English fallbacks on the next load.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setSnapshot(missingKeys())}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              clearMissingKeys();
              setSnapshot(missingKeys());
            }}
          >
            Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {snapshot.size === 0 ? (
          <EmptyState title="Nothing missing yet" description="Every key looked up so far was found — or the dictionary has not loaded." />
        ) : (
          <JsonView value={asJson} />
        )}
      </CardContent>
    </Card>
  );
}
