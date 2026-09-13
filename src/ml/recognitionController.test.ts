import { describe, expect, it } from 'vitest';
import { hasTrackingOwnership, isGenuineHandRelease, OwnedEmissionQueue, removeSentenceEntry } from './recognitionController';
import { HybridRouter, ONNX_ABSENCE_FRAMES_BEFORE_CUSTOM } from './hybridRouter';

describe('sentence correction', () => {
  it('removes only the exact pending entry when duplicate words exist', () => {
    const entries = [
      { id: 'new', word: 'hello', confidence: 97 },
      { id: 'old', word: 'hello', confidence: 96 },
    ];
    expect(removeSentenceEntry(entries, 'new')).toEqual([entries[1]]);
  });

  it('rearms only after a genuine release rather than a held tracking gap', () => {
    expect(isGenuineHandRelease(false, true)).toBe(false);
    expect(isGenuineHandRelease(false, false)).toBe(true);
    expect(isGenuineHandRelease(true, false)).toBe(false);
  });

  it('delivers an owned emission once and rejects another generation', () => {
    const queue = new OwnedEmissionQueue<string>();
    queue.store(3, 'goodbye');
    expect(queue.take(2)).toBeNull();
    expect(queue.take(3)).toBe('goodbye');
    expect(queue.take(3)).toBeNull();
  });

  it('preserves custom ownership and a queued emission across a held tracking gap', () => {
    const router = new HybridRouter();
    for (let frame = 0; frame < ONNX_ABSENCE_FRAMES_BEFORE_CUSTOM; frame++) {
      router.step({ handPresent: true, onnxLabel: null, onnxConfidence: 0, onnxState: 'IDLE', customLabel: 'custom', customConfidence: 99, customState: 'GESTURE_ACTIVE' });
    }
    const queue = new OwnedEmissionQueue<string>();
    queue.store(1, 'custom');
    const held = router.step({ handPresent: hasTrackingOwnership(false, true), onnxLabel: null, onnxConfidence: 0, onnxState: 'IDLE', customLabel: null, customConfidence: 0, customState: 'COOLDOWN' });
    expect(held.source).toBe('CUSTOM_ACTIVE');
    expect(queue.take(1)).toBe('custom');
    expect(queue.take(1)).toBeNull();
  });
});
