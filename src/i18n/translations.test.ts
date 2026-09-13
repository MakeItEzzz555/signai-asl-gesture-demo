import { describe, expect, it } from 'vitest';
import { translateGesture } from './translations';

describe('translateGesture', () => {
  it('falls back to an English custom translation when the selected language has no custom translation', () => {
    expect(translateGesture('custom insult', 'el', {
      'custom insult': {
        en: 'Custom display text',
      },
    })).toBe('Custom display text');
  });

  it('prefers the selected language custom translation over the English custom fallback', () => {
    expect(translateGesture('custom insult', 'el', {
      'custom insult': {
        en: 'Custom display text',
        el: 'Προσαρμοσμένο κείμενο',
      },
    })).toBe('Προσαρμοσμένο κείμενο');
  });

  it('only reads own custom translation keys', () => {
    const translations = Object.create(null) as Record<string, { en: string }>;
    translations.__proto__ = { en: 'Safe proto label' };

    expect(translateGesture('__proto__', 'el', translations)).toBe('Safe proto label');
    expect(translateGesture('constructor', 'el', {})).toBe('constructor');
  });
});
