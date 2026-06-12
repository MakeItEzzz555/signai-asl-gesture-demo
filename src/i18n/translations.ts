export type LanguageCode =
  | 'en' | 'el' | 'es' | 'fr' | 'de' | 'ar' | 'he' | 'ru'
  | 'zh' | 'pt' | 'tr' | 'it' | 'ja' | 'ko' | 'hi' | 'nl'
  | 'pl' | 'sv' | 'no' | 'da' | 'fi' | 'ro' | 'cs' | 'uk'
  | 'id' | 'th' | 'vi';

export interface LanguageDef {
  code: LanguageCode;
  flagCode: string;
  nativeName: string;
}

export const LANGUAGES: LanguageDef[] = [
  { code: 'en', flagCode: 'gb', nativeName: 'English' },
  { code: 'el', flagCode: 'gr', nativeName: 'Ελληνικά' },
  { code: 'es', flagCode: 'es', nativeName: 'Español' },
  { code: 'fr', flagCode: 'fr', nativeName: 'Français' },
  { code: 'de', flagCode: 'de', nativeName: 'Deutsch' },
  { code: 'ar', flagCode: 'sa', nativeName: 'العربية' },
  { code: 'he', flagCode: 'il', nativeName: 'עברית' },
  { code: 'ru', flagCode: 'ru', nativeName: 'Русский' },
  { code: 'zh', flagCode: 'cn', nativeName: '中文' },
  { code: 'pt', flagCode: 'pt', nativeName: 'Português' },
  { code: 'tr', flagCode: 'tr', nativeName: 'Türkçe' },
  { code: 'it', flagCode: 'it', nativeName: 'Italiano' },
  { code: 'ja', flagCode: 'jp', nativeName: '日本語' },
  { code: 'ko', flagCode: 'kr', nativeName: '한국어' },
  { code: 'hi', flagCode: 'in', nativeName: 'हिन्दी' },
  { code: 'nl', flagCode: 'nl', nativeName: 'Nederlands' },
  { code: 'pl', flagCode: 'pl', nativeName: 'Polski' },
  { code: 'sv', flagCode: 'se', nativeName: 'Svenska' },
  { code: 'no', flagCode: 'no', nativeName: 'Norsk' },
  { code: 'da', flagCode: 'dk', nativeName: 'Dansk' },
  { code: 'fi', flagCode: 'fi', nativeName: 'Suomi' },
  { code: 'ro', flagCode: 'ro', nativeName: 'Română' },
  { code: 'cs', flagCode: 'cz', nativeName: 'Čeština' },
  { code: 'uk', flagCode: 'ua', nativeName: 'Українська' },
  { code: 'id', flagCode: 'id', nativeName: 'Bahasa Indonesia' },
  { code: 'th', flagCode: 'th', nativeName: 'ภาษาไทย' },
  { code: 'vi', flagCode: 'vn', nativeName: 'Tiếng Việt' },
];

type TranslationMap = Record<LanguageCode, string>;

const GESTURE_TRANSLATIONS: Record<string, TranslationMap> = {
  'hello': {
    en: 'Hello',       el: 'Γεια',           es: 'Hola',           fr: 'Bonjour',         de: 'Hallo',
    ar: 'مرحبا',      he: 'שלום',           ru: 'Привет',         zh: '你好',             pt: 'Olá',
    tr: 'Merhaba',     it: 'Ciao',           ja: 'こんにちは',      ko: '안녕하세요',        hi: 'नमस्ते',
    nl: 'Hallo',       pl: 'Cześć',          sv: 'Hej',            no: 'Hei',             da: 'Hej',
    fi: 'Hei',         ro: 'Bună',           cs: 'Ahoj',           uk: 'Привіт',          id: 'Halo',
    th: 'สวัสดี',      vi: 'Xin chào',
  },
  'yes': {
    en: 'Yes',         el: 'Ναι',            es: 'Sí',             fr: 'Oui',             de: 'Ja',
    ar: 'نعم',        he: 'כן',             ru: 'Да',             zh: '是',               pt: 'Sim',
    tr: 'Evet',        it: 'Sì',             ja: 'はい',            ko: '네',               hi: 'हाँ',
    nl: 'Ja',          pl: 'Tak',            sv: 'Ja',             no: 'Ja',              da: 'Ja',
    fi: 'Kyllä',       ro: 'Da',             cs: 'Ano',            uk: 'Так',             id: 'Ya',
    th: 'ใช่',         vi: 'Có',
  },
  'no': {
    en: 'No',          el: 'Οχι',            es: 'No',             fr: 'Non',             de: 'Nein',
    ar: 'لا',         he: 'לא',             ru: 'Нет',            zh: '否',               pt: 'Não',
    tr: 'Hayır',       it: 'No',             ja: 'いいえ',          ko: '아니요',            hi: 'नहीं',
    nl: 'Nee',         pl: 'Nie',            sv: 'Nej',            no: 'Nei',             da: 'Nej',
    fi: 'Ei',          ro: 'Nu',             cs: 'Ne',             uk: 'Ні',              id: 'Tidak',
    th: 'ไม่',         vi: 'Không',
  },
  'please': {
    en: 'Please',      el: 'Παρακαλώ',       es: 'Por favor',      fr: "S'il vous plaît", de: 'Bitte',
    ar: 'من فضلك',    he: 'בבקשה',          ru: 'Пожалуйста',     zh: '请',               pt: 'Por favor',
    tr: 'Lütfen',      it: 'Per favore',     ja: 'お願いします',    ko: '제발',              hi: 'कृपया',
    nl: 'Alsjeblieft', pl: 'Proszę',         sv: 'Tack',           no: 'Vær så snill',    da: 'Vær så venlig',
    fi: 'Ole hyvä',    ro: 'Te rog',         cs: 'Prosím',         uk: 'Будь ласка',      id: 'Tolong',
    th: 'กรุณา',       vi: 'Làm ơn',
  },
  'help': {
    en: 'Help',        el: 'Βοήθεια',        es: 'Ayuda',          fr: 'Aide',            de: 'Hilfe',
    ar: 'مساعدة',     he: 'עזרה',           ru: 'Помощь',         zh: '帮助',              pt: 'Ajuda',
    tr: 'Yardım',      it: 'Aiuto',          ja: '助けて',          ko: '도움',              hi: 'मदद',
    nl: 'Hulp',        pl: 'Pomoc',          sv: 'Hjälp',          no: 'Hjelp',           da: 'Hjælp',
    fi: 'Apua',        ro: 'Ajutor',         cs: 'Pomoc',          uk: 'Допомога',        id: 'Bantuan',
    th: 'ช่วยด้วย',    vi: 'Giúp đỡ',
  },
  'goodbye': {
    en: 'Goodbye',         el: 'Αντίο',          es: 'Adiós',           fr: 'Au revoir',       de: 'Auf Wiedersehen',
    ar: 'وداعا',           he: 'להתראות',         ru: 'До свидания',     zh: '再见',              pt: 'Adeus',
    tr: 'Güle güle',       it: 'Arrivederci',    ja: 'さようなら',      ko: '안녕히 가세요',     hi: 'अलविदा',
    nl: 'Tot ziens',       pl: 'Do widzenia',    sv: 'Hejdå',           no: 'Ha det',          da: 'Farvel',
    fi: 'Näkemiin',        ro: 'La revedere',    cs: 'Nashledanou',     uk: 'До побачення',    id: 'Selamat tinggal',
    th: 'ลาก่อน',          vi: 'Tạm biệt',
  },
  'blank': {
    en: 'Blank',       el: 'Κενό',           es: 'Vacío',          fr: 'Vide',            de: 'Leer',
    ar: 'فارغ',        he: 'ריק',            ru: 'Пусто',          zh: '空白',              pt: 'Vazio',
    tr: 'Boş',         it: 'Vuoto',          ja: '空白',            ko: '빈칸',              hi: 'रिक्त',
    nl: 'Leeg',        pl: 'Puste',          sv: 'Tom',            no: 'Tom',             da: 'Tom',
    fi: 'Tyhjä',       ro: 'Gol',            cs: 'Prázdný',        uk: 'Порожньо',        id: 'Kosong',
    th: 'ว่าง',        vi: 'Trống',
  },
  'eat / speak': {
    en: 'Eat / Speak',       el: 'Τρώω / Μιλώ',       es: 'Comer / Hablar',    fr: 'Manger / Parler',   de: 'Essen / Sprechen',
    ar: 'أكل / تكلم',       he: 'לאכול / לדבר',       ru: 'Есть / Говорить',   zh: '吃/说话',             pt: 'Comer / Falar',
    tr: 'Yemek / Konuşmak', it: 'Mangiare / Parlare', ja: '食べる/話す',         ko: '먹다/말하다',           hi: 'खाना/बोलना',
    nl: 'Eten / Spreken',   pl: 'Jeść / Mówić',       sv: 'Äta / Tala',        no: 'Spise / Snakke',    da: 'Spise / Tale',
    fi: 'Syödä / Puhua',    ro: 'Mânca / Vorbi',      cs: 'Jíst / Mluvit',     uk: 'Їсти / Говорити',   id: 'Makan / Berbicara',
    th: 'กิน/พูด',           vi: 'Ăn / Nói',
  },
  'see / look': {
    en: 'See / Look',  el: 'Βλέπω / Κοιτώ', es: 'Ver / Mirar',    fr: 'Voir / Regarder', de: 'Sehen / Schauen',
    ar: 'رؤية / نظر', he: 'לראות',          ru: 'Видеть',         zh: '看',               pt: 'Ver',
    tr: 'Görmek',      it: 'Vedere',         ja: '見る',            ko: '보다',              hi: 'देखना',
    nl: 'Zien',        pl: 'Widzieć',        sv: 'Se',             no: 'Se',              da: 'Se',
    fi: 'Nähdä',       ro: 'Vedea',          cs: 'Vidět',          uk: 'Бачити',          id: 'Melihat',
    th: 'มอง',         vi: 'Nhìn',
  },
  'smell': {
    en: 'Smell',       el: 'Μυρίζω',         es: 'Oler',           fr: 'Sentir',          de: 'Riechen',
    ar: 'شم',         he: 'להריח',           ru: 'Нюхать',         zh: '闻',               pt: 'Cheirar',
    tr: 'Koklamak',    it: 'Annusare',       ja: '嗅ぐ',            ko: '냄새 맡다',          hi: 'सूंघना',
    nl: 'Ruiken',      pl: 'Wąchać',         sv: 'Lukta',          no: 'Lukte',           da: 'Lugte',
    fi: 'Haistaa',     ro: 'Mirosi',         cs: 'Čichat',         uk: 'Нюхати',          id: 'Mencium',
    th: 'ดมกลิ่น',     vi: 'Ngửi',
  },
  'think': {
    en: 'Think',       el: 'Σκέφτομαι',      es: 'Pensar',         fr: 'Penser',          de: 'Denken',
    ar: 'تفكير',      he: 'לחשוב',           ru: 'Думать',         zh: '思考',              pt: 'Pensar',
    tr: 'Düşünmek',    it: 'Pensare',        ja: '考える',          ko: '생각하다',           hi: 'सोचना',
    nl: 'Denken',      pl: 'Myśleć',         sv: 'Tänka',          no: 'Tenke',           da: 'Tænke',
    fi: 'Ajatella',    ro: 'Gândi',          cs: 'Myslet',         uk: 'Думати',          id: 'Berpikir',
    th: 'คิด',         vi: 'Suy nghĩ',
  },
  'listen': {
    en: 'Listen',      el: 'Ακούω',          es: 'Escuchar',       fr: 'Écouter',         de: 'Zuhören',
    ar: 'استمع',      he: 'להקשיב',          ru: 'Слушать',        zh: '听',               pt: 'Ouvir',
    tr: 'Dinlemek',    it: 'Ascoltare',      ja: '聞く',            ko: '듣다',              hi: 'सुनना',
    nl: 'Luisteren',   pl: 'Słuchać',        sv: 'Lyssna',         no: 'Lytte',           da: 'Lytte',
    fi: 'Kuunnella',   ro: 'Asculta',        cs: 'Poslouchat',     uk: 'Слухати',         id: 'Mendengarkan',
    th: 'ฟัง',         vi: 'Nghe',
  },
};

export function translateGesture(label: string, lang: LanguageCode): string {
  if (!label) return label;
  const key = label.trim().toLowerCase();
  const map = GESTURE_TRANSLATIONS[key];
  if (!map) return label;
  return map[lang] ?? label;
}

export const LANGUAGE_BCP47: Record<string, string> = {
  en: 'en-US', el: 'el-GR', es: 'es-ES', fr: 'fr-FR', de: 'de-DE',
  ar: 'ar-SA', he: 'he-IL', ru: 'ru-RU', zh: 'zh-CN', pt: 'pt-PT',
  tr: 'tr-TR', it: 'it-IT', ja: 'ja-JP', ko: 'ko-KR', hi: 'hi-IN',
  nl: 'nl-NL', pl: 'pl-PL', sv: 'sv-SE', no: 'nb-NO', da: 'da-DK',
  fi: 'fi-FI', ro: 'ro-RO', cs: 'cs-CZ', uk: 'uk-UA', id: 'id-ID',
  th: 'th-TH', vi: 'vi-VN',
};
