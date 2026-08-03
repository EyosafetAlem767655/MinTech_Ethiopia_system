-- Indexes for the department report / Brief summary access patterns.
--
-- The Brief summary and the department feeds filter and sort daily_reports and
-- material_counts by created_at (and daily_reports by the positions[] array), but
-- 0001 only indexed those tables on date_key. That left every summary query doing
-- a sequential scan + sort, and the Brief fanned that out across four departments
-- and six windows — the 30/90/180/365-day ranges timed out (504). These indexes
-- turn those hot paths into indexed range scans.

create index if not exists daily_reports_created_idx
  on daily_reports (created_at desc);

-- Department feeds match a report to a department with `positions && '{...}'`.
create index if not exists daily_reports_positions_gin
  on daily_reports using gin (positions);

create index if not exists material_counts_created_idx
  on material_counts (created_at desc);
