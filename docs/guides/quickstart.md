# Quickstart

Zero to your first skill run in 10 minutes.

## Prereqs

- Node 20+
- Docker (for Postgres)
- API key for at least one LLM provider (OpenAI or Anthropic)

## 1. Clone + install

```bash
git clone <your-compiles-core-url>
cd compiles-core
npm install
```

## 2. Configure env

```bash
cp packages/core/.env.example packages/core/.env.local
```

Edit `packages/core/.env.local` — at minimum:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/compiles
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
OPENAI_API_KEY=sk-...
```

## 3. Start infra

```bash
npm run dev:up
```

This boots Postgres + the retrieval stack (Onyx today; pgvector-native pipeline lands in Phase 5).

## 4. Apply schema + reference context

```bash
npm run db:migrate
npm run context:apply
```

The first `context:apply` seeds the reference tenant at `context/metacto/` — one agent (Ziggy), 13 skills, 4 object types, 1 workflow. You can swap in your own tenant later by setting `CONTEXT_PATH`.

## 5. Run the dev server

```bash
npm run dev:next
```

Open **http://localhost:3000** and sign in via Clerk.

## 6. Talk to an agent

Head to **/dashboard/chat** and ask Ziggy:

> *"Summarize the last discovery call."*

Ziggy will:

1. Route through the `search_everything` skill (retrieval across your Sources)
2. Pick `discovery_summary` from its wired skill catalog
3. Stream back a structured summary with citations back to the transcript

## 7. Author something

Edit a skill in your editor:

```bash
$EDITOR context/metacto/skills/discovery-summary/prompt.md
```

Apply the change:

```bash
npm run context:apply
```

Talk to Ziggy again — the new prompt is live. Every `skill_run` stamps the new `context_sha`, so any output traces back to the exact commit.

## 8. Ship it to your own tenant

Create a new context directory:

```bash
mkdir -p context/<your-org>/{sources,objects,skills,workflows,agents}
cat > context/<your-org>/context.yaml <<EOF
version: 1
orgId: <your-clerk-org-id>
name: <your-org>
EOF
```

Point the runtime at it:

```bash
CONTEXT_PATH=context/<your-org> COMPILES_ORG_ID=<clerk-org-id> npm run context:apply
```

Now everything you author under `context/<your-org>/` is scoped to your Clerk organization. When you're ready to split it into its own git repo, see [extract-tenant.md](./extract-tenant.md).

## Next

- [Authoring context](./authoring-context.md) — the full edit + apply loop
- [Concepts](../concepts/) — read all five primitives (~15 min, best ROI)
- [Writing a plugin](./writing-a-plugin.md) — when a prompt skill isn't enough
