# Runbook — the backup database, and how to fail over to it

The application reads and writes **one** database, named by one environment
variable: `SUPABASE_DB_URL` (see `src/lib/sql.ts`). Everything below exists so
that variable has somewhere else to point.

A nightly GitHub Action (`.github/workflows/backup-to-neon.yml`) dumps Supabase
and restores it into a Neon database, and keeps the dump file as a workflow
artifact for 30 days. There is **no dual-write**: Neon is a copy, never a second
place data lives.

## What this protects you from, and what it does not

| Risk | Covered? |
| --- | --- |
| Supabase outage | Yes — fail over, below. |
| A bad migration, a dropped table, a mass delete | Yes — restore last night's dump, or an older artifact. |
| Billing lapse / project paused | Yes. |
| Losing the last few hours of reports | **No.** The copy is as of the last run, ~03:20 EAT. |
| **Photographs** | **No.** They are in Supabase Storage. A `pg_dump` carries the rows that reference a file, not the file. |

That last row is the real limit of this setup. The rows that point at missing
photos will restore fine, and the images themselves would be gone. Every AI
verdict in the system records `checked: false` rather than failing when an image
cannot be read back, so a dashboard on a restored copy stays usable — but the
evidence behind a purchase decision would not be there.

## Which Neon account, and why no Vercel integration

**This setup does not use the Vercel ↔ Neon integration, and should not.** The
integration's job is to create a database and push its connection string into a
Vercel project's environment variables. Here, nothing in Vercel talks to Neon
day to day — the backup runs in GitHub Actions — and on the one day Vercel does
need Neon, the string is pasted in by hand. So:

- The Neon project can live in **any Neon account**, including one that has
  nothing to do with the Vercel account or with any integration already set up
  for another project. The connection string is the whole link.
- **Do not install the integration on this Vercel project.** It would write its
  own `DATABASE_URL`-style variables into the project, and a second set of
  database variables sitting next to `SUPABASE_DB_URL` is exactly how an app
  ends up talking to the wrong database without anyone noticing.
- An integration already installed for another Vercel project is unaffected —
  it manages that project's variables only.

## The two Neon connection strings

Neon gives each database two endpoints (Neon console → the project → **Connect**,
with the *Connection pooling* toggle):

| | Host looks like | Used for |
| --- | --- | --- |
| **Direct** (pooling off) | `ep-xxxx.region.aws.neon.tech` | the backup — GitHub secret `NEON_DATABASE_URL` |
| **Pooled** (pooling on) | `ep-xxxx-pooler.region.aws.neon.tech` | the app, on failover — Vercel `SUPABASE_DB_URL` |

The restore needs one session for its whole run, which a pooler cannot promise —
the same reason Supabase's pooler cannot serve `pg_dump`. The workflow refuses a
`-pooler` host for the restore, and a `:6543` host for the dump, by name.

## First-time setup

1. Log in to whichever Neon account should own the copy and create a project
   (any region; the smallest tier is enough — this holds a copy and serves no
   traffic). Check `npm run db:size` against that tier's storage limit first.
2. Leave IP allowlisting **off** on the Neon project. GitHub's runners connect
   from addresses that change every run, so an allowlist would block the backup.
   The password in the connection string is the protection; keep it only in
   GitHub secrets and Vercel.
3. In GitHub → the repository → Settings → Secrets and variables → Actions,
   add two **repository secrets**:
   - `NEON_DATABASE_URL` — Neon's **direct** string (pooling off).
   - `SUPABASE_DB_URL_DIRECT` — Supabase → Connect → **Session pooler**
     (host `aws-0-….pooler.supabase.com`, port **5432**). Not the *Transaction*
     pooler (6543), which cannot hold a session for `pg_dump`; and not the
     *Direct connection* (`db.….supabase.co`), which is IPv6-only and
     unreachable from GitHub's runners. The workflow refuses both by name.
4. Run the workflow by hand once (Actions → Nightly database backup to Neon →
   Run workflow) and read the summary line: it prints how many tables landed.
5. Keep Neon's **pooled** string somewhere you can find in an emergency (a
   password manager). It is not stored anywhere in this setup until the day it is
   needed.

Neon suspends an idle database and wakes it on the first connection, so the
first query after a quiet spell takes a second or so longer. That costs nothing
for a nightly backup, and is worth knowing on a failover day.

## Checking the copy is real

```bash
# the live database
npm run db:size
# the copy — same command, pointed elsewhere
SUPABASE_DB_URL='<neon url>' npm run db:size
```

Two table lists of the same length with the same row estimates means the copy is
good. A missing table means the restore failed part way; the workflow log says
where.

## Failing over

1. Vercel → Project → Settings → Environment Variables → `SUPABASE_DB_URL` →
   set it to the Neon connection string. **Use Neon's pooled string**, for the
   same reason the app uses Supabase's: the app opens a few connections per
   serverless invocation and `prepare: false` is already set for a pooler.
2. Redeploy (or trigger any deployment — the variable is read at request time by
   a lazily-created client, but a redeploy is the unambiguous way).
3. Check `/api/dashboard` answers and the Brief loads.
4. **Stop the backup workflow** before doing anything else: it restores *into*
   Neon with `--clean`, so leaving it on would drop the database you are now
   running on at 03:20. Actions → the workflow → ⋯ → Disable workflow.
5. Tell whoever files reports that anything submitted after the last backup ran
   needs filing again. Bot sessions live in the database too, so people will be
   asked to log in once more.

## Failing back

1. Restore Supabase (or a new Supabase project) from the most recent artifact:
   `pg_restore --no-owner --no-acl --clean --if-exists -d '<supabase direct url>' backup.dump`
2. Move anything filed while on Neon across by hand — it is a day of rows at
   most, and every table carries `created_at`, so
   `where created_at > '<failover time>'` finds it.
3. Point `SUPABASE_DB_URL` back, redeploy, re-enable the workflow.

## The lifecycle: what stays in Supabase, and for how long

The policy lives in one file, `src/lib/lifecycle.ts`. The quarterly move and
the System Admin view both read it.

| What | Stays in Supabase | Then |
| --- | --- | --- |
| Production, assets, sales, finance records | 12 full months | moved to the Neon **archive** each quarter |
| Logs (bot activity, chat usage, resolved errors, job runs) | 3 months | moved to the archive |
| Anything still owed, still in stock or still undecided | regardless of age | stays |
| Uploaded photos | 3 months **after the item is decided** | deleted (not archived) |
| Employees, logins, push devices, live bot sessions | always | never moved |

Two Neon databases, never one:

- **The copy** (`NEON_DATABASE_URL`) is replaced every night by the backup, with
  `--clean`.
- **The archive** (`NEON_ARCHIVE_URL`, a separate database such as
  `mintech_archive`) is only ever added to. The move refuses to run if the
  archive URL points at a database holding the live tables, because the nightly
  restore would wipe it.

**The quarterly move** is `.github/workflows/quarterly-archive.yml` running
`scripts/archive-to-neon.ts`, at 04:30 EAT on 1 January, April, July and
October.

- It refuses to run unless last night's backup succeeded.
- It copies each batch to the archive and confirms every row is there before
  deleting anything from Supabase.
- A failure leaves rows in both places, never in neither, and the next run
  finishes the job.
- Admins get a reminder 3 days before, in the morning summary, and a message
  listing what moved afterwards.
- Run by hand, it defaults to a dry run that only counts.

**Putting rows back:**

```bash
SUPABASE_DB_URL='<session pooler>' NEON_ARCHIVE_URL='<archive>'   npx tsx scripts/archive-restore.ts --table sales_invoices --from 2025-01-01 --to 2025-12-31
```

Restore parents before children: invoices, then `sales_credit_payments`. A
restore copies back and the archive keeps its copy, so rows still past their
keep period move out again at the next quarterly run.

**The nightly backup still covers everything.** Rows only leave Supabase after
the copy and the archive both hold them.

### Setting up the archive

1. Neon → the same project → **Databases** → **New database**. Name it
   `mintech_archive`.
2. Copy its **direct** connection string (pooling off) and add it as the GitHub
   repository secret `NEON_ARCHIVE_URL`.
3. Add `TELEGRAM_BOT_TOKEN` as a GitHub secret too. It is the same value as in
   Vercel, and it lets the backup and the move message the admins when they
   fail.
4. Actions → **Quarterly archive to Neon** → Run workflow, leaving "Count only"
   ticked. The log lists what a real run would move.

## If the concern was storage, not outages

Run `npm run db:size`, or open 🛠 System Admin → 🗄 Database in the bot.
`SUPABASE_DB_LIMIT_MB` in Vercel sets the limit the percentage is measured
against (default 500). The tables holding figures are small: a year of daily
production is 365 rows. Photos and logs are what grow, and the lifecycle above
handles both.

**Alerts.** Once a day, after the photo clean-up, the size is checked. Admins
are messaged when it crosses 80%, 90% and 100% of `SUPABASE_DB_LIMIT_MB`, daily
while it stays at or over 100%, and once when it drops back under 80%.

**Over the limit, the system keeps working.** Nothing in the application
refuses work because of this figure. The one thing that can stop it is
Supabase itself: a project that outgrows its plan's real database size is made
read-only (on the Free plan that is 500 MB). If that happens, the first failed
save messages admins ("Supabase is refusing writes"). Set
`SUPABASE_DB_LIMIT_MB` **below** the plan's real size, so the warnings come
while there is still room to act.
