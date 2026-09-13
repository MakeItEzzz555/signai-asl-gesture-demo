# SignAI stabilization status

Last updated: 2026-09-13. Baseline: `49720a7`; completed checkpoints: `b242199`, `90d04c4`, `2a79138`, and `8823428`.

## Implemented packets

| Packet | State | Main evidence |
|---|---|---|
| P00 harness | Complete | Vitest, Testing Library, fake IndexedDB, Playwright, client/server typecheck scripts |
| P01 camera lifecycle | Complete | Session ownership closes streams, RAF, pending sends and models; four hook regressions pass |
| P02 persistence/data | Complete | Versioned atomic IndexedDB snapshot, safe label maps, import/recording boundaries, reload browser test |
| P03 speech | Complete | One utterance owner across native/cloud/eSpeak/Piper, global stop/preferences; 13 backend tests pass |
| P04 recognition | Complete | Generation-safe inference, blank reset, source router, exactly-once queue and ID-based discard; 25 targeted tests pass |
| P05 training | Complete | Lazy TensorFlow engine, durable job/generation ownership, physical-sample stratified holdout before augmentation, safe metrics, validated save/load metadata |
| P06 TTS endpoint | Complete with activation prerequisite | Shared voice allowlist and handler, body/text limits, deadline, one 400 retry, structured no-store errors. Production returns 503 until a shared atomic quota adapter is configured |
| P07/P08 accessibility/responsiveness | Complete | Semantic navigation/links/switches/select/dialog focus, mobile grids and overflow handling; component tests plus mobile browser flow pass |
| P09 performance | Complete | Routes and TensorFlow engine are split into lazy chunks; eager Piper prewarming removed. Production build records separate route/engine bundles |
| P10 documentation | Complete | README/CLAUDE privacy, storage, feature and validation claims corrected; upgrade document marked as proposal |
| P11 browser verification | Complete for deterministic flows | Home console, mobile navigation/overflow, dataset and preferences reload pass in Chromium |
| P12 independent review | Complete | Sol found four P1 integration gaps; root corrected all four and added affected regression/browser coverage |

## Post-review refinements

| Area | Final behavior | Evidence |
|---|---|---|
| ONNX startup | WASM compilation and inference use ONNX Runtime's worker proxy. Concurrent callers share one in-flight model promise, avoiding the development StrictMode false-error race and duplicate initialization. Cold visits still download and initialize the runtime/model once. | Concurrent-load regression calls `InferenceSession.create` once; ONNX reached Ready in browser with proxy mode enabled. |
| Recognition layout | At desktop width, Camera Feed uses 70% of the content grid and the live-status column uses 30%. Sentence Output is directly beneath Camera Feed at the same width. | Browser visual check at 1440×1000. |
| Dataset layout | Webcam Feed retains its natural 16:9 camera area. Recording Target stays beneath it at the same width; the two right-side cards together match that left column's total height. Recording Tips spans the full content width below both columns. | Browser visual check at 1440×1200; responsive Dataset Playwright check remains green at 320×568 with X-Large text. |
| Training completion | Loss values render to four decimal places with tabular numerals, preventing long raw floats from overlapping adjacent metrics. | A five-epoch starter-dataset training run completed in Chromium and the four result cards rendered without overlap. |

## Verification checkpoint

- `npm test`: 73 tests passed across 20 files.
- `npm run typecheck`: passed after test fixture correction.
- `npm run typecheck:server`: passed.
- `npm run build`: passed after the startup/layout refinements; main application chunk 548.81 kB / 182.18 kB gzip, TensorFlow engine isolated at 882.17 kB / 230.49 kB gzip. Vite still warns that these chunks exceed 500 kB and ONNX Runtime contains `eval`.
- `npm run test:e2e`: 4 Chromium tests passed, including Dataset at 320×568 with X-Large text.
- `git diff --check`: passed.

The final full suite passed after the review fixes. A five-epoch browser training completion was checked separately from the deterministic suite. Real camera hardware, recognition quality with real signers, Safari/iOS, a complete saved-model reload cycle on physical devices, audible speech backends, and a live Google TTS request have not been claimed by these checks. The paid endpoint intentionally remains unavailable in production until a real shared quota adapter and trusted platform client-identity source are wired.
