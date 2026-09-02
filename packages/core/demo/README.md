# Demo sandbox fixtures

Everything the hosted demo (demo.vocion.ai) serves, baked at record time:

- `workspace/` — the acme-revops demo workspace (3 agents). Committed.
- `llm-cache/` + `turns/` — recorded LLM generations + whole-turn fixtures
  (VOCION_LLM_MODE=record). Committed.
- `seed-db/` — the seeded PGlite data dir (org, users, 90d adoption
  activity, 14 business objects, recorded runs). NOT committed (32MB);
  present locally and uploaded by `vercel deploy`. Rebuild:

```bash
npx pglite-server --extensions=vector --db=demo/seed-db --port=5544 &
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5544/vocion npx drizzle-kit migrate
kill %1
export DATABASE_URL=pglite://$PWD/demo/seed-db
npx tsx src/scripts/seed-demo.ts --email admin@acme.test --password demo123 \
  --account-name "Acme Demo" --account-slug acme-demo \
  --project-slug acme-revops --project-name "Acme RevOps"
npx tsx src/scripts/seed-adoption-demo.ts
npx tsx src/scripts/apply-workspace.ts $PWD/demo/workspace --project acme-revops --applied-by demo-seed
npx tsx demo/seed-objects.ts   # also grants object types to the agents
# then re-record turns with VOCION_LLM_MODE=record + real keys (see turnReplay.ts)
```

Serving env (Vercel project `vocion-demo`):
  DATABASE_URL=pglite:///tmp/vocion-demo-db
  VOCION_DEMO_SEED_DIR=demo/seed-db        # copied to /tmp on every cold start = auto-reset
  VOCION_LLM_MODE=replay
  VOCION_LLM_CACHE_DIR=demo/llm-cache
  WORKSPACE_PATH=demo/workspace
  VOCION_DISABLE_RUNTIME=1  VOCION_DISABLE_AGENTCORE=1
  VOCION_DEMO_HINT_EMAIL=admin@acme.test  VOCION_DEMO_HINT_PASSWORD=demo123
