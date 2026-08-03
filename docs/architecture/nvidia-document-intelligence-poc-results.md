# NVIDIA Document Intelligence POC Results

- Benchmark version: `document_intelligence_benchmark_v1`
- Run date: 2026-08-01
- Environment: isolated Vercel Preview
- Corpus: 12 synthetic documents, 13 rendered pages
- Official client: NVIDIA NeMo Retriever Multimodal Extraction
- Extraction model: `nvidia/nemotron-parse`
- Official client revision: `52886112cafab4c4bca1cda0d4f588785adfe4d3`
- Hosted contract profile: `hosted_tool_call`
- Decision: integration passed; global adoption gate failed

This report contains aggregate, content-free measurements only. It contains no customer data, workspace or user identifiers, source identifiers, filenames, raw benchmark text, raw provider requests or responses, authorization headers, credentials, or secret-derived values.

## Execution Boundary

The frozen benchmark used only committed synthetic fixtures and manually verified ground truth. It ran alongside, and did not modify, the active Vaeroex extraction path. Provider output was held in memory only long enough to validate and score it. It did not enter ordinary file analysis, Business Memory, Evidence, KPI tables, IntelligenceSnapshotV1, Business Health, findings, Saved Analyses, Trust telemetry, or any customer-visible result.

The permanent harness requires the explicit `--nvidia` command option and refuses to run when `VERCEL_ENV=production`. No deployed API route, admin page, temporary branch gate, build override, or active ingestion import remains. Provider failure leaves the current Vaeroex path unchanged.

## Official Client Integration

The former handwritten OCR and parser adapters were replaced by the official `nemo_retriever` client. The bridge calls `create_ingestor(...)` with `ExtractParams(method="nemotron_parse")`, verifies the hosted tool-call contract at startup, and normalizes only the official client result into the provider-neutral benchmark contract.

The official source revision generates development package versions from build time. The retained installer fixes the build metadata inputs so repeated installation of the pinned revision is deterministic; no binary wheel is committed.

| Provider measurement | Result |
|---|---:|
| Eligible hosted page calls | 12 |
| Successful hosted page calls | 12 |
| Authentication failures | 0 |
| Provider failures | 0 |
| Timeouts | 0 |
| Retries | 0 |
| Local schema/input failures | 1 corrupt fixture |
| p50 latency | 990 ms |
| p95 latency | 3,100 ms |
| p99 latency | 3,100 ms |

The corrupt fixture was rejected locally before the official client ran. The richer document-parser qualification reused the same extraction output and made zero additional provider calls. The official output contract was observed successfully.

## Aggregate Quality

Higher is better for accuracy and coverage metrics. Lower is better for error, omission, duplication, hallucination, and catastrophic-error rates.

| Metric | Current isolated baseline | Official NeMo Retriever |
|---|---:|---:|
| Character error rate | 0.2783 | 0.2772 |
| Word error rate | 0.7619 | 0.3173 |
| Exact numeric accuracy | 0.8000 | 0.8667 |
| Sign accuracy | 0.5667 | 0.9500 |
| Decimal accuracy | 0.2333 | 0.9333 |
| Currency accuracy | 0.0000 | 0.4762 |
| Percentage accuracy | 0.3333 | 0.8000 |
| Date accuracy | 0.0000 | 0.5000 |
| Reporting-period accuracy | 0.6000 | 0.1333 |
| KPI-name accuracy | 0.0000 | 0.4259 |
| KPI-value accuracy | 0.2917 | 0.4444 |
| KPI-target accuracy | 0.4167 | 0.8000 |
| Unit accuracy | 0.5833 | 0.7500 |
| Row reconstruction | Unavailable | 0.7778 |
| Column reconstruction | Unavailable | 0.7500 |
| Reading-order accuracy | Unavailable | 0.5471 |
| Page association | 0.7000 | 0.9750 |
| Bounding-box coverage | 0.0000 | 0.3325 |
| Bounding-box correctness | 0.0000 | 0.0000 |
| Hallucinated-text rate | 0.2000 | 0.0187 |
| Omitted-text rate | 0.2000 | 0.0040 |
| Duplicated-text rate | 1.0000 | 0.1678 |
| Catastrophic-business-error rate | 0.4667 | 0.1061 |

The official client materially improved word recognition, numeric fidelity, signs, decimals, page association, omission, hallucination, and duplication. It did not meet Vaeroex's adoption thresholds. Reporting-period accuracy regressed, currency fidelity remained inadequate, bounding boxes were not correct against ground truth, and catastrophic business errors remained non-zero.

The benchmark reported a 0.9091 merged-cell reconstruction value from normalized unit spans, but the official bridge does not preserve authoritative merged-cell spans. Merged cells remain explicitly unqualified, and that number is not adoption evidence. Heading and section associations also remain unqualified in the normalized contract.

## Catastrophic Errors

The observed aggregate catastrophic-business-error rate was 0.1061. Failures included:

- changed currency magnitude;
- changed numeric sign;
- merged reporting periods;
- omitted critical values;
- decimal shifts.

Any non-zero catastrophic error blocks global adoption for business-document extraction. The benchmark therefore rejects activation despite the substantial average quality improvement.

## Class Decisions

Two narrow class-level recommendations passed the benchmark rules:

| Document class | Decision |
|---|---|
| empty_page | QUALIFIED FOR CONDITIONAL FALLBACK |
| handwritten_annotation | QUALIFIED FOR SPECIALIST PILOT |

These recommendations are benchmark evidence only. They do not enable a fallback or pilot in the product.

The following 30 classes remain rejected under the current gate:

`chart_with_labels`, `clean_digital_pdf`, `conflicting_footnotes`, `corrupted_page`, `currencies`, `decimals`, `dense_financial_table`, `image_only_pdf`, `invoice`, `kpi_dashboard_export`, `low_resolution_image`, `merged_cell_table`, `mixed_text_image_page`, `multi_page_table`, `negative_values`, `operational_report`, `parentheses_negative_values`, `percentages`, `poor_contrast_scan`, `profit_and_loss_statement`, `prompt_injection_text`, `repeated_headers_and_footers`, `reporting_period_changes`, `rotated_page`, `scanned_pdf`, `screenshot`, `skewed_scan`, `spreadsheet_rendered_as_pdf`, `three_column_report`, and `two_column_report`.

## Cost And Adoption

Authoritative hosted pricing was not returned or configured, so exact cost per page and document is unknown.

The POC proves that the official hosted integration works and materially improves multiple extraction metrics. It does not pass Vaeroex's global adoption gate and remains isolated shadow infrastructure only. A future qualification would need to eliminate catastrophic business errors and improve reporting-period, currency, bounding-box, heading, and section fidelity before any active rollout is considered.

Merging this POC retains only reusable provider-neutral contracts, synthetic fixtures, the official-client adapter and bridge, validators, the local benchmark harness, tests, and this privacy-safe result. It does not activate NVIDIA or alter active Vaeroex behavior.
