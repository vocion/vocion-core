# Add-a-primitive checklist (vocion-core)

The proven layering for a new top-level primitive. Use an existing one as the template
(Workflow for structured, **Mission** for open-ended team work).

| Layer | File(s) | Notes |
|---|---|---|
| Schema | `models/Schema.ts` | catalog table (`<thing>`) + execution table (`<thing>_run`); jsonb for flexible state; `org_id` scope; stamp `workspace_sha`; add `relations`. |
| Migration | `migrations/00NN_<name>.sql` + `meta/_journal.json` | **Hand-write** it — `drizzle-kit generate` is blocked by a pre-existing `0021/0022` snapshot collision. Match existing DDL (FK + index style). Add a journal entry (next idx). |
| Service + runtime | `services/<Thing>Service.ts` + `services/<thing>/*` | public API (start/get/list/resume/cancel/feedback…) + the runtime. Reuse `runAgentDeep` to dispatch agents, `write_todos`/subagents for team/task-graph, `request_human_review` for HITL, learnings + budgets. |
| oRPC router | `routers/<Thing>.ts` + register in `routers/index.ts` | `os.input(z…).handler(async ({input}) => { const {orgId,userId} = await guardAuth(); … })`. |
| MCP tools | `interfaces/mcp/tools/<thing>-tools.ts` + register in `server.ts` | `ToolModule[]` with `inputSchema` (ZodRawShape) + `handler`. |
| Workspace authoring | `libs/workspace/{schemas,loader,applier}.ts` | `<Thing>ManifestSchema`; load `workspace/<org>/<things>/*.yaml`; `upsert<Thing>`; add to `counts`; seed templates in `workspace/<org>/<things>/`. |
| Dashboard UI | `app/[locale]/(auth)/dashboard/<things>/` | server pages call services directly; client components call `client.<thing>.*` from `@/libs/Orpc`. Reuse `TitleBar` (title/description only), `EmptyState`, `StatusPill`. |
| Sidebar | `features/dashboard/AppSidebar.tsx` | add a nav item with a lucide icon; use a **literal title** to avoid `check:i18n` churn (or add keys to `locales/en.json`). |
| Tests | colocated `*.test.ts` | unit-test pure logic (planners, policies); smoke-test the service with a mocked agent run. |

Verify after each layer: `npm run check:types`. Lint new files with `npx eslint --fix`. Don't do a
blanket find/replace that could hit unrelated `*Context`/`ctx` identifiers — scope renames to
specific tokens. `db:migrate` needs a live Postgres (not always available locally).
