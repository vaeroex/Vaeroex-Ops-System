create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  email text not null,
  issue_type text not null,
  message text not null,
  priority text not null default 'Medium',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_requests_priority_check check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  constraint support_requests_status_check check (status in ('open', 'in_review', 'waiting_on_customer', 'resolved', 'closed'))
);

create index if not exists support_requests_workspace_idx on public.support_requests(workspace_id);
create index if not exists support_requests_user_idx on public.support_requests(user_id);
create index if not exists support_requests_email_idx on public.support_requests(lower(email));
create index if not exists support_requests_status_idx on public.support_requests(status);
create index if not exists support_requests_created_idx on public.support_requests(created_at desc);

alter table public.support_requests enable row level security;

create policy "anyone can create support requests"
  on public.support_requests for insert
  to anon, authenticated
  with check (status = 'open');

create policy "users can read own support requests"
  on public.support_requests for select
  to authenticated
  using (
    user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or (workspace_id is not null and public.is_workspace_member(workspace_id))
  );

drop trigger if exists set_support_requests_updated_at on public.support_requests;
create trigger set_support_requests_updated_at
  before update on public.support_requests
  for each row execute function public.set_updated_at();
