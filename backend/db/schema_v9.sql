-- Phase 8 migration — resumable, server-side station range scans
-- Safe to run after schema_v8.sql. The browser always reaches these tables through FastAPI.

create table if not exists station_scan_jobs (
  id          uuid primary key default gen_random_uuid(),
  dest        text not null check (dest ~ '^[A-Z]{3}$'),
  stations    jsonb not null,
  from_date   date not null,
  to_date     date not null,
  adults      int not null check (adults between 1 and 9),
  cabin       text not null,
  status      text not null default 'pending' check (status in ('pending', 'running', 'completed', 'cancelled', 'failed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists station_scan_cells (
  id             bigint generated always as identity primary key,
  job_id         uuid not null references station_scan_jobs(id) on delete cascade,
  station        text not null check (station ~ '^[A-Z]{3}$'),
  departure_date date not null,
  status         text not null default 'pending' check (status in ('pending', 'running', 'done', 'empty', 'error')),
  flights        jsonb not null default '[]'::jsonb,
  error          text,
  updated_at     timestamptz not null default now(),
  unique(job_id, station, departure_date)
);

create index if not exists idx_station_scan_cells_job_status on station_scan_cells(job_id, status, departure_date);

alter table station_scan_jobs enable row level security;
alter table station_scan_cells enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'station_scan_jobs' and policyname = 'server only - no anon/auth access to station_scan_jobs') then
    create policy "server only - no anon/auth access to station_scan_jobs" on station_scan_jobs as restrictive for all to anon, authenticated using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'station_scan_cells' and policyname = 'server only - no anon/auth access to station_scan_cells') then
    create policy "server only - no anon/auth access to station_scan_cells" on station_scan_cells as restrictive for all to anon, authenticated using (false) with check (false);
  end if;
end $$;
