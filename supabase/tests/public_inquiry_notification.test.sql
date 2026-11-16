begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(2);
do $$
declare request_id uuid; claimed int;
begin
 insert into public.support_requests(name,email,issue_type,message,status,notification_status)
 values('SYNTHETIC notification qualification','synthetic@example.invalid','General Inquiry','No email sent','open','pending') returning id into request_id;
 update public.support_requests set notification_status='attempting' where id=request_id and notification_status='pending';
 get diagnostics claimed=row_count;
 if claimed<>1 then raise exception 'first notification claim must succeed'; end if;
 update public.support_requests set notification_status='attempting' where id=request_id and notification_status='pending';
 get diagnostics claimed=row_count;
 if claimed<>0 then raise exception 'repeated notification claim must not succeed'; end if;
 update public.support_requests set notification_status='failed',notification_detail='configuration_missing' where id=request_id;
 if not exists(select 1 from public.support_requests where id=request_id and status='open' and notification_status='failed') then raise exception 'email failure must preserve saved request'; end if;
end $$;
select pass('saved request survives failure and duplicate claim is rejected');
-- Local CLI grants differ from hosted API defaults. This fixture-only grant
-- is rolled back; it lets us test the trigger rather than table ACL denial.
grant insert on public.support_requests to anon;
set local role anon;
do $$
declare rejection text;
begin
 begin
  insert into public.support_requests(name,email,issue_type,message,status,notification_status)
  values('SYNTHETIC forbidden','synthetic@example.invalid','General Inquiry','No email','open','accepted');
  raise exception 'forged notification status accepted';
 exception when insufficient_privilege then
  get stacked diagnostics rejection=message_text;
  if rejection<>'notification metadata is server controlled' then raise exception 'unexpected denial'; end if;
 end;
end $$;
reset role;
select pass('anonymous notification-status forgery rejected');
select * from finish();
rollback;
