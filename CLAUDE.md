# Repository operating rules

## Goal
Complete coding tasks end-to-end with minimal interruption:
understand -> plan -> delegate -> implement -> validate -> review -> summarize

## Working style
- Inspect existing code before editing.
- Reuse current architecture, naming, and patterns.
- Keep diffs minimal and production-ready.
- Prefer finishing the task over asking for unnecessary confirmation.
- Only stop for destructive operations or truly blocking ambiguity.
- Commit every completed change set.
- Create a focused branch for each new feature, fix, or direction change after the initial repository commit.

## Delegation policy
- Use the researcher agent first for unfamiliar areas.
- Split independent workstreams when possible.
- Use implementation agents for scoped code changes.
- Always run validation before finalizing.
- Always run a review pass before completion.

## Validation
Before finishing, run the narrowest relevant checks:
- lint
- tests
- build/typecheck
- any repo-specific verification command

## Output format
When done, report:
1. what changed
2. files touched
3. validation performed
4. remaining risks or follow-ups
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SignAI is a browser-based ASL (American Sign Language) hackathon demo. The default demo path uses one primary hand for ONNX dynamic gesture inference, plus a deterministic fingertip-to-face-region heuristic for face-touch interactions. Collaborators can train a browser-local TensorFlow.js model and select Hybrid mode. Webcam frames and landmarks stay local; optional cloud voices send generated speech text through `/api/tts`.

## Commands

```bash
npm run dev       # Start dev server at localhost:3000
npm run build     # Production build -> dist/
npm run preview   # Preview production build
npm run typecheck # TypeScript type check (tsc --noEmit)
npm test          # Run all Vitest unit tests
```

> Uses npm with `package-lock.json`. TypeScript strict mode is **off**. No ESLint or Prettier are configured.

## Architecture

### ML Pipeline

```
Webcam → MediaPipe Hands (one primary hand, 21 landmarks × 3 = 63 dims)
  → normalizeLandmarks() [translate to wrist origin, scale to [-1, 1]]
  → buildFrameFeature() [concat temporal derivatives → 126-dim per frame]
  → rolling 30-frame buffer (30 × 126 = 3780-dim tensor)
  → ONNX inference (asl_dynamic.onnx, loaded from /models/)
  → SegmentationFSM [3-state: IDLE → GESTURE_ACTIVE → COOLDOWN]
  → emitted word → Web Speech API (optional TTS)
```

The default ONNX vocabulary is `hello`, `yes`, `no`, `please`, `help`, and `blank`. The rollback ONNX artifact still has a `goodbye` output for compatibility, but `inferenceModel.ts` suppresses it from the demo runtime.

Recognize also has optional Hybrid mode. The facade in `src/ml/model.ts` lazily loads a TensorFlow.js classifier trained on 63 primary-hand features; callers may pass the current extended vector and the engine selects those 63 values. A source router gives the shipped ONNX model priority for default gestures and admits strong, stable custom labels after ONNX absence. If no custom model is trained or loaded, the UI keeps ONNX mode active and reports that state.

Samples and custom translations live in one versioned IndexedDB snapshot managed by `AppContext` and are included together in dataset exports. Accessibility preferences use `localStorage`. Display and speech resolve labels in this order: custom translation for the selected language, built-in translation, raw label.

Face-touch labels are not trained ONNX classes. `useMediaPipe.ts` keeps FaceMesh active and detects only index/middle fingertip proximity to mouth, eye, nose, forehead, or ear. `RecognizePage.tsx` suppresses hand-only output as soon as raw face contact is detected, then emits one mapped face-region label after a 4-frame same-region confirmation gate.

The ONNX WASM runtime and MediaPipe WASM are loaded from jsDelivr CDN at runtime (hardcoded in `inferenceModel.ts` and `useMediaPipe.ts`).

### Segmentation FSM (`src/ml/segmentationFSM.ts`)

Controls when a detected gesture is "emitted" as a recognized word. Key parameters:
- `confidenceThreshold: 0.90` — minimum confidence to count a frame
- `confirmFrames: 8` — consecutive stable frames required to emit
- `dropToleranceFrames: 2` — brief uncertainty frames allowed during confirmation
- `cooldownFrames: 16` — frames to suppress re-emission after a word fires
- The rollback model's `goodbye` output is suppressed by the demo label gate

### Key Files

| File | Role |
|------|------|
| `src/App.tsx` | Root component; loads ONNX model on startup, sets up routing (wouter) and context providers |
| `src/ml/inferenceModel.ts` | ONNX model load + `runSequenceInference()` — primary inference engine |
| `src/ml/segmentationFSM.ts` | 3-state FSM for gesture segmentation and word emission |
| `src/ml/model.ts` | Browser-local TensorFlow.js training, save/load, and custom inference |
| `src/dataset/datasetUtils.ts` | Dataset import/export, custom translation bundle parsing, tensor prep, starter dataset generation |
| `src/hooks/useMediaPipe.ts` | Webcam access, one-hand MediaPipe Hands init, FaceMesh init, per-frame landmark extraction, 5-frame hold on hand loss, face-touch proximity |
| `src/hooks/usePredictionSmoothing.ts` | Smooths raw prediction probabilities across frames |
| `src/pages/RecognizePage.tsx` | Main UI: integrates MediaPipe hook → inference → FSM → state updates → render |
| `src/contexts/AppContext.tsx` | Global state: `modelReady/Loading/Error`, accessibility settings, dataset, training config |
| `src/utils/landmarks.ts` | `normalizeLandmarks()` and canvas skeleton drawing |

### Path Alias

`@/` maps to `src/` (configured in both `tsconfig.json` and `vite.config.ts`).

### Routing

Wouter (lightweight). Routes: `/`, `/recognize`, `/dataset`, `/train`, `/evaluate`, `/settings`, `/about`.

The sidebar intentionally exposes Dataset, Train, and Evaluate so collaborators
can record samples, add optional custom translations, merge starter/imported
datasets, train a browser-local TensorFlow.js model, and use Hybrid mode in
Recognize alongside the checked-in ONNX demo model.

### Styling

Tailwind CSS v4 via Vite plugin. Dark theme primary accent: `#00E5FF`. No component library — custom components in `src/components/ui/`.

### Python (optional, for retraining)

Use `requirements-ml.txt` for optional offline model training. Local virtual
environments, raw datasets, and training artifacts are ignored by Git. The app
can run from the checked-in source plus active assets in `public/models/`.

## Tests

Only one test file: `src/ml/segmentationFSM.test.ts` — unit tests for the FSM (Vitest). Run with `npm test`.
