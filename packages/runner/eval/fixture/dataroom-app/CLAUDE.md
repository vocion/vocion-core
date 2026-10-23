# Northwind Dataroom

A document-sharing product: people in a library upload documents and share them through tracked
links; recipients open a link page; owners see who opened what and get reminders sent.

Read `docs/architecture.md` first: it says where each kind of code lives and the rules the
codebase keeps. Product rules (reminders, retention, privacy) are in `docs/`.

## Working here

- Plain Node 22 ESM, no dependencies. Do not add any.
- `npm test` runs `test/*.test.mjs` with `node:test`. Keep it green and add tests for every rule
  you add, beside the existing ones.
- The database is in memory, but its schema is real: a table only takes the columns its
  migrations created. A schema change is a new file in `src/db/migrations/` and an entry in
  `src/db/migrations/index.mjs`, never an edit to a migration that has shipped.
- Dates are shown and keyed in UTC.
- Keep exported names stable: other code and tests import them.
