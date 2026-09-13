interface CloudVoice {
  languageCode: string;
  voiceName: string;
}

export const CLOUD_VOICE_MAP: Record<string, CloudVoice> = {
  en: { languageCode: 'en-US', voiceName: 'en-US-Neural2-F' },
  el: { languageCode: 'el-GR', voiceName: 'el-GR-Wavenet-A' },       // WaveNet confirmed; Chirp3-HD speaker names unreliable for el
  es: { languageCode: 'es-ES', voiceName: 'es-ES-Neural2-A' },
  fr: { languageCode: 'fr-FR', voiceName: 'fr-FR-Neural2-A' },
  de: { languageCode: 'de-DE', voiceName: 'de-DE-Neural2-A' },
  ar: { languageCode: 'ar-XA', voiceName: 'ar-XA-Wavenet-B' },  // Google uses ar-XA, not ar-SA
  ru: { languageCode: 'ru-RU', voiceName: 'ru-RU-Wavenet-A' },
  zh: { languageCode: 'zh-CN', voiceName: 'zh-CN-Neural2-A' },
  pt: { languageCode: 'pt-PT', voiceName: 'pt-PT-Wavenet-A' },
  tr: { languageCode: 'tr-TR', voiceName: 'tr-TR-Standard-A' },
  it: { languageCode: 'it-IT', voiceName: 'it-IT-Neural2-A' },
  ja: { languageCode: 'ja-JP', voiceName: 'ja-JP-Neural2-B' },
  ko: { languageCode: 'ko-KR', voiceName: 'ko-KR-Neural2-A' },
  hi: { languageCode: 'hi-IN', voiceName: 'hi-IN-Neural2-A' },
  nl: { languageCode: 'nl-NL', voiceName: 'nl-NL-Wavenet-A' },
  pl: { languageCode: 'pl-PL', voiceName: 'pl-PL-Wavenet-A' },
  sv: { languageCode: 'sv-SE', voiceName: 'sv-SE-Wavenet-A' },
  no: { languageCode: 'nb-NO', voiceName: 'nb-NO-Neural2-F' },
  da: { languageCode: 'da-DK', voiceName: 'da-DK-Neural2-D' },         // D is the confirmed high-quality Danish Neural2 variant
  fi: { languageCode: 'fi-FI', voiceName: 'fi-FI-Standard-A' },
  ro: { languageCode: 'ro-RO', voiceName: 'ro-RO-Standard-A' },
  cs: { languageCode: 'cs-CZ', voiceName: 'cs-CZ-Wavenet-A' },
  uk: { languageCode: 'uk-UA', voiceName: 'uk-UA-Standard-A' },
  id: { languageCode: 'id-ID', voiceName: 'id-ID-Wavenet-A' },
  th: { languageCode: 'th-TH', voiceName: 'th-TH-Standard-A' },        // Standard confirmed; Thai Neural2 availability uncertain
  vi: { languageCode: 'vi-VN', voiceName: 'vi-VN-Wavenet-A' },
};
