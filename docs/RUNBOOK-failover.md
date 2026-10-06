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

## If the concern was storage, not outages

Run `npm run db:size`. The tables holding figures are small — a year of daily
production is 365 rows. If a table is large it will be one holding photo
references, logs or bot activity, and the fix is retention, not another
database: see `src/lib/archive.ts` and `PP_BAG_RETENTION_DAYS`. Image **files**
are counted separately in that script's output, under Storage.
