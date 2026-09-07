-- Owner-created synthetic PRE-migration history, never an application write path.
-- Qualifies that additive Square migrations preserve existing immutable versions,
-- prior-version links, pending state, content/fingerprint bytes and current pointer.
begin;
do $guard$
begin
  if current_database() !~ '^square_qualification_[a-z0-9_]+$' then
    raise exception 'disposable_qualification_target_required';
  end if;
end;
$guard$;
insert into public.profiles(id,email,full_name) values
('99000000-0000-4000-8000-000000000001','square-upgrade-sentinel@example.invalid','Synthetic immutable upgrade sentinel');
insert into public.workspaces(id,name,created_by) values
('99000000-0000-4000-8000-000000000002','Synthetic preexisting history','99000000-0000-4000-8000-000000000001');
insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,status,created_by,updated_by) values
('99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000002','synthetic_upgrade','Synthetic upgrade','USD','UTC','active','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001');
insert into private.external_source_records(id,workspace_id,business_entity_id,source_kind,manual_actor_id,entry_reference,source_identity_fingerprint,first_seen_at,last_seen_at) values
('99000000-0000-4000-8000-000000000004','99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000003','manual','99000000-0000-4000-8000-000000000001','synthetic_upgrade_history',extensions.digest('synthetic_upgrade_history','sha256'),'2026-09-01T00:00:00Z','2026-09-01T00:00:03Z');
insert into private.external_source_record_versions(id,contract_version,workspace_id,business_entity_id,source_record_id,immutable_version,prior_version_id,
 record_kind,source_kind,manual_actor_id,entry_reference,temporal_basis,observed_at,synchronized_at,ingested_at,accounting_basis,normalized_schema_version,
 change_kind,normalized_projection,trust,validation_state,validator_version,received_at,source_fingerprint)
select ('99000000-0000-4000-8000-00000000000'||(n+4))::uuid,'external_source_record_version_v1','99000000-0000-4000-8000-000000000002',
 '99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000004',n,
 case when n=1 then null else ('99000000-0000-4000-8000-00000000000'||(n+3))::uuid end,
 'synthetic_upgrade_record','manual','99000000-0000-4000-8000-000000000001','synthetic_upgrade_history','point_in_time',
 '2026-09-01T00:00:00Z'::timestamptz+make_interval(secs=>n),'2026-09-01T00:00:00Z'::timestamptz+make_interval(secs=>n),
 '2026-09-01T00:00:00Z'::timestamptz+make_interval(secs=>n),'unknown','synthetic_upgrade_v1',
 case when n=1 then 'created' when n=2 then 'corrected' else 'deleted' end,
 case when n=3 then null else jsonb_build_object('synthetic',true,'revision',n) end,'untrusted_external_input','pending','synthetic_upgrade_v1',
 '2026-09-01T00:00:00Z'::timestamptz+make_interval(secs=>n),extensions.digest('synthetic_upgrade_version_'||n,'sha256')
from generate_series(1,3) n order by n;
update private.external_source_records set current_version_id='99000000-0000-4000-8000-000000000007',lifecycle_state='deleted'
where id='99000000-0000-4000-8000-000000000004';
commit;
