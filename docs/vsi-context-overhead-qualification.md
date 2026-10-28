# VSI request overhead qualification

This local correction follows a hosted preflight rejection: the complete request
measured 48,966 JavaScript UTF-16 characters against the unchanged 48,000 limit.
That request stopped before model dispatch. Its canonical packet was not retained;
the content-free size receipt cannot establish an exact replay.

## Change

The shared-answer path now uses a dedicated 9,769-character instruction string
instead of composing 12,987 characters of general-answer and shared-answer rules.
The legacy prompt and the entire 2,082-character shared contract remain unchanged.
The rewrite retains identity/disclosure, evidence authority, financial boundaries,
date/provenance/weather rules, source comparisons, current permissions, untrusted
input handling, saving/confirmation, product authority and research limitations.
Examples and repeated rendering instructions are reduced. Independent review found
no material instruction omission; this is not proof of equivalent model behavior.

The schema shares the supporting-source union across limitation alternatives when
doing so reduces serialized size. Exact source/hash definitions and the `anyOf`
around complete premise arrays remain. One original plus supporting context is
allowed; mixing independent originals in limitation prose is still rejected.
Source selection, canonical evidence, dates, coverage metadata, independent runtime
validation, limits, source mappings and all three OFF gates are unchanged.

## Complete serialized request measurements

`scripts/vsi-context-overhead-tests.cjs` constructs new synthetic Xero-shaped
invoice/bill observations and Sheets-shaped rows through `sharedRow`, plus the real
product-context producer. It uses 11,784 serialized fact characters within the
existing 12,000-character preparation bound. Three required originals out of five
are retained whole; every fact, date, binding, scope and coverage limitation is
checked unchanged. It is an approximation of the hosted shape, not private records.

Both columns below use the candidate exact-binding schema to isolate instruction
savings. The schema reduction is measured separately.

| Full-wire component | Previous prompt | Candidate prompt |
| --- | ---: | ---: |
| Protected context | 28,778 | 28,778 |
| System instructions | 12,987 | 9,769 |
| Input framing and JSON escaping | 2,034 | 2,033 |
| Schema and output format | 4,783 | 4,783 |
| Other envelope | 125 | 125 |
| Total characters | 48,707 | 45,488 |
| UTF-8 bytes | 48,718 | 45,513 |
| Headroom under 48,000 | rejected | 2,512 |

Instruction savings are 3,218 raw characters and 3,219 in this complete wire body.
Schema-only factoring saves 308 characters at three originals/six supports and
16,031 at 24 originals/30 supports. Those savings are not an exact hosted prediction.

## Qualification and remaining bounds

- Exact 48,000-character requests pass; 48,001 and insufficient byte budgets fail.
  The limits remain 48,000 characters and 192,000 UTF-8 bytes.
- Full-engine tests retain zero-dispatch rejection for excess required context,
  including 8,000-character questions, and preserve permission/revocation checks.
- Existing source fixtures were not shrunk. The large-workspace success cap was
  tightened from 36,000 to 32,000. Previously oversized fixtures that now fit are
  checked for full fact preservation; separate oversized cases still reject.
- Contract-boundary stress uses 24 business sources, 80-character refs, long
  questions, quotes, backslashes and Unicode. With six supports it measures 90,822
  characters; with 30 supports, 106,208. Both reject. Bounded individual fields do
  not guarantee that their simultaneous maxima fit; no evidence is truncated.
- The limitation suite checks 6,060 source combinations/binding mutations. Exact
  bindings, invoice eligibility, unknown refs, source-local indexes, omitted-source
  refs, cross-original prose and invented results remain independently checked.
- Four retained synthetic Eval12 outputs pass the candidate schema and strict
  renderer unchanged, including final answer text and citation objects. Full wire
  sizes are 25,208 / 24,466 / 21,883 / 22,640 characters. Twelve wrong-binding
  mutations and four invalid indexes fail. Retained artifacts remain outside the
  repository and unchanged. These cases have no product sources and do not prove
  maximum-shape admission or new model behavior.

All qualification here is offline with mocked responses or pure retained-output
replay, no SQL or model calls. Historical evaluation artifacts do not qualify this
new runtime. The isolated evaluator is pinned to local runtime commit `53effaec9a76b608338a5c9fc5c09cec7331e0cd`
and its exact app/lib trees. Its clean-runtime guard remains unchanged; mock-only
qualification uses this new candidate without inheriting prior model qualification. No activation or deployment is authorized by these tests.

Remaining evidence needs: provider acceptance of the schema, generated-answer
quality, actual hosted fit, and saved/reopened hosted output require a new, explicit
bounded live-test approval after the release workflow. The previous single hosted
test approval is consumed. Publication, merge, deployment and activation have not
been performed for this correction.
