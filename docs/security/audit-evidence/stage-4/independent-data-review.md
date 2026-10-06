# Stage 4 source-parent and usage final cross-review

Read-only independent review covered `lib/intelligence/source-parent-eligibility.ts`, layer/coverage/operational-evidence consumers, Overview/Intelligence/briefing caller wiring, `lib/ai/usage.ts`, the admin usage page, and focused regression harnesses. Root then explicitly assigned the narrow coverage-memory correction below; no other edits made by this review.

## Findings and disposition

- No new tenant or subscription bypass found in reviewed wiring. Referenced-parent queries retain `workspace_id` constraints and 200-ID batches. Intelligence builders retain original-evidence and lifecycle gates. Briefing throws on parent-load errors. Overview records source errors and avoids daily snapshot persistence when its source error list is nonempty.
- Existing coverage-memory undercount remained after KPI parent correction: `memoryItemCount` still used the capped display file list. Corrected `lib/intelligence/coverage.ts:531` to use the already filtered `parentEligibility.activeFileIds`. Existing fallback when no authoritative records are provided remains intact. This is the narrow VXA-014 extension requested by root, not a claim that all capped datasets are complete.
- Cost review found mixed environment override issue: either override originally disabled long-context uplift for both input and output, including the untouched catalog leg. Root corrected this to per-leg override flags and per-leg basis stamps. Independently reread final fix and input-only/output-only tests: untouched output retains 1.5x and untouched input retains 2x for >272k input. No further blocker found.
- New cost metadata preserves microcent precision; legacy rows keep their historical integer estimate. Producer metadata overwrites supplied `cost_estimate`; admin page aggregates through the shared reader and labels the latest 200 entries as estimates. Existing provider-reporting gaps and client-writable non-trust usage rows mean this remains recorded estimated usage, not authoritative invoice accounting.

## Test performed after authorized memory-count fix

Command: `/Users/isaacvizcarra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --max-old-space-size=256 scripts/audit-principal-parent-regression.cjs` from shared implementation worktree.

PASS, exit 0, shell wall 0.25s. Added actual pure-function assertions for an eligible memory source beyond the 200-file display list, archived/deleted/ineligible parent and chunk exclusion, missing authoritative parent, and preservation of unlinked signal/task/run exclusions. Existing authenticated-principal rate and KPI parent assertions also passed. No network, hosted Auth, Supabase mutations, model calls, or load test. Scoped `git diff --check` passed.

Qualified approval of reviewed changes after both corrections. Deployment qualification and existing audit residuals remain separate.
