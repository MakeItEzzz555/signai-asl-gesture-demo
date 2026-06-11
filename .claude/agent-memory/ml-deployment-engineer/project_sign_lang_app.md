---
name: Sign Language Recognition App — Project Overview
description: Current architecture, serving modes, and training workflow of the SignAI ASL recognition web app
type: project
---

This is a browser-based ASL gesture recognition app built with React, TypeScript, Vite, MediaPipe, ONNX Runtime Web, and TensorFlow.js.

## Current Runtime Architecture

- **Live recognition path:** `src/ml/inferenceModel.ts` loads the checked-in ONNX Attention-BiGRU model from `public/models/`.
- **Input shape:** one primary hand, 30 frames, 126 features per frame.
- **Visible demo vocabulary:** `hello`, `yes`, `no`, `please`, `help`, and `blank`.
- **Compatibility note:** the restored ONNX checkpoint still has `goodbye`; runtime gating suppresses it from the demo output.
- **Face-touch path:** `src/hooks/useMediaPipe.ts` uses FaceMesh plus index/middle fingertip proximity to mouth, eye, nose, forehead, or ear. `src/pages/RecognizePage.tsx` suppresses hand-only output as soon as raw face contact is detected and emits one face-region label after a 4-frame same-region confirmation gate.
- **Second-hand recognition:** disabled for the demo. The reserved second-hand feature slot stays zeroed for compatibility.

## Browser-Local Training Workflow

- Dataset recording is available through `DatasetPage`.
- Custom TensorFlow.js training is available through `TrainPage`.
- Evaluation is available through `EvaluatePage`.
- The TF.js MLP in `src/ml/model.ts` is a browser-local custom training model and is not currently wired as a live replacement for the ONNX RecognizePage path.

## Key Implementation Notes

- Keep RecognizePage focused on the ONNX demo model plus deterministic face-touch labels.
- Keep Dataset, Train, and Evaluate available in the sidebar for collaborators who want to record samples and train browser-local models.
- Do not re-enable second-hand recognition without a dedicated bimanual dataset and feature plan.
- Do not add back broad cheek-based generic face detection; it was removed because it caused noisy generic face outputs.
- Use npm commands from `package.json`; this repo uses `package-lock.json`.
