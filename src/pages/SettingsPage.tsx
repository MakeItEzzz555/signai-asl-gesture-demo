/**
 * SettingsPage.tsx — Accessibility & Preferences
 * Features:
 * - Theme toggle (dark/light)
 * - High contrast mode
 * - Text size adjustment
 * - Audio settings
 * - Auto-speak toggle
 * - About / system info
 */

import { useEffect } from 'react';
import { Sun, Moon, Contrast, Type, Volume2, VolumeX, Mic, Info, Globe, Wifi } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { useTheme } from '../contexts/ThemeContext';
import { cn } from '@/lib/utils';
import LanguageSelector from '../components/LanguageSelector';
import { toast } from 'sonner';
import { speak, stopSpeech, syncSpeechPreferences } from '../utils/tts';
import { LANGUAGE_BCP47, LANGUAGES, translateGesture } from '../i18n/translations';

function SettingRow({ icon: Icon, title, description, children }: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 border-b border-border last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      <div className="self-start sm:self-center sm:ml-4">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        "relative w-11 h-6 rounded-full transition-colors duration-200",
        checked ? "bg-primary" : "bg-muted"
      )}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <div className={cn(
        "absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200",
        checked ? "translate-x-6" : "translate-x-1"
      )} />
    </button>
  );
}

export default function SettingsPage() {
  const { accessibility, setAccessibility } = useApp();
  const { theme, toggleTheme } = useTheme();
  const setTheme = (t: 'dark' | 'light') => { if (t !== theme) toggleTheme?.(); };

  useEffect(() => {
    syncSpeechPreferences({
      audioEnabled: accessibility.audioEnabled,
      useCloudVoices: accessibility.useCloudTts,
      language: LANGUAGE_BCP47[accessibility.language] ?? 'en-US',
    });
  }, [accessibility.audioEnabled, accessibility.language, accessibility.useCloudTts]);

  const updateAccessibility = (partial: Parameters<typeof setAccessibility>[0]) => {
    if (partial.audioEnabled === false) stopSpeech();
    setAccessibility(partial);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
          Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the interface for your accessibility needs and preferences.
        </p>
      </div>

      {/* ── Appearance ─────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Appearance
        </h2>
        <SettingRow
          icon={theme === 'dark' ? Moon : Sun}
          title="Color Theme"
          description="Switch between dark and light interface themes"
        >
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTheme('dark')}
              aria-pressed={theme === 'dark'}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                theme === 'dark'
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "bg-muted text-muted-foreground border-border hover:text-foreground"
              )}
            >
              <Moon className="w-3.5 h-3.5" />
              Dark
            </button>
            <button
              type="button"
              onClick={() => setTheme('light')}
              aria-pressed={theme === 'light'}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                theme === 'light'
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "bg-muted text-muted-foreground border-border hover:text-foreground"
              )}
            >
              <Sun className="w-3.5 h-3.5" />
              Light
            </button>
          </div>
        </SettingRow>

        <SettingRow
          icon={Contrast}
          title="High Contrast Mode"
          description="Increases contrast for better visibility (WCAG AAA)"
        >
          <Toggle
            checked={accessibility.highContrast}
            onChange={() => updateAccessibility({ highContrast: !accessibility.highContrast })}
            label="High contrast mode"
          />
        </SettingRow>
      </div>

      {/* ── Language ──────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Language
        </h2>
        <SettingRow
          icon={Globe}
          title="Output Language"
          description="Translate recognized gesture labels into your preferred language"
        >
          <LanguageSelector
            value={accessibility.language}
            onChange={code => {
              setAccessibility({ language: code });
            }}
          />
        </SettingRow>
      </div>

      {/* ── Typography ─────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Typography
        </h2>
        <SettingRow
          icon={Type}
          title="Text Size"
          description="Adjust the base font size for better readability"
        >
          <div className="flex flex-wrap gap-2">
            {(['normal', 'large', 'xl'] as const).map(size => (
              <button
                key={size}
                type="button"
                onClick={() => setAccessibility({ textSize: size })}
                aria-pressed={accessibility.textSize === size}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border capitalize",
                  accessibility.textSize === size
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "bg-muted text-muted-foreground border-border hover:text-foreground"
                )}
              >
                {size === 'normal' ? 'Normal' : size === 'large' ? 'Large' : 'X-Large'}
              </button>
            ))}
          </div>
        </SettingRow>
      </div>

      {/* ── Audio ─────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Audio & Speech
        </h2>
        <SettingRow
          icon={accessibility.audioEnabled ? Volume2 : VolumeX}
          title="Audio Output"
          description="Enable or disable all speech synthesis output"
        >
          <Toggle
            checked={accessibility.audioEnabled}
            onChange={() => updateAccessibility({ audioEnabled: !accessibility.audioEnabled })}
            label="Audio output"
          />
        </SettingRow>

        <SettingRow
          icon={Mic}
          title="Auto-Speak Gestures"
          description="Automatically speak confirmed gestures during recognition"
        >
          <Toggle
            checked={accessibility.autoSpeak}
            onChange={() => updateAccessibility({ autoSpeak: !accessibility.autoSpeak })}
            label="Automatically speak confirmed gestures"
          />
        </SettingRow>

        <SettingRow
          icon={Wifi}
          title="Online Voices"
          description="Use cloud speech synthesis for natural-sounding voices in all languages (Greek, Japanese, Korean, Hindi, etc.). When enabled, recognized text is sent to the speech provider."
        >
          <Toggle
            checked={accessibility.useCloudTts}
            onChange={() => updateAccessibility({ useCloudTts: !accessibility.useCloudTts })}
            label="Online voices"
          />
        </SettingRow>

        {/* Speech test */}
        <div className="mt-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={() => {
              if (!accessibility.audioEnabled) return;
              const lang = accessibility.language;
              const bcp47 = LANGUAGE_BCP47[lang] ?? 'en-US';
              speak(translateGesture('hello', lang), bcp47, (missingLang) => {
                const name = LANGUAGES.find(l => l.code === missingLang.split('-')[0])?.nativeName ?? missingLang;
                toast.warning(`No ${name} voice is installed on this device — speech is unavailable for this language.`);
              });
            }}
            disabled={!accessibility.audioEnabled}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted text-foreground border border-border text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Volume2 className="w-4 h-4" />
            Test Speech Synthesis
          </button>
        </div>
      </div>

      {/* ── About ─────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          About
        </h2>
        <div className="space-y-2 text-xs font-mono text-muted-foreground">
          <div className="flex justify-between">
            <span>Application</span>
            <span className="text-foreground">Sign Language Assistant v1.0</span>
          </div>
          <div className="flex justify-between">
            <span>Hand Detection</span>
            <span className="text-foreground">MediaPipe Hands 0.4</span>
          </div>
          <div className="flex justify-between">
            <span>ML Framework</span>
            <span className="text-foreground">ONNX Runtime 1.24</span>
          </div>
          <div className="flex justify-between">
            <span>Speech API</span>
            <span className="text-foreground">Web Speech API (browser-native)</span>
          </div>
          <div className="flex justify-between">
            <span>Model Architecture</span>
            <span className="text-foreground">Attention BiGRU · 30x126</span>
          </div>
          <div className="flex justify-between">
            <span>Inference Target</span>
            <span className="text-foreground">&lt;150ms per frame</span>
          </div>
          <div className="flex justify-between">
            <span>Data Privacy</span>
            <span className={accessibility.useCloudTts ? 'text-warning' : 'text-success'}>
              {accessibility.useCloudTts ? 'Online voices on · text sent to provider' : 'Camera and recognition stay local'}
            </span>
          </div>
        </div>
        <div className="mt-4 p-3 rounded-lg bg-muted/50 border border-border flex items-start gap-2">
          <Info className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            Camera frames, landmarks, datasets, and recognition stay in your browser. When online voices are enabled,
            the generated speech text is sent to the configured speech provider; video and landmarks are not sent.
          </p>
        </div>
      </div>
    </div>
  );
}
