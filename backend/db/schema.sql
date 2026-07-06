-- Phase 2 schema  (貼到 Supabase SQL Editor 執行)
-- v2 adds provider_status with throttled columns (Phase 3 will extend it further)

-- ── search_cache ─────────────────────────────────────────────────────────────
create table if not exists search_cache (
  id         bigint generated always as identity primary key,
  cache_key  text unique not null,
  payload    jsonb not null,
  source     text not null,
  created_at timestamptz default now(),
  expires_at timestamptz not null
);
create index if not exists idx_cache_key     on search_cache (cache_key);
create index if not exists idx_cache_expires on search_cache (expires_at);

-- ── price_history ─────────────────────────────────────────────────────────────
create table if not exists price_history (
  id               bigint generated always as identity primary key,
  route            text not null,
  date             date not null,
  lowest_price_twd int  not null,
  source           text not null,
  recorded_at      timestamptz default now(),
  unique (route, date)
);
create index if not exists idx_history_route_date on price_history (route, date);

-- ── tracked_routes ────────────────────────────────────────────────────────────
create table if not exists tracked_routes (
  route   text primary key,
  enabled boolean not null default true
);
insert into tracked_routes (route) values
  ('TPE-WAW'), ('TPE-NRT'), ('TPE-FUK')
on conflict (route) do nothing;

-- ── provider_status (stub for Phase 2; Phase 3 extends with throttled cols) ──
create table if not exists provider_status (
  provider        text primary key,
  state           text not null default 'closed',
  failure_count   int  not null default 0,
  opened_at       timestamptz,
  monthly_calls   int  not null default 0,
  month_key       text,
  last_success_at timestamptz,
  throttled       boolean      not null default false,
  throttled_until timestamptz
);
