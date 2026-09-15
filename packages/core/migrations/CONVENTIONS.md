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
failed build left `INVALID`. A deploy that applies migrations its own way should
end with it. The requirement on parent projects, and the reason a project should
call core's applier rather than reimplement the loop, is written up in
`docs/deployment/parent-project-pattern.md`.

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

## 5. Two branches that claim the same number: renumber, do not merge

Migration numbers are allocated by whoever writes the file, so two branches
opened the same day both take the next free one. The collision does not surface
until the second one merges, and then it surfaces as a git conflict in
`meta/_journal.json` — two entries with the same `idx` and different `tag`s,
inside a JSON array where the conflict markers land in the middle of an object.

**Resolve it by renumbering the later migration to the tail of the sequence, not
by editing the conflict into something that merges.** Concretely, for a branch
whose `0085_thing.sql` collides with a `0085_other.sql` that reached `main`
first:

1. `git mv` the file to the next free number — `0086_thing.sql`.
2. Restore `meta/_journal.json` to exactly what `main` says it is, rather than
   hand-editing the conflicted hunk into something that parses.
3. Append one fresh entry for the renamed migration: `idx` one past the last,
   `tag` matching the new filename, and a `when` later than the entry before it.
   Keep the array sorted by `idx` — that is the order the migrator walks.
4. If the migration has a `concurrent/` sibling, rename that too — the applier
   matches on the filename's first four characters, so a stale number silently
   detaches the index build from its migration.

Why renumbering rather than hand-merging the conflict: drizzle decides what to
apply from the journal, and what is already applied from what it recorded when
it ran — not from the file contents (same reason rule 1 leaves `0000`-`0080`
alone). An environment that already applied the entry that reached `main` first
has therefore recorded that number as done, and a second, different file sitting
at the same `idx` is at best skipped in silence and at worst applied to some
environments and not others, with nothing in the repo showing which. Renumbering
keeps the sequence append-only, which is what every applier here assumes. It
costs nothing, because a migration that has not reached `main` yet has not been
applied anywhere — the immutability rule starts at merge, not at authoring.

This is not hypothetical: resolving [#253](https://github.com/vocion/vocion-core/pull/253)
against `main` hit exactly this at `idx` 84/85, and the fix was to renumber the
branch's migration to `0086_agent_persona` and re-append its journal entry.
