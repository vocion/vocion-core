/* eslint-disable regexp/no-unused-capturing-group */
/**
 * CoreContext Agent Eval Runner
 *
 * Runs test cases against the agent endpoint and reports pass/fail.
 * Usage: npx tsx src/scripts/run-evals.ts
 */

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

// We call the agent service directly instead of HTTP (avoids auth)
// This is a server-side eval that runs in the same process

type EvalCase = {
  name: string;
  input: string;
  checks: Array<{
    name: string;
    fn: (response: string, toolCalls: any[]) => boolean;
  }>;
};

const evalCases: EvalCase[] = [
  {
    name: 'Discovery calls this week',
    input: 'What discovery calls did I have this week?',
    checks: [
      {
        name: 'Uses search_onyx tool',
        fn: (_, toolCalls) => toolCalls.some((tc: any) => tc.tool === 'search_onyx'),
      },
      {
        name: 'Searches with Zoom source filter',
        fn: (_, toolCalls) => {
          const searchCalls = toolCalls.filter((tc: any) => tc.tool === 'search_onyx');
          // At least one search should mention zoom, discovery, or MetaCTO
          return searchCalls.some((tc: any) => {
            const q = (tc.input?.query ?? '').toLowerCase();
            return q.includes('discovery') || q.includes('intro') || q.includes('zoom') || q.includes('metacto');
          });
        },
      },
      {
        name: 'Response includes dates',
        fn: response => /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(response),
      },
      {
        name: 'No raw URLs in response',
        fn: response => !response.includes('https://us06web.zoom.us/rec/play/'),
      },
      {
        name: 'No /dashboard/ paths in response',
        fn: response => !response.includes('/dashboard/objects/'),
      },
      {
        name: 'Kevin/Kristen NOT shown for "this week" (it is from January)',
        fn: (response) => {
          // If the response mentions Kevin/Kristen, it should note it's old
          if (response.includes('Kevin') && response.includes('Kristen')) {
            return response.toLowerCase().includes('january') || response.toLowerCase().includes('not this week') || response.toLowerCase().includes('old');
          }
          return true; // Not mentioned = pass
        },
      },
    ],
  },
  {
    name: 'Response format quality',
    input: 'Show me my recent Zoom meetings',
    checks: [
      {
        name: 'Uses search_onyx',
        fn: (_, toolCalls) => toolCalls.some((tc: any) => tc.tool === 'search_onyx'),
      },
      {
        name: 'Response has bullet points or numbered list',
        fn: response => /^\s*[-*\d]\.?\s/m.test(response),
      },
      {
        name: 'Response mentions durations',
        fn: response => /\d+\s*min/i.test(response),
      },
      {
        name: 'No raw URLs',
        fn: response => !response.includes('https://'),
      },
    ],
  },
  {
    name: 'Citation format',
    input: 'What do you know about the Kevin/Kristen discovery call?',
    checks: [
      {
        name: 'Response uses citation markers [N]',
        fn: response => /\[\d+\]/.test(response),
      },
      {
        name: 'Mentions duration',
        fn: response => /32\s*min/i.test(response) || /duration/i.test(response),
      },
    ],
  },
  {
    name: 'Permanent: Discovery calls week of March 16, 2026',
    input: 'What discovery calls did I have the week of March 16, 2026?',
    checks: [
      {
        name: 'Searches Zoom source',
        fn: (_, toolCalls) => toolCalls.some((tc: any) => tc.tool === 'search_onyx'),
      },
      {
        name: 'Response includes Dr. K or Unmuted (Mar 19)',
        fn: response => /Dr\.?\s*K|Unmuted/i.test(response),
      },
      {
        name: 'Response includes Matt Hurst (Mar 17)',
        fn: response => /Matt\s*Hurst/i.test(response),
      },
      {
        name: 'Response includes dates (Mar 17, Mar 19, etc.)',
        fn: response => /Mar\s*(1[6-9]|2[0-2])/.test(response),
      },
      {
        name: 'No raw URLs',
        fn: response => !response.includes('https://us06web.zoom.us'),
      },
    ],
  },
];

async function runAgent(message: string): Promise<{ response: string; toolCalls: any[] }> {
  // Import dynamically to avoid module resolution issues
  const { runAgent: runAgentFn } = await import('../services/AgentService');

  const result = await runAgentFn({
    orgId: 'org_3B7f6cPKTKnJOExO55asDaUVAay',
    agentSlug: 'sales-assistant',
    message,
  });

  return {
    response: result.response,
    toolCalls: result.toolCalls,
  };
}

async function main() {
  console.log('🧪 CoreContext Agent Eval Runner\n');
  console.log('='.repeat(60));

  // Phase 7 — DB-backed dataset path. Trigger via `--dataset <slug>`.
  const datasetFlagIndex = process.argv.indexOf('--dataset');
  if (datasetFlagIndex !== -1 && process.argv[datasetFlagIndex + 1]) {
    const datasetSlug = process.argv[datasetFlagIndex + 1]!;
    const orgArg = process.argv.indexOf('--org');
    const orgId = orgArg !== -1 && process.argv[orgArg + 1]
      ? process.argv[orgArg + 1]!
      : (process.env.VOCION_DEFAULT_ORG ?? 'org_3B7f6cPKTKnJOExO55asDaUVAay');
    const { runDataset } = await import('../services/EvalService');
    console.log(`\n→ Running dataset "${datasetSlug}" for org ${orgId}...`);
    const result = await runDataset({ orgId, datasetSlug });
    console.log(`✓ eval_run #${result.runId} complete`);
    console.log(`   metrics: ${JSON.stringify(result.metrics, null, 2)}`);
    const passRate = (result.metrics?.passRate ?? 0) as number;
    process.exit(passRate >= 0.8 ? 0 : 1);
  }

  let totalChecks = 0;
  let passedChecks = 0;
  let failedChecks = 0;

  for (const evalCase of evalCases) {
    console.log(`\n📋 ${evalCase.name}`);
    console.log(`   Input: "${evalCase.input}"`);

    try {
      const startTime = Date.now();
      const result = await runAgent(evalCase.input);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(`   ⏱  ${elapsed}s | ${result.toolCalls.length} tool calls | ${result.response.length} chars`);
      console.log(`   Tools: ${result.toolCalls.map((tc: any) => tc.tool).join(', ')}`);

      for (const check of evalCase.checks) {
        totalChecks++;
        const passed = check.fn(result.response, result.toolCalls);
        if (passed) {
          passedChecks++;
          console.log(`   ✅ ${check.name}`);
        } else {
          failedChecks++;
          console.log(`   ❌ ${check.name}`);
        }
      }
    } catch (err: any) {
      console.log(`   💥 Error: ${err.message}`);
      failedChecks += evalCase.checks.length;
      totalChecks += evalCase.checks.length;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`\n📊 Results: ${passedChecks}/${totalChecks} passed (${failedChecks} failed)`);
  console.log(`   Pass rate: ${totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0}%\n`);

  process.exit(failedChecks > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
