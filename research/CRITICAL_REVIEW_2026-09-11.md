# SignAI critical review — 11 September 2026

Reviewed commit `49720a7` with three parallel specialists: recognition/runtime; dataset/training/evaluation; speech/API/UI. The coordinator ran build checks and browser flows. This is a review, with no application changes. P1 means fix before treating the affected flow as dependable; P2 means follow immediately for usability and reliability. No P0 outage was established.

## Fix first

### 1. P1 — Camera remains active after leaving Recognize

**Browser confirmed.** Started a synthetic camera, retained the MediaStream reference, then navigated to Home. The page had zero video elements, but the stream's video track remained `live`. Explicit Stop worked in a separate check.

**Cause:** `src/hooks/useMediaPipe.ts:472` obtains the stream only from `videoRef.current.srcObject`. Passive unmount cleanup at line 509 can run after React clears that DOM ref. Startup also lacks cancellation around imports/getUserMedia (`223–225`, `448–451`), so late startup can outlive navigation.

**Fix:** own the MediaStream in a separate ref; stop every track independently of DOM lifetime. Add a startup generation token and set a starting guard before the first await. Release streams/models on failure and stale completion.

**Acceptance:** normal navigation, Stop, pending-permission navigation, duplicate Start, and failed initialization all end every owned track and RAF loop.

### 2. P1 — Default training excludes the entire Help class

**Deterministic probe and browser confirmed.** The starter dataset has 30 samples per class, grouped by label. `prepareTensors` preserves order and appends mirrored copies (`src/dataset/datasetUtils.ts:68`). `model.fit` takes its validation tail before shuffling (`src/ml/model.ts:124`; installed TFJS implementation `node_modules/@tensorflow/tfjs-layers/dist/engine/training.js:1258`).

At the default 20% split, training receives 60 augmented rows each for Hello, Yes, No and Please, while validation receives only 60 Help rows. Training sees no Help examples. The browser run completed with **100% train accuracy, 0% validation accuracy, validation loss 8.9553**.

**Fix:** split original samples by label before augmentation; keep related recording/session samples together where possible. Augment the training partition, pass explicit validationData, and enforce sufficient independent samples per class.

**Acceptance:** every eligible class appears in both partitions; no original and its augmentation cross partitions; starter ordering cannot determine class exclusion.

### 3. P1 — Evaluation reports training performance as general performance

**Browser and code confirmed.** `src/pages/TrainPage.tsx:58` creates one augmented feature matrix, fits on it, then evaluates the same matrix at line 75. The evaluation page reported **80% accuracy despite 0% validation accuracy**. All 60 augmented Help examples were predicted as Yes. Counts double the 30 physical samples per class.

**Fix:** evaluate only an untouched holdout; identify the partition and physical sample count in the UI. Keep training accuracy clearly separate. Synthetic starter metrics must not be presented as evidence of real signing accuracy.

**Acceptance:** Evaluate consumes no fitting samples or mirrored derivatives of fitting samples; its headline matches the named holdout.

### 4. P1 — Reload loses datasets; development reload also erases saved preferences/translations

**Browser confirmed.** Loading the starter set gives 150 samples; reloading gives zero. Dataset state is memory-only (`src/contexts/AppContext.tsx:159`). There is no persistence or unsaved-session notice.

Separately, seeding saved Greek language, XL text, disabled audio and a custom translation, then reloading the development app restored defaults and `{}`. Mount restoration effects at `AppContext.tsx:293` and 310 run alongside default-writing effects at 327–334. Root StrictMode replays these effects (`src/main.tsx:6`). This second reproduction is specifically development-mode behavior, not a demonstrated production reset.

**Fix:** persist a versioned dataset in IndexedDB with quota/error handling. Initialize preferences/translations synchronously through validated lazy state initializers, or gate writes until restoration completes. Replace samples and translations atomically when importing a replacement bundle.

**Acceptance:** reload restores samples, labels, translations and preferences in both dev and production; unavailable/full storage gives a recoverable notice.

### 5. P1 — Blank predictions fail to clear partial gesture confirmation

**Deterministic FSM probe confirmed.** With default smoothing, five Hello frames followed by twenty `blank@0.99` frames leave `GESTURE_ACTIVE`, Hello, stableCount 5, dropCount 0. Three later Hello frames emit a word. The partial sign survives a long blank interval.

**Cause:** `src/ml/segmentationFSM.ts:151` mixes blank confidence into the same confidence EMA; lines 198–203 treat the high EMA as evidence against a genuine drop. The inference layer passes real blank confidence through.

**Fix:** make blank/mismatched-class evidence decay or reset the active class independently of generic top-class confidence. Add tests using the actual default smoothing configuration.

**Acceptance:** sustained high-confidence blank resets an incomplete sign; only short explicitly tolerated uncertainty preserves it.

### 6. P1 — Phone layout clips the core controls

**Browser confirmed at 390×844.** The sidebar takes 224px, leaving 166px for main content. The language selector begins around x=405, outside the viewport. Camera controls and cards collapse into strips and overflow is hidden.

**Cause:** fixed desktop shell/sidebar in `src/components/Layout.tsx:61` and 68; unconditional five-column recognition grid in `src/pages/RecognizePage.tsx:776`. Dataset, Train and Evaluate also use desktop grids that need review.

**Fix:** mobile drawer or equivalent navigation; one-column content below a desktop breakpoint; wrapping controls, sensible minimum sizes, and scrollable short-height navigation.

**Acceptance:** 320, 390, 768 and desktop widths; XL text; portrait/landscape; all primary actions remain visible and operable without hidden horizontal overflow.

Evidence screenshot: `/tmp/signai-review-mobile.png`.

## Other urgent correctness fixes

### 7. P1 — Reset and inference completion can race

**Code-confirmed race; timing not reproduced with real signing.** `RecognizePage.tsx:612` launches asynchronous inference. Stop/reset/mode changes at 668–714 clear busy state, and `inferenceModel.ts:439` resets in-flight state while an older promise can still complete. That completion can mutate fresh FSM state, emit/speak, or overlap another inference using shared buffers.

**Fix:** generation IDs at both inference and page consumers; discard stale results before any mutation/emission; let only the actual task completion release its in-flight ownership. Test delayed completion after Stop and mode switch.

### 8. P1 — Hybrid emissions can be lost; some custom labels cannot emit

**Code-confirmed.** Custom FSM advances on every callback (`RecognizePage.tsx:551`), but results are consumed behind the ONNX busy gate (`595–659`). A one-tick emittedWord can be discarded while ONNX is busy, after which the custom FSM is already in cooldown. The outer busy gate also drops camera frames before the sequence buffer receives them, making temporal sampling depend on inference speed.

Additionally, custom `goodbye`, `thank you`, or `thankyou` cannot satisfy the shared FSM's low-motion late-commit gate: custom calls always supply `isLowMotion:false`, while those labels require low motion (`segmentationFSM.ts:209`).

**Fix:** separate frame ingestion from inference scheduling; preserve custom emissions until consumed. Make late-commit policy configurable or supply valid custom motion evidence. Verify slow-inference interleavings and affected labels.

### 9. P1 — Discard leaves the rejected word in the sentence

**Code-confirmed.** Emission prepends the word immediately (`RecognizePage.tsx:451–462`), but Discard only resets display/reducer fields (`330–338`, button `1178`). It never removes that sentence entry.

**Fix:** use stable word IDs and remove the corresponding sentence entry, or defer insertion until acceptance. Test actual sentence output after Discard.

### 10. P1 — Recording continues through camera stop and conflicting data operations

**Code-confirmed.** The 200ms interval at `DatasetPage.tsx:93` retains the label selected when recording began. Gesture selection stays enabled. Stop Camera calls camera stop without ending recording (`331`); clear/replace/remove remain available and the next interval tick can re-add old samples or use stale cached features.

**Fix:** one endRecording operation clears timer and cached features before camera stop, label changes or dataset mutation. Buffer and commit a recording atomically if practical. Test stop, change-target, clear and replace during capture.

### 11. P1 — Training lacks durable job ownership

**Code-confirmed; concurrent navigation race not runtime-reproduced.** Training state is page-local (`TrainPage.tsx:29`); abortRef is never read. Navigating away does not cancel fit. Another visit can start another job. Dataset reset can be overwritten by an old fit publishing its model and metrics (`model.ts:151`, `TrainPage.tsx:75`).

**Fix:** own one job in a model service/context, track dataset revision and run ID, reject concurrent starts, cancel when invalidated, and publish only matching results. Train a candidate model and swap after success rather than destroying the working model first. Dispose tensors/candidate models in finally; dispose replaced loaded models.

### 12. P1 — Imported labels can crash the dataset screen

**Deterministic probe and render-path inspection.** Any string label passes import (`datasetUtils.ts:142`), while getSampleCounts uses a normal object as a dictionary (`216`). For `__proto__`, lookup returns an inherited object rather than a numeric count; DatasetPage renders it at line 477, which causes a React invalid-child failure.

**Fix:** validate trimmed nonempty labels; use Map or null-prototype dictionaries for user-defined keys throughout counts/metrics/translations. Test `__proto__`, `constructor`, whitespace and empty labels through the import UI.

### 13. P1 — Async speech can play stale utterances or cancel newer ones

**Code-confirmed races; audible cross-device behavior not tested.** Older cloud requests can clear the newer global controller or call stopCloud after a body read (`src/utils/cloudTts.ts:125–166`). Rejected stale requests can start local fallback (`tts.ts:85`). eSpeak stops current audio without invalidating pending worker callbacks (`espeakFallback.ts:68`, `161–183`). Piper initialization permits multiple waiters to resume and reset the singleton (`piperFallback.ts:224–253`). Audio-off changes preferences without stopping pending/current speech.

**Fix:** one utterance generation token across all backends, identity-checked cleanup, serialized Piper initialization and a shared stopSpeech operation used for mute/unmount. Test deferred A→B responses and rapid language changes.

### 14. P1 conditional — Publicly configured cloud TTS needs abuse controls

**Code-confirmed exposure if GOOGLE_TTS_API_KEY is enabled publicly; deployment not inspected.** `api/tts.ts:50–87` accepts arbitrary unauthenticated POSTs and forwards caller-controlled text/voice to the paid provider without application rate or text-size limits. JSON null or non-string text can also throw outside validation. With no key, the endpoint returns 503 and this billing exposure is inactive.

**Fix:** validate a plain object and string fields, cap text bytes/body size, allowlist supported voices/locales, and enforce per-client plus aggregate rate/budget limits appropriate to the public demo. Share validation with the dev proxy. CORS alone is not an abuse control.

## P2 smoothness, accessibility and recovery work

- **Avoid unnecessary startup work.** Build emitted a 1,891.17 kB main JS bundle (542.81 kB gzip), with eagerly imported routes and TensorFlow dependencies. Lazy-load training/evaluation and optional ML code at actual use; AppContext's direct model import also needs consideration. Measure cold navigation before/after.
- **Defer fallback voice loading.** Entering Recognize starts Piper download with camera off (`RecognizePage.tsx:432`), even when native/cloud speech would handle it. Browser showed the download toast immediately. The module describes medium voices as about 63 MB. Start fallback loading when selected/needed.
- **Throttle display updates after profiling.** useMediaPipe publishes fresh large state every frame (`405–415`), rerendering Recognize even though inference receives a callback. Keep frame payloads in refs/callbacks, publish status changes and throttled display metrics, then compare frame times on representative hardware. No real-device jank measurement was made.
- **Recover camera errors correctly.** A transient send error sets error state (`useMediaPipe.ts:437`) that the next successful frame never clears. Five errors halt RAF without clearing isActive or stopping tracks. Clear recovered transient errors and fully tear down on fatal failure.
- **Preserve held-sign deduplication through short tracking gaps.** `RecognizePage.tsx:484` treats `!handPresent` as a release even when isHeld is true. Only rearm after sustained genuine absence; test dropout followed by cooldown completion.
- **Fix accessible control semantics.** Layout/Home nest buttons inside links; collapsed navigation and several icon buttons lack names. Settings switches have no associated labels (`SettingsPage.tsx:44`). Style links directly, name controls, expose active page/state, and verify keyboard order.
- **Finish modal/picker keyboard behavior.** GestureGuide needs dialog semantics, initial/contained/restored focus. LanguageSelector needs expanded/selection semantics and keyboard behavior, or a native select.
- **Correct product explanations.** “No cloud/no servers/data never leaves” is inaccurate with online speech enabled; distinguish local camera processing from transmitted speech text. Training architecture copy still says 156 features while model.ts uses 63. Keep the documented one-hand prototype scope; a bimanual expansion is a separate project, not required for these fixes.

## Validation and recommended implementation sequence

Passed: `npm run typecheck`; `npm test` (26 tests in four files); `npm run build`. The build warns about a large main chunk and ONNX dependency eval. No lint command is configured. Current typecheck includes src only, not api/tts.ts or vite.config.ts.

Browser checks: Home loads, ONNX reaches Ready, internal navigation works, starter load/training/evaluation completes. Synthetic camera runs at approximately 33 FPS in the sampled no-hand scene and explicit Stop releases it. Navigation leaks its track. Mobile layout and reload persistence failed as documented. Initial page had no error overlay or browser errors. Screenshots: `/tmp/signai-review-home.png`, `/tmp/signai-review-mobile.png`, `/tmp/signai-review-evaluation.png`.

Not verified: actual human signing accuracy, Safari/iOS, microphone/audio output quality across devices, deployed API behavior, or production abuse controls. No code fixes or regression tests were implemented. Existing passing tests do not establish correctness of these integration flows.

Implement in this order:

1. Camera ownership/cleanup and persistent data restoration.
2. Stratified training split and independent evaluation together.
3. FSM blank handling, generation-safe inference, hybrid emission delivery and Discard.
4. Recording/training job ownership, import validation and speech cancellation.
5. Responsive shell and accessible controls; apply API protections before public cloud speech.
6. Lazy loading and measured rendering optimization after correctness stabilizes.

Each change should add a focused regression for its demonstrated failure. Use synthetic streams and deferred promises for reproducible lifecycle tests, and a fixed small dataset for partition/leakage tests. Do not broaden recognition vocabulary while stabilizing these flows.
