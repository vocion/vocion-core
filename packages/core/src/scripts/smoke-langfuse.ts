/**
 * smoke-langfuse — boot-time check that the local Langfuse stack
 * accepts a trace and returns it via the public API.
 *
 * Usage:
 *
 *   npm run langfuse:smoke
 *
 * Defaults to the dev project keys baked into the platform compose
 * (`pk-lf-corecontext-demo` / `sk-lf-corecontext-demo`,
 * `http://localhost:3200`); override via the standard
 * LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL envs.
 *
 * Exits non-zero on any failure so it's safe to use in CI / dev:up
 * hooks.
 */

import process from 'node:process';
import { langfuse } from '../libs/Langfuse';

const baseUrl = process.env.LANGFUSE_BASE_URL ?? 'http://localhost:3200';
const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? 'pk-lf-corecontext-demo';
const secretKey = process.env.LANGFUSE_SECRET_KEY ?? 'sk-lf-corecontext-demo';

const log = (...args: unknown[]) => {
  console.log('[langfuse:smoke]', ...args);
};

async function main() {
  log(`base: ${baseUrl}`);

  // Probe health first — fail fast with a readable message rather than
  // a generic SDK error.
  const health = await fetch(`${baseUrl}/api/public/health`).catch((err) => {
    throw new Error(`Cannot reach ${baseUrl}/api/public/health — is the platform stack up? (${(err as Error).message})`);
  });
  if (!health.ok) {
    throw new Error(`Health probe returned ${health.status}`);
  }
  log('health OK');

  const trace = langfuse.trace({
    name: 'smoke:langfuse',
    metadata: { source: 'smoke-langfuse', timestamp: new Date().toISOString() },
    tags: ['smoke'],
  });

  const gen = trace.generation({
    name: 'smoke:generation',
    model: 'claude-haiku-4-5-20251001',
    input: 'ping',
  });
  gen.end({
    output: 'pong',
    usage: { input: 1, output: 1 },
  });

  const span = trace.span({ name: 'smoke:span', input: { step: 1 } });
  span.end({ output: { step: 1, ok: true } });

  trace.update({ output: { ok: true } });

  await langfuse.flushAsync();
  log(`flushed trace id=${trace.id}`);

  // Confirm the trace is visible via the public API. Langfuse v3 lands
  // traces through the worker → clickhouse pipeline, which can lag a
  // few seconds after `/api/public/ingestion` returns 207. Poll up to
  // 30 s.
  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');
  const start = Date.now();
  let found = false;
  while (Date.now() - start < 30_000) {
    const r = await fetch(`${baseUrl}/api/public/traces/${trace.id}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (r.status === 200) {
      found = true;
      break;
    }
    if (r.status !== 404) {
      const body = await r.text();
      throw new Error(`Unexpected status ${r.status} reading trace: ${body}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }

  if (!found) {
    throw new Error(`Trace ${trace.id} never appeared in /api/public/traces within 30 s — ingestion pipeline may be stalled.`);
  }

  log(`trace landed: ${baseUrl}/project/demo/traces/${trace.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[langfuse:smoke] FAILED:', (err as Error).message);
    process.exit(1);
  });
