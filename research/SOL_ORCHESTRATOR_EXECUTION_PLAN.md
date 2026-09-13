# Sol orchestration execution plan — SignAI stabilization

Prepared: 2026-09-12. Baseline: `49720a7` (`Enforce ONNX-first hybrid gating`).
Status: **EXECUTED — preserved as the historical implementation plan.** Final
outcomes and verification are recorded in
[STABILIZATION_STATUS.md](STABILIZATION_STATUS.md) and
[STABILIZATION_REVIEW.md](STABILIZATION_REVIEW.md).
Audience: a `gpt-5.6-sol` root coordinator executing this plan with Sol, Terra and Luna workers.

## 1. Objective and scope

Fix the 14 findings in [the critical review](CRITICAL_REVIEW_2026-09-11.md), plus its performance, accessibility and recovery follow-ups. Preserve the current five-sign, one-primary-hand ONNX demo, optional custom Hybrid model, face-touch heuristic, translations and local speech fallbacks.

Success means demonstrated lifecycle/data correctness, truthful evaluation, usable phone layouts, accessible controls, and measured startup/render improvements. A passing build alone is insufficient. Do not add vocabulary, retrain/replace the shipped ONNX model, implement two-hand recognition, change frameworks, upgrade unrelated dependencies, or redesign the product.

The review's line numbers identify the baseline; locate symbols again if code moves. Source files and failing reproductions take precedence over an outdated review claim. Record a disproved finding with evidence rather than forcing a patch.

All local implementation and regression work in this plan should proceed once the user instructs Sol to execute it. Deployment, new paid infrastructure, secret/privilege changes and deletion of actual user datasets are outside this plan. Use isolated browser profiles and synthetic data for destructive test flows.

## 2. Coordinator, models and execution rules

| Responsibility | Model ID | Reasoning | Why assigned |
| --- | --- | --- | --- |
| Root coordinator and integration decisions | `gpt-5.6-sol` | high | Own contracts, dependencies, evidence and final acceptance |
| Camera, recognition, training, speech, API, final correctness review | `gpt-5.6-sol` | high | Async ownership, ML correctness and security boundaries |
| Test harness, persistence/recording, responsive UI, browser verification | `gpt-5.6-terra` | high for persistence/harness; medium for UI/QA | Bounded implementation with explicit state/API contracts |
| Documentation and coverage ledger | `gpt-5.6-luna` | medium | Grounded copy and checklist work after behavior stabilizes |

These assignments are task choices, not claims that a cheaper model cannot do harder work. Promote a Terra/Luna task to Sol if it exposes an unresolved concurrency/security/data-integrity decision or repeats the same failed approach twice. Provide the evidence and current diff on promotion. Do not automatically retry failed agents forever or silently substitute an unavailable model; root may finish a bounded remaining task locally and disclose the substitution.

Use at most **four active agents total: Sol root plus three workers**. Packets below are sequential assignments, not a request to launch every named packet at once. Reuse workers of the same model when practical, explicitly releasing prior ownership. Do not allow workers to spawn grandchildren.

For explicit model selection use generic `worker` (or `default` for read-only review), with `fork_turns: "none"` and a self-contained prompt. Named specialist roles can have fixed models; do not assume an override changes them. Root's model must be selected when starting the execution session; a worker spawn does not change root's model.

Relevant skills, read only when needed:

- Root: `workflow-orchestrator`, `task-distributor`, `multi-agent-coordinator`.
- Implementation workers: `musk-5-implementation-discipline` first, then the relevant frontend/backend/React/TypeScript/accessibility/QA skill.
- Browser owner: `vercel:agent-browser`, `vercel:agent-browser-verify` when using the dev server.
- Final reviewer: `code-reviewer`; API owner also `security-engineer`.

Repository instructions and the user's authorization take precedence over generic skill guidance. The named skill paths are session-provided; read the actual available files rather than inventing their content.

### Shared-workspace rules

1. One writer per file at a time, including tests and configuration. Every packet has an explicit write lease below. Reading another owner's file is allowed; changing it requires a root-approved ownership transfer.
2. Root does not edit leased files while the worker runs. Workers must not revert others' edits, stage the entire tree, run branch switches, or create overlapping worktrees by assumption. All agents share the checkout unless root deliberately establishes otherwise.
3. Root owns branch/commit integration. Start a focused branch after inspecting existing changes; retain unrelated user work. Commit accepted coherent packets/checkpoints, never `git add .` indiscriminately. Do not push/deploy as part of local execution.
4. Root alone changes `package.json`, lockfile, TypeScript/test configuration after P00 completes. A worker requests dependency/config additions with a concrete reason; root performs them at an integration boundary.
5. Changes to a declared public contract require a message to consumers and root approval before editing. Do not use `any`, disable StrictMode, lower recognition gates, suppress tests or hide errors to satisfy a check.
6. After a packet: report files changed, contracts changed, bug reproduction before/after, exact checks/results and residual limitations. Root releases paths only after reviewing this handoff.

## 3. Execution graph and exclusive write ownership

P00 must finish before implementation waves. Within a wave, the listed packets can run concurrently. Advance only when their shared contracts are accepted and targeted checks pass.

| Wave | Packet | Owner/model | Exclusive production write paths (tests owned alongside these) |
| --- | --- | --- | --- |
| 0 | P00 baseline, harness and contracts | Terra; Sol root accepts | `package.json`, `package-lock.json`, `tsconfig.server.json` (new), `vitest.config.ts` (new), `playwright.config.ts` (new), `src/test/**` (new), `e2e/fixtures/**` (new), `.gitignore` test outputs only |
| 1 | P01 camera lifecycle | Sol | `src/hooks/useMediaPipe.ts`; new `src/hooks/useMediaPipe.test.tsx` |
| 1 | P02 dataset durability, imports and recording | Terra | `src/contexts/AppContext.tsx`, `src/contexts/ThemeContext.tsx`, `src/dataset/datasetUtils.ts`, new `src/dataset/datasetStorage.ts`, `src/pages/DatasetPage.tsx`, `src/i18n/translations.ts`; corresponding tests |
| 1 | P03 speech engine ownership | Sol | `src/utils/tts.ts`, `cloudTts.ts`, `espeakFallback.ts`, `piperFallback.ts`; corresponding tests |
| 2 | P04 recognition and Hybrid integration | Sol | `src/pages/RecognizePage.tsx`, `src/ml/inferenceModel.ts`, `segmentationFSM.ts`, `hybridRouter.ts`; corresponding tests; narrowly scoped `src/ml/recognitionController.ts` extraction only if needed |
| 2 | P05 training, splitting, model ownership, metrics | Sol | `src/ml/model.ts`, new `src/ml/trainingSession.ts`, new `src/ml/trainingSplit.ts`, `src/contexts/AppContext.tsx`, `src/dataset/datasetUtils.ts`, `src/pages/TrainPage.tsx`, `EvaluatePage.tsx`; corresponding tests |
| 2 | P06 cloud endpoint and dev parity | Sol | `api/tts.ts`, `vite.config.ts`, new `server/tts/**`, new `shared/ttsVoices.ts`, `src/utils/cloudTts.ts` voice-map import only; server/shared tests |
| 3 | P07 shell and shared accessibility | Terra | `src/components/Layout.tsx`, `GestureGuide.tsx`, `LanguageSelector.tsx`, `src/pages/SettingsPage.tsx`, `Home.tsx`, `AboutPage.tsx`, `src/index.css`; corresponding tests |
| 3 | P08 page responsiveness and presentation | Terra | `src/pages/RecognizePage.tsx`, `DatasetPage.tsx`, `TrainPage.tsx`, `EvaluatePage.tsx`; corresponding component tests |
| 4 | P09 measured performance | Sol | `src/App.tsx`, `src/contexts/AppContext.tsx`, `src/hooks/useMediaPipe.ts`, `src/pages/RecognizePage.tsx`, `src/ml/model.ts`, `trainingSession.ts`; new small model facade if necessary; performance tests/fixtures. Other paths only via root transfer |
| 4 | P10 docs and coverage ledger | Luna | `README.md`, `CLAUDE.md`, `GESTURE_RECOGNITION_UPGRADE.md` status notice only, new `research/STABILIZATION_STATUS.md`; no application logic |
| 5 | P11 end-to-end verification | Terra | `e2e/**/*.spec.ts` and a new `research/STABILIZATION_VERIFICATION.md`; fixtures/config edits by root approval |
| 5 | P12 independent review | Sol | Read-only application review; new `research/STABILIZATION_REVIEW.md` only |

Explicit transfers: AppContext P02 → P05 → P09; datasetUtils P02 → P05; camera hook P01 → P09; cloudTts P03 → P06; Recognize P04 → P08 → P09; Dataset P02 → P08; Train/Evaluate P05 → P08. Root retains config ownership after P00. P10 may run with P09 for documentation unaffected by unfinished performance changes, then reconcile before completion. P11 and P12 run against one frozen implementation revision. Any implementation correction returns to its owner and invalidates only the affected verification/review results.

## 4. Contracts root must settle in P00

These names describe **proposed contracts**, not APIs claimed to exist today. Root may choose equivalent names once, record them in the status ledger, and require all consumers to use them.

### A. Dataset state and durability

- Keep the existing `GestureSample` feature shape and legacy array/v2 imports. Do not invent signer/session provenance or require a new three-way training workflow for this repair.
- A browser-local snapshot contains `{ schemaVersion: 1, revision, samples, customTranslations }`. Derive labels from validated samples; do not trust independently stored labels. The internal storage version is separate from export bundle v2.
- Expose `datasetRevision`, `datasetStorageStatus: loading | saving | saved | error`, and atomic replace/merge bundle operations from AppContext. Content mutations increment the training revision; translation-only edits persist without retraining. A separate persistence sequence may order both types of write.
- Restore IndexedDB before enabling dataset mutation controls or writing defaults. Migrate existing localStorage translations only when no current snapshot exists; do not re-merge stale translations on every reload. Validate preferences/theme through lazy initializers with guarded reads/writes.
- Mutations retain a usable in-memory snapshot and serialize immediate persistence writes. Coalesce only snapshots not yet started; an older write must never overwrite a newer snapshot. `saved` means the latest transaction committed. Failure must not claim success or clear the only good copy.
- Do not promise asynchronous IndexedDB writes complete during unload. Show Saving/Saved/recoverable error; on explicit recording Stop wait for the write queue before saying data is saved. If changes are still unsaved on unload, use a narrowly scoped unsaved-work notice. Export remains available when storage fails.

### B. Training ownership and preserved model APIs

- P05 preserves existing `predict`, `isModelReady` and async `loadModel` signatures used by P04, or provides compatible wrappers. P04 must not read candidate models or internal training state.
- One application-owned training job contains `{runId, datasetRevision, status}`. Navigation does **not** cancel it; returning to Train displays the same job. Explicit Cancel, dataset mutation and app shutdown invalidate it. A second train/load cannot run concurrently with training.
- AppContext's data invalidation path in P02 is the integration seam P05 replaces with generation-aware cancellation. P02 must not try to implement the training service in parallel.
- Only a candidate belonging to the current run/revision can publish. Retain the last good model during a same-dataset retrain; invalidate it on dataset mutation according to existing semantics. Failure of a candidate must not leave contradictory ready/metrics flags.

### C. Recognition ownership and events

- A recognition session has a monotonic generation changed by Stop, mode change, unmount and explicit reset. Old async completions have no authority to mutate state, emit speech or clear a newer task's lock.
- Separate ingesting each captured frame into the rolling sequence from scheduling ONNX work. Keep at most one inference per owned session/pipeline in flight; input memory used by that task stays immutable until completion.
- Distinguish reusable prediction display snapshots from one-shot emission events. Reusing cached probabilities must never replay `emittedWord` or count one completed inference as multiple fresh confirmation observations.
- Preserve ONNX-first arbitration for built-in signs and face-contact priority. A custom emission can be delivered once only while its generation/source ownership remains valid; do not replay a queued custom word after face suppression or an ONNX takeover.
- Keep auto-add behavior. A pending entry stores a unique sentence-entry ID; Discard removes that exact entry, and Confirm dismisses its notice. Do not silently convert the app to manual confirmation. Previously played audio cannot be undone; pending playback for a discarded entry should be cancelled where owned.

### D. Speech and shared UI integration

- P03 exports idempotent `stopSpeech()` plus a preference synchronization operation covering audio enabled/cloud choice/language. It invalidates delayed voice discovery, fallback, synthesis and playback, not just current HTMLAudioElement output.
- P02 initially keeps existing speech calls stable. Root/P05 wires the finalized global preference sync in AppContext after P03 finishes, so sidebar and Settings mute work immediately. P04 calls stopSpeech on recognition Stop/unmount/reset as appropriate. P07 wires Settings preview cleanup.
- P03 preserves the locale/voice map values initially. P06 may extract them to a shared pure module; browser code must never import server credentials or Node modules.

## 5. Work packets and acceptance criteria

### P00 — Baseline, targeted harness and contracts

**Inputs:** review, this plan, package/lockfile and current source. **Output:** recorded baseline, accepted contracts and runnable test commands.

1. Inspect git status and applicable repository instructions. Confirm baseline or record intervening changes. Capture `npm run typecheck`, `npm test`, `npm run build`, current bundle sizes and initial route resources.
2. Add only missing development test tools: DOM component testing compatible with installed React/Vitest (normally Testing Library + jsdom), `fake-indexeddb`, and Playwright for repeatable browser regressions. Verify supported versions against installed packages/current official docs before selecting versions; do not upgrade runtime dependencies to make testing convenient.
3. Add `npm run test:e2e` and `npm run typecheck:server`. The latter checks API, Vite config and new shared/server modules with proper Node types. Keep Vitest excluding e2e specs. Do not introduce a lint suite merely because none exists.
4. Add deterministic deferred-promise, synthetic MediaStream, RAF/timer and IndexedDB fixtures. Mock model engines in component lifecycle tests. Separate unit test configuration from Vite's live TTS middleware so unit tests cannot contact a paid provider.
5. Establish isolated browser profiles/test data and a server on a free local port. The browser harness must verify actual page content, console errors and navigation, not just HTTP 200.

**Gate:** baseline results recorded; one minimal DOM mount test, one fake-IDB transaction, and a browser Home smoke test run. Tests do not access real camera or cloud credentials. Root owns config edits after this gate.

### P01 — Camera resource ownership and error recovery

**Inputs:** hook code, synthetic stream/deferred fixtures. **Output:** independently owned stream/models/RAF with safe startup and teardown.

- Store the acquired stream outside the DOM ref immediately. Register startup ownership before any await; recheck generation after imports, getUserMedia, video.play and each MediaPipe send.
- Preserve the current hook's public start/stop functions, refs and onLandmarks callback shape during wave1, because P02 consumes them concurrently. Additive lifecycle fields are allowed only after root records their meaning; breaking signature changes wait for a coordinated handoff.
- Stop/unmount must end all owned tracks even when React has nulled videoRef. A cancelled startup that later receives a stream must stop it immediately. Startup failure releases partially created models/streams.
- Do not let an old frame's completion schedule RAF, update results or read new models after Stop/restart. Serialize teardown/model closure relative to pending sends; handle close rejections without resurrecting ownership.
- Clear transient errors after successful processing. At the existing fatal threshold, fully tear down and report inactive/retryable state.

**Regressions:** explicit Stop; navigate away; unmount with null videoRef; double Start; stop during permission/play/send waits; stale start completes after restart; one transient failure then success; repeated fatal failures; retry succeeds. Assert ended tracks, no retained RAF and no stale state callback. Browser start→Home must leave the captured old track `ended`.

### P02 — Durable dataset, safe imports and recording boundaries

**Inputs:** contracts A/D, current data handlers. **Output:** persistence module, atomic mutation APIs, corrected capture lifecycle.

- Implement contract A with native IndexedDB or an already-present helper; do not add a backend/database service. Preserve legacy array and v2 JSON compatibility and existing 156→63 conversion notices.
- Validate imports before mutating state: plain sample objects; trimmed nonempty labels; 63 or supported legacy 156 finite coordinates; valid finite timestamps or documented fallback. Null/arrays/wrong shapes fail with useful sample-index errors.
- Use prototype-safe maps/own-key lookups throughout counts and custom translations. Test `__proto__`, `constructor`, `toString`; do not rely solely on banning one key. P05 applies the same rule to metric maps.
- Replace import replaces translations, including clearing old translations if the replacement has none. Merge preserves existing unrelated content and uses a documented incoming-value-wins rule for translation collisions.
- A single idempotent endRecording clears interval/features and freezes the recording label. Invoke it before camera Stop, target change, destructive data operation, import application and unmount. Each tick requires fresh, genuinely detected hand features, not a held/stale copy.
- Snapshot import mode/file before asynchronous reads, prevent out-of-order imports overwriting newer operations, and reset file input in finally, including early-return errors.
- Restore accessibility and custom translations without StrictMode overwrite. Handle disabled/full storage without crashing ErrorBoundary. Preserve controls/settings while a recoverable storage warning is shown.
- A corrupt or unsupported persisted snapshot must remain available for recovery/export; do not automatically overwrite it with an empty fallback. Report the recovery state, and require an explicit in-app replace/clear action to replace that stored payload.

**Regressions:** save→reload in dev StrictMode and production; 150 samples remain after Saved; translation/preference persistence; slow hydration cannot overwrite existing data; ordered rapid writes; quota/corrupt/unavailable storage; replace atomicity; hostile label import renders safely; stop/change/clear/replace/unmount causes no later capture writes; import reads resolved out of order.

### P03 — Speech cancellation and fallback correctness

**Inputs:** speech modules, deferred timers/worker/audio fixtures. **Output:** one utterance authority across native/cloud/Piper/eSpeak and stable exported controls.

- Allocate an utterance generation before waiting for voices. Every async continuation verifies current ownership before fallback, callbacks, playback or shared cleanup.
- Cloud cleanup only clears its own controller/audio/object URL. Cancellation is intentional completion/cancellation, never a reason to start a stale local fallback. Resolve/reject pending playback promises on cancellation so callers do not hang.
- eSpeak worker results must not play after cancellation. Piper singleton initialization/synthesis must be serialized correctly across rapid language changes; an old operation may release only resources it owns.
- Correct an additional edge found while preparing this plan: `tts.ts`'s 300ms timeout currently does nothing if the native voice list stays empty. Event+timer can also run the same request twice. Use an exactly-once bounded native-voice wait and proceed to available fallbacks even when native voices or speechSynthesis are absent.
- Leave fallback model download initiation in the chosen speech path. P04 removes unconditional Recognize prewarming; P07 removes unnecessary Settings prewarming. Keep native voice discovery lightweight.

**Regressions:** delayed A then B; A resolves/rejects after B; mute/unmount during every async phase; cloud abort; eSpeak callback after Stop; rapid EN→EL→EN initialization; empty native voices after timeout; no speechSynthesis but supported alternative backend; event and timeout fire; no unsettled cancelled promises; no old URL/audio cleanup destroys the current utterance.

### P04 — FSM, inference sampling, Hybrid events and sentence correction

**Inputs:** contract C; completed camera/speech public contracts. P05 may concurrently change model internals but must preserve the public API.

- Fix confidence smoothing so sustained blank/invalid active-class evidence consumes the existing drop tolerance instead of supporting the active label. Preserve intended short uncertainty tolerance and current thresholds; do not set smoothing to zero just to match old tests.
- Introduce session/task identity at inference and page consumption boundaries. Protect model input buffers until async completion; never force a busy flag false while its task still owns it.
- Ingest all captured frames independently of ONNX scheduling. Route results using current permitted ownership, not an old customFrame closure. Consume each eligible custom/ONNX emission once, with explicit invalidation on reset, takeover and face suppression.
- Make custom late-commit policy coherent: prefer a configuration that disables ONNX-specific late-commit labels for the static custom classifier, rather than fabricating motion. Keep ONNX policy intact. Custom `goodbye` remains distinct from the shipped ONNX vocabulary gate.
- Rearm held-sign deduplication only after real sustained release (`!handPresent && !isHeld` or the agreed equivalent), not a short tracked-hand gap.
- Implement Discard by unique entry ID while keeping auto-add/Confirm behavior. Remove eager Piper mount/language prewarm; rely on P03 routing. Stop pending speech at relevant session boundaries.
- Guard async custom model loading during mode changes/unmount, as well as ONNX completions.

**Regressions:** default-EMA 5 Hello + 20 blank + 3 Hello does not emit; short tolerated gap still works; at least one normal valid sign emits; old inference after Stop/mode change cannot emit; old finally cannot clear new ownership; rolling window contains latest captured frames under delayed inference; cached result cannot replay emission; custom event during ONNX wait delivers once only when eligible; ONNX-first/face gates preserved; custom goodbye/thank-you can emit; short held gap does not duplicate; discard removes only selected sentence entry.

### P05 — Reliable model jobs and honest validation

**Inputs:** completed P02 mutation/revision API; existing model API compatibility with P04. **Output:** one durable job, a stratified splitter, validated model publication, truthful metrics.

- Implement contract B. Keep orchestration state in one application-lifetime service/context, not TrainPage. Pages subscribe to the same run across navigation. Add Cancel and prevent concurrent train/load. Disable Save during a pending replacement unless explicitly saving the last-good model with accurate UI text; simplest default is disabled.
- Use one deterministic **two-way train/validation split** of original samples, stratified by label. For each eligible label with n≥2, validation count is `clamp(round(n * validationSplit), 1, n-1)`. Keep the existing overall 10-sample/2-class gate plus actionable per-class ≥2 requirement. Snapshot config and seed once per job.
- At default 150 originals (30 each), expect 120 training originals, 30 validation originals, every label represented. Mirroring yields 240 fitting rows; validation remains 30 physical rows. Pass explicit validationData to fit; remove fit's implicit validationSplit on augmented ordered rows.
- Validation data is also the dashboard's **validation holdout**, not a separately claimed unseen test set. Compute metrics on that unaugmented partition only. Show partition name, support counts, seed/strategy and data provenance limitation. These sample-level metrics do not prove unseen-signer/session performance; legacy files have no such metadata. A three-way/signer-held-out research workflow is outside this repair.
- Retain the last good model until candidate training and candidate validation both succeed. Publish model/labels/metrics atomically only if run+dataset revision still match. Check cancellation after awaits and before publishing; request TFJS stopTraining and discard stale completion even if cancellation cannot interrupt the current batch immediately.
- Dispose input/output tensors and abandoned candidates on errors/cancel; dispose old published models only after safe swap. Model load must validate input dimension, output/label cardinality and metadata before replacing the current model; failed loads preserve it. Keep existing saved models compatible where valid.
- Use safe metric maps for user labels. Clear unrelated/stale evaluation when loading a different model; never display old metrics as belonging to a new loaded model.
- Wire global speech preferences/stop from P03 through AppContext, without creating a second independent mute state.

**Regressions:** deterministic/permutation-robust class representation; original/mirror never cross split; fitting never consumes holdout rows; confusion sum equals 30 for the default starter split; metrics sample support matches UI; train→navigate→return still one running job; second start/load rejected; dataset mutation/cancel prevents delayed publish; failed retrain preserves old same-dataset model; tensor/model cleanup on reject; repeated loads release replaced model; invalid model metadata rejected; saved model remains usable by Hybrid.

Do not assert an arbitrary accuracy target for synthetic training. Verify correct partitions and provenance; report measured accuracy honestly even if low.

### P06 — Cloud endpoint validation and real abuse protection

**Inputs:** existing endpoint/dev middleware and completed P03 voice map. **Output:** shared validated request/provider logic, bounded errors, testable policy, documented production gate.

- Inspect the actual production hosting/runtime read-only if available. Verify request body parsing and deployment limits with current official runtime/provider docs; the current Netlify compatibility comment is not proof of an installed Netlify adapter.
- Extract one pure locale/voice allowlist used by browser and server. Share request validation and provider invocation between Vite dev middleware and production handler. Keep provider secrets strictly server-side.
- Proposed app limits: 16 KiB request body, 4 KiB trimmed UTF-8 speech text, 10s provider timeout, at most the existing single named-voice fallback retry under the same overall deadline. These are demo policy defaults, not claimed provider quotas. Check that they fit verified provider limits; root records any necessary adjustment.
- Contract: 405 unsupported method; 400 malformed/type/allowlist error; 413 size limit; 429 enforced rate/budget rejection with Retry-After where meaningful; 503 unconfigured provider/protection; bounded 502/504 upstream failures. Browser falls back locally, without stale replay or logging recognized text/keys. Distinguish temporary 503 from permanently unconfigured cloud in the client.
- Define proposed demo abuse budgets explicitly (default 30 requests/client/minute and 1,000 total provider requests/day, configurable server-side). Both original and retry requests consume aggregate allowance. Verify trusted client identity handling for the actual host; do not trust arbitrary forwarded headers.
- **Production gate:** per-client and aggregate enforcement must survive serverless instances/restarts, through an existing verified platform policy or shared atomic store. A module-level Map, CORS, Origin check, or a boolean claiming protection is enabled is not sufficient. Check available infrastructure; reuse it rather than provisioning a new paid service.
- If no enforcement exists and external setup is outside authorization, implement/test the policy boundary and keep production cloud calls fail-closed with an explicit unavailable reason. Local speech remains usable. Mark production cloud activation blocked on the named operational setup, not the whole local stabilization task. Do not claim that simulated policy tests prove deployed enforcement. Root must disclose this behavior and remaining gate.

**Regressions:** null/array/number body; non-string text; empty/oversized/multibyte input; unsupported voice/locale; missing key; provider timeout/invalid response; retry budget accounting; concurrent policy requests; exhausted per-client/global budget; dev/prod validation parity. Mock upstream calls; no billable test requests. Deployment verification is separate and cannot be marked passed without actual evidence.

### P07 — Responsive shell and accessible shared controls

**Inputs:** stable runtime/settings APIs. **Output:** mobile navigation and complete shared control semantics.

- Use a mobile drawer/overlay below a documented breakpoint and persistent desktop navigation above it. Prefer one existing-layout adaptation, not a new component framework. Drawer has labelled controls, Escape/close behavior, proper focus handling and no hidden content stealing focus.
- Make navigation scrollable on short screens; do not clip its collapse control or status. Use suitable dynamic viewport sizing with fallback.
- Style links directly; remove nested button-inside-anchor controls. Name collapse/icon controls, expose aria-current and switch labels/states. Ensure Settings changes synchronize P03 immediately; stop a Settings voice preview on unmount.
- Use a native labelled select for language unless existing requirements demand a custom picker. If retaining custom, implement the complete keyboard/expanded/selection behavior.
- GestureGuide is a labelled modal with focus entry, containment, Escape and restoration; background controls are not interactive while open.
- Correct Home/About/Settings privacy copy: video/landmark processing stays local; optional online voices send speech text to the provider. Remove unnecessary prewarming only from Settings within this lease. Recognize prewarming belongs to P04; do not edit Recognize here.

**Regressions:** keyboard-only navigation and controls, meaningful accessible names, no duplicate nested focus targets, dialog focus behavior, language selection, mute while speech pending, reduced-motion preference, normal/high contrast/XL text. Check at 320/390/768/1440px and short landscape heights.

### P08 — Responsive recognition/data/training/evaluation pages

**Inputs:** stable P02/P04/P05 behavior; P07 breakpoint/spacing contract. **Output:** usable page grids and accurate state presentation.

- Replace fixed multi-column grids with one-column phone layouts and appropriate larger breakpoints. Ensure camera area retains a usable aspect ratio, controls wrap, text does not disappear, and charts/tables have intentional contained scrolling.
- Preserve runtime handlers, capture generation, sentence IDs and training ownership; this packet changes presentation and accessibility only. Request root reassignment if logic changes are needed.
- Render dataset loading/Saving/Saved/error states; train progress/cancel and per-class insufficiency; validation partition/count/limitations; actionable empty and unavailable model states.
- Source architecture text from actual dimensions: custom classifier 63; ONNX frame126/sequence30; live hook may still use an extended156 feature transport. Do not globally replace every 156 with63.
- Validate language switching and long translated labels. Check recognition controls including Stop, mode selector, Discard and speech at every target width.

**Gate:** every primary action is reachable at 320×568, 390×844, 768×1024, 1440×900 and 844×390, with normal and XL text. No horizontal page overflow that hides controls; intentionally scrollable metric tables are acceptable.

### P09 — Measure and reduce startup/render costs

**Inputs:** correctness-stable revision and P00 measurements. **Output:** measured report plus narrowly justified optimization.

- Profile the production build, not development HMR. Record initial JS transfer, module graph, ONNX/Piper requests, scripting time, long tasks and recognition UI render counts under the same synthetic feed/viewport/browser conditions.
- Lazy-load training/evaluation routes and optional custom ML dependencies. AppContext currently directly imports `ml/model.ts`, so route-level lazy imports alone are insufficient. Use a small lazy model facade or equivalent to remove eager TensorFlow edges while preserving immediate revision invalidation and global job ownership. Do not create an import cycle or allow a stale lazy-load completion to publish.
- Keep existing ONNX startup behavior unless root records a concrete reason to change it. Do not optimize by silently disabling recognition/face tracking.
- Remove unneeded fallback voice downloads with the P03/P04/P07 policy. On a browser with suitable native voices, visiting Home/Recognize without speech must not download a Piper model.
- Separate per-frame internal data from UI publication only when profiling confirms the hot path. Every frame still reaches inference; overlays remain current; critical status/emissions publish immediately. Continuous debug/FPS displays may publish at a documented capped rate, initially ≤10Hz. The cap is a chosen display policy, not a recognition sampling rate.
- Do not lower thresholds, shorten confirmation gates, rewrite model artifacts or remove accessibility to improve numbers. Compare paired before/after results; do not promise a device-independent FPS number.

**Gate:** all lifecycle/event regressions still pass; cold Home no longer eagerly loads TensorFlow/chart-only training code; Piper network gate passes; production JS/resource and render/long-task measurements are recorded. If an optimization does not improve its target metric, revert that optimization and report the result, retaining justified correctness changes.

### P10 — Durable documentation and traceability

**Inputs:** accepted packet handoffs, final behavior, measured limitations. **Output:** accurate README/CLAUDE and status ledger.

Luna updates exact commands, storage semantics, validation vs test wording, synthetic-data limitation, feature dimensions, speech privacy/fallback behavior, and cloud production activation prerequisites. Mark old expansion proposal as a proposal, not current behavior. Do not edit product TSX concurrently with P07/P08. Root provides user-facing copy requirements to those owners; Luna checks consistency afterward.

For every finding/P2 row below, record owner, changed files/commit, regression evidence, status and residual risk. Use statuses `pending`, `in progress`, `fixed and verified`, `disproved with evidence`, `externally blocked`, `measured—no change justified`. No checkmark based only on an agent saying done.

### P11 — End-to-end verification

**Inputs:** frozen implementation, isolated test fixtures. **Output:** reproducible browser tests and evidence report.

Run the flows in section6 on dev StrictMode and production preview where specified. Keep application edits outside this lease; send failures with screenshots/trace, exact trigger and expected/observed result to root. Test unmount using retained track handles, not just absence of a video element. Test output/speech with synthetic landmark/deferred model fixtures, not nondeterministic human signing. Mock cloud audio in automation; list audible real-device checks separately.

### P12 — Independent final review

**Inputs:** frozen diff, finding ledger, tests and browser evidence. **Output:** severity-ordered findings or explicit no remaining confirmed P1 in verified scope.

Sol reviewer must be independent of the relevant implementation where feasible: do not reuse the same Sol worker as the sole reviewer of its own packet. Review async ownership, memory/resource cleanup, data migration/durability, metric partition provenance, prototype keys, server limits and shared import graph. Check that tests fail on the original bug and don't merely assert implementation internals. Verify the production cloud gate is honestly reported.

Root adjudicates disagreements against code/reproductions, assigns bounded fixes, then reruns affected checks and a final integrated smoke. Do not claim full signing accuracy, Safari/iOS quality or deployed policy coverage from Chromium mocks.

## 6. Required verification matrix

| ID | Scenario | Observable pass condition |
| --- | --- | --- |
| V01 | Camera Start→Home, explicit Stop, denied/delayed startup, fatal processing error | All captured tracks ended; no owned RAF/model work publishes after teardown; retry works |
| V02 | Dataset Saved→reload; dev StrictMode and production | Samples/translations/settings preserved; initial empty render does not overwrite saved snapshot |
| V03 | Stop/change label/clear/replace during recording; delayed competing imports | No stale interval commit; replace samples+translations atomic; later operation wins |
| V04 | Imported prototype keys, null/wrong fields, invalid vectors, failed storage | Safe error or valid safe rendering; no crash; prior data preserved |
| V05 | 150 starter originals, 20% validation | 24 train+6 validation per class; 240 augmented fit rows; 30 unaugmented validation rows; no original sample and its mirror/augmentation cross partitions; no signer/session isolation is implied |
| V06 | Metrics/counts/provenance | Confusion sum equals validation originals; UI says validation holdout; no unseen-signer claim |
| V07 | Train→navigate→return; second Start/Load; mutate/cancel before fit resolves | Same active job across navigation; competing operation prevented; no invalidated result publishes |
| V08 | Failed retrain/load, repeated model replacement | Previous appropriate model retained; old/discarded tensors/models released; flags/metrics accurate |
| V09 | Default-EMA partial sign plus sustained confident blank | Active confirmation resets; valid short-noise behavior remains |
| V10 | Delayed ONNX, reset, Hybrid custom event, cached snapshot, face takeover | Latest rolling frames preserved; no stale/duplicate/lost eligible emission; ownership gates intact |
| V11 | Short held-hand dropout, custom late-commit label, sentence Discard | No held-sign duplicate; valid custom label can emit; only discarded entry removed |
| V12 | Speech A/B delays, mute, language switch, empty voices | Only currently owned utterance can play; alternatives start after bounded voice wait; no duplicate callback run |
| V13 | API malformed/oversized/upstream/rate-budget failures | Bounded status handling, no unvalidated provider request, no secret leakage; real production enforcement separately evidenced |
| V14 | All routes at target widths, XL/contrast, keyboard/modals | Visible/reachable primary controls; meaningful names; correct focus; intentional table scrolling only |
| V15 | Production cold load/recognition performance | Optional training/voice downloads deferred; measured costs improve where optimized; all correctness checks retained |
| V16 | Saved custom model→reload/load→Hybrid, language/translation change | Compatible model works; source/default gates preserved; current translation spoken/displayed |

Root runs final `npm run typecheck`, `npm run typecheck:server`, `npm test`, `npm run build`, `npm run test:e2e` after relevant scripts are introduced by P00. Stop the test servers and release test streams/browser sessions at completion. Do not rerun expensive whole suites repeatedly when only documentation changes.

Browser/device limitations are separate checklist entries: Chromium synthetic flows; real signing fixture/session if available; Safari/iOS/mobile hardware if available; audible speech per backend if available; live production API/policy if authorized and available. Report each as passed/failed/not run with reason. Never mark unavailable hardware checks passed by inference.

## 7. Finding-to-packet coverage

| Review item | Implementation | Required evidence |
| --- | --- | --- |
| R01 camera leak/startup | P01 | V01 |
| R02 class-segregated split | P05 | V05 |
| R03 training-data evaluation | P05/P08 | V06 |
| R04 lost dataset/preferences/translations | P02 | V02/V04 |
| R05 EMA blank reset | P04 | V09 |
| R06 phone layout | P07/P08 | V14 |
| R07 reset/inference race | P04 | V10 |
| R08 Hybrid lost events/custom labels | P04 | V10/V11 |
| R09 ineffective Discard | P04 | V11 |
| R10 recording mutations | P02 | V03 |
| R11 training ownership | P05 | V07/V08 |
| R12 imported label crash | P02/P05 | V04 |
| R13 speech races | P03/P04/P05/P07 | V12 |
| R14 conditional cloud abuse/validation | P06 | V13 plus operational activation evidence |
| P2 eager JS/TFJS loading | P09 | V15 |
| P2 eager Piper download | P03/P04/P07/P09 | V12/V15 |
| P2 excessive display updates | P09 | paired profiling and V10 |
| P2 transient/fatal camera errors | P01 | V01 |
| P2 held-sign rearm | P04 | V11 |
| P2 links/switches/icon accessibility | P07/P08 | V14 |
| P2 dialog/language keyboard behavior | P07 | V14 |
| P2 inaccurate privacy/architecture docs | P07/P08/P10 | source/copy comparison |
| Additional rechecked native-voice timeout issue | P03 | V12 |
| Replace-import translation residue / failed model cleanup | P02/P05 | V03/V08 |

## 8. Agent dispatch and handoff templates

Example explicit worker call (parameters shown for the available collaboration tool; this is a template, not a call already made):

```json
{
  "task_name": "p01_camera_lifecycle",
  "agent_type": "worker",
  "model": "gpt-5.6-sol",
  "reasoning_effort": "high",
  "fork_turns": "none",
  "message": "Implement P01 from research/SOL_ORCHESTRATOR_EXECUTION_PLAN.md in the current repository. Read research/CRITICAL_REVIEW_2026-09-11.md and applicable instructions. Goal: camera streams/models/RAF fully stop on Stop, unmount, stale startup and fatal errors. You own only src/hooks/useMediaPipe.ts and its dedicated tests. Use accepted P00 fixtures. You are not alone in the codebase; preserve others' edits and adjust to accepted contracts. No other file writes, dependency edits, commits, deployments or child agents. Read the implementation-discipline and relevant skills. First reproduce the failure with a deterministic regression, implement the smallest correct fix, run targeted tests and report exact evidence, changed paths, API changes and remaining risks. Request a root ownership transfer if another path is necessary."
}
```

Use the same complete contract for each packet; substitute its model, dependencies, exact allowed paths and acceptance criteria. For read-only P12 use `agent_type: "default"` with model Sol/high and forbid application edits. Do not omit context just because fork_turns is none: provide repository path, baseline/current accepted revision, plan path, packet ID and predecessor handoffs.

Worker handoff format:

```text
Packet / model / current revision:
Owned files actually changed:
Behavior fixed and original reproduction:
Public API/contract changes (or none):
Targeted tests: exact commands, pass/fail, what they prove:
Browser/measurement evidence if applicable:
Unresolved risks or prerequisites:
Paths ready for ownership release:
```

Root final report must distinguish implemented+verified, disproved, measured-without-change, and externally blocked items. Include final commands, real-device/deployment limitations, performance before/after and the prioritized remaining actions. Never mark the entire plan complete while a required local regression is failing.
