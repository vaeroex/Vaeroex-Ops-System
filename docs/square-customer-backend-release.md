# Square customer backend: bounded release procedure

This replaces the customer dependency on custom OAuth/broker LOGINs with the existing Vaeroex server-side Supabase backend. It does not change or repair the retired provisioner, its journal, role OID 34220, secret version 1, VM, or Terraform state. None of those is required by this path.

## What the code does

- A signed-in, active workspace owner selects an active Business Entity. The database independently checks the session, ownership and the existing paid-workspace entitlement before every provider dispatch.
- The customer authorizes the Production application at Square. Callback state is single-use and tied to that owner, session and workspace. The callback discovers the seller's active locations; the owner then chooses one location.
- Seller access and renewal credentials are AES-256-GCM encrypted on the server, bound to provider/environment/workspace/connection/generation/version. No plaintext credential is stored in a table or returned in status. The encryption key is separate from the database and must be retained for recovery.
- Each read imports one bounded Payments page. Cursor continuation is bound to the seller/location/workspace and a fixed updated-time window. Atomic upserts and checkpoints permit interruption/replay without duplicating Payments. Credentials renew on demand before expiry and can renew beyond version 2.
- Disconnect first fences local reads, then revokes the application's authorization for the verified seller. A pending revocation prevents reconnect until reconciled. Saved Payments remain visible. Status and disconnect do not require a current paid subscription.

One active Square seller/location per workspace is supported. One merchant cannot be active in two Vaeroex workspaces, including while revocation is pending, because Square revocation can affect the merchant's entire application authorization.

Reads are customer-requested, not an unattended scheduler. Initial reads cover 30 days of updates, subsequent reads use the saved checkpoint with five-minute overlap, and long gaps catch up in at most 31-day windows. The screen shows the 100 most recently updated saved records. This is not a complete-history or accounting-total claim. Scheduler, webhook, economics and AI remain deferred.

## Required separate Production authorization

Do not execute these steps merely because this document exists.

1. **Merge/deploy the reviewed code dormant.** Leave `SQUARE_CUSTOMER_BACKEND_ENABLED` unset/false. Existing native services and their flags stay unchanged. No new VM, container image or Google access grant is needed.
2. **Apply only `20260929004917_square_customer_service_backend.sql`.** First verify Production project `mdiianhfrojmxqpwrflh`, PostgreSQL 17/postgres owner, exactly 105 canonical ledger entries ending `20260925032300`, and fingerprint `33bb3e49ae22026172264da954a02a869afcc878b33a57a78f0258e20d9a5d16`. The connected dry run must select this file alone from an isolated exact-105-prefix staging set. Do not include the superseded, unapplied native first-read migration `20260926232356` or Sandbox history. Freeze and present this candidate's merged SHA-256 before apply. Expected result: 106 ledger entries, four new empty/protected tables (configuration has one disabled row), one service-only RPC and a private context function. No native roles or existing tables are changed.
3. **Configure private server inputs.** Use Vercel's protected Production environment entry/import, never chat or command arguments. Required names: `SQUARE_CUSTOMER_APPLICATION_ID`, `SQUARE_CUSTOMER_APPLICATION_SECRET`, `SQUARE_CUSTOMER_ENCRYPTION_KEY`. Reuse the approved Production application currently held in `square-production-application` version 1; do not invent a version reference or expose its value. Generate a fresh 32-byte random encryption key privately, Base64-encode it, and keep a private recovery copy. Existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` remain the application's current backend configuration. New inputs must never be `NEXT_PUBLIC_*` or included in Preview.
4. **Register the exact Production redirect** in the existing Square application: `https://www.vaeroex.com/api/integrations/square/callback`. Preserve other registered callbacks. No Square password or access token is entered in Vaeroex.
5. **Activate only after verification.** Separately approve setting the new singleton configuration's exact application ID and enabled=true, plus the Production-only `SQUARE_CUSTOMER_BACKEND_ENABLED=true` deployment. Present the exact SQL and deployment identity first. Keep every old native, scheduler, webhook, economics and AI gate false. These are real activation changes and require explicit approval.
6. **Prove the actual product.** In the authenticated paid owner's real workspace, complete Square consent, verify the discovered merchant/location, select that location, read Payments and compare at least one returned payment with Square (or verify an honestly empty page). Check another workspace cannot view/use the connection. Repeat the next page or checkpoint read, exercise supported renewal and disconnect/recovery, and inspect sanitized status/errors. Only then report the exact customer readiness state.

On any uncertain migration/deployment acknowledgement, reconcile the ledger/catalog/deployment read-only before another mutation. Never reuse the retired OAuth proof operation or start the proof VM. Preserve encrypted seller credentials and the key during any rollback; disabling the new dispatch gate does not delete them. Close dispatch first, retain owner status/disconnect where the host is enabled, and reconcile any revocation already in progress.

## Verification in the repository

- `node scripts/square-direct-provider-tests.cjs`: production-only provider requests, encrypted context, renewal, bounded Payments, cursor binding, denied dispatch and revocation.
- `node scripts/square-direct-service-tests.cjs`: consent→mapping→read→renewal→disconnect using synthetic capabilities; PostgreSQL timestamp spelling; replay, lost acknowledgement and HTTP boundary regressions.
- `node scripts/square-direct-customer-ui-tests.js`: real component rendering, exact forms, money formatting, unavailable/disconnected states and safe provider-text rendering.
- `node scripts/run-square-customer-backend-qualification.js`: GitHub's disposable PostgreSQL 17, exact canonical 105-migration baseline, real role/SQL checks, private ACL/FORCE-RLS closure, workspace isolation, lease fencing and pagination. Runs independently after successful disposable database setup even if the unrelated QBO assertions fail. It cannot target a hosted database.

An unchanged red QBO database job is not green CI. Record its exact failure and whether this new qualification actually ran. No QBO exception automatically approves a merge.
