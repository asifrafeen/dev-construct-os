import { Languages } from 'lucide-react';
import { useI18n } from './i18n';
import { languageCode, languageLabel } from './api';

/**
 * Picks the language the whole app renders in. Hidden when the project defines fewer
 * than two languages — a one-option picker is noise.
 */
export function LanguageSwitcher() {
  const { language, setLanguage, languages } = useI18n();
  if (languages.length < 2) return null;

  return (
    <label className="flex items-center gap-1.5 text-muted-foreground" title="Language">
      <Languages className="h-4 w-4" />
      <select
        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
      >
        {languages.map((l) => (
          <option key={languageCode(l)} value={languageCode(l)}>
            {languageLabel(l)}
          </option>
        ))}
      </select>
    </label>
  );
}
