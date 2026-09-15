# Private Production pilot actions for Isaac

Perform these actions only in separate reviewed windows. Keep every Square gate
false until the final one-customer activation decision, and never paste a
credential, seller identifier, private database endpoint or provider payload
into Git, CI, an issue, a PR, chat or a recorded terminal.

1. Confirm the exact reviewed Git head and independently passed code/security
   review plus required CI. Confirm the Production project is exactly
   `vaeroex-integrations-prod`, the database ledger ends at
   `20260902191323`, the Square overlay has not been applied yet, the layered
   callback has not been qualified yet, all eight credential containers have no
   versions, and every activation gate is false. Do not proceed from a partial
   or stale readback.

2. After the separate overlay review approves its exact migration, apply only
   that migration with the normal migration tool and exact-version bound. Do not
   apply Sandbox migrations or change QBO. Record only its version and hash.

3. Provision the six native LOGINs only after the overlay RPC allowlist is
   fixed. Map `square_production_{oauth,broker,scheduler,webhook,runtime,evidence}`
   one-to-one to the matching `square_production_*_authority` role using
   `LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
   and a membership with `INHERIT TRUE, SET FALSE, ADMIN FALSE`. Give LOGINs no
   direct table, sequence, schema-owner or function ACL. Use a reviewed
   Production native-SCRAM profile that privately generates and stores each
   unique credential in only its matching version-1 container. Do not reuse the
   Sandbox-pinned maintenance profile, type a database password into SQL, or
   put one in argv, an environment variable, a file or a shell history. Run
   `verify-database.sql` through a private native read-only session and retain
   only `square_production_login_verification_passed` plus the reviewed role
   inventory.

4. In Square's Production application settings, register exactly
   `https://square.vaeroex.com/api/integrations/square/callback` and
   `https://square.vaeroex.com/api/integrations/square/webhook`. Do not register
   a Preview, Sandbox, Vercel, IP, alternate host, query or trailing-slash form.
   Keep provider calls, customer onboarding and webhook intake closed.

5. In a private, non-recorded terminal with the reviewed GCP identity and a
   written approval reference, verify `gcloud config get-value project` returns
   `vaeroex-integrations-prod`, set `VAEROEX_APPROVED_SECRET_WINDOW=yes`, and run
   `stage-provider-secret.sh application APPROVAL_ID`, then
   `stage-provider-secret.sh webhook-signature APPROVAL_ID`. Type each value only
   at its no-echo prompt. Verify the returned version metadata is exactly
   version `1`; do not read the value back or use `latest`. Clear the terminal
   and close the window. The script refuses to create a second version.

6. If secret-version creation is cancelled, times out or loses its
   acknowledgement, do not retry. Keep all gates false. From a separately
   authenticated read-only terminal, list only version metadata and reconcile
   the exact container, creation time, state, operator audit event and approval.
   If exactly one owned version-1 result cannot be proven, mark the slot
   unresolved, leave the runtime identity without access, and escalate for a
   reviewed recovery/rotation decision. Never inspect payload bytes, adopt
   `latest`, disable/destroy an uncertain version, or create version 2 to make
   the check pass. For a database credential interruption, fence the exact
   LOGIN, drain exact-role sessions, and use the native tool's explicit
   exact-OID recovery path; a journal entry alone is not a commit acknowledgement.

7. Select one Vaeroex-owned internal Production workspace and one internal
   Square seller. In a private operating record, record the exact workspace,
   merchant, business entity and explicitly selected location IDs. Have a
   second person compare seller discovery to that record. Do not infer a mapping
   from names or the provider default. Add exactly that tuple to the private
   allowlist, confirm `internalSeller=true` and `mappingConfirmed=true`, and
   verify a foreign workspace, seller, entity and location each fail closed.

8. Before consent, prove the callback layer strips the query before ordinary
   request logging, the webhook remains queryless, alternate host/method/path
   requests fail closed, direct Cloud Run access is denied, request logs contain
   no synthetic canary, and alert delivery reaches both the primary and backup
   incident contacts. Do not use a real code, token, signature or seller payload
   as a canary.

9. In an explicitly approved one-customer window, authorize only the allowlisted
   internal seller with the five read scopes. Confirm the discovered merchant,
   entity and locations exactly match the reviewed mapping before enrollment.
   Start with one bounded initial scan. Verify pagination checkpoints, restart
   replay, cancellation, timeout and a deliberately dropped nonsecret
   acknowledgement do not skip or duplicate immutable versions. Then run one
   bounded overlapping incremental scan and verify only new versions are added.
   Do not claim history completeness, Current status, economics, stock value,
   accounting truth or freshness from cursor exhaustion.

10. Exercise one successful credential refresh, webhook delivery replay and
    signature failure using provider-approved non-sensitive test actions. Verify
    duplicate delivery has one effect, refresh failure fences only this
    connection, local disconnect stops later work, authenticated provider
    revocation fences the exact current grant, and a delayed callback, task,
    webhook or page acknowledgement cannot revive an older generation. Stop on
    any ambiguous provider or database result.

11. Deliver and acknowledge alerts for callback health, signature failures,
    refresh failure, 401/403, 429, provider 5xx, task age/retries/dead letter,
    stale/incomplete scans and backup failure. Confirm bounded log retention and
    absence of credentials, OAuth query values, cursors and raw provider
    payloads. Record gross spend separately from credits; the budget alert is not
    a hard cap.

12. With gates closed and no provider work running, verify the current Supabase
    backup inventory and perform the approved isolated restore drill. Prove the
    restored ledger, role closure, one-workspace mapping, immutable version/
    receipt counts and checkpoints without connecting the restored copy to
    Square or Production callbacks. Perform the rollback drill by closing the
    customer/provider/webhook/runtime gates, fencing all six LOGINs, draining
    exact-role sessions, pausing tasks, removing the seller from the allowlist,
    and verifying late work is denied. Do not delete history, secret versions or
    Terraform state during a drill.

13. Verify the normal Production Vaeroex workspace shows only the allowlisted
    seller's reviewed connection/sync evidence, never another workspace's data,
    and still labels output as operational evidence rather than economic truth.
    Keep economic contributions and Vaeroex dispatch false. Run the offline
    qualification against a private sanitized evidence file at the exact head;
    a pass permits only the final activation review.

14. Make the final one-customer decision with the backup operator present. Name
    the incident owner, rollback owner and expiry time; confirm the allowlist has
    exactly one workspace/seller and every preceding check has a fresh
    acknowledgement. Activate only the minimum separately approved read-only
    pilot gates in the separately reviewed change. Do not enable a second
    customer, economics, Vaeroex dispatch, QBO changes or additional
    infrastructure. At expiry or any unbounded/ambiguous result, execute the
    rollback and keep the pilot closed pending incident review.
