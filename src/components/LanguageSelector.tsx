import { LANGUAGES, type LanguageCode } from '../i18n/translations';
import { cn } from '../lib/utils';

interface LanguageSelectorProps {
  value: LanguageCode;
  onChange: (code: LanguageCode) => void;
  className?: string;
}

export default function LanguageSelector({ value, onChange, className }: LanguageSelectorProps) {
  return (
    <label className={cn('flex items-center gap-2', className)}>
      <span className="sr-only">Output language</span>
      <select
        aria-label="Output language"
        value={value}
        onChange={event => onChange(event.target.value as LanguageCode)}
        className="max-w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground"
      >
        {LANGUAGES.map(language => (
          <option key={language.code} value={language.code}>
            {language.nativeName} ({language.code.toUpperCase()})
          </option>
        ))}
      </select>
    </label>
  );
}
