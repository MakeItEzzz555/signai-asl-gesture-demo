import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { LANGUAGES, type LanguageCode } from '../i18n/translations';
import { cn } from '@/lib/utils';

interface LanguageSelectorProps {
  value: LanguageCode;
  onChange: (code: LanguageCode) => void;
  className?: string;
}

export default function LanguageSelector({ value, onChange, className }: LanguageSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find(l => l.code === value) ?? LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium border transition-all duration-200',
          'bg-muted/80 text-foreground',
          'flag-selected',
          'hover:scale-105 hover:bg-muted',
          open && 'ring-2 ring-primary/40',
        )}
      >
        <img
          src={`https://flagcdn.com/24x18/${current.flagCode}.png`}
          alt={current.code.toUpperCase()}
          style={{ width: '24px', height: '18px', borderRadius: '2px' }}
        />
        <span>{current.code.toUpperCase()}</span>
        <ChevronDown className={cn(
          'w-3 h-3 text-muted-foreground transition-transform duration-150',
          open && 'rotate-180',
        )} />
      </button>

      {open && (
        <div className={cn(
          'absolute right-0 top-full mt-1.5 z-50',
          'w-56 max-h-80 overflow-y-auto',
          'bg-card border border-primary/20 rounded-xl',
          'shadow-[0_8px_40px_rgba(0,0,0,0.5),0_0_0_1px_rgba(0,217,255,0.1)]',
          'py-1',
        )}>
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              type="button"
              onClick={() => { onChange(lang.code); setOpen(false); }}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all duration-150',
                lang.code === value
                  ? 'bg-primary/20 text-primary shadow-[inset_0_0_20px_rgba(0,217,255,0.08)]'
                  : 'text-foreground hover:bg-muted hover:translate-x-0.5',
              )}
            >
              <img
                src={`https://flagcdn.com/24x18/${lang.flagCode}.png`}
                alt={lang.code.toUpperCase()}
                style={{ width: '24px', height: '18px', borderRadius: '2px', flexShrink: 0 }}
              />
              <span className="font-mono text-[11px] font-semibold w-7 shrink-0">
                {lang.code.toUpperCase()}
              </span>
              <span className={cn(
                'text-xs truncate',
                lang.code === value ? 'text-primary/80 font-medium' : 'text-muted-foreground',
              )}>
                {lang.nativeName}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
