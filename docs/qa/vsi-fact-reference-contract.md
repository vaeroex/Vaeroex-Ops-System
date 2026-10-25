# VSI issued fact selection alignment

Local runtime candidate: `5e34cc75e69e79292bbf7f4e2348c9fefecd2e9f`, based on production commit `1105339847f79a65e582bae4f7087f72f783b28f`. The application gates remain false. No database, ingestion, credential, provider-route or model changes are included.

## Supported diagnosis

The hosted attempt reached shared-answer validation and failed `fact_reference`. Its rejected output was not retained. That category formerly combined an unknown reference, mismatched binding, invalid source-local fact index and missing dependency. The exact rejected tuple and cause cannot be reconstructed from the retained category.

An offline reproduction establishes one concrete contract mismatch: the provider JSON schema and local Zod parser accepted `sha256:`-prefixed hashes, but the renderer compared the value with an application-issued bare hash and rejected it. Both schemas now require exactly 64 lowercase hexadecimal characters. Input is never normalized, repaired or silently rebound. Exact length also excludes a trailing newline accepted by a regular-expression end anchor alone.

The shared prompt also inherited permission to reuse historical web snapshots even though historical-only references receive no selectable shared fact binding. Shared-mode instructions now permit selection only from currently issued `qualitative_sources` or `contextFactSources`. Historical dialogue remains context; no history is newly admitted and ordinary non-shared answers retain their existing behavior.

Neither finding establishes the discarded response's cause.

## Reference invariants and diagnostics

Whole-source packing preserves each issued reference, binding, dependency and fact order. Product context uses index zero. Public lookup facts use zero-based indices within each source's matching claims after final lookup bounding, not indices in the global claims array. No source-position fallback or fuzzy reference matching is allowed.

The resolver still rejects the same invalid selections. It now emits one of four closed reasons: `unknown_ref`, `binding_mismatch`, `fact_index_out_of_bounds`, or `source_dependencies_missing`. A binding mismatch may also report the boolean `bindingMatchesOtherSource`. Diagnostics contain no reference values, hashes, source content, rejected answer, URL or credentials. Schema failures continue to expose only allowlisted fields/codes and bounded counts.

Coverage, calculation dependencies, independent-original requirements, canonical citations, actor/session/workspace checks, revocation, accounting and unverified-draft labels are preserved. A correctly bound fact may still be irrelevant to the question. An in-range but unintended index selects another actual issued fact; deterministic validation cannot recover the model's intended selection or prove narrative entailment. Draft quality still requires an honest usefulness review.

## Local verification

- Prefix/uppercase/whitespace/newline selections fail at schema validation, including draft premises; exact bare selections pass without mutation.
- The existing hosted-shaped engine fixture exercises 15 admitted originals, seven packed originals, two requested provider scopes and six product contexts. Every visible fact is probed against the actual renderer context; omitted originals and substituted snapshot/source bindings remain rejected.
- Overlapping public claims test source-local indexing across multiple source references and multiple facts, including rejection of an invalid global index.
- Content-free diagnostics reject unrecognized reasons, unrelated fields, injected secret-shaped markers and wrong-stage metadata.
- Existing compatible/sparse mocked engine cases, source coverage, isolation/revocation, context limits and failed-answer accounting remain relevant qualification checks. The credential-free evaluator is pinned to the exact runtime above; its fixture, budgets and manual review criteria are unchanged.

This is a reconstructed offline regression, not an exact captured hosted payload or successful real-model acceptance. A local pass does not prove hosted answer usefulness, saving/reopening, or citation-link access. External publication, CI and any further bounded model test require their own approval.
