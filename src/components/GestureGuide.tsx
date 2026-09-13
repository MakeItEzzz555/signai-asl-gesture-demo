import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { type FaceRegion } from '../hooks/useMediaPipe';
import { translateGesture, type LanguageCode } from '../i18n/translations';
import { cn } from '../lib/utils';

interface GestureGuideProps {
  language: LanguageCode;
  onClose: () => void;
}

interface CoreGestureInfo {
  key: string;
  emoji: string;
  description: string;
}

interface FaceGestureInfo {
  region: FaceRegion;
  label: string;
  emoji: string;
  handHint: string;
}

const CORE_GESTURES: CoreGestureInfo[] = [
  { key: 'hello',   emoji: '👋', description: 'Open hand, fingers together, sweep away from forehead' },
  { key: 'yes',     emoji: '✊', description: 'Closed fist, bob up and down from the wrist' },
  { key: 'no',      emoji: '✌️', description: 'Index and middle fingers extended, shake side to side' },
  { key: 'please',  emoji: '🙏', description: 'Flat hand on chest, move in a clockwise circle' },
  { key: 'help',    emoji: '🤲', description: 'Thumbs-up fist resting on flat palm, lift upward' },
  { key: 'goodbye', emoji: '👋', description: 'Open hand raised, bend fingers down repeatedly' },
];

const FACE_GESTURES: FaceGestureInfo[] = [
  { region: 'mouth',    label: 'Eat / Speak', emoji: '👄', handHint: 'Bring index or middle fingertip toward mouth' },
  { region: 'eye',      label: 'See / Look',  emoji: '👁️',  handHint: 'Bring hand or index finger near eye area' },
  { region: 'nose',     label: 'Smell',       emoji: '👃', handHint: 'Bring index finger near nose' },
  { region: 'forehead', label: 'Think',       emoji: '🧠', handHint: 'Touch or tap index finger to forehead' },
  { region: 'ear',      label: 'Listen',      emoji: '👂', handHint: 'Bring hand or index finger near ear' },
];

export default function GestureGuide({ language, onClose }: GestureGuideProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], select, [tabindex]:not([tabindex="-1"])')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gesture-guide-title"
        className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border flex items-center justify-between px-5 py-3 rounded-t-xl">
          <div className="flex items-center gap-2">
            <span className="text-lg">📖</span>
            <h2 id="gesture-guide-title" className="text-sm font-bold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
              Gesture Reference Guide
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close gesture guide"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Core Gestures */}
          <section>
            <p className="text-xs font-mono text-muted-foreground mb-3 uppercase tracking-wide">
              Core Gestures — ONNX Model
            </p>
            <div className="grid grid-cols-1 gap-2">
              {CORE_GESTURES.map(g => (
                <div
                  key={g.key}
                  className="flex items-start gap-3 px-4 py-3 rounded-lg bg-muted/40 border border-border"
                >
                  <span className="text-2xl leading-none mt-0.5 flex-shrink-0">{g.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold uppercase text-primary" style={{ fontFamily: 'Space Grotesk' }}>
                      {translateGesture(g.key, language)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{g.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="border-t border-border" />

          {/* Face-Touch Gestures */}
          <section>
            <p className="text-xs font-mono text-muted-foreground mb-2 uppercase tracking-wide">
              Face-Touch Gestures — Proximity Detection
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              Touch a face region with your index or middle fingertip while signing to trigger these.
            </p>
            <div className="grid grid-cols-1 gap-2">
              {FACE_GESTURES.map(g => (
                <div
                  key={g.region}
                  className="flex items-start gap-3 px-4 py-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20"
                >
                  <span className="text-2xl leading-none mt-0.5 flex-shrink-0">{g.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold uppercase text-yellow-400" style={{ fontFamily: 'Space Grotesk' }}>
                        {translateGesture(g.label, language)}
                      </p>
                      <span className={cn(
                        'text-[10px] font-mono px-1.5 py-0.5 rounded uppercase',
                        'bg-yellow-500/10 text-yellow-500/80 border border-yellow-500/20',
                      )}>
                        {g.region}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{g.handHint}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <p className="text-[11px] font-mono text-muted-foreground pt-1 border-t border-border">
            Camera frames and landmark detection stay in this browser. Optional online speech sends only generated text to the configured speech provider.
          </p>
        </div>
      </div>
    </div>
  );
}
