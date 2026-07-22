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
  const recs = events.filter(e => e.type === 'recommended_action').map(e => (e.recommendation as { label: string }).label);
  const hits = DUMP_MARKERS.filter(m => res.response.includes(m));

  // Typed trace analysis — fold trace_node events by id (last status wins).
  type Node = { id: string; parentId?: string; actor: { id: string; kind: string; name: string }; kind: string; status: string; label: string; result?: string; citations?: Array<{ sourceType: string; title: string; actorId: string }> };
  const nodeMap = new Map<string, Node>();
  const nodeDeltas = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'trace_node') {
      continue;
    }
    const n = e as unknown as Node & { delta?: string };
    const prev = nodeMap.get(n.id);
    nodeMap.set(n.id, { ...prev, ...n, citations: n.citations ?? prev?.citations });
    if (n.delta) {
      nodeDeltas.set(n.id, (nodeDeltas.get(n.id) ?? 0) + n.delta.length);
    }
  }
  const nodes = [...nodeMap.values()];
  const kinds: Record<string, number> = {};
  for (const n of nodes) {
    kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
  }
  const delegates = nodes.filter(n => n.kind === 'delegate');
  const specialists = new Set(nodes.filter(n => n.actor.kind === 'specialist').map(n => n.actor.name));
  const allCites = nodes.flatMap(n => n.citations ?? []);
  const citesByActor: Record<string, number> = {};
  for (const c of allCites) {
    citesByActor[c.actorId] = (citesByActor[c.actorId] ?? 0) + 1;
  }

  console.warn('\n===== LIVE TURN REPORT =====');
  console.warn(`agent=${agentSlug}  msg="${message}"  took=${secs}s`);
  console.warn('events:', JSON.stringify(byType));
  console.warn('tool calls:', res.toolCalls.map(t => t.tool).join(', ') || '(none)');
  console.warn(`recommend_action cards: ${recs.length}${recs.length ? ` → ${JSON.stringify(recs)}` : ' ✗ (none)'}`);
  console.warn('DUMP markers in answer:', hits.length ? `✗ ${JSON.stringify(hits)}` : 'NONE ✓');
  console.warn(`response length: ${res.response.length}`);

  console.warn('\n----- TYPED TRACE -----');
  console.warn(`trace nodes: ${nodes.length}  by kind: ${JSON.stringify(kinds)}`);
  console.warn(`delegations: ${delegates.length}${delegates.length ? ` → ${JSON.stringify(delegates.map(d => d.actor.name === 'a specialist' ? d.label.replace(/^Delegating to /, '') : d.label))}` : ''}`);
  console.warn(`specialists seen: ${specialists.size ? [...specialists].join(', ') : '(none)'}`);
  console.warn(`citations: ${allCites.length}  by actor: ${JSON.stringify(citesByActor)}`);
  const nested = nodes.filter(n => n.parentId);
  console.warn(`NESTED nodes (delegate work surfaced): ${nested.length}${nested.length ? ` → ${JSON.stringify(nested.slice(0, 8).map(n => `${n.actor.name}:${n.kind}`))}` : ' ✗'}`);
  // Render the tree.
  console.warn('\n--- trace tree ---');
  const roots = nodes.filter(n => !n.parentId);
  for (const r of roots) {
    const cites = r.citations?.length ? `  [${r.citations.length} cite]` : '';
    console.warn(`• ${r.label}${r.result ? ` — ${r.result}` : ''}${cites}  (${r.actor.name})`);
    for (const c of nodes.filter(n => n.parentId === r.id)) {
      const cc = c.citations?.length ? `  [${c.citations.length} cite]` : '';
      const think = nodeDeltas.get(c.id) ? `  (${nodeDeltas.get(c.id)} chars)` : '';
      console.warn(`    └─ ${c.label}${c.result ? ` — ${c.result}` : ''}${cc}${think}  (${c.actor.name})`);
    }
  }
  console.warn('\n--- response (first 1000 chars) ---\n' + res.response.slice(0, 1000));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
