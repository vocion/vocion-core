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
 * SKIPPED, deliberately, and this is the whole reason the body is a skeleton:
 * the model stage is not in the tree yet. `libs/processors/candidateExtractor/
 * run.ts` is still the placeholder the registry's lazy `import()` resolves to,
 * it throws `candidate-extractor: model stage not implemented yet`, and the
 * registry is a closed map, so there is no second processor slug a fixture
 * could name to produce candidates without a model. Both halves of the gap are
 * one commit group away (the model stage, and whatever seam it offers for a
 * deterministic run), so this file is left in place with the shape it will
 * have rather than written from scratch later.
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
