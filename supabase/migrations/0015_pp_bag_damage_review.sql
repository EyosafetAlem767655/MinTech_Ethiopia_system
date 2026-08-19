-- Manual review of PP bag damage reports.
--
-- The AI trust score is advice, not a decision: a photo the model could not read
-- (or could not check at all, when every provider is down) must still be
-- approvable by a person, and a convincing photo must still be rejectable. Until
-- now the report was simply filed and scored with no way to act on it, so the
-- panel could show a verdict nobody could ever accept or refuse.
alter table pp_bag_damage_reports
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  add column if not exists decided_by text,
  add column if not exists decided_at timestamptz;

create index if not exists pp_bag_damage_status_idx on pp_bag_damage_reports (status);
