# SignAI stabilization status

Last updated: 2026-09-13. Baseline: `49720a7`; test-harness checkpoint: `b242199`.

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

## Verification checkpoint

- `npm test`: 73 tests passed across 20 files.
- `npm run typecheck`: passed after test fixture correction.
- `npm run typecheck:server`: passed.
- `npm run build`: passed; main application chunk 548.52 kB / 182.08 kB gzip, TensorFlow engine isolated at 882.17 kB / 230.49 kB gzip. Vite still warns that these chunks exceed 500 kB and ONNX Runtime contains `eval`.
- `npm run test:e2e`: 4 Chromium tests passed, including Dataset at 320×568 with X-Large text.
- `git diff --check`: passed.

The final full suite passed after the review fixes. Real camera hardware, live MediaPipe CDN assets, the actual ONNX model's recognition quality, a complete browser TensorFlow training/save/load session, and a live Google TTS request have not been claimed by these deterministic tests. The paid endpoint intentionally remains unavailable in production until a real shared quota adapter and trusted platform client-identity source are wired.
