/**
 * e2e-demo — the RevOps demo as an executable end-to-end test.
 *
 * Fires the two flagship checks the automations run on their schedules —
 * the daily revenue briefing and the CRM email sweep — waits for each to
 * complete, and ASSERTS the outputs are demo-worthy:
 *
 *   1. Briefing check → run completes; output covers leads, opportunities,
 *      and today's moves (section names are prompts, not string contracts —
 *      we assert on robust lowercase keywords).
 *   2. Sweep check → run completes; any CRM updates it found are queued as
 *      pending action_run rows WITH confidence envelopes (never auto-applied).
 *
 * Run anywhere the app's env works (local dev DB, or inside the prod worker
 * container). Exits non-zero on any failed expectation, printing a scorecard.
 *
 *   npm run e2e:demo                # target org from --project / sole project
 *   npx dotenv -c -- tsx src/scripts/e2e-demo.ts --project <id|slug>
 */

import process from 'node:process';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, missionRunSchema, projectSchema } from '@/models/Schema';

type CheckResult = { name: string; pass: boolean; detail: string };
const results: CheckResult[] = [];

function expect(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name} — ${detail}`);
}

async function resolveOrgId(): Promise<string> {
  const flag = process.argv.indexOf('--project');
  const wanted = flag >= 0 ? process.argv[flag + 1] : undefined;
  const projects = await db.select().from(projectSchema);
  if (wanted) {
    const hit = projects.find(p => p.id === wanted || p.slug === wanted);
    if (!hit) {
      throw new Error(`project "${wanted}" not found`);
    }
    return hit.id;
  }
  if (projects.length === 1) {
    return projects[0]!.id;
  }
  throw new Error(`multiple projects — pass --project <id|slug>. Found: ${projects.map(p => p.slug).join(', ')}`);
}

async function runCheck(orgId: string, missionSlug: string): Promise<{ runId: number; status: string; output: string }> {
  const { getMission, scheduledCheckBrief, startMission } = await import('@/services/MissionService');
  const template = await getMission(orgId, missionSlug);
  if (!template) {
    throw new Error(`mission "${missionSlug}" not found — is the workspace applied?`);
  }
  const run = await startMission({
    orgId,
    missionSlug,
    brief: scheduledCheckBrief(template),
    title: `E2E check: ${template.name}`,
    mode: 'check',
    invokedBy: 'e2e-demo',
  });
  const [row] = await db.select().from(missionRunSchema).where(eq(missionRunSchema.id, run.id));
  const output = (row?.plan?.tasks ?? []).map(t => t.output ?? '').join('\n');
  return { runId: run.id, status: row?.status ?? 'unknown', output };
}

async function main(): Promise<void> {
  const orgId = await resolveOrgId();
  console.log(`\n═══ E2E demo — org ${orgId} ═══\n`);

  /* 1 ── Daily revenue briefing */
  console.log('▶ Firing: daily-revenue-briefing check (the 12:00 UTC automation pass)…');
  const briefStart = Date.now();
  const brief = await runCheck(orgId, 'daily-revenue-briefing');
  const briefText = brief.output.toLowerCase();

  expect('briefing run completes', brief.status === 'completed', `run ${brief.runId} → ${brief.status} in ${Math.round((Date.now() - briefStart) / 1000)}s`);
  expect('briefing covers leads', /lead/.test(briefText), 'mentions leads');
  expect('briefing covers opportunities/deals', /opportunit|deal/.test(briefText), 'mentions opportunities or deals');
  expect('briefing recommends moves', /today|move|action|priorit/.test(briefText), 'contains prioritized moves');
  expect('briefing has substance', brief.output.length > 500, `${brief.output.length} chars of output`);

  /* 2 ── CRM email sweep */
  console.log('\n▶ Firing: crm-email-sweep check (the business-hours automation pass)…');
  const sweepStart = new Date();
  const sweep = await runCheck(orgId, 'crm-email-sweep');

  expect('sweep run completes', sweep.status === 'completed', `run ${sweep.runId} → ${sweep.status} in ${Math.round((Date.now() - sweepStart.getTime()) / 1000)}s`);
  expect('sweep reports its pass', /thread|scan|movement|sweep|proposal/i.test(sweep.output), 'summary mentions the sweep');

  // Proposals created DURING this sweep — pending in the review queue, with
  // confidence envelopes. Zero is legitimate when nothing moved; assert shape
  // only when rows exist, and record the count either way.
  const proposals = await db
    .select()
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      gt(actionRunSchema.createdAt, sweepStart),
    ));
  const withConfidence = proposals.filter(p => typeof p.proposal?.confidence === 'number');

  expect(
    'sweep proposals ride the review queue',
    proposals.every(p => p.status === 'pending' || p.status === 'rejected'),
    `${proposals.length} proposal(s) this pass — none auto-applied`,
  );

  if (proposals.length > 0) {
    expect('proposals carry confidence envelopes', withConfidence.length === proposals.length, `${withConfidence.length}/${proposals.length} scored`);

    for (const p of withConfidence.slice(0, 3)) {
      console.log(`   · ${p.actionId} — ${Math.round((p.proposal!.confidence ?? 0) * 100)}% — ${(p.proposal!.rationale ?? '').slice(0, 80)}`);
    }
  } else {
    console.log('   · no CRM movement detected this pass (legitimate on a quiet inbox)');
  }

  /* Scorecard */
  const failed = results.filter(r => !r.pass);
  console.log(`\n═══ ${results.length - failed.length}/${results.length} checks passed ═══`);
  if (failed.length > 0) {
    console.log(`FAILED: ${failed.map(f => f.name).join(' · ')}`);
    process.exit(1);
  }
  console.log('Demo-ready: the briefing and the sweep both run end to end.');
  process.exit(0);
}

main().catch((e) => {
  console.error('E2E demo crashed:', e?.message ?? e);
  process.exit(1);
});
