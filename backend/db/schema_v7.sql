-- Phase 6 migration — L2 穩定性修正：配額計數 atomic RPC + price_history 防重複安全網
-- Safe to run on top of schema_v6.sql (idempotent)。
-- 對應 backend/db/repository.py 的 increment_monthly_calls() / upsert_price_history()。
-- 尚未套用本檔時，increment_monthly_calls() 會自動 fallback 回舊版 read-then-write
-- 並在 log 印一次提示，不影響服務可用性；套用後才會走 atomic 路徑，消除下述競態：
--   fast-flights 掛掉時多位使用者同時 failover 到 Kiwi，兩個協程讀到同一
--   monthly_calls 各自 +1 寫回，其中一次更新會被覆蓋（配額少計，軟上限，低風險）。

-- ── atomic quota increment ──────────────────────────────────────────────────
-- upsert 到 provider_status：若同月已有列，monthly_calls 在同一筆 UPDATE 內 +1（DB 端
-- 序列化，無 read-then-write 競態）；若月份變了或該 provider 尚無列，重置為 1。
create or replace function increment_monthly_calls_atomic(p_provider text, p_month_key text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count int;
begin
  insert into provider_status (provider, monthly_calls, month_key)
  values (p_provider, 1, p_month_key)
  on conflict (provider) do update
    set monthly_calls = case
          when provider_status.month_key = excluded.month_key
          then provider_status.monthly_calls + 1
          else 1
        end,
        month_key = excluded.month_key
  returning monthly_calls into new_count;

  return new_count;
end;
$$;

-- 僅限後端 service_role 呼叫（PostgREST RPC 預設對 anon/authenticated 也開放，這裡明確收斂）。
revoke all on function increment_monthly_calls_atomic(text, text) from public;
revoke all on function increment_monthly_calls_atomic(text, text) from anon;
revoke all on function increment_monthly_calls_atomic(text, text) from authenticated;
grant execute on function increment_monthly_calls_atomic(text, text) to service_role;

-- ── price_history 防重複安全網 ────────────────────────────────────────────────
-- price_history 建表時（schema.sql）已宣告 `unique (route, date)`；此處補一個具名唯一
-- 索引再次確保約束存在（idempotent，若欄位組合已被既有 constraint 涵蓋，額外建立同欄位
-- 唯一索引本身不影響資料，也不會破壞既有約束）。有此約束後，repository.py 的
-- upsert_price_history() insert 分支若遇併發競態撞到唯一鍵，會 catch 例外並回頭走
-- update-if-lower，維持「取最低價」語意。
create unique index if not exists idx_price_history_route_date_uniq on price_history (route, date);

-- ── 使用說明 ──────────────────────────────────────────────────────────────────
-- 請將本檔整份貼到 Supabase 專案的 SQL Editor 執行一次即可（新建函式與索引，均為
-- idempotent，可安全重複執行）。
