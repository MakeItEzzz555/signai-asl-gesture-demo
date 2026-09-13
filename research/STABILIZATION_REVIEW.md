# Independent stabilization review

Date: 2026-09-13

Sol's read-only integrated gate found four remaining P1 issues after the first green suite. All were reproduced from source and corrected before final acceptance:

1. Non-object JSON could escape the TTS handler. The handler now returns a bounded 400 for `null`, arrays, and scalar JSON; tests also cover oversized input, quota rejection, and provider timeout.
2. A held camera tracking gap could release Hybrid source ownership and replay a queued custom emission. Recognition now uses effective tracking presence (`handPresent || isHeld`) for arbitration and invalidates pending emissions on genuine release or custom-source release.
3. A delayed file read could overwrite a newer Clear or Starter Dataset action. Dataset imports now use explicit operation generation ownership, invalidated by competing edits and unmount.
4. Dataset retained a five-column desktop grid on phones. It now stacks at small widths, wraps camera controls, exposes icon-button labels, and has browser coverage at 320×568 with X-Large text.

The conditional TTS security concern was also tightened: each paid provider attempt, including the fallback retry, consumes quota. Production remains fail-closed until both an atomic shared quota implementation and a trusted platform-derived client identity function are supplied; unverified forwarding headers are not used by the production entrypoint.

No further correctness defect was found in the affected code during root review.
Remaining limitations are environmental rather than silently accepted behavior:
real camera/MediaPipe execution, accuracy with real signers, a saved-model reload
cycle on physical devices, audible backends, Safari/iOS, live Google TTS, and
deployed quota infrastructure require their respective devices, credentials, or
production environment. A browser training-completion check was performed later
and is recorded below.

## Follow-up after the independent gate

Two focused refinement commits followed the gate without changing its recognition,
data-integrity, speech, or security conclusions:

- `2a79138` moved ONNX WASM work to its worker proxy, made concurrent model-load
  callers await one shared operation, corrected Training Complete number formatting,
  widened the desktop Recognize camera area to 70%, and moved Sentence Output below it.
- `8823428` restored Dataset's natural camera aspect ratio, kept Recording Target
  directly below it, aligned the total left and right card-column heights, and retained
  full-width Recording Tips.

Root re-ran TypeScript, the complete 73-test Vitest suite, the production build,
and all four Playwright tests after the first refinement. After the final Dataset
adjustment, TypeScript and all four Playwright tests passed again, and the desktop
layout was visually checked at 1440×1200. A separate five-epoch Chromium training
run completed and confirmed that the final metrics no longer overlap.
