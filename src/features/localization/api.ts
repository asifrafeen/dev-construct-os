import { blocksFetch } from '@/lib/blocks-client';
import { LOCALIZATION_BASE } from '@/lib/env';

/**
 * Runtime localization — reading translations, never authoring them (that is the
 * console / `blocks localization *` CLI).
 *
 * Every read comes in two flavours. The public ones (`Language/Gets`, `Module/Gets`,
 * `Key/GetUilmFile`) need only `x-blocks-key`, so the login page can be translated before
 * anyone signs in. The `*ForCurrentTenant` / `GetCloudUilmFile` ones run under the session.
 * Both are wired so either can be tested; the app itself uses the public pair.
 *
 * Routes are PascalCase `Controller/Action` — this service predates the kebab-case
 * convention the newer Data routes use.
 */

const L = LOCALIZATION_BASE;

export interface Language {
  itemId?: string;
  languageName?: string;
  languageCode?: string;
  isDefault?: boolean;
  [k: string]: unknown;
}

export interface LocalizationModule {
  itemId?: string;
  moduleName?: string;
  name?: string;
  [k: string]: unknown;
}

export interface KeyResource {
  value?: string;
  culture?: string;
  characterLength?: number;
}

export interface LocalizationKey {
  itemId?: string;
  keyName?: string;
  moduleId?: string;
  resources?: KeyResource[];
  routes?: string[];
  context?: string;
  isPartiallyTranslated?: boolean;
  [k: string]: unknown;
}

export type Dictionary = Record<string, string>;

const KEY_MISSING = '[ KEY MISSING ]';

/** Language records are not consistent about which field carries the code. */
export const languageCode = (l: Language): string =>
  String(l.languageCode ?? l.code ?? l.culture ?? l.name ?? '');
export const languageLabel = (l: Language): string =>
  String(l.languageName ?? l.displayName ?? l.name ?? languageCode(l));
export const moduleName = (m: LocalizationModule): string => String(m.moduleName ?? m.name ?? '');

/** Lists may come bare or inside a `data` envelope depending on the build. */
function unwrapList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  const data = (value as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

/**
 * A UILM file is a flat `{ KEY: "text" }` map, sometimes wrapped in `data`. Non-string
 * values are dropped — a dictionary that hands an object to a label renders
 * "[object Object]", which is worse than the fallback.
 */
function toDictionary(value: unknown): Dictionary {
  const record =
    value && typeof value === 'object'
      ? ((value as { data?: unknown }).data && typeof (value as { data?: unknown }).data === 'object'
          ? (value as { data: Record<string, unknown> }).data
          : (value as Record<string, unknown>))
      : {};
  const out: Dictionary = {};
  // An untranslated key is published as the literal "[ KEY MISSING ]" — treat it as
  // absent so the app's fallback shows instead of the marker.
  for (const [k, v] of Object.entries(record)) if (typeof v === 'string' && v !== KEY_MISSING) out[k] = v;
  return out;
}

export const localization = {
  languages: () => blocksFetch<unknown>(`${L}/Language/Gets`, { noRetry: true }).then(unwrapList<Language>),
  modules: () =>
    blocksFetch<unknown>(`${L}/Module/Gets`, { noRetry: true }).then(unwrapList<LocalizationModule>),

  languagesForTenant: () =>
    blocksFetch<unknown>(`${L}/Language/GetLanguagesForCurrentTenant`).then(unwrapList<Language>),
  modulesForTenant: () =>
    blocksFetch<unknown>(`${L}/Module/GetModulesForCurrentTenant`).then(unwrapList<LocalizationModule>),

  /** Module first, language second — the order the endpoint and the SDK both use. */
  dictionary: (module: string, language: string, cloud = false) => {
    const qs = new URLSearchParams({ Language: language, ModuleName: module });
    return blocksFetch<unknown>(`${L}/Key/${cloud ? 'GetCloudUilmFile' : 'GetUilmFile'}?${qs}`, {
      noRetry: !cloud,
    }).then(toDictionary);
  },

  keysByNames: (keyNames: string[], moduleId?: string) =>
    blocksFetch<{ keys?: LocalizationKey[]; errorMessage?: string }>(`${L}/Key/GetsByKeyNames`, {
      method: 'POST',
      body: { keyNames, ...(moduleId ? { moduleId } : {}) },
    }),
};
