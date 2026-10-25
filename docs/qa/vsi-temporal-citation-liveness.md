# Source-date semantics and protected citation liveness

Local runtime candidate: `95f7f3467e4b84a804bd11d45c0037daef4b7dba`.
Base: `6caa9a1c4a460b4c798e8c196e32c2af0e35a9f0`, tree
`c3b3b907ff1df39bf493778f5d38b8c741c9bb81`, identical to the gates-off production merge `9148d574420d25787255b5ef3813a20af6061fe1`.
This package is local only. It includes no activation, provider calls, SQL, ingestion, credentials or saved-record edits.

## Supported diagnosis

The retained hosted answer aligned Xero observations dated October 13 with Sheets rows dated October 14–15. The source dates were not shifted by extraction. The shared projection used generic “recorded” language for Xero document dates and omitted the distinction between document date and an outstanding balance observed at import. The enclosing retrieval selection window was also presented as a reporting window. These were confirmed representation defects; they do not establish why the model chose its particular unsupported sentence.

The correction issues index-bound temporal metadata with each applicable stored fact. Xero invoice/bill dates, balances at import, Sheets supplied row dates, Harvest spent dates and Clockify entry-start UTC dates remain distinct. Running and completed time entries both retain neutral entry-contribution semantics. Exact import observation times are not invented from retrieval timestamps or coverage records. Sources without typed fact timing remain explicitly unknown.

The application renders selected-date limitations from selected issued facts, not model prose or every available record. Different dates cannot establish aligned periods; matching labels alone cannot establish comparable measurement times; incomplete dates cannot establish either comparison. Xero record contributions, including zeros, are not account/day totals. Prompt guidance carries these distinctions to the model, but it is not a semantic validator.

The hosted protected pages remained in a loading state while activation was on. Retained evidence does not identify the stalled request or authorization stage. The local harness reproduces one concrete liveness defect: an unresolved citation-reopen RPC left the page promise unresolved indefinitely. The corrected read forwards an abort signal and settles after ten seconds even if transport ignores abort. It performs no retry or substitution and reveals no source details on failure. The unavailable message now acknowledges an unsuccessful check rather than asserting that a timeout proves a changed source.

## Preserved boundaries

Source identity/hash, original data, fact order, workspace/actor/session checks, current eligibility, revocation, required source scopes, calculation dependencies, citation authorization and gate defaults remain intact. Temporal metadata participates in preparation integrity and canonical citation snapshots. The request serializer removes only an identical duplicate of that metadata and retains the issued copy; complete request character/byte limits are unchanged.

Corrected text and metadata produce new preparation/snapshot hashes and may change derived citation IDs for future answers. Original bindings and source-link anchors are retained. Existing saved answers are not rewritten.

## Local qualification

All twenty `test:vsi` scripts plus the shared-consumer and protected-reopen suites pass offline. Focused coverage includes:

- Date mismatch, equal-date non-comparability, incomplete dates, running entries, selected-only summaries, tampered/malformed index groups and immutable source data: thirteen negative cases.
- Actual engine input, packing and renderer metadata correspondence across fifteen canonical originals, including forty-seven invalid reference selections, missing-provider/wrong-scope denials and revocation before and after planning.
- Counts versus amounts across forty-two observations/six providers and 201 rejected combinations.
- Actual protected page invocation, server rendering and real application auth/workspace/subscription guards over mocked sessions and database responses; a real PostgREST builder uses only synthetic transport. Two successful revision modes, eight pre-read denials, seven revoked/malformed cases and two stalled transports pass with no retries.
- Both existing synthetic evaluator cases, source separation, request bounds, accounting and save/reopen composition remain covered by their existing mocked suites.

The positive 32,000-character stress fixture uses less optional synthetic volume to accommodate the new prompt/metadata; the former positive volume is now an explicit complete-request rejection. The fifteen-source all-fit fixture uses compact optional labels. Source-count, citation, authorization, failure and unchanged-size-limit assertions remain in place. No canonical evidence is truncated to make tests pass.

TypeScript and focused ESLint pass; two existing unused-variable warnings in protected projection redaction remain. The isolated credential-free evaluator is repinned to the exact app/lib trees; no live adapter or budget change is included. Full Linux CI/build has not been run for this unpublished candidate.

## What remains unproved

The retained unsupported “for those dates” sentence still passes structural validation and remains a manual quality failure even alongside the new application date warning. This change does not prove model reasoning correct or prevent all misleading prose.

Citation tests prove page invocation and server rendering, not a Next browser navigation/loading boundary or live database authorization. Auth/workspace/layout waits are outside the citation RPC deadline. The original hosted spinner cause is still unknown, and successful hosted opening of both source links remains unverified.

A future approved validation should check the saved citation navigation first, with request/stage timing while active and a restoration deadline, before spending another generation attempt. Publication, deployment/activation and any new paid question require separate approval. Production remains gates off; the prior single-question approval is consumed.
