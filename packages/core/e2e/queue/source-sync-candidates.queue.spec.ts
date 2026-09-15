import { test } from '@playwright/test';

/**
 * A source sync that produces review candidates, end to end over real HTTP:
 *
 *   POST /api/v1/sources          → a source over a local fixture directory
 *   POST /api/v1/sources/:slug/sync (or `sync-source.ts` by execFileSync)
 *   GET  /api/v1/reviews          → one card per event in the fixtures
 *   re-sync                       → 0 new, N refreshed
 *   decide one, re-sync           → that one comes back `already_decided`
 *
 * Zero tokens: the processor's model stage is replaced by a deterministic
 * extractor over fixture pages, so nothing here calls out.
 *
 * SKIPPED, deliberately: the model stage exists (libs/processors/
 * candidateExtractor/run.ts), but it has no seam for a deterministic run.
 * A zero-token e2e needs a fake extractor the registry can name, or a
 * `model` override on the processor config, and neither exists yet. The
 * shape below is what the spec will have once one does.
 *
 * To finish it, in this order:
 *   1. Register the source with `POST /api/v1/sources`, `kind: 'local-files'`,
 *      pointed at a fixture directory of event pages, declaring
 *      `processor: { slug: 'candidate-extractor', config: … }`. The token needs
 *      `manage_sources` (see `app/api/v1/_shared.ts`).
 *   2. Drive the sync. `POST /api/v1/sources/:slug/sync` is asynchronous, so
 *      either poll `GET /api/v1/sources` until `run.status === 'completed'` or
 *      run `src/scripts/sync-source.ts` synchronously by `execFileSync`, the
 *      way the propose specs run their seeder.
 *   3. Assert one queue card per fixture event, then the re-sync counts, then
 *      `already_decided` after a decision, the same three outcomes
 *      `objects-propose-candidate.queue.spec.ts` already pins for the action
 *      itself, here reached through a sync instead of a direct propose.
 *
 * Run with: npx playwright test --project=queue
 */

test.skip('a source sync proposes one candidate per event, refreshes on re-sync, and reports already_decided after a decision', async () => {
  // Intentionally empty, see above.
});
