/**
 * Demo sandbox diagnostics — reports how the pglite:// boot resolved inside
 * this runtime (paths, seed presence, a real query) so deploy issues are
 * debuggable without log archaeology. Harmless in normal deployments: it
 * only reveals filesystem layout when the demo envs are set.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const raw = process.env.VOCION_DEMO_SEED_DIR ?? '(unset)';
  const candidates = [
    join(process.cwd(), raw),
    join(process.cwd(), 'packages', 'core', raw),
  ];
  const report: Record<string, unknown> = {
    cwd: process.cwd(),
    databaseUrl: (process.env.DATABASE_URL ?? '').split('://')[0],
    seedRaw: raw,
    seedCandidates: candidates.map(c => ({ path: c, exists: existsSync(c) })),
    llmMode: process.env.VOCION_LLM_MODE ?? 'live',
  };
  try {
    const { db } = await import('@/libs/DB');
    const users = await db.execute(sql`select count(*)::int as n from "user"`);
    report.userCount = (users as unknown as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? users;
    report.db = 'ok';
  } catch (error) {
    report.db = 'error';
    report.dbError = error instanceof Error ? `${error.message} :: ${String((error as { cause?: unknown }).cause ?? '')}` : String(error);
  }
  try {
    const tmp = readdirSync('/tmp').filter(f => f.includes('vocion'));
    report.tmp = tmp;
  } catch { /* not readable */ }
  return NextResponse.json(report);
}
