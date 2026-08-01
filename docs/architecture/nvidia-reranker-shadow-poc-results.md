# NVIDIA Reranker Shadow POC Results

- Qualification version: `nvidia_reranker_shadow_poc_qualification_v1`
- Fixture version: `nvidia_reranker_poc_fixture_v1`
- Run date: 2026-08-01
- Environment: isolated Vercel Preview
- Model: `nvidia/llama-nemotron-rerank-1b-v2`
- Decision: remain shadow-only

This report contains aggregate measurements only. No query text, passage text, customer data, workspace or user identifiers, source identifiers, provider payloads, authorization headers, or credentials are included.

## Execution Boundary

The benchmark used the committed 24-category synthetic fixture set. Candidate pools were frozen after deterministic eligibility, normalization, exact deduplication, and canonical-source handling. NVIDIA could reorder only the identical eligible pool. Its order did not affect active retrieval, manifests, citations, evidence, snapshots, or user-visible output.

The run made 128 real hosted requests: 24 quality requests plus four warmups and 100 measured latency requests. The hard ceiling was 250 requests. Warmups were excluded from latency percentiles. No request was retried.

The existing sensitive `NVIDIA_API_KEY` was available to Preview and Production, but the benchmark executed only in Preview. Authentication succeeded. The credential value and any value-derived fingerprint were never read back, printed, logged, or persisted by the benchmark.

## Aggregate Quality

| Metric | Baseline | NVIDIA | Change |
|---|---:|---:|---:|
| Recall@1 | 31.94% | 60.42% | +28.47 pp |
| Recall@3 | 95.83% | 100.00% | +4.17 pp |
| Recall@5 | 95.83% | 100.00% | +4.17 pp |
| Recall@10 | 97.22% | 100.00% | +2.78 pp |
| Recall@20 | 97.22% | 100.00% | +2.78 pp |
| Precision@1 | 54.17% | 95.83% | +41.67 pp |
| Precision@3 | 63.19% | 67.36% | +4.17 pp |
| Precision@5 | 63.19% | 65.69% | +2.50 pp |
| Precision@10 | 63.61% | 64.44% | +0.83 pp |
| Mean reciprocal rank | 0.7477 | 0.9722 | +0.2245 |
| nDCG@5 | 0.7320 | 0.9757 | +0.2437 |
| nDCG@10 | 0.7379 | 0.9757 | +0.2378 |
| First relevant result position | 1.79 | 1.08 | -0.71 |
| Irrelevant selected chunks | 36.39% | 35.56% | -0.83 pp / -2.29% relative |
| Duplicate selected chunks | 0.00% | 0.00% | unchanged |
| Wrong entity | 4.17% | 4.17% | unchanged |
| Wrong KPI | 8.33% | 8.33% | unchanged |
| Wrong reporting period | 6.94% | 6.94% | unchanged |
| Stale source | 1.39% | 1.39% | unchanged |
| Source-authority inversion | 2.78% | 0.00% | -2.78 pp |
| Business Note over-promotion | 4.17% | 0.00% | -4.17 pp |
| Citation/source correctness | 100.00% | 100.00% | unchanged |
| Downstream validation failure | 4.17% | 0.00% | -4.17 pp |

## Category Comparison

NVIDIA produced 17 wins, 7 ties, and 0 losses across the 24 synthetic categories.

| Category group | Queries | Wins | Ties | Losses |
|---|---:|---:|---:|---:|
| KPI aliases | 2 | 1 | 1 | 0 |
| Semantic direction | 4 | 4 | 0 | 0 |
| Reporting-period conflicts | 2 | 2 | 0 | 0 |
| Entity conflicts | 2 | 2 | 0 | 0 |
| Current versus stale | 1 | 1 | 0 | 0 |
| Authority versus Business Notes | 2 | 1 | 1 | 0 |
| Duplicate and same-source chunks | 2 | 0 | 2 | 0 |
| Numeric ambiguity | 1 | 1 | 0 | 0 |
| Prompt-injected text | 1 | 1 | 0 | 0 |
| Sparse pools | 1 | 0 | 1 | 0 |
| Large pools | 1 | 1 | 0 | 0 |

Several small synthetic pools improved, but the sparse-pool case tied and the aggregate irrelevant-selection reduction remained small. The large-pool case improved. These frozen fixtures are qualification evidence, not measured Production candidate-volume distribution, so they do not establish active product value or justify rollout.

## Latency And Failures

| Measurement | Result |
|---|---:|
| Attempted requests | 128 |
| Successful requests | 128 |
| Failed requests | 0 |
| Authentication failures | 0 |
| Schema failures | 0 |
| Timeouts | 0 |
| Provider errors | 0 |
| Fallback rate | 0.00% |
| Circuit-breaker activations | 0 |
| Measured latency calls | 100 |
| p50 | 123 ms |
| p95 | 135 ms |
| p99 | 144 ms |

| Candidate pool | Successful calls | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| 3 | 25 | 120 ms | 125 ms | 132 ms |
| 8 | 25 | 121 ms | 127 ms | 127 ms |
| 20 | 25 | 124 ms | 141 ms | 168 ms |
| 48 | 25 | 134 ms | 143 ms | 144 ms |

The provider reported or the adapter estimated 77,582 input tokens across the run. No authoritative hosted price was configured or returned, so exact hosted cost remains unverified. Cost uncertainty did not itself fail the quality benchmark.

## Adoption Gates

| Gate | Result |
|---|---|
| Zero cross-workspace leakage | PASS |
| Zero lifecycle leakage | PASS |
| Citation/source correctness maintained | PASS |
| No Business Note authority promotion | PASS |
| Recall@20 regression within one percentage point | PASS |
| At least five points of ranking improvement | PASS |
| No other primary metric regression over one point | PASS |
| At least 10% relative irrelevant-selection reduction | **FAIL** |
| No downstream validation-failure increase | PASS |
| p95 no greater than 500 ms | PASS |
| p99 no greater than 750 ms | PASS |
| Timeout rate no greater than 1% | PASS |
| Fallback rate no greater than 2% | PASS |
| Cost no greater than $5/1,000 when verifiable | NOT BLOCKING; UNVERIFIED |
| Complete source metadata preservation | PASS |
| Correct fail-open behavior | PASS |
| Active results unchanged | PASS |

The mandatory adoption gate did not pass. Irrelevant selected chunks decreased by only 2.29% relative, below the required 10%. The POC therefore remains disabled and shadow-only. Any active pilot requires a separate reviewed decision after stronger product-value evidence; this PR does not authorize active routing or Production use.
