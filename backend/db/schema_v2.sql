-- Phase 3 migration — safe to run on top of schema.sql (all idempotent)

-- Seed initial provider_status rows so circuit-breaker load_from_db finds them
insert into provider_status (provider, state, failure_count, monthly_calls)
  values ('fast_flights', 'closed', 0, 0),
         ('amadeus',      'closed', 0, 0)
on conflict (provider) do nothing;
