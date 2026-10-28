# All twelve integrations: isolated synthetic qualification

This is a local, credential-free preparation artifact. Production stays on
`5ca06d3a7417c30e5bdbff9e731fb724b601e8cb` with all three VSI switches off.
No provider accounts, OAuth grants, tokens or production source records are
created. No real model transport is included in this candidate.

## Four fixed cases

The invented **Cedar Workshop** entity is explicitly synthetic. Its records are
intentionally from one fictional business, but no invoice/order/payment, SKU,
employee or project correspondence is supplied. Partial coverage is not a ledger.
Source-shaped observations are October 1–2, 2026, with a deliberately backdated
September 30 Loyverse receipt. The actual engine's supported default discovery
window at the fixture calendar date is September 28–October 27. Question wording
does not implement arbitrary date-range retrieval. `Date.now()` remains real so
elapsed-time guards are not frozen; only the fixture calendar is fixed.

| Case | Providers | Facts and useful conclusion to evaluate |
| --- | --- | --- |
| Accounting and orders | QBO, Xero, Zoho Books, Wix | Distinct invoice amounts/balances, valid zero balance and purchase bill, paid/unpaid order statuses. Check order-to-invoice and payment/settlement references before interpreting them together; do not sum across potentially overlapping systems. |
| Payments and operations | Square, Loyverse, Sheets | Completed payment in minor units, pending payment exclusion, SALE/REFUND/cancelled/zero receipts, separate tax/discount, backdated event, operational counts. Check tender/receipt references for payment-confirmation work; do not declare those orders paid or net unlinked records. |
| Time coverage | Harvest, Clockify, Toggl 2.0 | Completed/running entries, valid zero duration, account-visible versus connected-user scope, lifetime project hours. Establish common people/project/period and duplicate-entry boundaries before combining hours. |
| Inventory context | Zoho Inventory, Katana, Sheets | Low-stock items, unavailable variant/location rows including zero, operational review counts and differing dates. Check item/location/quantity correspondence; equal counts do not identify the same records. |

Exact questions, importer-shaped records, expected facts, field patterns,
prohibited inferences and manual usefulness criteria live in
`scripts/vsi-all12-synthetic-cases.cjs`. Negative-case names there are requirements,
not claims that every semantic failure is mechanically detected.

### Question and review alignment after Evaluation 10

Evaluation 10's payments answer was mechanically valid and supplied useful
cross-source checks: record identifiers, event dates, coverage/status, compatible
units/periods and non-overlap. It did not assert that any waiting order was paid.
The predeclared rubric additionally required a settlement-confirmation follow-up,
but the old question asked only about matching records and combining amounts.
That narrow subgoal was unmet; this is not evidence of fabricated facts or a
general inability to reason across sources. The stopped receipt stays unchanged.

The revised questions state the operational decision being evaluated without
supplying the answer: payment confirmation/settlement of waiting orders, a
combined completed-hours comparison, and stock availability for waiting orders.
The accounting question already names the financial-stage decision. Facts,
criteria, expected checks, guards, schema, system prompt and application code are
unchanged. The runner verifies that the exact reviewed question reaches both
the planner and answer request. No extra reviewer instructions are sent secretly.

Manual reviewers must assess meaning, not a required word or canned phrase.
For example, matching waiting orders to tender records and verifying that funds
were received/cleared can satisfy the payment-confirmation criterion without
the word "settlement". Generic source-status checking is useful for the old
matching question but does not by itself answer the newly explicit confirmation
decision. Do not require a recommended check already established by supplied
evidence, or invent unknown settlement status as a fact.
Payment confirmation and bank settlement are distinct outcomes: the answer
must establish the relevant workflow rule instead of assuming every business
requires bank settlement before marking an order paid. The fixture supplies no
such rule and no order-linked settlement evidence.

For time, inspect whether the answer addresses people/project/period coverage,
running versus completed entries, and overlap before a combined comparison;
the empty-history requirement applies only to that variant. For inventory,
inspect order-demand quantities and item/variant/location correspondence before
availability, preserving the different counting units and observation dates.
Recommendations may use equivalent wording and may explain why the requested
decision remains unavailable. None of these cases requires inventing a positive
relationship or adding a rote warning to every answer.

`scripts/vsi-all12-review-alignment-tests.cjs` replays the retained synthetic
recommendation and supports an optional hash-pinned private replay using
`--retained-dir`. Its human-reviewed paraphrases and adversarial assertions
demonstrate the limit of the unchanged syntax contract: unsupported causal or
settlement prose can still render as unverified drafts and must fail manual
review. The script is not a lexical classifier or a semantic judge, and a pass
does not retroactively qualify Evaluation 10 or prove new model behavior.

## What runs unchanged, and what is modeled

Each case gets a new in-memory PGlite database. It executes actual source
projection, owner-reviewed legacy mapping, discovery, manifest admission, engine
planning/answer assembly, full request packing, structured validation, factual
rendering, atomic settlement, internal provenance reopening and cost-event SQL.
The current draft10 memory wrapper and exact applied PT409 upgrade are included;
the patched function body SHA256 is
`460322cb8730ac1ff72438027771b14b42a8533b0a152836f5ba0443205e82a3`.

The exact Sheets readability and ticket-binding migration functions and draft12
typed resolver are installed against minimal synthetic retention tables. This
replaces the old test's always-true readability and direct admin ticket update.
Local synthetic owner/session/mapping state is fixture setup, not fabricated
OAuth consent. Historical baseline references remain immutable and revoked;
they are not deleted or admitted into the new cases.

This is **not** a complete Supabase installation. Supabase Auth/JWT verification,
PostgREST, billing entitlement, full schema/RLS and writer-fence trigger graph,
concurrent writers, provider policy configuration, actual import transports,
browser sessions and protected citation-page navigation are not proved. Product
context is a bounded synthetic slot. These limitations are emitted in every
successful case receipt. Real permissions cannot be inferred from simulated auth.

Network sockets are denied; the only fetch implementation is the fixed mocked
Responses exchange. Workers reject real credential environment variables and the
test driver supplies only the screened local SQL-fixture directory and timezone.
There is no live CLI mode, credential reader, database URL or network fallback.
No dependency installation is required. The existing screened SQL definitions
remain outside Git and must not be uploaded as test output.

## Offline checks

Run with the existing Node runtime and screened fixture directory:

```sh
SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR=/absolute/path/to/screened-private-fixtures node --test scripts/vsi-all12-synthetic-db-tests.mjs
SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR=/absolute/path/to/screened-private-fixtures node scripts/vsi-all12-synthetic-tests.cjs
```

The four positive cases each use two deterministic mock responses. Every final
serialized request includes the actual full prompt/schema/escaping and remains
within the unchanged 48,000-character / 192,000-byte guards. Issued bindings and
whole fact groups are compared against preparation for the same discovery window.
Each case checks its exact provider set, stored factual patterns, matching saved
answer/citations, reopened hashes and one cost event. Wrong actor/workspace and
revocation of every selected provider must deny reopening.

The isolated evaluator deterministically includes the fixture's `syntheticLabel`
in the presented answer before settlement. Its result retains the original
`engineAnswer` separately; `answer` is the evaluator presentation that is saved
and read back after protected provenance reopening. All four cases assert the
label occurs exactly once as a standalone leading heading in that presented/persisted
text (an embedded or negated occurrence cannot suppress it) and that the engine
answer, citations and usage are unchanged. This is an evaluator-owned disclosure,
not proof that the model supplied it, and it does not label production/customer
answers. Existing saved evaluation outputs are not rewritten. Manual usefulness
criteria remain unchanged and still assess the model's factual reasoning.

Additional cases verify immutable-binding mutation rejection, wrong-workspace
discovery rejection, explicit empty Harvest/Clockify coverage and suppression of
Loyverse money when merchant currency is absent. Categorical receipt status/date
facts remain valid in that last case; missing currency does not imply no receipt.
The SQL guard suite covers session expiry, owner deletion/ban, privacy block,
retention expiry/erasure, mapping/value mismatch, disconnection, wrong actor,
missing roots and PT409 one-attempt rejection without source/artifact/accounting
writes. Existing all12 projection/selection/preparation tests supply additional
typed-field, status, time and budget-boundary coverage.

Mock answers deliberately include specific, supported follow-up text, proving
that the contract can express it. They do not prove a real model will choose it.
The current contract can still accept misleading causal or attribution prose in
an explicitly unverified draft. Manual review must reject that, generic parallel
summaries, invented correspondence, totals/ratios and false temporal alignment.

## Smallest subsequent real-model step (not executed or authorized here)

Use this same disposable SQL worker; do not enable production. The worker now
provides an IPC-only `--ipc-case` seam for the four fixed cases. It accepts no key,
blocks network sockets, and receives only synthetic Responses payloads from its
parent. Eleven mocked IPC scenarios cover all cases, invalid output/reference,
protocol errors, credential-environment denial, clarification and disconnect.
Default offline behavior remains unchanged. The separately reviewed private
hidden-input/anonymous-pipe adapter pins this runtime and these fixtures, bounds
requests and elapsed time, retains synthetic output before validation and requires
case/nonce/answer-hash-bound manual review. It is not part of this public test
candidate. The obsolete two-case launcher must not be reused unchanged. No real
key or paid execution is authorized by adapter preparation.

Proposed combined approval after that qualification:

- Four fixed questions, at most two calls per case / eight calls total, maximum
  **$2 incremental usage**, and a **20-minute local process limit**. This is a
  request budget, not an account-wide billing limit. Verify current official
  pricing and reserve the conservative whole-call maximum before dispatch; stop
  before any call whose cost cannot be bounded. No automatic retries.
- Fixed `https://api.openai.com/v1/responses`, `gpt-6-luna`, `store:false`, default
  service tier; no web tools, redirects, fallback model/provider or paid judge.
- A fresh temporary **Vaeroex Synthetic Evaluation 06** key in the previously
  verified Personal / Default project, Responses Write only, all other permissions
  None, one-day expiry. Creation/use needs explicit approval. Owner enters it only
  at the hidden prompt; no production key extraction or persistent secret config.
- Review each retained answer honestly against that case's facts, dates, units,
  coverage and usefulness criteria before proceeding. Stop the remaining cases on
  failure, unexpected call, authorization error, accounting uncertainty, save
  mismatch or timeout. No replacement question or automatic rerun.
- Retain only private synthetic requests, outputs, safe diagnostics and usage;
  revoke only the newly identified evaluation key immediately after completion or
  failure. Verify process/key cleanup. Production activation time is **zero**.

No cloud database provisioning, hosted migrations, provider accounts/imports,
production deployment or new source bindings are needed for this isolated test.
An eventual successful run would qualify reasoning on these twelve synthetic
stored formats, not real connector login/import behavior or general accuracy.

## Historical CPU question

The retained retry-session start times are close to earlier citation requests,
making a common retry defect plausible. They are connection-start metadata, not
unique request matches, and direct CPU measurements were not retained for the
earlier Oct26 window. The Oct27 correction is stronger evidence: after the exact
40001-to-PT409 change, target errors stopped and the reported five-minute CPU
reading fell from 98.6% to 6.34%. That supports the retry bug as the cause of the
measured load. It does not establish that citation retrieval now works or explain
the separately reproduced date, unit, reference and mapping defects.
