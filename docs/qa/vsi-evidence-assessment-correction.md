# Evidence-assessment language correction

GitHub-only credential-free validation. No new paid evaluation, credential, deployment, production read or activation is included. All application gates remain false. The prior evaluation key is revoked and must not be reused.

## Confirmed failure

The retained synthetic response reached qualitative validation after successful OpenAI authentication and two completed Responses requests. The old validator rejected `source`, `sufficient` and `unclear` in its missing-information sentence, and `source` in its next check. An offline replay of the exact retained output reproduced `interpretation_unsupported_term`.

The predicate treated every non-neutral word in all authored fields as a proposed business fact needing to appear verbatim in a premise. That conflated asking whether evidence is sufficient with asserting a new measured fact. Token reuse also never established semantic entailment in the first place.

## Bounded correction

- Hypothesis business vocabulary and per-premise contribution checks are unchanged.
- Questions and checks can refer to the evidence itself using source/data and abstract assessment concepts such as adequacy, sufficiency, clarity, reliability and limitations. These words do not become hypothesis authority or contribute to premise grounding.
- Evidence-quality adjectives are allowed in the missing-information question and in explicitly interrogative next checks such as `Check whether ...`. They cannot newly label a business fact in an action such as `Review reliable invoice balance ...`.
- Unsupported business terms still fail in every field. Exact complete premises, immutable bindings, duplicate-premise rejection, independent dependencies, source attribution, environment/installation separation, numeric/causal/certainty/linkage restrictions and canonical citations are preserved.
- Vocabulary diagnostics now include only a closed authored-field name. Rejected words, sentences, source identities and quotes are not logged.

The prompt now explicitly permits a useful, cited limitation with `interpretations: []` when no business relationship is supported. It discourages generic “warrant review alongside” filler. It also clarifies that the ban on authored interpretation numbers does not remove exact reported values/dates from factual content.

## What this fixture supports

Every observation is invented: one day contains an invoice-balance amount in USD and operational dispatch/backlog counts. These are different quantities. The supplied records provide no invoice-to-dispatch identifier, complete population, payment sequence or verified collections/operational trend. A useful joint answer can explain those limits and identify the missing scope/coverage/record definitions needed for a comparison.

It cannot truthfully conclude that collections affect dispatch, that an operational problem exists, that balances are cash receipts/revenue/profit, or that a ratio or trend is established. The retained answer's generic “review alongside” hypothesis remains insufficient for the agreed usefulness threshold even after its wording passes validation. The correction does not turn that answer into a successful evaluation.

## Validation and limits

The new regression uses sanitized retained synthetic wording and remapped citation IDs; no private production metadata or credential is a fixture. Four actual-engine replays use mocked model responses only: retained wording, a precise limitation without a hypothesis, fabricated-premise rejection and unsupported-number rejection. Existing lexical, premise-independence, synthesis, diagnostic, citation/workspace and VSI behavior tests remain in force. The exact private retained output is also replayed locally, without copying its private artifacts into Git.

This remains a conservative English lexical boundary, not a semantic-entailment verifier. Hypothesis paraphrases or new business terms absent from the premises can still fail. A valid citation does not prove a factual sentence, and reuse of all premise words does not prove a useful relationship. Mocked examples establish application acceptance/rejection paths, not improved real-model quality. Manual assessment must stay separate; do not force a positive interpretation from a sparse fixture.

Before any separately approved real-model evaluation, its runtime identity must be pinned to this reviewed local contract. The separate owner-run credential and private review-file handoff is outside this publication. The credential-free evaluator's two-question/four-call/$1 controller and no-production boundary remain unchanged. New paid execution or publication requires its own explicit authorization; no new key should be created merely to repeat this failure.
