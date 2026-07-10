-- Phase 4 migration — anonymous in-site flight price tracking
-- Safe to run on top of schema_v4.sql (idempotent)
-- Browser clients never access these tables directly; all access goes through the backend service_role.

create table if not exists price_trackers (
  id                 uuid primary key default gen_random_uuid(),
  tracker_key_hash   text not null,
  trip_type          text not null check (trip_type in ('one-way', 'round-trip')),
  origin             text not null check (origin ~ '^[A-Z]{3}$'),
  dest               text not null check (dest ~ '^[A-Z]{3}$'),
  depart_date        date not null,
  return_date        date,
  adults             int not null default 1 check (adults between 1 and 9),
  cabin              text not null default 'economy',
  target_price_twd   int check (target_price_twd is null or target_price_twd > 0),
  current_price_twd  int check (current_price_twd is null or current_price_twd > 0),
  previous_price_twd int check (previous_price_twd is null or previous_price_twd > 0),
  enabled            boolean not null default true,
  last_checked_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (
    (trip_type = 'one-way' and return_date is null)
    or (trip_type = 'round-trip' and return_date is not null and return_date >= depart_date)
  )
);

create index if not exists idx_price_trackers_key_hash on price_trackers (tracker_key_hash);
create index if not exists idx_price_trackers_enabled on price_trackers (enabled, depart_date);

create table if not exists tracker_events (
  id                 uuid primary key default gen_random_uuid(),
  tracker_id         uuid not null references price_trackers(id) on delete cascade,
  tracker_key_hash   text not null,
  event_type         text not null check (event_type in ('target_price', 'price_drop')),
  price_twd          int not null check (price_twd > 0),
  previous_price_twd int,
  target_price_twd   int,
  message            text not null,
  read               boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (tracker_id, event_type, price_twd)
);

create index if not exists idx_tracker_events_key_hash_read on tracker_events (tracker_key_hash, read, created_at desc);
create index if not exists idx_tracker_events_tracker on tracker_events (tracker_id, created_at desc);

alter table price_trackers enable row level security;
alter table tracker_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'price_trackers'
      and policyname = 'server only - no anon/auth access to price_trackers'
  ) then
    create policy "server only - no anon/auth access to price_trackers"
    on price_trackers
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
      and tablename = 'tracker_events'
      and policyname = 'server only - no anon/auth access to tracker_events'
  ) then
    create policy "server only - no anon/auth access to tracker_events"
    on tracker_events
    as restrictive
    for all
    to anon, authenticated
    using (false)
    with check (false);
  end if;
end $$;
