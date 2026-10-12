begin;

-- Accepting the policies needed to buy a subscription must be available before
-- that subscription exists. The shared workspace-feature audit attached these
-- guards to the legal ledger because it has a workspace_id column.
-- Scope the exception to this append-only pre-purchase ledger. Its original
-- self-user/workspace-membership RLS, grants, unique acceptance key and immutable
-- UPDATE/DELETE trigger remain unchanged; operational workspace gates stay on.
drop trigger if exists audit_workspace_entitlement on public.checkout_legal_acceptances;
drop policy if exists audit_entitled_insert on public.checkout_legal_acceptances;
drop policy if exists audit_entitled_update on public.checkout_legal_acceptances;
drop policy if exists audit_entitled_delete on public.checkout_legal_acceptances;

commit;
