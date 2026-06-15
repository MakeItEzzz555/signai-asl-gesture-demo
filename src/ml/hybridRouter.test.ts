import { describe, expect, it } from 'vitest';
import {
  CUSTOM_RELEASE_FRAMES,
  HybridRouter,
  ONNX_BLOCK_CUSTOM_CONFIDENCE,
  ONNX_RELEASE_FRAMES,
  SOURCE_SWITCH_COOLDOWN_FRAMES,
  type HybridRouterInput,
} from './hybridRouter';

function frame(partial: Partial<HybridRouterInput> = {}): HybridRouterInput {
  return {
    handPresent: true,
    onnxLabel: null,
    onnxConfidence: 0,
    onnxState: 'IDLE',
    customLabel: null,
    customConfidence: 0,
    customState: 'IDLE',
    ...partial,
  };
}

describe('HybridRouter', () => {
  it('activates ONNX from idle and blocks custom while ONNX remains valid', () => {
    const router = new HybridRouter();

    let snapshot = router.step(frame({
      onnxLabel: 'hello',
      onnxConfidence: 91,
      customLabel: 'custom',
      customConfidence: 99,
    }));
    expect(snapshot.source).toBe('ONNX_ACTIVE');
    expect(snapshot.activeLabel).toBe('hello');

    snapshot = router.step(frame({
      onnxLabel: 'yes',
      onnxConfidence: 90,
      customLabel: 'custom',
      customConfidence: 99,
    }));
    expect(snapshot.source).toBe('ONNX_ACTIVE');
    expect(snapshot.activeLabel).toBe('yes');
  });

  it('blocks custom from idle while ONNX has weak default presence', () => {
    const router = new HybridRouter();

    let snapshot = router.step(frame({
      onnxLabel: 'hello',
      onnxConfidence: ONNX_BLOCK_CUSTOM_CONFIDENCE,
      customLabel: 'custom',
      customConfidence: 98,
    }));
    expect(snapshot.source).toBe('IDLE');

    snapshot = router.step(frame({
      onnxLabel: 'hello',
      onnxConfidence: ONNX_BLOCK_CUSTOM_CONFIDENCE - 1,
      customLabel: 'custom',
      customConfidence: 98,
    }));
    expect(snapshot.source).toBe('CUSTOM_ACTIVE');
    expect(snapshot.activeLabel).toBe('custom');
  });

  it('prefers ONNX over custom from idle when ONNX is strongly confident', () => {
    const router = new HybridRouter();

    const snapshot = router.step(frame({
      onnxLabel: 'hello',
      onnxConfidence: 80,
      customLabel: 'custom',
      customConfidence: 98,
    }));
    expect(snapshot.source).toBe('ONNX_ACTIVE');
  });

  it('keeps ONNX active during weak default presence and blocks custom takeover', () => {
    const router = new HybridRouter();

    router.step(frame({ onnxLabel: 'hello', onnxConfidence: 90 }));
    const snapshot = router.step(frame({
      onnxLabel: 'hello',
      onnxConfidence: ONNX_BLOCK_CUSTOM_CONFIDENCE,
      customLabel: 'custom',
      customConfidence: 99,
    }));

    expect(snapshot.source).toBe('ONNX_ACTIVE');
    expect(snapshot.activeLabel).toBe('hello');
    expect(snapshot.releaseFrames).toBe(0);
  });

  it('keeps custom active through cooldown and ignores ONNX flicker', () => {
    const router = new HybridRouter();

    router.step(frame({ customLabel: 'custom', customConfidence: 99 }));
    const snapshot = router.step(frame({
      onnxLabel: 'hello',
      onnxConfidence: 95,
      customState: 'COOLDOWN',
    }));

    expect(snapshot.source).toBe('CUSTOM_ACTIVE');
    expect(snapshot.activeLabel).toBe('custom');
    expect(snapshot.releaseFrames).toBe(0);
  });

  it('updates the active custom label while custom remains the source owner', () => {
    const router = new HybridRouter();

    router.step(frame({ customLabel: 'first custom', customConfidence: 99 }));
    const snapshot = router.step(frame({ customLabel: 'second custom', customConfidence: 98 }));

    expect(snapshot.source).toBe('CUSTOM_ACTIVE');
    expect(snapshot.activeLabel).toBe('second custom');
    expect(snapshot.activeConfidence).toBe(98);
  });

  it('releases custom only after the configured invalid-frame window', () => {
    const router = new HybridRouter();

    router.step(frame({ customLabel: 'custom', customConfidence: 99 }));

    for (let i = 1; i < CUSTOM_RELEASE_FRAMES; i++) {
      const snapshot = router.step(frame());
      expect(snapshot.source).toBe('CUSTOM_ACTIVE');
      expect(snapshot.releaseFrames).toBe(i);
    }

    const released = router.step(frame());
    expect(released.source).toBe('IDLE');
    expect(released.lastSource).toBe('CUSTOM_ACTIVE');
    expect(released.sourceSwitchCooldown).toBe(SOURCE_SWITCH_COOLDOWN_FRAMES);
  });

  it('releases ONNX only after the configured blank or uncertain window', () => {
    const router = new HybridRouter();

    router.step(frame({ onnxLabel: 'hello', onnxConfidence: 95 }));

    for (let i = 1; i < ONNX_RELEASE_FRAMES; i++) {
      const snapshot = router.step(frame());
      expect(snapshot.source).toBe('ONNX_ACTIVE');
      expect(snapshot.releaseFrames).toBe(i);
    }

    const released = router.step(frame());
    expect(released.source).toBe('IDLE');
    expect(released.lastSource).toBe('ONNX_ACTIVE');
  });

  it('requires source switch cooldown after returning to idle', () => {
    const router = new HybridRouter();

    router.step(frame({ customLabel: 'custom', customConfidence: 99 }));
    let snapshot = router.step(frame({ handPresent: false }));
    expect(snapshot.source).toBe('IDLE');
    expect(snapshot.sourceSwitchCooldown).toBe(SOURCE_SWITCH_COOLDOWN_FRAMES);

    for (let i = SOURCE_SWITCH_COOLDOWN_FRAMES - 1; i >= 0; i--) {
      snapshot = router.step(frame({ onnxLabel: 'hello', onnxConfidence: 95 }));
      expect(snapshot.source).toBe('IDLE');
      expect(snapshot.sourceSwitchCooldown).toBe(i);
    }

    snapshot = router.step(frame({ onnxLabel: 'hello', onnxConfidence: 95 }));
    expect(snapshot.source).toBe('ONNX_ACTIVE');
  });
});
