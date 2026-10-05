begin;

-- A provider401 has already retired its facts in the guarded lifecycle RPC.
-- Its subsequent failure/lease cleanup changes no connection authority. Repeating
-- retirement for that lease-only UPDATE invokes a revoked private helper from
-- the service-role SECURITY INVOKER failure RPC and rolls back the failed run.
-- Retire on actual nonconnected transitions or source/approval changes only.
-- Keep this trigger invoker-scoped and keep every existing privilege unchanged.
create or replace function private.google_sheets_connection_retirement_v1()
returns trigger language plpgsql security invoker set search_path='' as $function$
begin
  if (new.status<>'connected' and new.status is distinct from old.status)
    or new.spreadsheet_id is distinct from old.spreadsheet_id or new.sheet_id is distinct from old.sheet_id
    or new.header_row is distinct from old.header_row or new.headers is distinct from old.headers or new.field_mapping is distinct from old.field_mapping
    or new.active_approval_id is distinct from old.active_approval_id then
    perform private.retire_google_sheets_facts_v1(old.workspace_id,old.id);
  end if;
  if new.spreadsheet_id is distinct from old.spreadsheet_id or new.sheet_id is distinct from old.sheet_id
    or new.header_row is distinct from old.header_row or new.headers is distinct from old.headers
    or (new.field_mapping is distinct from old.field_mapping and new.active_approval_id is not distinct from old.active_approval_id) then
    new.active_approval_id:=null; new.automatic_refresh_enabled:=false; new.next_sync_at:=null;
  end if;
  return new;
end;
$function$;

commit;
