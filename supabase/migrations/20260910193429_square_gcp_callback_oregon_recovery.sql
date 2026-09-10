-- Permit explicitly approved Oregon recovery placements. This changes only the
-- zone allowlist: it installs no host identity, LOGIN, grant, credential or gate.
-- The checked runtime still compares the exact canonical zone/name/numeric VM ID
-- to the signed GCP identity. Moving a host requires a separate fenced binding
-- update; accepting a zone never authorizes any VM in that zone.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
alter table private.square_gcp_callback_binding
  drop constraint square_gcp_callback_binding_gcp_zone_check,
  add constraint square_gcp_callback_binding_gcp_zone_check
    check (gcp_zone in ('us-west1-a','us-west1-b','us-west1-c'));
commit;
