/**
 * Live-turn harness — runs a REAL agent turn against the configured DB and
 * reports what actually happened: delegation, tool calls, A2UI cards, and
 * whether the answer DUMPS raw records. This is the ground-truth check the
 * chat-answer work needs (typecheck ≠ behavior).
 *
 *   dotenv -c -- tsx --tsconfig ./tsconfig.json src/scripts/live-turn-test.ts \
 *     [--agent founder-gtm-lead] [--org <projectId>] [--msg "What should I do right now?"]
 */
import process from 'node:process';
import { parseArgs } from 'node:util';
import { runAgentDeep } from '@/services/AgentService';

type Ev = { type: string; [k: string]: unknown };

const DUMP_MARKERS = [
  // record-dump (lookup_objects)
  '/dashboard/objects', 'DATA to SYNTHESIZE', 'owed_action:', 'linkedin_url',
  'channel: linkedin', 'relationship_status', '"owed_action"', '"contact_title"',
  // search-result dump (search_knowledge)
  '[gmail]', 'Subject:', 'From:', 'semantic_identifier', '] From:',
];

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    agent: { type: 'string' }, org: { type: 'string' }, msg: { type: 'string' },
  } });
  const orgId = values.org ?? 'proj-revenue-f8429a692aab3703f82a4f15169b8662';
  const agentSlug = values.agent ?? 'founder-gtm-lead';
  const message = values.msg ?? 'What should I do right now?';

  const events: Ev[] = [];
  const t0 = Date.now();
  const res = await runAgentDeep({ orgId, agentSlug, message, userId: 'live-turn-test', onEvent: e => events.push(e as Ev) });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const byType: Record<string, number> = {};
  for (const e of events) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
  }
  const subagents = events.filter(e => e.type === 'subagent_start').map(e => e.name);
  const recs = events.filter(e => e.type === 'recommended_action').map(e => (e.recommendation as { label: string }).label);
  const hits = DUMP_MARKERS.filter(m => res.response.includes(m));

  console.warn('\n===== LIVE TURN REPORT =====');
  console.warn(`agent=${agentSlug}  msg="${message}"  took=${secs}s`);
  console.warn('events:', JSON.stringify(byType));
  console.warn('tool calls:', res.toolCalls.map(t => t.tool).join(', ') || '(none)');
  console.warn('delegated to:', subagents.join(', ') || '(none — answered directly) ✓');
  console.warn(`recommend_action cards: ${recs.length}${recs.length ? ` → ${JSON.stringify(recs)}` : ' ✗ (none)'}`);
  console.warn('DUMP markers in answer:', hits.length ? `✗ ${JSON.stringify(hits)}` : 'NONE ✓');
  console.warn(`response length: ${res.response.length}`);
  console.warn('\n--- response (first 1400 chars) ---\n' + res.response.slice(0, 1400));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
