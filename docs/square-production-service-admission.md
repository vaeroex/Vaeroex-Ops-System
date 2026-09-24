# Supervised internal-pilot database admission

Provisioning success is **not** service admission. It leaves the exact native
role `NOLOGIN NOINHERIT`, its capability membership non-inheriting, and a verified
credential in the corresponding existing Secret Manager container. The pilot
services currently pin numeric version **1**. No role or secret is created by
the admission path.

## Minimum sequence (separately authorized hosted actions)

1. Provision OAuth once, using the existing operation-bound recovery clearance
   for retained intent `prod_oauth_20260921_0330` only when required by the journal.
   Install that maximum-ten-minute clearance immediately before its authorized
   private launcher, not during planning. Reconcile the exact OID, fenced state,
   zero sessions and version-1 acknowledgement. Repeat provisioning for broker
   only after OAuth is conclusive; stop on uncertainty, without automatic retry.
2. Use each profile's existing static privileged launcher with the new `admit`
   operation, exact provisioned OID, fresh intent/approval and reviewed deadline.
   This is a **supervised foreground command**, not a background admission or a
   credential handoff to chat. It retains the existing private no-echo entry,
   pinned VM/database/TLS/native-binary checks and exclusive journal lock.
3. Admission requires the last journal result to be conclusive `staged_ready`
   for that OID and corresponding numeric secret version 1, still ENABLED.
   The native `inspect` proves the fenced catalog; native `activate` supplies
   `LOGIN INHERIT` with **ADMIN FALSE, INHERIT TRUE, SET FALSE** membership.
   Services keep the exact session identity and execute their fixed RPC through
   inheritance. They never `SET ROLE`, receive direct table grants, or run SQL
   supplied by a request. Consent still needs its separate reviewed pilot permit,
   service deployment and private Square application inputs.
4. Keep both supervised admission commands alive during the authorized consent
   test. For the first Payments page, provision and admit runtime/evidence in
   the same manner; scheduler and webhook admission are explicitly excluded.
5. Cancel after the result. SIGINT/SIGTERM/SIGHUP, output failure, lost activation
   acknowledgement, and soft deadline initiate independent native drain/fence.
   The unchanged soft deadline reserves 60 seconds before the hard stop; fencing
   has a separate 30-second cancellation bound. Require its positive receipt,
   `NOLOGIN NOINHERIT`, non-inheriting membership, zero sessions and normal cloud
   cleanup before declaring the test closed. No secret version is deleted,
   rotated or replaced by admission.

Admission events prevent blind reuse: a later admission needs checked operator
reconciliation, not skipping past an interrupted journal. This change introduces
no automatic retry or general recurring service-admission scheduler.

## Explicit limit

The supervisor holds the existing private administrator buffer only until
fencing/termination and then clears it. A VM stop, SIGKILL or power loss is **not**
a PostgreSQL LOGIN expiry guarantee. The hard-stop path reports recovery required;
an absent fence acknowledgement requires checked reconciliation. Do not claim
database closure from a stopped VM alone. No production action is authorized by
this document or by merging this code.

## Qualification

- Service tests cover all four fixed RPC identities with no role switch, existing
  seller/workspace/replay boundaries and zero AI imports.
- Disposable PostgreSQL runtime fixtures use the exact native membership flags,
  prove `SET ROLE` rejection and exercise the real RPCs.
- Native qualification admits a real synthetic role with the existing native
  binary, checks inherited RPC permission, cancels, and verifies native fencing.
- Admission unit tests cover exact journal/version binding, lost ACK, failed
  journal/output writes and failed fencing; static-launcher tests limit the
  operation to OAuth, broker, runtime and evidence.
