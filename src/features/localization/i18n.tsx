import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { localization, languageCode, type Dictionary, type Language } from './api';

/**
 * App-wide translations from Blocks Localization.
 *
 * Which modules load is a build-time choice (`VITE_BLOCKS_I18N_MODULES`, comma-separated,
 * default `common`), because a module is a bundle of keys the app was written against —
 * not something to discover at runtime. The language is the user's, persisted per browser
 * and defaulting to whichever language the project marks `isDefault`.
 *
 * `t(key, fallback)` never blocks rendering: until the dictionary lands, and for any key
 * the project hasn't defined, the English fallback shows. Keys that miss are recorded so the
 * Localization page can list exactly what to add in the console.
 */

export const I18N_MODULES = (import.meta.env.VITE_BLOCKS_I18N_MODULES || 'common')
  .split(',')
  .map((m: string) => m.trim())
  .filter(Boolean);

interface LanguageState {
  language: string | null;
  setLanguage: (language: string) => void;
}

const useStoredLanguage = create<LanguageState>()(
  persist((set) => ({ language: null, setLanguage: (language) => set({ language }) }), {
    name: 'blocks.language',
  }),
);

/** Keys looked up but absent, with the fallback text the app used for each. */
const missing = new Map<string, string>();
export const missingKeys = () => new Map(missing);
export const clearMissingKeys = () => missing.clear();

interface I18nValue {
  language: string;
  setLanguage: (language: string) => void;
  languages: Language[];
  dictionary: Dictionary;
  isLoading: boolean;
  error: unknown;
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { language: stored, setLanguage } = useStoredLanguage();

  const languages = useQuery({
    queryKey: ['localization', 'languages'],
    queryFn: () => localization.languages(),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const list = languages.data ?? [];
  const fallbackLanguage = languageCode(list.find((l) => l.isDefault) ?? list[0] ?? {}) || 'en-US';
  // A stored choice the project no longer offers is ignored rather than requested forever.
  const language =
    stored && (!list.length || list.some((l) => languageCode(l) === stored)) ? stored : fallbackLanguage;

  const dictionary = useQuery({
    queryKey: ['localization', 'dictionary', language, I18N_MODULES],
    queryFn: async () => {
      const parts = await Promise.all(
        I18N_MODULES.map((m: string) => localization.dictionary(m, language).catch(() => ({}))),
      );
      // Later modules win on a key collision, same as the SDK's load().
      return Object.assign({}, ...parts) as Dictionary;
    },
    enabled: !languages.isPending,
    staleTime: 10 * 60_000,
    retry: false,
  });

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const dict = dictionary.data;
  const t = useCallback(
    (key: string, fallback?: string) => {
      const hit = dict?.[key];
      if (hit) return hit;
      if (dict) missing.set(key, fallback ?? '');
      return fallback ?? key;
    },
    [dict],
  );

  const value = useMemo<I18nValue>(
    () => ({
      language,
      setLanguage,
      languages: list,
      dictionary: dict ?? {},
      isLoading: languages.isPending || dictionary.isPending,
      error: languages.error ?? dictionary.error,
      t,
    }),
    [language, setLanguage, list, dict, languages.isPending, dictionary.isPending, languages.error, dictionary.error, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Shorthand for components that only need the lookup. */
export const useT = () => useI18n().t;
