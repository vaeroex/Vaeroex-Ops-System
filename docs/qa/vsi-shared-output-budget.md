# Shared-answer output budget

## Confirmed Evaluation 11 result

The retained request used `gpt-6-luna`, medium reasoning, strict structured
output, `store:false`, and `max_output_tokens:4000`. Its response was HTTP 200,
status `incomplete`, reason `max_output_tokens`. Safe usage metadata reported
6,506 input tokens and 4,000 output tokens, including 1,446 reasoning tokens.
The remaining 2,554 output tokens are not a measured visible-answer count:
formatting can also consume the output budget. The rejected response text was
not retained, so its exact selection and repetition cannot be reconstructed.
The run stopped after its planner and first answer request. No answer passed
quality review. The old receipt and unresolved accounting are preserved.

## Narrow correction

Shared answers now use the existing configured output ceiling, up to 6,000,
instead of inheriting the 4,000-token simple/standard free-form cap. An explicit
lower configuration still wins. Legacy free-form and public-research limits,
reasoning effort, input packing, schema and all validation checks are unchanged.

Each fact selection repeats an issued reference, 64-character binding and fact
index. Draft premises repeat these selections. The prompt therefore requests
compact JSON, relevant observations and necessary premises, without repeated
checks. It explicitly preserves needed zeros, statuses, units,
timing evidence, required source coverage and calculation dependencies. No facts
are truncated, no model answer is repaired, and no validator is relaxed.

Offline full-fact examples for the four fixed cases retain 16, 9, 18 and 8
observations. Compact answers are respectively 3,350, 2,170, 3,267 and 2,070
characters. They include a date assessment and a specific check, and exercise
the actual admission, engine, wire schema, render, save and reopen path. These
are structural mock measurements, not tokenizer estimates or model quality
evidence. Historical completed accounting answers used 2,533, 2,879 and 3,516
total output tokens. The new ceiling gives bounded headroom but cannot guarantee
completion: the schema's legal maximum is much larger than these fixtures.

## Evaluation spending and failure handling

The private evaluator retains four questions, two calls per question, eight
total calls, a 20-minute process deadline and a $2 reservation ceiling. Its
conservative existing cost envelope at the maximum request size is
`(192000 * 0.50 + 6000 * 1.00) * 1.10 / 1000000 = $0.1122` per call.
Eight such envelopes are $0.8976; the stronger $0.25 reservation per call
remains unchanged. This is local control, not an account-wide billing cap.

Incomplete content must never be delivered to the engine as a valid answer.
Accounting can nevertheless validate the returned model, tier and bounded usage
independently of answer acceptance. Validated usage should be recorded once
while the run remains stopped; missing or uncertain usage keeps its reservation.
Retained counts alone are not proof of the final provider invoice.

No key, paid call, retry, deployment, SQL change or activation is part of this
local correction. Every future paid evaluation requires separate approval and
fresh qualification of its exact combined application/transport package.

## Official references checked 2026-10-28

- [Reasoning and output limits](https://developers.openai.com/api/docs/guides/reasoning)
- [GPT-6 Luna capabilities and rates](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Recording usage while stopping incomplete responses](https://developers.openai.com/cookbook/articles/per_run_spending_controller_responses_api)

The key-entry flow is separate from this output failure. Revoked keys cannot be
reused. Reducing owner entries would require a different approved credential
lifecycle or secure persistent handoff; this change creates neither.
