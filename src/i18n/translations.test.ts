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
});
