-- Archive-instead-of-delete for Telegram employees.
--
-- Removing an employee from Settings used to DELETE the telegram_users row. The
-- submitted-report tables already point at the user with ON DELETE SET NULL and
-- denormalise full_name/positions onto every row, so a delete never destroyed
-- history — but it did throw away the employee record itself (name, positions,
-- last-seen), so an "archived" person vanished from the dashboard entirely.
--
-- Archiving keeps the row and marks when it was archived. Combined with
-- active=false + the existing session_epoch revocation, the person can no longer
-- sign into the bot, but their record and full submission history stay visible.

alter table telegram_users
  add column if not exists archived_at timestamptz;

-- Fast "active roster vs archived" partitioning for the Settings screen.
create index if not exists telegram_users_archived_idx
  on telegram_users (archived_at);
