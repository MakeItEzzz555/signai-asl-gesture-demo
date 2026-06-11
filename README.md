# SignAI: ASL Gesture Demo

Real-time, browser-only ASL gesture recognition for a local hackathon demo.

The demo focuses on a reliable narrow scope:

- One primary hand for ML gesture recognition
- Five core gestures: `hello`, `yes`, `no`, `please`, `help`
- Face-touch interactions using fingertip proximity to face regions
- Fully client-side processing with no video upload or backend

## Quick Start

```bash
npm install
npm run dev
```

Open the Vite URL, grant camera permission, and use the **Recognize** page.

To train a custom browser-local model, use **Dataset** to record samples, then
open **Train** and **Evaluate** from the sidebar.

## Demo Behavior

The primary recognition path is:

```text
Webcam
  -> MediaPipe Hands: one primary hand, 21 landmarks
  -> normalize hand landmarks
  -> 30-frame sequence buffer with coordinate deltas
  -> ONNX Runtime Web
  -> segmentation FSM
  -> sentence output + optional speech
```

Face-touch gestures are handled separately:

```text
MediaPipe FaceMesh
  -> fingertip-to-face-region proximity check
  -> region label such as Think, Eat / Speak, Smell, See / Look, Listen
  -> sentence output + optional speech
```

The face-touch path is deterministic. It is not part of the ONNX class set.

## Current Demo Scope

The public model files live in `public/models/`:

- `asl_dynamic.onnx`
- `asl_dynamic_labels.json`

The rollback model has 7 output classes for compatibility:

```text
hello, yes, no, please, help, goodbye, blank
```

The app intentionally exposes only:

```text
hello, yes, no, please, help, blank
```

`goodbye` is suppressed in the demo runtime to keep predictions stable.

## Useful Commands

```bash
npm run dev
npm run build
npm run typecheck
npm test
```

Optional Python retraining uses the local `.venv` and `requirements-ml.txt`.
For the narrowed demo vocabulary, use:

```bash
scripts/train_demo_dynamic_model.sh
```

Raw datasets and offline training artifacts are intentionally ignored by Git.
Collaborators can run the app from the checked-in source, `package-lock.json`,
and the active browser model files in `public/models/`.

The older expanded workflow is documented for post-hackathon research, but large generated artifacts stay local and are ignored by Git.

## Key Files

- `src/hooks/useMediaPipe.ts` - camera, MediaPipe Hands, FaceMesh, face-touch detection
- `src/ml/inferenceModel.ts` - ONNX model loading and primary-hand sequence inference
- `src/ml/segmentationFSM.ts` - gesture confirmation/cooldown logic
- `src/pages/RecognizePage.tsx` - live demo UI, sentence output, speech controls
- `src/utils/landmarks.ts` - hand/face normalization and overlay drawing

## Post-Hackathon Roadmap

- Revisit second-hand recognition with dedicated bimanual training data.
- Promote face-interactive signs from heuristic labels to trained classes only after collecting balanced samples.
- Decide after the hackathon whether the TensorFlow.js custom training workflow should remain a collaborator tool or become a live recognition mode.
