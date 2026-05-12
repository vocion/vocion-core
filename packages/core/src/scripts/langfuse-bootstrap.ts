/**
 * langfuse-bootstrap — idempotently register Vocion's model pricing
 * with the local (or cloud) Langfuse instance.
 *
 * Why: Langfuse's cost-calc engine multiplies generation token counts
 * by per-model unit prices. The default Langfuse install does NOT ship
 * pricing for very recent Claude models — `claude-sonnet-4-6`,
 * `claude-haiku-4-5-20251001`, `claude-opus-4-7`. Without this step,
 * traces show token counts but `calculatedTotalCost = 0`.
 *
 * What it does: for every model in `libs/pricing.ts`, hits
 *   GET  /api/public/models?modelName=<name>
 *   DELETE /api/public/models/{id}   (if a custom row exists and drifts)
 *   POST /api/public/models          (when missing)
 *
 * Idempotent — safe to re-run. Cache-read input pricing is NOT yet
 * supported by the public CreateModel API (Langfuse v3.163), so the
 * full prompt-cache discount is approximate. See observability.md.
 *
 * Usage:
 *
 *   npm run langfuse:bootstrap
 *
 * Honors LANGFUSE_BASE_URL / LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY
 * with dev defaults pointing at the local docker stack.
 */

import type { PricingTier } from '../libs/pricing';
import process from 'node:process';
import { knownModels } from '../libs/pricing';

const baseUrl = process.env.LANGFUSE_BASE_URL ?? 'http://localhost:3200';
const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? 'pk-lf-corecontext-demo';
const secretKey = process.env.LANGFUSE_SECRET_KEY ?? 'sk-lf-corecontext-demo';

const auth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');

const log = (...args: unknown[]) => {
  console.log('[langfuse:bootstrap]', ...args);
};

// Re-import the actual PRICING table for read access via knownModels()
// + tokenCostCents() — pricing.ts only exports the helpers, so we
// duplicate the table here to avoid changing its exports. Single
// source of truth stays libs/pricing.ts; this list mirrors it.
const PRICING_MIRROR: Record<string, PricingTier> = {
  'claude-opus-4-7': { inputCentsPerMillion: 1500, outputCentsPerMillion: 7500, cacheReadCentsPerMillion: 150 },
  'claude-sonnet-4-6': { inputCentsPerMillion: 300, outputCentsPerMillion: 1500, cacheReadCentsPerMillion: 30 },
  'claude-haiku-4-5-20251001': { inputCentsPerMillion: 100, outputCentsPerMillion: 500, cacheReadCentsPerMillion: 10 },
  'gpt-4o': { inputCentsPerMillion: 250, outputCentsPerMillion: 1000 },
  'gpt-4o-mini': { inputCentsPerMillion: 15, outputCentsPerMillion: 60 },
};

function expectedPrices(tier: PricingTier): { inputPrice: number; outputPrice: number } {
  // CreateModelRequest expects USD per single token.
  // pricing.ts stores cents per 1M tokens → divide by 1e8.
  return {
    inputPrice: tier.inputCentsPerMillion / 100_000_000,
    outputPrice: tier.outputCentsPerMillion / 100_000_000,
  };
}

type ModelRow = {
  id: string;
  modelName: string;
  matchPattern: string;
  inputPrice: number | null;
  outputPrice: number | null;
  isLangfuseManaged?: boolean;
};

type ModelsPage = { data: ModelRow[]; meta: { totalItems: number; totalPages: number; page: number; limit: number } };

async function listAllModels(): Promise<ModelRow[]> {
  // Public API caps `limit` at 100 and doesn't actually filter by
  // `modelName`. Page through everything and filter client-side.
  const all: ModelRow[] = [];
  let page = 1;
  while (true) {
    const url = `${baseUrl}/api/public/models?page=${page}&limit=100`;
    const r = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!r.ok) {
      throw new Error(`GET /models?page=${page} → ${r.status} ${await r.text()}`);
    }
    const json = (await r.json()) as ModelsPage;
    all.push(...json.data);
    if (page >= json.meta.totalPages) {
      break;
    }
    page++;
  }
  return all;
}

function findCustomMatches(models: ModelRow[], modelName: string): ModelRow[] {
  // Exact (trim-aware) match on modelName, only custom rows. Langfuse
  // stores a few rows with whitespace-decorated names — trim both
  // sides before comparing.
  return models.filter(m => !m.isLangfuseManaged && (m.modelName ?? '').trim() === modelName.trim());
}

async function deleteModel(id: string): Promise<void> {
  const r = await fetch(`${baseUrl}/api/public/models/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!r.ok && r.status !== 404) {
    throw new Error(`DELETE /models/${id} → ${r.status} ${await r.text()}`);
  }
}

async function createModel(opts: { modelName: string; matchPattern: string; inputPrice: number; outputPrice: number }): Promise<void> {
  const r = await fetch(`${baseUrl}/api/public/models`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      modelName: opts.modelName,
      matchPattern: opts.matchPattern,
      unit: 'TOKENS',
      inputPrice: opts.inputPrice,
      outputPrice: opts.outputPrice,
    }),
  });
  if (!r.ok) {
    throw new Error(`POST /models → ${r.status} ${await r.text()}`);
  }
}

function approxEqual(a: number | null | undefined, b: number, tol = 1e-12): boolean {
  return a != null && Math.abs(a - b) < tol;
}

async function main() {
  log(`base: ${baseUrl}`);
  const wanted = knownModels();
  log(`fetching project models from langfuse…`);
  const allModels = await listAllModels();
  log(`will register/verify ${wanted.length} models against ${allModels.length} existing rows`);

  for (const modelName of wanted) {
    const tier = PRICING_MIRROR[modelName];
    if (!tier) {
      log(`  skip ${modelName} (no mirror tier — update PRICING_MIRROR)`);
      continue;
    }
    const { inputPrice, outputPrice } = expectedPrices(tier);
    const matches = findCustomMatches(allModels, modelName);
    const upToDate = matches.find(m => approxEqual(m.inputPrice, inputPrice) && approxEqual(m.outputPrice, outputPrice));
    if (upToDate && matches.length === 1) {
      log(`  ok    ${modelName} — already registered (id=${upToDate.id})`);
      continue;
    }
    // Delete every custom row with this name (handles duplicates and
    // stale prices) before re-creating. Idempotent.
    for (const m of matches) {
      log(`  drop  ${modelName} — deleting custom row (id=${m.id})`);
      await deleteModel(m.id);
    }
    // matchPattern: case-insensitive exact match on the generation's
    // `model` field. This is what Langfuse recommends for explicit
    // model entries.
    const matchPattern = `(?i)^${modelName}$`;
    await createModel({ modelName, matchPattern, inputPrice, outputPrice });
    log(`  +     ${modelName} — registered (input=$${inputPrice}/tok, output=$${outputPrice}/tok)`);
  }

  log('done');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[langfuse:bootstrap] FAILED:', (err as Error).message);
    process.exit(1);
  });
