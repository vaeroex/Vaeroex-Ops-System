# ADR-003: Business Health Explanation on IntelligenceSnapshotV1

- Status: Proposed in Draft PR #235
- Date: 2026-07-28
- Baseline: `b39262ff803a269f31ff91a1aa566ab84a6f88b5`
- Scope: Business Health explanation only

## Decision

Business Health explanation is the first live consumer of `IntelligenceSnapshotV1`. The authorized Executive Overview server boundary now composes the explanation in this order:

```text
authoritative Intelligence Layer + coverage + bounded Evidence Manifest
  -> buildIntelligenceSnapshotV1
  -> projectBusinessHealthExplanationV1
  -> existing BusinessHealthExplanationPackage
  -> existing validated Sol/Terra explanation service
```

No other consumer reads the snapshot in this change. Executive Overview presentation, Intelligence, KPI pages, finding explanation, Executive Brief, Reports, Saved Analyses, and provider routing retain their existing paths.

## Producer prerequisite

The Intelligence Layer already calculated the data-quality base, capped risk penalty, and capped opportunity adjustment, but did not expose them. The explanation context independently reconstructed those values. The producer now exposes the already-calculated components and their bounded finding-level impacts. The score is derived from those same component values in the producer; the adapter copies them and the explanation layer no longer contains weight, cap, or score formulas.

## Projection boundary

The projection is capped at four Business Health drivers and 24 evidence or citation references. It carries canonical score, status, trajectory, confidence, data quality, findings, priorities, limitations, evidence identity, and citation identity. It does not contain raw source excerpts, unrestricted files, prompts, embeddings, or provider output.

The existing bounded Evidence Manifest remains the source for citation excerpts and human-readable source labels. Historical Business Health snapshots and the current homepage model remain presentation inputs for previous-review wording and the deterministic summary. Runtime guards require those presentation values to agree with the snapshot on score, status, trajectory, and confidence; they cannot override snapshot intelligence.

## Parity and fallback

The active package keeps the existing contract, validator version, fingerprint algorithm, evidence manifest, citations, and provider request shape. Preview builds also assemble the legacy package from the same producer-owned components and compare the complete canonical package. An unexplained difference is classified as an adapter defect and falls back to the legacy package only in Preview for qualification. Production does not use parity fallback for an available explanation.

An insufficient-evidence state continues through the existing unavailable package path and cannot invoke a provider. This is not a generated explanation consumer.

## Consequences

- Business Health score and formulas are unchanged.
- Sol remains primary and Terra remains the existing fallback under the existing policy.
- Snapshot construction performs no provider call, database read, database write, or persistence.
- The explanation cache remains keyed by the unchanged package fingerprint; the snapshot fingerprint does not replace it.
- Evidence verification, workspace authorization, release gating, stale-artifact behavior, and Saved Analysis compatibility remain unchanged.
- No database migration or Production configuration is required.
