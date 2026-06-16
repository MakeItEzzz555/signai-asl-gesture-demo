import type { SegmentationState } from './segmentationFSM';

export type HybridSource = 'IDLE' | 'ONNX_ACTIVE' | 'CUSTOM_ACTIVE';

export const CUSTOM_ACTIVATE_CONFIDENCE = 95;
export const CUSTOM_ACTIVATE_MARGIN = 15;
export const ONNX_ACTIVATE_CONFIDENCE = 80;
export const ONNX_BLOCK_CUSTOM_CONFIDENCE = 45;
export const ONNX_ABSENCE_FRAMES_BEFORE_CUSTOM = 12;
export const CUSTOM_RELEASE_FRAMES = 10;
export const ONNX_RELEASE_FRAMES = 8;
export const SOURCE_SWITCH_COOLDOWN_FRAMES = 6;

export interface HybridRouterSnapshot {
  source: HybridSource;
  activeLabel: string | null;
  activeConfidence: number;
  releaseFrames: number;
  onnxAbsenceFrames: number;
  sourceSwitchCooldown: number;
  lastSource: HybridSource;
}

export interface HybridRouterInput {
  handPresent: boolean;
  onnxLabel: string | null;
  onnxConfidence: number;
  onnxState: SegmentationState;
  customLabel: string | null;
  customConfidence: number;
  customState: SegmentationState;
}

const INITIAL_SNAPSHOT: HybridRouterSnapshot = {
  source: 'IDLE',
  activeLabel: null,
  activeConfidence: 0,
  releaseFrames: 0,
  onnxAbsenceFrames: 0,
  sourceSwitchCooldown: 0,
  lastSource: 'IDLE',
};

function isActiveState(state: SegmentationState): boolean {
  return state === 'GESTURE_ACTIVE' || state === 'COOLDOWN';
}

export class HybridRouter {
  private snapshot: HybridRouterSnapshot = { ...INITIAL_SNAPSHOT };

  reset() {
    this.snapshot = { ...INITIAL_SNAPSHOT };
  }

  getSnapshot(): HybridRouterSnapshot {
    return { ...this.snapshot };
  }

  step(input: HybridRouterInput): HybridRouterSnapshot {
    if (!input.handPresent) {
      this.releaseToIdle();
      return this.getSnapshot();
    }

    switch (this.snapshot.source) {
      case 'ONNX_ACTIVE':
        this.stepOnnxActive(input);
        break;
      case 'CUSTOM_ACTIVE':
        this.stepCustomActive(input);
        break;
      case 'IDLE':
      default:
        this.stepIdle(input);
        break;
    }

    return this.getSnapshot();
  }

  private hasValidOnnx(input: HybridRouterInput): boolean {
    return Boolean(input.onnxLabel && input.onnxConfidence >= ONNX_ACTIVATE_CONFIDENCE);
  }

  private hasOnnxDefaultPresence(input: HybridRouterInput): boolean {
    return Boolean(input.onnxLabel && input.onnxConfidence >= ONNX_BLOCK_CUSTOM_CONFIDENCE);
  }

  private hasValidCustom(input: HybridRouterInput): boolean {
    return Boolean(input.customLabel && input.customConfidence >= CUSTOM_ACTIVATE_CONFIDENCE);
  }

  private releaseToIdle() {
    if (this.snapshot.source === 'IDLE') {
      this.snapshot = {
        ...this.snapshot,
        activeLabel: null,
        activeConfidence: 0,
        releaseFrames: 0,
        onnxAbsenceFrames: 0,
        sourceSwitchCooldown: Math.max(0, this.snapshot.sourceSwitchCooldown - 1),
      };
      return;
    }

    this.snapshot = {
      source: 'IDLE',
      activeLabel: null,
      activeConfidence: 0,
      releaseFrames: 0,
      onnxAbsenceFrames: 0,
      sourceSwitchCooldown: SOURCE_SWITCH_COOLDOWN_FRAMES,
      lastSource: this.snapshot.source,
    };
  }

  private stepIdle(input: HybridRouterInput) {
    const hasOnnxPresence = this.hasOnnxDefaultPresence(input);
    const onnxAbsenceFrames = hasOnnxPresence ? 0 : this.snapshot.onnxAbsenceFrames + 1;

    if (this.snapshot.sourceSwitchCooldown > 0) {
      this.snapshot = {
        ...this.snapshot,
        onnxAbsenceFrames,
        sourceSwitchCooldown: this.snapshot.sourceSwitchCooldown - 1,
      };
      return;
    }

    if (this.hasValidOnnx(input)) {
      this.snapshot = {
        source: 'ONNX_ACTIVE',
        activeLabel: input.onnxLabel,
        activeConfidence: input.onnxConfidence,
        releaseFrames: 0,
        onnxAbsenceFrames: 0,
        sourceSwitchCooldown: 0,
        lastSource: 'IDLE',
      };
      return;
    }

    if (hasOnnxPresence) {
      this.snapshot = {
        ...this.snapshot,
        activeLabel: null,
        activeConfidence: 0,
        releaseFrames: 0,
        onnxAbsenceFrames: 0,
      };
      return;
    }

    if (
      onnxAbsenceFrames >= ONNX_ABSENCE_FRAMES_BEFORE_CUSTOM &&
      this.hasValidCustom(input)
    ) {
      this.snapshot = {
        source: 'CUSTOM_ACTIVE',
        activeLabel: input.customLabel,
        activeConfidence: input.customConfidence,
        releaseFrames: 0,
        onnxAbsenceFrames,
        sourceSwitchCooldown: 0,
        lastSource: 'IDLE',
      };
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      activeLabel: null,
      activeConfidence: 0,
      releaseFrames: 0,
      onnxAbsenceFrames,
    };
  }

  private stepOnnxActive(input: HybridRouterInput) {
    const onnxHolding = this.hasOnnxDefaultPresence(input) || isActiveState(input.onnxState);
    if (onnxHolding) {
      this.snapshot = {
        ...this.snapshot,
        activeLabel: input.onnxLabel ?? this.snapshot.activeLabel,
        activeConfidence: input.onnxLabel ? input.onnxConfidence : this.snapshot.activeConfidence,
        releaseFrames: 0,
        onnxAbsenceFrames: 0,
      };
      return;
    }

    const releaseFrames = this.snapshot.releaseFrames + 1;
    if (releaseFrames >= ONNX_RELEASE_FRAMES) {
      this.releaseToIdle();
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      releaseFrames,
      onnxAbsenceFrames: 0,
    };
  }

  private stepCustomActive(input: HybridRouterInput) {
    const customHolding = this.hasValidCustom(input) || isActiveState(input.customState);
    if (customHolding) {
      this.snapshot = {
        ...this.snapshot,
        activeLabel: input.customLabel ?? this.snapshot.activeLabel,
        activeConfidence: input.customLabel ? input.customConfidence : this.snapshot.activeConfidence,
        releaseFrames: 0,
      };
      return;
    }

    const releaseFrames = this.snapshot.releaseFrames + 1;
    if (releaseFrames >= CUSTOM_RELEASE_FRAMES) {
      this.releaseToIdle();
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      releaseFrames,
    };
  }
}
