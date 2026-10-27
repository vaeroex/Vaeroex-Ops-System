# Request-bound calculation result selection

The hosted quality attempt on 2026-10-27 failed at `result_reference` after two
provider calls. No answer was saved. The discarded answer cannot be replayed.

The retained content-free metrics record `sharedRelationships` as two serialized
characters both before and after packing. This field is always an array produced
by `issueAnswerResults`, so both views contained `[]`. Packing only filters that
array, and validator selection uses the same dependency condition. The failed
answer therefore selected at least one unavailable result ID. Duplicate selected
IDs may also have existed; their exact values and the model's reasoning are unknown.
Duplicate issued IDs or a result lost only during packing do not explain this case.

## Correction

The previous provider schema allowed any 64-character hexadecimal result ID.
The request now derives its `results` schema from the exact final packed JSON:

- No issued results: `maxItems: 0` requires an empty selection.
- Issued results: the allowed string enum is exactly their IDs, with the existing
  twelve-result selection limit retained.
- Every packing measurement includes this request-specific schema, including its
  enum overhead. The final transport uses the same request builder.
- Invalid or duplicate application-issued IDs fail before provider dispatch.
- Rendering still rejects unavailable or duplicate selections, changed result
  hashes, and missing observed input dependencies. No selection is repaired,
  discarded, recalculated, or retried to produce an answer.

The producer already bounds issued relationships to twelve. `enum` and `maxItems`
are supported by the official [Structured Outputs contract](https://developers.openai.com/api/docs/guides/structured-outputs).
This local qualification does not replace a hosted provider compatibility check.

Content-free diagnostics distinguish invalid issued IDs, duplicate issued IDs,
duplicate selected IDs, and unknown selected IDs. They retain only closed reasons
and bounded counts, never IDs, source facts, model output, or credentials.

## Offline coverage and limits

The actual-engine regression admits five synthetic originals, preserves all 27
Xero-shaped records and their 135 facts, and packs four originals under an explicit
45,000-character synthetic budget. It tests the real full prompt, request schema,
serialized budget, protected admission path with mocked authority, canonical
bindings, wrong workspace, revocation, and deliberately noncompliant provider
responses. This reproduces the hosted structural boundary, not its exact payload.

Nonempty result coverage uses the actual packer, schema factory, and renderer:
one result and all its dependencies remain, another whole dependency group is
omitted, and only the retained result ID is selectable. It checks independent
runtime rejection of missing inputs and mixed environments. It is not a full
engine/provider test of the nonempty result producer.

The compatible and sparse isolated cases remain unchanged. Mocked outputs and
valid references do not prove natural-language accuracy, useful synthesis, correct
date interpretation, or semantic entailment. Manual quality review remains required.
Production switches remain off; this correction authorizes no publication, release,
model call, source mutation, or citation-opening work.
