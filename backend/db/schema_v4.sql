-- Phase 3.2 migration — explicit RLS-deny policies for server-only tables
-- Safe to run on top of schema_v3.sql (idempotent)
-- Design: the app backend uses Supabase service_role, which bypasses RLS.
-- Browser clients must not read or write these tables directly through the Data API.

alter table search_cache enable row level security;
alter table price_history enable row level security;
alter table provider_status enable row level security;
alter table tracked_routes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'search_cache'
      and policyname = 'server only - no anon/auth access to search_cache'
  ) then
    create policy "server only - no anon/auth access to search_cache"
    on search_cache
    as restrictive
    for all
    to anon, authenticated
    using (false)
    with check (false);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'price_history'
      and policyname = 'server only - no anon/auth access to price_history'
  ) then
    create policy "server only - no anon/auth access to price_history"
    on price_history
    as restrictive
    for all
    to anon, authenticated
    using (false)
    with check (false);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'provider_status'
      and policyname = 'server only - no anon/auth access to provider_status'
  ) then
    create policy "server only - no anon/auth access to provider_status"
    on provider_status
    as restrictive
    for all
    to anon, authenticated
    using (false)
    with check (false);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tracked_routes'
      and policyname = 'server only - no anon/auth access to tracked_routes'
  ) then
    create policy "server only - no anon/auth access to tracked_routes"
    on tracked_routes
    as restrictive
    for all
    to anon, authenticated
    using (false)
    with check (false);
  end if;
end $$;
