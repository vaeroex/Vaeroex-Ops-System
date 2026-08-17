# ADR-006: Weekly and Monthly Intelligence Briefings

Status: Implemented in source; migration and deployment pending.

## Decision

Executive Intelligence exposes two rolling briefing products:

- Weekly Intelligence Briefing: the seven UTC calendar days ending at the request cutoff.
- Monthly Intelligence Briefing: the thirty UTC calendar days ending at the request cutoff.

The exact evidence start, end, cutoff, and time zone are stored with every completed artifact and displayed to the user. These are rolling evidence windows, not calendar-week or calendar-month reports.

## Truth boundary

`IntelligenceSnapshotV1` remains the shared canonical consumer contract. Business Health, KPI identities and semantics, target interpretation, finding priority, coverage, source lifecycle, and evidence eligibility are computed before model execution. The model cannot calculate or modify those facts.

The briefing projection admits only eligible original Evidence Engine records, deterministic KPI and finding results bound to that evidence, deterministic Business Health supported by cited signals, and approved active Business Notes as attributed reported context. No eligible evidence means no provider call. Limited evidence produces a narrower briefing with an application-owned confidence ceiling and visible limitations. Empty business sections are omitted deterministically.

## Model boundary

`VAEROEX_INTELLIGENCE_BRIEFING_POLICY=gpt56_sol_terra_v1` enables the workflow. GPT-5.6 Sol is primary with medium reasoning. GPT-5.6 Terra is the only fallback and uses the same strict JSON schema and validator. Each model receives at most one attempt; provider-manager retries are zero. NVIDIA is not a briefing route.

The provider receives bounded facts and opaque signal references, not workspace authority. The server rebuilds workspace scope and evidence from the authenticated session. Strict validation rejects unknown support references, cross-section evidence, missing limitations, invented numbers, causal claims, semantic direction reversals, task creation, and internal identifiers. The existing Trust layer runs a zero-call shadow check after canonical validation.

## Materiality and concurrency

The projection records exact evidence, effective evidence, and material-state fingerprints. Evidence freshness is evaluated against the exact rolling briefing period; the workflow does not introduce a parallel age threshold. Material state includes Business Health, authoritative KPI values and semantic states, findings, approved context versions, confidence, freshness, and coverage. The generation key also binds briefing type, schema, prompt, validator, provider policy, and materiality versions.

Identical inputs return the existing briefing. New but nonmaterial evidence reports “No significant change” and preserves the current briefing. A material state change permits one new generation. A partial unique index on `ai_agent_runs` prevents concurrent duplicate processing/completed claims, including hidden completed history.

## Storage and user experience

Validated current briefings are stored as versioned `intelligence_briefing_v1` artifacts in `ai_agent_runs`; existing workspace RLS policies remain authoritative. `/app/intelligence/briefings` presents Weekly and Monthly states, and `/app/intelligence/briefings/[type]` renders the current artifact with exact period, adaptive sections, confidence, limitations, and source links.

“Save Briefing” copies the complete immutable artifact into the existing `reports` Saved Analysis envelope as `weekly_briefing` or `monthly_briefing`. Saved copies preserve provider attribution, evidence fingerprint, period, citations, and lineage. Saving does not change the current briefing or its evidence.

## Operations

1. Apply `20260817185529_intelligence_briefing_storage_contract.sql` through the normal Supabase migration workflow.
2. Configure `VAEROEX_INTELLIGENCE_BRIEFING_POLICY=gpt56_sol_terra_v1` only in an approved environment and redeploy.
3. Verify no-evidence, limited-evidence, sufficient-evidence, current/nonmaterial/material regeneration, Saved Briefing persistence, and workspace isolation paths.
4. Monitor normal AI usage and Trust shadow telemetry. The workflow adds no scheduler or automatic generation.

To disable new generation, unset the policy selector. Existing current and saved artifacts remain readable and immutable. Do not reverse the forward migration merely to disable the feature.
