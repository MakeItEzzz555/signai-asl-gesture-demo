import { describe, expect, it } from 'vitest';
import {
  exportDatasetJSON,
  getSampleCounts,
  parseImportedDataset,
  parseImportedDatasetBundle,
  parseStoredDatasetSnapshot,
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

  it('rejects hostile or malformed sample records before changing caller state', () => {
    expect(() => parseImportedDataset(JSON.stringify([
      { label: '   ', landmarks: new Array(63).fill(0) },
    ]))).toThrow('Sample 0: "label" must be a nonempty string');

    expect(() => parseImportedDataset(JSON.stringify([
      { label: 'Hello', landmarks: new Array(63).fill(0), timestamp: Infinity },
    ]))).toThrow('Sample 0: "timestamp" must be a finite number when provided');

    expect(() => parseImportedDataset(JSON.stringify([null]))).toThrow('Sample 0: must be an object');
  });

  it('keeps prototype-like labels as ordinary own keys in counts and translations', () => {
    const parsed = parseImportedDatasetBundle(`{
      "version": 2,
      "samples": [
        {"label":"__proto__","landmarks":[${new Array(63).fill(0).join(',')}],"timestamp":123},
        {"label":"constructor","landmarks":[${new Array(63).fill(0).join(',')}],"timestamp":123},
        {"label":"toString","landmarks":[${new Array(63).fill(0).join(',')}],"timestamp":123}
      ],
      "customTranslations": {
        "__proto__": {"el":"proto"},
        "constructor": {"el":"constructor"},
        "toString": {"el":"string"}
      }
    }`);
    const counts = getSampleCounts({
      labels: parsed.samples.map(sample => sample.label),
      samples: parsed.samples,
    });

    expect(Object.getPrototypeOf(counts)).toBeNull();
    expect(counts.__proto__).toBe(1);
    expect(counts.constructor).toBe(1);
    expect(counts.toString).toBe(1);
    expect(parsed.customTranslations['__proto__']?.el).toBe('proto');
    expect(parsed.customTranslations['constructor']?.el).toBe('constructor');
    expect(parsed.customTranslations['tostring']?.el).toBe('string');
  });

  it('validates persisted snapshots without trusting stored labels', () => {
    const snapshot = parseStoredDatasetSnapshot({
      schemaVersion: 1,
      revision: 4,
      samples: [makeSample(' Hello ', 63)],
      customTranslations: { hello: { el: 'Γεια' } },
    });

    expect(snapshot.revision).toBe(4);
    expect(snapshot.samples[0].label).toBe('Hello');
    expect(() => parseStoredDatasetSnapshot({ schemaVersion: 2, revision: 0, samples: [], customTranslations: {} }))
      .toThrow('Stored dataset has an unsupported format');
  });
});
