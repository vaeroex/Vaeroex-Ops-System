# Document Ingestion Router Pilot

## Status

This is disabled-by-default, Preview-only shadow infrastructure. It is not imported by the active upload action and cannot change Production ingestion. It does not write to Supabase, Evidence, Business Memory, KPI tables, deterministic intelligence, `IntelligenceSnapshotV1`, Business Health, Trust, or Saved Analyses.

The current customer upload and review workflow remains authoritative. The long-term user concept is one entry point named **Upload Evidence** with file, photo, and drag-and-drop inputs. Users do not select an extraction engine.

## Routing Table

| Input | Deterministic decision | NVIDIA behavior in enabled Preview pilot | Authority |
|---|---|---|---|
| CSV | Existing structured parser | Never called | Existing import review |
| XLS/XLSX | Existing structured workbook parser | Never called; workbook is never rendered as images | Existing import review |
| Clean DOCX | Existing native DOCX extraction | Bypassed | Existing file review |
| Clean digital PDF | Existing native PDF extraction after quality assessment | Bypassed | Existing file review |
| Low-quality native PDF/DOCX | Native result preserved | Shadow fallback when all gates allow it | Human review required |
| Scanned or image-only PDF | Visual specialist route | Shadow direct extraction when all gates allow it | Human review required |
| PNG/JPEG, screenshot, phone photo | Visual specialist route | Shadow direct extraction when all gates allow it | Human review required |
| Unsupported or over limit | Unsupported/review | Never called | No authoritative write |

The deterministic decision is independent of whether NVIDIA execution is enabled. Dry-run and cost-only modes can therefore measure routing without provider calls.

## Assessment Contract

`DocumentAssessmentV1` records content-free file facts, native extraction observations, token/structure counts, provenance availability, layout indicators, warnings, a documented assessment score, an explicit state, and stable reason codes. The score starts at 100 and subtracts documented severity weights. It is an internal quality score, not a probability of error.

High-severity failover conditions include missing meaningful text, image-only pages, severe invalid characters or repeated garbage, corrupt reading order, broken tables, unlabeled critical numbers, conflicting reporting periods, missing critical page provenance, unsupported layouts, and native validator failure. Medium signals lower the score without claiming that extraction is wrong.

| Deterministic signal | Score penalty |
|---|---:|
| No meaningful native text | 100 |
| Native validator failure | 50 |
| Unsupported layout | 40 |
| Very low characters per page | 35 |
| Severe invalid characters | 35 |
| Corrupt reading order | 35 |
| Broken table reconstruction | 35 |
| Conflicting reporting periods | 35 |
| Severe repeated garbage | 30 |
| Critical numbers without labels | 30 |
| Missing critical page provenance | 30 |
| Declared type or magic mismatch | 15 and provider execution blocked |
| Elevated invalid characters, repeated garbage, or degraded reading order | 15 each |

The score is clamped to 0-100. Thresholds and any high-severity reason produce explicit states and reason codes; they do not express statistical confidence.

States are `native_clean`, `native_acceptable`, `native_low_quality`, `image_only`, `visual_specialist_required`, `unsupported`, and `review_required`.

## Preview Gates

All three values must be `true`, `VERCEL_ENV` must be `preview`, and mode must be `shadow_extraction` or `dual_extraction_comparison` before a provider call is allowed:

- `VAEROEX_DOCUMENT_ROUTER_PILOT`
- `VAEROEX_NVIDIA_DOCUMENT_PILOT`
- `VAEROEX_NVIDIA_DOCUMENT_SHADOW_CONFIRMATION`

Production is hard-disabled regardless of environment configuration. The initial pilot is additionally synthetic-only and requires an explicit workspace-authorization result from the caller. No customer document may be sent during initial qualification.

Supported pilot modes:

- `routing_dry_run`: assess and route only;
- `cost_only_measurement`: count eligible pages without calling NVIDIA;
- `shadow_extraction`: run one bounded shadow extraction;
- `dual_extraction_comparison`: run shadow extraction and compare it with a supplied native result.

The official NeMo Retriever Multimodal Extraction adapter remains the only NVIDIA execution path. It is pinned to official client revision `52886112cafab4c4bca1cda0d4f588785adfe4d3` and model `nvidia/nemotron-parse`.

Provider work is bounded to 16 pages and two extraction attempts (one initial attempt and at most one eligible retry). The official client timeout remains ten minutes. Type/magic mismatch, authorization failure, non-synthetic input, file-size overflow, and page overflow block provider execution.

## Agreement And Review

The comparator binds fields by normalized type and identity and compares KPI identity, value, target, sign, decimal placement, currency, percentage, unit, reporting period, page, and source coordinates. It returns one of:

- `exact_agreement`
- `normalized_agreement`
- `noncritical_disagreement`
- `critical_disagreement`
- `one_parser_missing`
- `both_unreliable`

It exposes hashed field identities only. Critical disagreement, missing parser output, unreliable output, low-quality native assessment, or any critical NVIDIA field requires review. Agreement can support extraction confidence but never establishes business truth and never chooses a winner silently.

## Idempotency And Failure

The cache identity includes file-content hash, provider, model, official client revision, extraction contract, normalization version, and routing policy version. It is additionally scoped by a one-way workspace hash. The coordinator performs single-flight duplicate suppression. A cache hit makes zero provider calls and records zero planning cost. Explicit reprocessing requires a reviewed Preview-only re-analysis key; that key creates one new cache namespace and remains idempotent when repeated.

The retained cache implementation is process-local for controlled synthetic Preview qualification. The cache interface is provider-neutral so a separately reviewed durable, encrypted, tenant-safe adapter can replace it before any real-customer pilot. A version change deliberately changes cache identity.

NVIDIA retries at most once and only for transport failure, timeout, or rate limiting. Validation, malformed-content, unsupported-input, and disagreement failures do not retry. A bounded circuit breaker opens after repeated failures. Provider failure preserves any valid native extraction; otherwise the outcome requires review. The original file and active baseline are outside and untouched by this pilot.

## Privacy-Safe Measurement

Telemetry includes only one-way workspace scope, document hash, parser path, reason codes, document kind, pages, calls, success/failure counts, retries, latency, byte count, output element count, cache/duplicate state, assessment/validation/review state, pilot mode, and configured planning estimate. Cost-only mode records projected eligible pages separately from actual pages sent, so a planning estimate cannot be mistaken for provider usage.

It excludes filenames, raw text, extracted values, prompts, Business Notes, customer identity, workspace/user identifiers, credentials, headers, and provider payloads. Pricing is never fabricated. Optional per-page or per-call rates are labeled configured planning estimates; absent rates remain unknown. Aggregate helpers report routing, page, cache, duplicate, workspace, and subscription-relative planning metrics.

## Qualification Boundary

The pilot may be exercised only with the committed synthetic corpus. Qualification should run routing dry-run first, then cost-only measurement, then a bounded shadow/dual run using the official adapter. Review aggregate content-free telemetry and keep raw provider output in memory only. No route, admin page, temporary API endpoint, migration, schema change, or Production environment change is part of this pilot.

Before any real-customer Preview pilot, require a separate review of durable encrypted caching, data-processing terms, retention/deletion, regional handling, workspace admin consent, and document-class adoption thresholds. Before Production, require a separate activation PR and repeat the catastrophic-business-error gate.
