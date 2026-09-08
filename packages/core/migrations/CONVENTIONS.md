# Migration conventions

Rules for everything in `packages/core/migrations/`. The first one is enforced
by `npm run check:migrations`, which runs in CI; the rest are on you.

## 1. Never build an index on a table that already exists

A plain `CREATE INDEX` holds a lock that blocks every write to the table until
the build finishes. On a table with real volume that is an outage in the middle
of a deploy — the app keeps serving reads and hangs on every insert.

Postgres' answer is `CREATE INDEX CONCURRENTLY`, which does not block writes but
**cannot run inside a transaction block**. Two things in this repo make that
awkward:

- drizzle's migrator applies each numbered migration in a single transaction, so
  a concurrent build there is rejected outright.
- Dev, the unit-test fixtures and the demos all migrate through PGlite, which
  cannot run a concurrent build at all — it answers `tuple concurrently
  updated` (verified 2026-09-08).

So concurrent index builds live in their own directory:

```
packages/core/migrations/
  0081_add_thing.sql              ← schema change, applied everywhere
  concurrent/
    0081_thing_lookup_index.sql   ← index build, production only
```

`concurrent/` is invisible to drizzle — its migrator only opens the files named
in `meta/_journal.json` — and `infra/aws/apply-migrations.sh` applies each one
against production straight after the numbered migration that shares its number,
outside any transaction. The match is on the filename's first four characters,
so the number needs exactly four digits and an underscore.

This only works if whatever applies migrations in a given environment knows to
look in `concurrent/`. A deploy that globs `packages/core/migrations/*.sql`
skips the directory in silence, and the index is simply never built there.
`apply-migrations.sh --verify-indexes` exists to catch that: it reads the
database and fails naming any index declared here that is missing, or that a
failed build left `INVALID`. The requirement on parent projects is written up in
`docs/deployment/parent-project-pattern.md`; `Veerio-Life/veerio-vocion` is the
open case (issue #30 there).

Dev and test then run without those indexes, which is fine for a plain index: it
changes query plans, never results. It is **not** fine for a unique one, so
`UNIQUE` is refused in `concurrent/` — uniqueness is a constraint, and dev and
the tests would happily accept rows production rejects. A unique index on a
populated table is an expand-and-contract problem (below), not an index
problem.

Write them like this:

```sql
-- concurrent/0081_thing_lookup_index.sql
-- Applied outside a transaction by infra/aws/apply-migrations.sh.
-- The DROP clears an INVALID index left behind by a build that failed
-- partway; a concurrent build that dies leaves the index in place, and
-- `IF NOT EXISTS` on its own would then skip the retry forever.
DROP INDEX IF EXISTS "thing_org_lookup_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "thing_org_lookup_idx"
  ON "thing" USING btree ("org_id", "updated_at");
```

`IF NOT EXISTS` is required, not decorative. Baselining an existing database
records only the numbered migrations, so a concurrent build can legitimately run
against a database that already has the index; without it that run dies on
`relation already exists` and takes the deploy down with it.

Only `CREATE INDEX` and `DROP INDEX` belong in `concurrent/`. Those files have no
transaction around them, so a statement that fails halfway leaves the schema
half-changed with nothing to roll back.

### Keeping `Schema.ts` in step

Declare the index in `src/models/Schema.ts` as usual — that is what the ORM and
the types read, and it is not what applies the DDL. The migrations here are
hand-written (see `0066`'s header for why `drizzle-kit generate` is not in use),
so nothing regenerates a plain `CREATE INDEX` behind your back. If generation is
ever restored, an index that lives in `concurrent/` has to be removed from the
generated migration by hand, or the lock comes back with it.

An index on a table the same migration creates needs none of this — nothing else
can be writing to a table that does not exist yet — so keep it in the numbered
migration.

Migrations `0000`-`0080` predate this rule and several of them do index a
pre-existing table. They stay as they are: an applied migration is immutable,
and drizzle decides what to apply from the journal timestamp rather than the
file contents, so editing one would change nothing in production while quietly
diverging from what actually ran. `FIRST_ENFORCED_MIGRATION_NUMBER` in
`src/scripts/check-migration-safety.ts` is where that line is drawn.

## 2. Change columns by expand and contract, never in place

A deploy is not atomic: migrations run first, then containers roll one at a
time, so old and new application code both talk to the new schema for a few
minutes. A column rename or a type change in a single migration breaks whichever
half is not deployed yet.

Split it across releases instead:

1. **Expand** — add the new column, nullable or with a default. Backfill it in
   batches, not in the migration. Write to both columns from the application.
2. **Migrate reads** — ship the code that reads the new column. Both columns
   still exist and both are written.
3. **Contract** — once no running code touches the old column, drop it in a
   later migration.

Each step is its own release. Adding a nullable column, or one with a constant
default, is metadata-only on modern Postgres and safe. A `NOT NULL` on a
populated column, a type change and a rename all rewrite or lock the table, so
they belong in step 3 at the earliest, or behind a concurrent index build and a
validated constraint.

`ALTER TABLE ... ADD UNIQUE` and `ADD PRIMARY KEY` build an index too, holding a
lock that blocks reads as well as writes, and Postgres has no concurrent form of
either — so `check:migrations` refuses them on a table the migration does not
create. `ADD CONSTRAINT ... FOREIGN KEY` is milder but not free: it scans the
whole table to validate. The check does not refuse it (43 already exist), but on
a populated table prefer `NOT VALID` followed by `VALIDATE CONSTRAINT` in a
later release.

This one is documentation, not a check — the checker cannot tell a safe column
change from an unsafe one without knowing what the running code does.

## 3. Keep migrations idempotent

Use `IF NOT EXISTS` / `IF EXISTS`. A renumbered migration, or an environment
where someone applied half of one by hand, must not wedge the whole chain on
"already exists". `0070` onwards already does this.

## 4. Hand-written migrations still need a journal entry

drizzle reads `meta/_journal.json`, not the directory listing. A numbered file
with no entry is silently never applied. `concurrent/` files are the deliberate
exception — they are meant to be invisible to drizzle.
