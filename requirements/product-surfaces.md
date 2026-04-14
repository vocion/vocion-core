# Product Surfaces

Spec for the in-product UI surfaces. Each entry is tagged with status:

- ✓ shipped
- ◐ partial
- ◇ planned

The chat UI is a *work* UI, not just a chat app. Surfaces compose: an answer in Ask should be one click from the action that follows from it.

## 1. Conversation Pane (Ask) ◐

The obvious piece, but not the whole product. Today it's the Ziggy chat at `/dashboard/ziggy`; the broader Ask surface is partial.

| Requirement | Status |
|---|---|
| Streaming answers | ✓ |
| Source-backed citations | ✓ |
| Follow-up suggestions | ◇ |
| Visible scope controls | ◐ |
| Saved/pinned context | ◇ |
| Thread history | ◐ |

## 2. Context Drawer ◐

Critical for trust. Every answer should be explorable through a side panel surfacing the evidence.

Shows: source documents · Slack/Teams threads · CRM/account records · tickets · linked business objects · related runs or prior answers. Today the Ziggy sidebar shows source cards; the unified drawer pattern across Ask + Search is planned.

The user should be able to navigate the evidence, not just click raw links.

## 3. Action Bar ◇

Where answers turn into work. Every useful answer should have nearby next steps:

- Create ticket
- Send follow-up
- Update CRM record
- Generate report
- Route to approver
- Open workflow

The contextual-action UX (business-object markup `<<discovery:...>>` rendered as hover popovers) is the start of this.

## 4. Foundation ✓

The business-context view at `/dashboard/foundation`. Renders connectors, object types + counts, source systems, and (coming) relationships, rules, system-of-record decisions, data-quality findings. This is the unified Context Map deliverable.

## 5. Skills ◐

Catalog at `/dashboard/skills`. Today: list + per-skill detail + run-now form. Planned: edit-in-place (read-through to git), run history per skill.

## 6. Workflows ◐

Today: list + run start via MCP `workflow_run_start`. Planned: in-product trigger + run history at `/dashboard/runs`. Workflow builder UI is Phase 7 (meta-agent generates workflows from natural language).

## 7. Review Queue ✓

`/dashboard/review` — one queue for every pending decision: skill drafts awaiting approval and workflow runs paused at `approve` steps. Approve, reject, resume, cancel from one surface. Mirrored in MCP via `runtime_approve_draft` etc.

## 8. Source + Scope Controls ◐

Trust rises when users can clearly control which systems / teams / time range / business object / agent is in scope. Onyx provides the search-side filters today; the unified scope-control UX is planned.

## 9. Memory + Session State ◇

- Recent searches
- Saved workflows
- Pinned objects
- Reusable scopes
- Draft outputs
- Reopened prior runs

## 10. Feedback ◇

Every surface should collect: thumbs up/down · "wrong source" · "stale answer" · "missing system" · "bad action" · freeform correction. Feeds the improvement loop ([Phase 4](../docs/internal/roadmap.md)).

## 11. Docs ✓

In-product viewer at `/dashboard/docs` — renders every markdown file under `docs/`, `requirements/`, `context/`. Internal-only docs (`docs/internal/`) shown only to authenticated users; public docs site at `/docs` filters those out.

## 12. Connectors ✓

`/dashboard/connectors` — connector + indexing status, sourced from Onyx admin API today, pgvector-native next.

## What stays out of the default UI

These are managed-service territory and admin-only at first:

- Raw prompt editor (use git + `context:apply` instead)
- Chunking / embedding settings (configured via `retrieval.yaml`)
- Retrieval weights (config, not UI)
- Model routing (per-skill `provider` field in YAML)
- Secret management (env or vault, not in-app)
- Low-level connector retries (handled by the connector plugin)
