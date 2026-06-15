# SignAI ASL Gesture Demo

Real-time, browser-only ASL gesture recognition for a local hackathon prototype.

SignAI combines MediaPipe hand/face landmarks, ONNX Runtime Web, and a small deterministic face-touch layer to recognize a narrow, reliable set of ASL-inspired demo gestures without uploading video or requiring a backend.

## Highlights

- **Client-side only:** webcam frames stay in the browser.
- **One-hand recognition:** ONNX sequence model for `hello`, `yes`, `no`, `please`, and `help`.
- **Face-region interactions:** deterministic index/middle fingertip proximity for mouth, eye, nose, forehead, and ear labels.
- **Speech output:** confirmed words can be spoken through the Web Speech API.
- **Custom training workflow:** collaborators can merge datasets, train a TensorFlow.js model, inspect metrics, and optionally use it in Recognize.
- **Hackathon-ready scope:** second-hand recognition and broad gesture expansion are intentionally deferred until stronger data exists.

## Demo Flow

```text
Webcam
  -> MediaPipe Hands: one primary hand
  -> normalized 30-frame landmark sequence
  -> ONNX Runtime Web
  -> segmentation FSM
  -> confirmed word + optional speech
```

Custom mode is optional:

```text
Dataset / starter samples
  -> TensorFlow.js training
  -> browser-local custom model
  -> Recognize custom mode toggle
  -> stable custom word + optional speech
```

Face-region labels are handled separately:

```text
MediaPipe FaceMesh
  -> index/middle fingertip proximity
  -> 4-frame same-region confirmation
  -> Think, Eat / Speak, Smell, See / Look, or Listen
```

## Recognized Demo Vocabulary

The active public model files are checked in at:

- `public/models/asl_dynamic.onnx`
- `public/models/asl_dynamic_labels.json`

The restored ONNX checkpoint still contains `goodbye` for compatibility:

```text
hello, yes, no, please, help, goodbye, blank
```

The app intentionally exposes only:

```text
hello, yes, no, please, help, blank
```

`goodbye` is gated out in runtime to keep the hackathon demo stable.

## Quick Start

Prerequisites:

- Node.js 20+
- npm
- A browser with webcam permission support

Install and run:

```bash
npm install
npm run dev
```

Open the Vite URL, grant camera permission, and use **Recognize**.

## App Sections

- **Home:** overview and entry points.
- **Recognize:** live ASL demo with camera, sentence output, speech, and an optional custom TensorFlow.js mode.
- **Dataset:** record browser-local gesture samples, load starter data, import/replace datasets, or add JSON samples to the current dataset.
- **Train:** train or load a custom TensorFlow.js model from the current merged dataset.
- **Evaluate:** inspect custom model metrics.
- **Settings:** theme, text size, contrast, and speech preferences.
- **About:** technical project summary.

## Useful Commands

```bash
npm run dev       # local development server
npm run build     # production build into dist/
npm run preview   # preview the production build
npm run typecheck # TypeScript check
npm test          # Vitest unit tests
```

## Offline Model Research

Optional Python retraining uses `requirements-ml.txt`.

For the narrowed demo vocabulary:

```bash
scripts/train_demo_dynamic_model.sh
```

For archived expanded-vocabulary experiments:

```bash
scripts/train_expanded_dynamic_model.sh
```

Large raw datasets and offline training artifacts are intentionally ignored by Git. Collaborators can run the web app from the checked-in source, `package-lock.json`, and the active model files in `public/models/`.

## Project Structure

```text
src/
  hooks/useMediaPipe.ts       MediaPipe Hands + FaceMesh runtime
  dataset/datasetUtils.ts     dataset import/export, tensor prep, starter data
  ml/inferenceModel.ts        ONNX model loading and sequence inference
  ml/segmentationFSM.ts       gesture confirmation/cooldown state machine
  ml/model.ts                 browser-local TensorFlow.js training model
  pages/RecognizePage.tsx     live recognition UI
  pages/DatasetPage.tsx       sample recording workflow
  pages/TrainPage.tsx         custom model training workflow
  pages/EvaluatePage.tsx      custom model evaluation
research/                     current research notes and tradeoffs
scripts/                      offline training entrypoints
.claude/                      Claude agent/project guidance
public/models/                active browser model assets
```

## Repository Policy

Tracked:

- app source and config
- README, roadmap, research, and Claude guidance files
- active ONNX model and labels required to run the app
- optional offline training scripts

Ignored:

- `node_modules/`
- `dist/`
- `.venv/`
- root `data/`, `dataset/`, and `artifacts/`
- inactive model backups and local scratch files

## Deployment Notes

This is a static Vite app. A production deployment should run:

```bash
npm install
npm run build
```

Then host `dist/` on any static host. The app loads MediaPipe and ONNX WASM assets in-browser and serves the active ONNX model from `public/models/` through the built app.

## Privacy

The app does not send webcam frames to a server. MediaPipe, ONNX inference, custom sample recording, and TensorFlow.js training all run in the browser.

## Custom Dataset Notes

The repository ships the active ONNX model, not the raw training dataset used to build it. The **Load Starter Dataset** button generates synthetic browser-local samples for the default demo gestures so collaborators can train quickly, then add their own recorded or imported samples on top.

Use **Add Dataset to Current** to append JSON samples without losing existing data. Use **Import Dataset (Replace)** when you intentionally want to clear the current in-browser dataset and load a different one.

## Post-Hackathon Roadmap

- Revisit second-hand recognition with dedicated bimanual training data.
- Promote face-interactive signs from heuristic labels to trained classes only after collecting balanced samples.
- Improve custom TensorFlow.js live recognition with stronger sample guidance and model quality checks.
- Add deployment-specific config if the app is published under a subpath such as GitHub Pages.
