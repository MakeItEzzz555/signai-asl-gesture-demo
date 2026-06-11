import { describe, expect, it } from 'vitest';
import { SegmentationFSM, type SegmentationConfig } from './segmentationFSM';

const TEST_CONFIG: SegmentationConfig = {
  blankLabel: 'blank',
  confidenceThreshold: 0.9,
  confirmFrames: 3,
  dropToleranceFrames: 2,
  cooldownFrames: 3,
  blankStableFrames: 2,
  lowMotionStableFrames: 2,
};

function makeFSM() {
  return new SegmentationFSM(TEST_CONFIG);
}

describe('SegmentationFSM', () => {
  it('tolerates brief confidence dips without resetting confirmation', () => {
    const fsm = makeFSM();

    let step = fsm.step({ predictedLabel: 'hello', confidenceProb: 0.95, isBlankLike: false, isLowMotion: false });
    expect(step.snapshot.state).toBe('GESTURE_ACTIVE');
    expect(step.snapshot.stableCount).toBe(1);

    step = fsm.step({ predictedLabel: 'hello', confidenceProb: 0.2, isBlankLike: false, isLowMotion: false });
    expect(step.snapshot.state).toBe('GESTURE_ACTIVE');
    expect(step.snapshot.stableCount).toBe(1);
    expect(step.snapshot.dropCount).toBe(1);
    expect(step.emittedWord).toBeNull();

    step = fsm.step({ predictedLabel: 'hello', confidenceProb: 0.96, isBlankLike: false, isLowMotion: false });
    expect(step.snapshot.state).toBe('GESTURE_ACTIVE');
    expect(step.snapshot.stableCount).toBe(2);

    step = fsm.step({ predictedLabel: 'hello', confidenceProb: 0.98, isBlankLike: false, isLowMotion: false });
    expect(step.emittedWord).toBe('hello');
    expect(step.snapshot.state).toBe('COOLDOWN');
    expect(step.snapshot.lastCompletedWord).toBe('hello');
  });

  it('prevents repeated emissions during cooldown and only rearms after blank stability', () => {
    const fsm = makeFSM();
    const emitted: string[] = [];

    for (let i = 0; i < 3; i++) {
      const step = fsm.step({ predictedLabel: 'yes', confidenceProb: 0.95, isBlankLike: false, isLowMotion: false });
      if (step.emittedWord) emitted.push(step.emittedWord);
    }

    expect(emitted).toEqual(['yes']);
    expect(fsm.getSnapshot().state).toBe('COOLDOWN');

    for (let i = 0; i < 5; i++) {
      const step = fsm.step({ predictedLabel: 'yes', confidenceProb: 0.99, isBlankLike: false, isLowMotion: false });
      if (step.emittedWord) emitted.push(step.emittedWord);
    }

    expect(fsm.getSnapshot().state).toBe('COOLDOWN');
    expect(emitted).toEqual(['yes']);

    fsm.step({ predictedLabel: 'blank', confidenceProb: 0.99, isBlankLike: true, isLowMotion: false });
    const rearmStep = fsm.step({ predictedLabel: 'blank', confidenceProb: 0.99, isBlankLike: true, isLowMotion: false });
    expect(rearmStep.snapshot.state).toBe('IDLE');

    for (let i = 0; i < 3; i++) {
      const step = fsm.step({ predictedLabel: 'yes', confidenceProb: 0.96, isBlankLike: false, isLowMotion: false });
      if (step.emittedWord) emitted.push(step.emittedWord);
    }

    expect(emitted).toEqual(['yes', 'yes']);
  });

  it('does not collapse an active gesture on a brief blank-like tick within drop tolerance', () => {
    const fsm = makeFSM();

    fsm.step({ predictedLabel: 'help', confidenceProb: 0.97, isBlankLike: false, isLowMotion: false });
    let step = fsm.step({ predictedLabel: 'help', confidenceProb: 0.96, isBlankLike: false, isLowMotion: false });
    expect(step.snapshot.stableCount).toBe(2);

    step = fsm.step({ predictedLabel: 'blank', confidenceProb: 0.1, isBlankLike: true, isLowMotion: false });
    expect(step.snapshot.state).toBe('GESTURE_ACTIVE');
    expect(step.snapshot.stableCount).toBe(2);
    expect(step.snapshot.dropCount).toBe(1);

    step = fsm.step({ predictedLabel: 'help', confidenceProb: 0.95, isBlankLike: false, isLowMotion: false });
    expect(step.emittedWord).toBe('help');
    expect(step.snapshot.lastCompletedWord).toBe('help');
  });

  it('switches immediately to a new confident label during gesture tracking', () => {
    const fsm = makeFSM();

    fsm.step({ predictedLabel: 'hello', confidenceProb: 0.95, isBlankLike: false, isLowMotion: false });
    let step = fsm.step({ predictedLabel: 'hello', confidenceProb: 0.96, isBlankLike: false, isLowMotion: false });
    expect(step.snapshot.activeLabel).toBe('hello');
    expect(step.snapshot.stableCount).toBe(2);

    step = fsm.step({ predictedLabel: 'please', confidenceProb: 0.97, isBlankLike: false, isLowMotion: false });
    expect(step.snapshot.state).toBe('GESTURE_ACTIVE');
    expect(step.snapshot.activeLabel).toBe('please');
    expect(step.snapshot.stableCount).toBe(1);
    expect(step.snapshot.dropCount).toBe(0);
  });

  it('late-commit labels wait for low motion before emitting', () => {
    const fsm = makeFSM();

    for (let i = 0; i < 3; i++) {
      const step = fsm.step({
        predictedLabel: 'goodbye',
        confidenceProb: 0.98,
        isBlankLike: false,
        isLowMotion: false,
      });
      expect(step.emittedWord).toBeNull();
      expect(step.snapshot.state).toBe('GESTURE_ACTIVE');
    }

    let step = fsm.step({
      predictedLabel: 'goodbye',
      confidenceProb: 0.98,
      isBlankLike: false,
      isLowMotion: true,
    });
    expect(step.emittedWord).toBeNull();

    step = fsm.step({
      predictedLabel: 'goodbye',
      confidenceProb: 0.98,
      isBlankLike: false,
      isLowMotion: true,
    });
    expect(step.emittedWord).toBeNull();

    step = fsm.step({
      predictedLabel: 'goodbye',
      confidenceProb: 0.98,
      isBlankLike: false,
      isLowMotion: true,
    });
    expect(step.emittedWord).toBe('goodbye');
    expect(step.snapshot.state).toBe('COOLDOWN');
  });

  it('non-late labels still emit as soon as confirmation is reached', () => {
    const fsm = makeFSM();

    fsm.step({ predictedLabel: 'hello', confidenceProb: 0.97, isBlankLike: false, isLowMotion: false });
    fsm.step({ predictedLabel: 'hello', confidenceProb: 0.98, isBlankLike: false, isLowMotion: false });
    const step = fsm.step({ predictedLabel: 'hello', confidenceProb: 0.99, isBlankLike: false, isLowMotion: false });

    expect(step.emittedWord).toBe('hello');
    expect(step.snapshot.state).toBe('COOLDOWN');
  });

  it('cooldown exits via low motion even when the hand never goes blank', () => {
    const fsm = makeFSM();

    fsm.step({ predictedLabel: 'hello', confidenceProb: 0.97, isBlankLike: false, isLowMotion: false });
    fsm.step({ predictedLabel: 'hello', confidenceProb: 0.98, isBlankLike: false, isLowMotion: false });
    let step = fsm.step({ predictedLabel: 'hello', confidenceProb: 0.99, isBlankLike: false, isLowMotion: false });
    expect(step.snapshot.state).toBe('COOLDOWN');

    step = fsm.step({ predictedLabel: 'hello', confidenceProb: 0.2, isBlankLike: false, isLowMotion: true });
    expect(step.snapshot.state).toBe('COOLDOWN');

    step = fsm.step({ predictedLabel: 'hello', confidenceProb: 0.2, isBlankLike: false, isLowMotion: true });
    expect(step.snapshot.state).toBe('COOLDOWN');

    step = fsm.step({ predictedLabel: 'hello', confidenceProb: 0.2, isBlankLike: false, isLowMotion: true });
    expect(step.snapshot.state).toBe('IDLE');
  });

  it('held frames do not count as blank when isBlankLike is false', () => {
    const fsm = makeFSM();

    fsm.step({ predictedLabel: 'hello', confidenceProb: 0.97, isBlankLike: false, isLowMotion: false });
    fsm.step({ predictedLabel: 'hello', confidenceProb: 0.98, isBlankLike: false, isLowMotion: false });
    let step = fsm.step({ predictedLabel: 'hello', confidenceProb: 0.99, isBlankLike: false, isLowMotion: false });
    expect(step.snapshot.state).toBe('COOLDOWN');

    step = fsm.step({ predictedLabel: 'blank', confidenceProb: 0, isBlankLike: false, isLowMotion: true });
    expect(step.snapshot.blankStableCount).toBe(0);
    expect(step.snapshot.state).toBe('COOLDOWN');
  });
});
