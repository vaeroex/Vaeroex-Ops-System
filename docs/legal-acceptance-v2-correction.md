# Protected in-app legal acceptance

The in-app policy form previously inserted directly into `legal_acceptances`.
The reviewed production contract denies direct inserts and exposes the protected
`record_trusted_in_app_legal_acceptance_v2` function to the service role instead.
The action now calls that existing function through the server-only admin client.
No migration, grant, RLS policy, policy text, version, or account change is included.

The action requires all four explicit checkboxes before authentication or writes.
It verifies the current user and matching JWT subject/session UUID, reuses that
identity for workspace resolution, and rejects inconsistent or inactive membership.
Actor, email, workspace, policy versions, and session arguments come from server
state; extra form fields cannot replace them. The protected function remains
responsible for live account/session and workspace checks at write time.

The existing account-level contract permits a null workspace. The shared workspace
resolver can also return no workspace after a query failure; this existing audit
context limitation is unchanged. An account-level acceptance does not grant
workspace access. A broader resolver change is outside this correction.

Successful UUID responses retain the existing revalidation and redirect. Failures
produce bounded messages without raw database details or identity metadata. There
is no direct-write fallback, legacy function call, or automatic retry. Repeated
explicit submissions retain the deployed function's append behavior.

## Local verification

Run `pnpm test:legal-acceptance-action`, `pnpm typecheck`, and `pnpm lint`.
CI runs the new action suite independently of the older legal-content suites.
The 69 actual-handler cases use synthetic server dependencies and verify consent,
actor/session checks, viewer and account-level success, workspace rejection, forged
form fields, exact RPC arguments, safe failures, and absence of alternate writes.

Local TypeScript and full lint passed. Two broader legal-content suites also fail
on the untouched base: `test:legal-readiness` expects an obsolete Trust Center
sentence, and `test:pre-checkout-legal` expects an obsolete acceptance-set version.
Their assertions and production policy content remain unchanged.

A separate local disposable-database check used retained public function DDL and
ACL metadata. It verified the direct-write denial, protected wrapper shape, and
internal persistence semantics. The real private account-session guard definition
was not retained; no permissive replacement was used. This does not qualify a
successful v2 database call, session revocation, or the hosted form submission.
No production acceptance was performed during local qualification.
