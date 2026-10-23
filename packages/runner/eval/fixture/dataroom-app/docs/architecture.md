# Architecture

```
src/app.mjs              createApp(): the database, repositories, services and router, wired
src/server.mjs           an HTTP server around app.handle (local use only)
src/config.mjs           limits and product constants
src/db/                  the in-memory database, its migrations and the seed data
src/repos/               one module per table: the only code that reads or writes the database
src/services/            product rules: access, sharing, analytics, search, notifications, jobs
src/http/router.mjs      the route table and request context
src/http/routes/         one module per area; a handler gets ctx and returns a response
src/views/               HTML for the pages
src/lib/                 small shared helpers (html, time, csv, crypto, bots, ids)
```

## Rules

- Routes never touch the database: they call repositories and services.
- Every response that names a document is behind an access check. A document a person cannot see
  answers exactly like a missing one (404 `not_found`).
- Activity is recorded as views; analytics, reminders and the library page all read views.
- Events (`src/services/events.mjs`) tell other services about changes; the search index keeps
  itself current from them.
- Notifications go through `src/services/notifications.mjs`, which knows every type and the
  preference that turns it off. Nothing writes to the outbox directly.
- `src/lib/legacyDate.mjs` is deprecated in favour of `src/lib/time.mjs`; a few callers remain.
- Audit entries are written for every change a person makes to sharing or access.
