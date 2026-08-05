-- Per-session edit-window state for the 5-minute correction feature.
--
-- After an employee submits a report, the bot keeps a reference to that record
-- ({ table, id, at, capKey }) plus, while a correction is in progress, a
-- `pending` target. The corrected submission replaces the old row only when it
-- arrives, so an abandoned edit never loses data. Stored as jsonb, mirroring the
-- existing capture/draft session columns.

alter table telegram_sessions
  add column if not exists edit_state jsonb;
