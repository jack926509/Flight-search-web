-- Phase 5 migration — Telegram push notifications for tracker events
-- Safe to run on top of schema_v5.sql (idempotent)

alter table tracker_events add column if not exists notified boolean not null default false;

create index if not exists idx_tracker_events_unnotified on tracker_events (created_at) where notified = false;
