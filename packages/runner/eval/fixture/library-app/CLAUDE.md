# Northwind Library

A small document library: people in a library upload documents and send share links; a visitor
opens a link without an account. Plain Node 22, ES modules, no dependencies.

## Where things live

- `src/data.mjs`: the seed data. `seed()` returns a fresh copy; `NOW` is the fixed clock.
- `src/store.mjs`: `createStore(data)` holds the data in memory (`store.db`) and the queries.
  `store.now()` is the clock every rule reads; never read the system clock.
- `src/api.mjs`: `handle(store, { method, path, query, body, userId })` returns `{ status, body }`.
  Every HTTP route lives here. A visitor (no account) opens `/l/<link id>`.
- `src/web/pages.mjs`: `libraryPage(store, userId, options)`, `documentPage(store, userId, id)`
  and `linkPage(store, linkId, options)` return HTML strings.
- `src/web/format.mjs`: small formatting helpers.
- `test/`: node:test suites. Run `npm test`.

## Rules

- Keep the exported names above: other code and the checks call them.
- Every new rule gets a test in `test/`.
- Dates are UTC. Copy is short and plain.
