
revoke all privileges on table public.business_notes from anon;
revoke all privileges on table public.business_notes from authenticated;
grant select, insert, update on table public.business_notes to authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon;

alter default privileges for role postgres in schema public
  revoke delete, truncate, references, trigger, maintain on tables from authenticated;
;
