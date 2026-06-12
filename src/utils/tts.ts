let voiceCache: SpeechSynthesisVoice[] = [];

function refreshCache(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  voiceCache = window.speechSynthesis.getVoices();
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshCache();
  window.speechSynthesis.addEventListener('voiceschanged', refreshCache);
}

function normalizeLang(lang: string): string {
  return lang.toLowerCase().replace(/_/g, '-');
}

function resolveVoice(bcp47: string): SpeechSynthesisVoice | null {
  const target = normalizeLang(bcp47);
  const base = target.split('-')[0];
  return (
    voiceCache.find(v => normalizeLang(v.lang) === target) ??
    voiceCache.find(v => normalizeLang(v.lang).split('-')[0] === base) ??
    null
  );
}

export function preWarmVoices(): void {
  refreshCache();
}

export function speak(text: string, bcp47: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  const utter = (voice: SpeechSynthesisVoice | null) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = bcp47;
    u.rate = 0.9;
    u.pitch = 1.0;
    u.volume = 1.0;
    if (voice) u.voice = voice;
    console.log(`[TTS] lang=${bcp47}, voice=${voice?.name ?? 'browser default'}`);
    window.speechSynthesis.speak(u);
  };

  refreshCache();
  const voice = resolveVoice(bcp47);

  if (voice) {
    utter(voice);
    return;
  }

  const base = bcp47.split('-')[0];

  if (voiceCache.length === 0) {
    // Voices not yet available — defer until voiceschanged fires with a match
    const onReady = () => {
      refreshCache();
      const v = resolveVoice(bcp47);
      if (v) {
        utter(v);
      } else if (base === 'en') {
        utter(null);
      } else {
        console.warn(`[TTS] No voice installed for ${bcp47} — skipping to avoid mispronunciation`);
      }
    };
    window.speechSynthesis.addEventListener('voiceschanged', onReady, { once: true });
    return;
  }

  // Voices are loaded but no match found for this language
  if (base === 'en') {
    utter(null);
  } else {
    console.warn(`[TTS] No voice installed for ${bcp47} — skipping to avoid mispronunciation`);
  }
}
