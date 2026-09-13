# Copy-paste execution prompt for Sol

Start the execution session with **gpt-5.6-sol** selected as the main model. Paste:

```text
Execute research/SOL_ORCHESTRATOR_EXECUTION_PLAN.md end to end in orchestrator mode.
Read research/CRITICAL_REVIEW_2026-09-11.md as the evidence baseline, then verify
the current checkout and applicable repository instructions before modifying it.

You are the Sol root coordinator. Use the plan's explicit model assignments:
gpt-5.6-sol for concurrency, ML correctness, speech, API and independent review;
gpt-5.6-terra for the harness, data persistence/recording, UI and browser checks;
gpt-5.6-luna for documentation and coverage bookkeeping.
Use at most three workers alongside yourself, no nested delegation, and generic
worker/default roles with explicit model IDs and self-contained fork_turns:none
prompts. Execute P00, then the dependency waves and exclusive file leases.

This authorizes the local implementation, focused regression tests, required
test-only tooling, integration fixes and local commits described by the plan.
Preserve unrelated work. Proceed without repeatedly asking approval for routine
in-scope choices. Do not deploy, provision paid infrastructure, alter credentials,
or delete real user data. Use isolated fixtures for those test scenarios.

Treat the plan's contracts as proposed APIs to settle in P00, not existing APIs.
Keep two-way sample-level validation labelled honestly; preserve ONNX-first and
face-touch gates, auto-add/Discard behavior, and compatible saved custom models.
Do not claim serverless protection from an in-memory limiter. If production
cloud enforcement is unavailable, complete local work and report the precise
activation gate and intentional fallback behavior.

Require before/after evidence for each finding. Integrate accepted packets,
resolve cross-packet failures, complete P11 browser verification and P12 independent
review, and fix any remaining local P1 before finalizing. Report exact checks,
coverage status, measured performance changes and unverified device/deployment
limitations. Do not stop after only planning or the first successful wave.
```

Selecting Sol as the root model happens in the execution session configuration;
the worker model parameters do not change the current root model.
