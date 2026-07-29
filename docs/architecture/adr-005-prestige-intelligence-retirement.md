# ADR-005: Prestige Intelligence Retirement

- Status: Proposed in Draft PR
- Date: 2026-07-29
- Baseline: `b4dd49008397879e4794d56dfa255a607898e695`
- Scope: Retired parallel intelligence producer and presentation only

## Decision

Prestige is removed as an active intelligence system. It no longer calculates or presents Business Health, KPI diagnostics, data quality, benchmarks, recommendations, risk simulations, source visibility, department scorecards, role briefings, tool-sprawl analysis, or speculative profit leakage.

Canonical authority remains with the Intelligence Layer, canonical KPI semantics, bounded `IntelligenceSnapshotV1` projections, the Evidence Engine, and coverage/readiness producers. No Prestige formula is recreated in an adapter or replacement feature.

## KPI Diagnostics

KPI Compare was carrying a Prestige-derived confidence object that only supplied the already-independent timeframe label to the visible comparison component. The dead confidence, Business Memory count, and data-quality calculation are removed. KPI Compare values, charts, deterministic semantic notes, targets, and directions remain on their existing canonical paths.

The KPI Records benchmark and data-quality panel was a legacy Prestige presentation. It is intentionally retired rather than replaced with new heuristics or a broader snapshot contract. KPI records and management controls remain unchanged.

## Decision Journal

The Decision Journal is retained as an independent durable leadership feature. Its authority is `business_decisions`, queried by workspace and ordered by persisted creation time. The existing form, authorization, demo fail-closed behavior, and recent-decision presentation are separated into `LeadershipDecisionJournal`; no new record is attributed to Prestige.

Historical `business_decisions` remain available through the Decision Journal. Historical `vaeroex_recommendation_outcomes` rows remain stored and protected by their existing RLS and generated types, but are excluded from active search, intelligence loaders, coverage diagnostics, and provider context. No table, migration, or row is removed.

## Profit Leakage

The independent KPI Profit Leakage route and deterministic calculator remain. The unsupported "Profit Leak Detector" promise from Prestige is replaced with accurate "Profit Leakage Review" wording and a direct link to the existing KPI review.

## Consequences

- Business Health formulas, KPI semantics, findings, priorities, confidence, readiness formulas, evidence, citations, prompts, provider routing, cache inputs, and saved artifacts are unchanged. Retired recommendation-outcome rows no longer inflate the coverage producer's derived-finding diagnostic.
- Prestige-specific producer, panel, actions, demo recommendation fixtures, and snapshot projection are deleted after zero runtime imports are proven.
- Low-value legacy diagnostics are intentionally retired, not replaced.
- No database migration or Production configuration change is required.
