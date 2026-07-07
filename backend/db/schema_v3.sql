-- Phase 3.1 migration — Amadeus 自助 API 2026-07-17 停用，備援 provider 改為 Kiwi.com
-- Safe to run on top of schema_v2.sql (idempotent)
-- 已於 2026-07-07 套用至 Supabase 專案 flight-search

insert into provider_status (provider, state, failure_count, monthly_calls)
  values ('kiwi', 'closed', 0, 0)
on conflict (provider) do nothing;

delete from provider_status where provider = 'amadeus';
