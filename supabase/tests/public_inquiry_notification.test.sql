begin;
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
 insert into public.support_requests(name,email,issue_type,message,status)
 values('SYNTHETIC legacy intake','synthetic@example.invalid','General Inquiry','No email','open');
end $$;
reset role;
rollback;
