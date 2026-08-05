# Google Document AI Enterprise OCR v1

## Status

This document describes the reviewed, inert Google Document AI extraction
contract in Draft PR #265. The adapter, deterministic routing policy,
provider-neutral artifact normalization, cache identity, encryption boundary,
review provenance, static migration, and regression harness are implemented.

Google execution is not active. The migration is committed but unapplied, the
checked-in deployment templates remain bound to NVIDIA, no Google processor or
IAM grant is provisioned, and no Preview or Production gate is enabled. The
compiled broker and worker can recognize only the exact, explicitly selected
Google profile described below; they cannot auto-select it. Printed-document
ingestion through Google remains blocked until the activation prerequisites and
the separately approved one-page qualification are complete.

Hosted Nemotron Parse remains blocked. Its strict historical validators and
profiles are unchanged: the final hosted response passed the content-free
structural observer but failed the approved response-envelope validator against
an undocumented hosted contract. Vaeroex does not broaden that parser or infer
another compatibility exception.

## Authority boundary

Google Document AI is an extraction provider only. Accepted provider output is
normalized into a draft, encrypted with AES-256-GCM, bound to a versioned review
identity, and stopped at mandatory human review. It cannot directly create or
change Evidence, Business Memory, embeddings, KPIs, Business Health, findings,
priorities, IntelligenceSnapshotV1, Trust evaluations, or Saved Analyses.

The adapter does not classify business meaning. Luna and deterministic
validation remain downstream of extraction, and no critical value can become
authoritative without the existing authorized review path.

## Exact provider contract

| Contract field | Required value |
| --- | --- |
| Provider | `google_document_ai` |
| Processor type | `OCR_PROCESSOR` |
| Processor version/model | `pretrained-ocr-v2.1-2024-08-07` |
| Location | `us` |
| Endpoint | `https://us-documentai.googleapis.com/v1/{processorVersion}:process` |
| Client | `vaeroex_google_document_ai_rest_v1` |
| Provider profile | `google_document_ai_enterprise_ocr_v1` |
| Endpoint contract | `google_document_ai_processor_version_process_v1` |
| Request serializer | `google_document_ai_process_request_v1` |
| Response validator | `google_document_ai_process_response_v2` |
| Provider normalization | `google_document_ai_layout_normalization_v2` |
| Compatibility policy | `google_document_ai_enterprise_ocr_strict_v1` |
| Artifact contract | `document_extraction_artifact_v2` |
| Artifact normalization | `document_extraction_normalization_v2` |
| Tables | `tables_if_present_strict_v1` |
| Confidence | `preserve_for_review_never_authority_v1` |
| Selection marks | `disabled_v1` |
| Worker input MIME | `image/png` |
| Source limit | 25,000,000 bytes and 15 pages |
| Rendered-page limit | 12,000,000 bytes, 1664 by 2048 pixels |
| Initial qualification retries | zero |

The processor resource must contain an exact numeric Google Cloud project,
exact `us` location, exact processor ID, and the pinned processor version.
Moving aliases such as `latest`, response auto-detection, and malformed-output
fallback are forbidden.

Google documents the pinned Enterprise OCR version as stable. Version lifecycle
must still be monitored before activation; Vaeroex must deliberately qualify a
new version rather than allowing an alias to move underneath the contract.

## Request contract

The private worker sends one already rendered PNG page per synchronous
`processorVersions.process` request. The request contains:

- `rawDocument.content` with the one rendered page;
- `rawDocument.mimeType` equal to `image/png`;
- no provider-side human-review field, because Vaeroex owns the mandatory
  review boundary;
- `imagelessMode: true`;
- OCR options with image-quality scores enabled; and
- a bounded field mask for MIME type, document text, page number and layout,
  detected languages, blocks, paragraphs, lines, tokens, tables, and image
  quality.

Checkbox, style, math, and symbol add-ons are not requested. The adapter sends
no workspace label, customer identifier, file name, or business metadata.
Request identity binds the provider profile, exact processor resource and
version, serializer, validator, normalization, compatibility policies, source
and rendered-page hashes, dimensions, MIME type, field mask, payload mode, and
timeout policy. OAuth tokens and request IDs are excluded.

## Response validation and normalization

The adapter accepts only the documented JSON `ProcessResponse.document`
contract and the exact processor selected for the job. It enforces response
size, exact top-level shapes, one provider page for the requested rendered
page, valid text anchors, ordered bounded segments, valid confidence values,
and normalized four-point polygons. Unknown keys, missing required page
structures, pixel-only geometry, duplicate identities, invalid page references,
overlapping non-table annotations, malformed tables, partial documents, and
ambiguous transport failures fail closed.

The provider-neutral draft preserves, when present:

- page identity and page layout;
- blocks, paragraphs, lines, and tokens;
- bounded text segments and reading order;
- detected languages and provider confidence;
- normalized bounding polygons and derived bounding rectangles;
- table, row, and cell structure;
- token break information;
- rotation/orientation; and
- image-quality score and documented defect types.

Empty table cells remain empty and unknown. Table cells, text, coordinates,
confidence, relationships, and semantic classes are never invented. Provider
confidence is review context only and never becomes Vaeroex confidence.

Enterprise OCR may return table structures, but it is not a Form Parser
contract. Customer-facing table quality is therefore a qualification metric,
not an assumed guarantee. Handwriting support is likewise not treated as the
primary contract for this route.

## Deterministic routing

Routing depends only on trusted source assessment and the explicit Google
qualification scope. No model chooses the provider.

| Source | Assessment | Route |
| --- | --- | --- |
| CSV/XLSX | Valid spreadsheet | Existing deterministic parser |
| PDF | Reliable native text | Existing native extraction |
| DOCX | Reliable native text | Existing native extraction |
| Digital PDF | Missing or low-quality native text | `google_fallback` after qualification |
| Scanned/image-only PDF | Printed content | `google_primary` after qualification |
| PNG/JPEG | Printed document, form, invoice, receipt, or table | `google_primary` after qualification |
| DOCX | Missing or low-quality native text | Fail closed until a renderer is qualified |
| Screenshot, whiteboard, highly handwritten note, mixed scene | Any | Future visual provider required |

Images must contain exactly one page. Over-limit, mismatched, unqualified, or
unsupported sources fail closed. A native extraction failure does not silently
change providers within the same job.

## Privacy and security

Authentication is limited to a dedicated Cloud Run service identity obtaining
short-lived OAuth tokens from the metadata server. Static service-account key
files, Application Default Credentials from local files, SDK fallback chains,
and credentials exposed to Vercel are forbidden. Tokens remain memory-only.

Future Preview activation must use a dedicated Preview processor and grant only
the online processing permission on that exact processor resource. The existing
private broker, Google IAM/OIDC caller authentication, Ed25519 request signing,
lease ownership, single-use dispatch, quotas, and provider gates remain
mandatory. Request and response payload logging must be disabled or excluded;
telemetry may contain only bounded operational metadata.

Google states that Document AI customer data is not used to train its models.
For synchronous processing, Google documents that request document data is
processed in memory, encrypted in flight, and not persisted to disk; limited
request metadata such as receipt time and request size may be logged
temporarily. The applicable DPA, regional configuration, and account terms must
still be approved before customer activation. Cloud Audit Logs classify online
processing as Data Access activity; the rollout must explicitly decide whether
to enable those logs and ensure no payload capture is introduced.

Official references:

- [Enterprise Document OCR](https://docs.cloud.google.com/document-ai/docs/enterprise-document-ocr)
- [Process a processor version](https://docs.cloud.google.com/document-ai/docs/reference/rest/v1/projects.locations.processors/process)
- [Process response](https://docs.cloud.google.com/document-ai/docs/reference/rest/v1/ProcessResponse)
- [Document response model](https://docs.cloud.google.com/document-ai/docs/reference/rest/v1/Document)
- [Processing limits](https://docs.cloud.google.com/document-ai/limits)
- [Regions](https://docs.cloud.google.com/document-ai/docs/regions)
- [Document AI IAM roles](https://docs.cloud.google.com/document-ai/docs/access-control/iam-roles)
- [Cloud Run service identity](https://docs.cloud.google.com/run/docs/securing/service-identity)
- [Document AI security](https://docs.cloud.google.com/document-ai/docs/security)
- [Document AI audit logging](https://docs.cloud.google.com/document-ai/docs/audit-logging)
- [Document AI pricing](https://cloud.google.com/products/document-ai/pricing)

## Cost and latency

As of 2026-08-05, Google lists the first 1,000 Enterprise OCR pages per account
and month at no charge, $1.50 per 1,000 pages from 1,000 through five million,
and $0.60 per 1,000 pages above that tier. Optional add-ons cost $6 per 1,000
pages and are disabled by this contract. A successful one-page qualification
is therefore $0 while the account's monthly free tier remains available, with
a marginal paid-tier cost of approximately $0.0015 otherwise, excluding any
broader Google Cloud infrastructure cost. Google states that failed 4xx and 5xx
requests are not billed. Prices, free-tier availability, and account-specific
terms must be reconfirmed immediately before qualification and rollout.

No latency or accuracy claim is made before a live qualification. The adapter
records bounded request latency and response size without retaining provider
payloads.

## Quality gates

The one-page qualification and later frozen corpus must measure, without
inventing results:

- numeric transcription accuracy, including signs and decimals;
- date accuracy and page association;
- line and token ordering;
- table reconstruction;
- fabricated critical values, which must remain zero;
- missing-text and malformed-response rates;
- provider failure rate and ambiguous dispatch count;
- latency and cost per page;
- encryption and review-provenance binding; and
- mandatory review and zero downstream authority.

No aggregate pass can excuse a fabricated critical value or an authority-boundary
failure.

## Committed migration and inactive runtime

`20260805163333_google_document_ai_enterprise_ocr_v1.sql` is a forward-only,
unapplied migration. It widens existing source-class and route constraints,
adds nullable provider-profile identity columns, adds exact Google contract
checks for new Google rows, extends the one-active-provider-per-workspace
invariant, and introduces an internal `document_extraction_runtime_reason_v2`
gate function. It also defines separate service-role-only Google enqueue,
claim, lease, file-grant, dispatch, provider-boundary, outcome, failure,
encrypted-completion, and telemetry RPCs plus a V3 authorized human-review
mutation. It inserts or updates no rows while unapplied, enables no gate, and
grants no provider output direct authority.

The compiled runner and broker use explicit profile dispatch. Historical
`hosted_tool_call_v2` calls continue through their existing RPCs and adapter.
`google_document_ai_enterprise_ocr_v1` calls use only the separately named
Google RPCs and adapter. Missing, mixed, or unknown profiles fail before network
access; there is no profile auto-detection, provider fallback, or Google retry.
Google Preview execution additionally requires
`google_document_ai_preview_qualification_v1`. Production requires both the
general document-extraction approval and the separate absent-by-default
`google_document_ai_production_pilot_v1` approval.

## Activation blockers

All of the following must be completed in later, separately approved work:

1. Independently audit and replay the migration on a clean isolated Preview
   database, then regenerate
   Supabase types from that exact schema.
2. Provision the Document AI API, one Preview-only `OCR_PROCESSOR`, and the
   exact pinned processor version in `us`.
3. Add least-privilege processor-level IAM to the existing worker service
   account, with metadata-service OAuth only.
4. Re-verify the committed Google-specific enqueue, claim, dispatch,
   completion, and V3 review-provenance paths against the live Preview schema.
   They must bind every provider identity field and remain single-use,
   encrypted, workspace-scoped, and mandatory-review only.
5. Configure the exact Google profile and its separate Preview approval only
   for a separately approved qualification. Keep the initial qualification at
   one provider attempt and zero retries.
6. Re-verify quota reservation, cache identity, ambiguous dispatch handling,
   cleanup, audit logging, retention terms, and no downstream authority.
7. Complete an independent read-only audit before any provider call.

Until those items pass, paper ingestion through Google remains unavailable.

## Exact one-page qualification plan

The first provider qualification requires a separate explicit approval. It is
bounded to one committed, non-sensitive, one-page printed synthetic fixture,
one isolated Preview workspace, one job, one rendered PNG page, one provider
attempt, and zero retries.

Preflight must prove the isolated Preview project, exact migration ledger,
default-false gates, zero active jobs and leases, worker scale zero, no broker,
exact processor/version/IAM binding, one-page quota, one-call ceiling, and
Production denial. Broker OIDC plus Ed25519 authentication must be proven with
zero provider calls before the worker is scaled to one.

The run must verify exact contract selection, one request, strict response
validation, deterministic normalization, AES-256-GCM encryption, V3 review
provenance, and a terminal pre-authority state of `awaiting_review`,
`needs_review`, or `pending`. Any retry, ambiguity, contract mismatch,
cross-workspace result, unexpected asset flow, or authority-boundary failure
stops the run.

Cleanup must immediately disable every gate, scale the worker to zero, delete
the ephemeral broker and IAM grants, remove all synthetic database and storage
records, and prove no provider assets, credentials, active leases, or
content-bearing telemetry remain. Production must never be addressed.

## Rollback

Before activation, rollback is simply to leave the migration unapplied and the
provider absent from the active runner. After a future Preview migration replay,
operational rollback remains gate-first: disable global, worker, provider,
workspace, and synthetic gates; scale the worker to zero; remove ephemeral
broker and processor IAM; invalidate synthetic artifacts; and retain migration
history and encrypted review records for audit. No customer data rewrite is
required.
