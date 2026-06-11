export type SegmentationState = 'IDLE' | 'GESTURE_ACTIVE' | 'COOLDOWN';

export interface SegmentationConfig {
  blankLabel: string;
  confidenceThreshold: number;
  confirmFrames: number;
  dropToleranceFrames: number;
  cooldownFrames: number;
  blankStableFrames: number;
  lowMotionStableFrames: number;
  /**
   * EMA coefficient for per-frame confidence smoothing in GESTURE_ACTIVE.
   * Range: 0 (disabled, legacy behaviour) – 1 (no smoothing).
   * Default 0.3: a single noisy low-confidence frame barely moves the smoothed
   * value, so isolated model hiccups don't prematurely increment the drop
   * counter and destabilise an otherwise-stable gesture confirmation sequence.
   */
  confEmaAlpha?: number;
}

export const DEFAULT_SEGMENTATION_CONFIG: SegmentationConfig = {
  blankLabel: 'blank',
  confidenceThreshold: 0.90,
  confirmFrames: 8,
  dropToleranceFrames: 2,
  cooldownFrames: 16,
  blankStableFrames: 8,
  lowMotionStableFrames: 6,
  confEmaAlpha: 0.3,
};

export interface SegmentationStepInput {
  predictedLabel: string | null;
  confidenceProb: number;
  isBlankLike: boolean;
  isLowMotion: boolean;
}

export interface SegmentationSnapshot {
  state: SegmentationState;
  activeLabel: string | null;
  stableCount: number;
  dropCount: number;
  cooldown: number;
  blankStableCount: number;
  blankStableRequired: number;
  lastCompletedWord: string | null;
  threshold: number;
  confirmFrames: number;
  /** EMA-smoothed confidence for the current active label (0–100, display only). */
  smoothedConfidence: number;
}

export interface SegmentationStepOutput {
  emittedWord: string | null;
  snapshot: SegmentationSnapshot;
}

// Late-commit labels (pre-canonicalised): only emit when motion ends.
const LATE_COMMIT_LABELS = new Set(['goodbye', 'thank you', 'thankyou']);

// Below this fraction of the confidence threshold the EMA value must fall
// before a raw-confidence drop is treated as a "genuine" drop event.
// Value < 1.0 creates a hysteresis band: transient single-frame dips that
// leave the EMA still in the upper zone are absorbed without penalty.
const SUSTAINED_DROP_FRACTION = 0.85;

export class SegmentationFSM {
  private state: SegmentationState = 'IDLE';
  private activeLabel: string | null = null;
  private stableCount = 0;
  private dropCount = 0;
  private cooldown = 0;
  private blankStableCount = 0;
  private lastCompletedWord: string | null = null;
  private lowMotionCount = 0;
  private lowMotionStableCount = 0;
  /** EMA-smoothed confidence tracked during GESTURE_ACTIVE. */
  private smoothedConf = 0;

  private readonly minLowMotionToCommit = 3;

  constructor(private readonly config: SegmentationConfig = DEFAULT_SEGMENTATION_CONFIG) {}

  reset() {
    this.state = 'IDLE';
    this.activeLabel = null;
    this.stableCount = 0;
    this.dropCount = 0;
    this.cooldown = 0;
    this.blankStableCount = 0;
    this.lastCompletedWord = null;
    this.lowMotionCount = 0;
    this.lowMotionStableCount = 0;
    this.smoothedConf = 0;
  }

  getSnapshot(): SegmentationSnapshot {
    return {
      state: this.state,
      activeLabel: this.activeLabel,
      stableCount: this.stableCount,
      dropCount: this.dropCount,
      cooldown: this.cooldown,
      blankStableCount: this.blankStableCount,
      blankStableRequired: this.config.blankStableFrames,
      lastCompletedWord: this.lastCompletedWord,
      threshold: Math.round(this.config.confidenceThreshold * 100),
      confirmFrames: this.config.confirmFrames,
      smoothedConfidence: Math.round(this.smoothedConf * 1000) / 10,
    };
  }

  isCoolingDown(): boolean {
    return this.state === 'COOLDOWN';
  }

  private canon(s: string) {
    return s.trim().toLowerCase().replace(/[_-]+/g, ' ');
  }

  private clearActiveGesture() {
    this.activeLabel = null;
    this.stableCount = 0;
    this.dropCount = 0;
    this.lowMotionCount = 0;
    this.lowMotionStableCount = 0;
    this.smoothedConf = 0;
  }

  private startGesture(label: string, initConf = 0) {
    this.state = 'GESTURE_ACTIVE';
    this.activeLabel = label;
    this.stableCount = 1;
    this.dropCount = 0;
    this.cooldown = 0;
    this.blankStableCount = 0;
    this.lowMotionCount = 0;
    this.lowMotionStableCount = 0;
    // Seed EMA at the raw confidence so it doesn't start near zero and
    // immediately look like a drop on the very next frame.
    this.smoothedConf = initConf;
  }

  step(input: SegmentationStepInput): SegmentationStepOutput {
    const label = input.predictedLabel ?? this.config.blankLabel;

    // ── EMA confidence smoothing ─────────────────────────────────────────────
    // Update the exponential moving average of confidence every frame.
    // confEmaAlpha = 0 disables smoothing (legacy / test configs).
    const alpha = this.config.confEmaAlpha ?? 0;
    if (alpha > 0) {
      this.smoothedConf = alpha * input.confidenceProb + (1 - alpha) * this.smoothedConf;
    }

    const isGestureCandidate =
      !input.isBlankLike &&
      label !== this.config.blankLabel &&
      input.confidenceProb >= this.config.confidenceThreshold;

    let emittedWord: string | null = null;

    switch (this.state) {
      case 'IDLE':
        this.cooldown = 0;
        this.blankStableCount = 0;
        if (isGestureCandidate) {
          this.startGesture(label, input.confidenceProb);
        } else {
          this.clearActiveGesture();
        }
        break;

      case 'GESTURE_ACTIVE':
        this.cooldown = 0;
        this.blankStableCount = 0;

        // Track low motion streak separately (used for late-commit labels)
        if (input.isLowMotion) this.lowMotionCount += 1;
        else this.lowMotionCount = 0;

        if (isGestureCandidate) {
          // Immediate switch when a new confident label appears
          if (this.activeLabel === null) {
            this.startGesture(label, input.confidenceProb);
          } else if (label === this.activeLabel) {
            this.stableCount += 1;
            this.dropCount = 0;
          } else {
            // Confidently switched gesture mid-stream -> start tracking the new one immediately
            this.startGesture(label, input.confidenceProb);
          }
        } else {
          // Not a confident gesture candidate (blank-like, low confidence, or blank label).
          // With EMA enabled: only count as a genuine drop when the smoothed confidence has
          // also fallen below the hysteresis threshold.  A single noisy frame that leaves
          // smoothedConf in the high zone is absorbed silently, preventing premature FSM resets.
          const isGenuineDrop = alpha <= 0 ||
            this.smoothedConf < this.config.confidenceThreshold * SUSTAINED_DROP_FRACTION;
          if (isGenuineDrop) {
            this.dropCount += 1;
          }
          if (this.dropCount > this.config.dropToleranceFrames) {
            this.clearActiveGesture();
            this.state = 'IDLE';
          }
        }

        // Late-commit logic: some gestures should only emit when motion ends
        if (this.state === 'GESTURE_ACTIVE' && this.activeLabel && this.stableCount >= this.config.confirmFrames) {
          const isLateCommit = this.activeLabel ? LATE_COMMIT_LABELS.has(this.canon(this.activeLabel)) : false;
          const readyByEndMotion = !isLateCommit || this.lowMotionCount >= this.minLowMotionToCommit;

          if (readyByEndMotion) {
            emittedWord = this.activeLabel;
            this.lastCompletedWord = emittedWord;
            this.state = 'COOLDOWN';
            this.cooldown = this.config.cooldownFrames;
            this.blankStableCount = input.isBlankLike ? 1 : 0;
            this.clearActiveGesture();
          }
        }
        break;

      case 'COOLDOWN':
        if (this.cooldown > 0) {
          this.cooldown -= 1;
        }
        this.blankStableCount = input.isBlankLike ? this.blankStableCount + 1 : 0;
        this.lowMotionStableCount = input.isLowMotion ? this.lowMotionStableCount + 1 : 0;

        if (
          this.cooldown === 0 &&
          (
            this.blankStableCount >= this.config.blankStableFrames ||
            this.lowMotionStableCount >= this.config.lowMotionStableFrames
          )
        ) {
          this.state = 'IDLE';
          this.blankStableCount = 0;
          this.clearActiveGesture();
        }
        break;
    }

    return {
      emittedWord,
      snapshot: this.getSnapshot(),
    };
  }
}
