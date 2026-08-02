# NVIDIA Document Intelligence POC Results

- Benchmark version: `document_intelligence_benchmark_v1`
- Run date: 2026-08-01
- Environment: isolated Vercel Preview
- Corpus: 12 synthetic documents, 13 rendered pages
- OCR candidate: `nvidia/nemotron-ocr-v2`
- Rich parser probe: `nvidia/nemotron-parse`
- Decision: blocked at the hosted endpoint/output-contract boundary

This report contains aggregate, content-free measurements only. It contains no customer data, workspace or user identifiers, source identifiers, filenames, raw benchmark text, raw provider requests or responses, authorization headers, credentials, or secret-derived values.

## Execution Boundary

The benchmark used only committed synthetic fixtures and manually verified ground truth. It ran alongside, and did not modify, the active Vaeroex extraction path. Provider output was held in memory only long enough to validate and score it. It did not enter ordinary file analysis, Business Memory, Evidence, KPI tables, IntelligenceSnapshotV1, Business Health, findings, Saved Analyses, Trust telemetry, or any customer-visible result.

The permanent harness requires the explicit `--nvidia` command option and refuses to run when `VERCEL_ENV=production`. No deployed API route, admin page, temporary branch gate, or active ingestion import remains. Provider failure leaves the current Vaeroex path unchanged.

## Current Vaeroex Baseline

The baseline invokes the repository's current deterministic local PDF text extractor where technically applicable. Image-only and multimodal documents are reported as unsupported by this isolated local baseline rather than invoking the active customer analysis provider. CSV and XLSX remain on their existing deterministic parser and are outside the OCR replacement scope.

The corpus demonstrates why a specialist OCR capability may be valuable for scans and images, but it does not authorize replacing deterministic spreadsheet ingestion, clean PDF extraction, or the active multimodal workflow.

## Hosted OCR Result

The run made 11 hosted OCR requests. All 11 returned without an authentication, transport, timeout, rate-limit, or provider-status failure, with observed request durations from 145 ms to 507 ms. None matched the documented normalized response contract expected by the adapter, so all were classified `malformed_response`. The corrupted-image fixture was rejected locally before transmission and made zero provider calls.

Because no OCR response produced a contract-valid extraction, OCR accuracy is **unscored**. Character, word, numeric, KPI, page-provenance, bounding-box, omission, hallucination, and catastrophic-business-error metrics are `null`, not zero. A failed provider contract is not treated as extracted empty text and cannot pass an adoption gate.

| Provider measurement | Result |
|---|---:|
| Hosted OCR requests | 11 |
| Contract-valid OCR results | 0 |
| Authentication failures | 0 |
| Provider-status failures | 0 |
| Timeouts | 0 |
| Retries | 0 |
| Schema/validation failures | 12 (11 hosted responses, 1 local corrupt-input rejection) |
| Valid-result p50 / p95 / p99 | Unavailable |

No inference about NVIDIA OCR quality can be made from this run. The blocker is endpoint/response-contract compatibility, not measured recognition accuracy.

## Rich Document Parser Result

The separate `nvidia/nemotron-parse` probe made one bounded request to the hosted chat-completions endpoint. It returned HTTP 400 with `unsupported_input` after 250 ms. No output contract was observed. Tables, merged cells, charts, reading order, headings, and sections therefore remain unqualified; they were not counted as ordinary standalone OCR errors.

## Class Decisions

Every class with a hosted OCR attempt is blocked because there is no contract-valid provider result to score. The corrupt-input class is rejected because the benchmark safety validator correctly refuses malformed input before transmission.

| Document class | Decision |
|---|---|
| chart_with_labels | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| clean_digital_pdf | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| conflicting_footnotes | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| corrupted_page | REJECT FOR THIS DOCUMENT CLASS |
| currencies | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| decimals | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| dense_financial_table | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| empty_page | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| handwritten_annotation | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| image_only_pdf | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| invoice | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| kpi_dashboard_export | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| low_resolution_image | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| merged_cell_table | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| mixed_text_image_page | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| multi_page_table | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| negative_values | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| operational_report | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| parentheses_negative_values | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| percentages | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| poor_contrast_scan | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| profit_and_loss_statement | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| prompt_injection_text | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| repeated_headers_and_footers | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| reporting_period_changes | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| rotated_page | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| scanned_pdf | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| screenshot | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| skewed_scan | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| spreadsheet_rendered_as_pdf | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| three_column_report | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |
| two_column_report | BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE |

## Cost And Adoption

Authoritative hosted pricing was not returned or configured, so exact cost per page and document is unknown. No class qualifies for a pilot, fallback, shadow rollout, or Production activation. A future qualification must first reconcile the hosted endpoint and response contract, then rerun the frozen synthetic corpus before any accuracy or cost gate can be evaluated.

Merging this POC retains only reusable provider-neutral contracts, synthetic fixtures, adapters, validators, the local benchmark harness, tests, and this privacy-safe result. It does not activate NVIDIA or alter active Vaeroex behavior.
