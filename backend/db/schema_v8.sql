-- Phase 7 migration — public-safe health diagnostics for providers and schedulers
-- Safe to run after schema_v7.sql. Browser clients still use only the backend API.

alter table provider_status add column if not exists last_failure_at timestamptz;
alter table provider_status add column if not exists last_error text;

create table if not exists scheduler_status (
  job_name         text primary key,
  last_status      text not null check (last_status in ('running', 'success', 'failed')),
  last_started_at  timestamptz,
  last_finished_at timestamptz,
  last_error       text
);

alter table scheduler_status enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'scheduler_status'
      and policyname = 'server only - no anon/auth access to scheduler_status'
  ) then
    create policy "server only - no anon/auth access to scheduler_status"
    on scheduler_status as restrictive for all to anon, authenticated
    using (false) with check (false);
  end if;
end $$;
