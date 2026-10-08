/**
 * Boot check — answers 200 once the app serves requests, and says whether the
 * database answered. CI's image check (`.github/workflows/app-image.yml`)
 * needs only the 200.
 *
 * Unauthenticated, so it reports nothing about the installation: no user
 * count, no working directory, no database error text. On a host serving
 * several companies those are process-wide facts about all of them. The
 * demo sandbox (`VOCION_DEMO_SEED_DIR` set) also gets the seed-path
 * diagnostics it was written for — how the pglite:// boot resolved inside
 * this runtime — since a demo box serves no one but the demo.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const report: Record<string, unknown> = { ok: true };
  try {
    const { db } = await import('@/libs/DB');
    await db.execute(sql`select 1`);
    report.db = 'ok';
  } catch {
    report.db = 'error';
  }
  const seed = process.env.VOCION_DEMO_SEED_DIR;
  if (seed) {
    const candidates = [
      // turbopackIgnore: this path is only known at runtime, so the build must not
      // trace it, or Next copies the whole project into the image (next.config.ts, #832).
      join(/* turbopackIgnore: true */ process.cwd(), seed),
      join(process.cwd(), 'packages', 'core', seed),
    ];
    report.seed = candidates.map(c => ({ path: c, exists: existsSync(/* turbopackIgnore: true */ c) }));
    report.databaseUrl = (process.env.DATABASE_URL ?? '').split('://')[0];
    report.llmMode = process.env.VOCION_LLM_MODE ?? 'live';
  }
  return NextResponse.json(report);
}
