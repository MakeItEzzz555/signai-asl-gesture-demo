import { describe, expect, it } from 'vitest';
import {
  exportDatasetJSON,
  parseImportedDataset,
  parseImportedDatasetBundle,
} from './datasetUtils';
import type { GestureSample } from '../contexts/AppContext';

function makeSample(label = 'Hello', dim = 156): GestureSample {
  return {
    label,
    landmarks: new Array(dim).fill(0),
    timestamp: 123,
  };
}

describe('dataset import/export', () => {
  it('keeps legacy array exports when no custom translations exist', () => {
    const samples = [makeSample()];
    const expected = [makeSample('Hello', 63)];
    const parsed = JSON.parse(exportDatasetJSON(samples));

    expect(Array.isArray(parsed)).toBe(true);
    expect(parseImportedDataset(JSON.stringify(parsed))).toEqual(expected);
  });

  it('exports and imports samples with custom translations', () => {
    const samples = [makeSample('Fuck you')];
    const json = exportDatasetJSON(samples, {
      'fuck you': {
        el: 'Custom Greek text',
      },
    });

    const parsed = parseImportedDatasetBundle(json);

    expect(parsed.samples).toEqual([makeSample('Fuck you', 63)]);
    expect(parsed.customTranslations).toEqual({
      'fuck you': {
        el: 'Custom Greek text',
      },
    });
  });

  it('still accepts old sample-array imports through the bundle parser', () => {
    const samples = [makeSample('Help')];
    const parsed = parseImportedDatasetBundle(JSON.stringify(samples));

    expect(parsed.samples).toEqual([makeSample('Help', 63)]);
    expect(parsed.customTranslations).toEqual({});
    expect(parsed.convertedToHandOnlyCount).toBe(1);
  });

  it('normalizes imported custom translation labels and ignores invalid language keys', () => {
    const samples = [makeSample('Custom')];
    const parsed = parseImportedDatasetBundle(JSON.stringify({
      version: 2,
      samples,
      customTranslations: {
        '  Custom  ': {
          el: 'Custom Greek text',
          xx: 'invalid',
        },
      },
    }));

    expect(parsed.customTranslations).toEqual({
      custom: {
        el: 'Custom Greek text',
      },
    });
  });

  it('keeps hand-only imports as hand-only without conversion notice count', () => {
    const samples = [makeSample('Hello', 63)];
    const parsed = parseImportedDatasetBundle(JSON.stringify(samples));

    expect(parsed.samples).toEqual(samples);
    expect(parsed.convertedToHandOnlyCount).toBe(0);
  });
});
