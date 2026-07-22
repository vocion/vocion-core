/**
 * Diagnostic: run a real turn through the raw LangChain `streamEvents(v2)`
 * stream and dump the event taxonomy + namespaces — so the typed-emitter
 * build knows exactly how tools, skills, and SUBAGENT nesting appear
 * (checkpoint_ns / langgraph_node) before we parse them. Read-only.
 *
 *   bash /Users/chrisfitkin/vc.sh dump "<message>" [agent]
 */
import process from 'node:process';
import { parseArgs } from 'node:util';
import { bindRequestEmit, buildInitialFiles, getCompiledAgent } from '@/services/agents/harness';

type RawEvent = { event?: string; name?: string; metadata?: Record<string, unknown>; data?: Record<string, unknown> };

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { agent: { type: 'string' }, org: { type: 'string' }, msg: { type: 'string' } } });
  const orgId = values.org ?? 'proj-revenue-f8429a692aab3703f82a4f15169b8662';
  const agentSlug = values.agent ?? 'founder-gtm-lead';
  const message = values.msg ?? 'Draft the email follow-ups I owe Eric Bloomfield and Kyle Getson.';

  const compiled = await getCompiledAgent(orgId, agentSlug);
  bindRequestEmit(compiled, () => {}, 'dump', undefined, undefined);
  const initialFiles = await buildInitialFiles(orgId, agentSlug);
  const input = { messages: [{ role: 'user', content: message }], files: initialFiles };

  const taxonomy = new Map<string, number>();
  const namespaces = new Set<string>();
  const toolNames = new Set<string>();
  const sampled = new Set<string>();
  let total = 0;

  const shallow = (v: unknown, depth = 0): string => {
    if (v == null) {
      return String(v);
    }
    if (typeof v === 'string') {
      return `str(${v.length})="${v.slice(0, 60).replace(/\n/g, '↵')}"`;
    }
    if (typeof v !== 'object') {
      return `${typeof v}=${String(v).slice(0, 40)}`;
    }
    if (Array.isArray(v)) {
      return `[${v.length}]${depth < 1 && v[0] != null ? ` first=${shallow(v[0], depth + 1)}` : ''}`;
    }
    if (depth > 1) {
      return `{${Object.keys(v as object).join(',')}}`;
    }
    return `{ ${Object.entries(v as Record<string, unknown>).map(([k, val]) => `${k}: ${shallow(val, depth + 1)}`).join(', ')} }`;
  };

  const stream = await compiled.graph.streamEvents(input as never, { version: 'v2' } as never);
  for await (const evUnknown of stream as AsyncIterable<RawEvent>) {
    const ev = evUnknown;
    total++;
    const event = ev.event ?? '?';
    const name = ev.name ?? '?';
    const md = ev.metadata ?? {};
    const cpns = md.checkpoint_ns;
    const ns = (typeof cpns === 'string' ? cpns : Array.isArray(cpns) ? cpns.join('/') : '')
      || String(md.langgraph_node ?? '');
    namespaces.add(ns || '(root)');
    if (event === 'on_tool_start' || event === 'on_tool_end') {
      toolNames.add(name);
    }
    // Bucket by (event, whether nested) to keep the taxonomy compact.
    const nested = ns.includes('|') || ns.includes('/') || /task|subagent|general-purpose/i.test(ns) ? 'NESTED' : 'root';
    taxonomy.set(`${event} · ${nested}`, (taxonomy.get(`${event} · ${nested}`) ?? 0) + 1);

    // Sample the DATA shape once per (event · tool) so the emitter knows how to
    // extract text / tool input / tool output / citations.
    const sampleKey = event === 'on_tool_start' || event === 'on_tool_end' ? `${event}:${name}` : event;
    if (!sampled.has(sampleKey)) {
      sampled.add(sampleKey);
      console.warn(`\n--- sample ${sampleKey} (ns="${ns}") run_id=${(ev as { run_id?: string }).run_id ?? '?'}`);
      console.warn(`    data: ${shallow(ev.data)}`);
    }
  }

  console.warn(`\n===== streamEvents(v2) — ${total} events =====`);
  console.warn('\nby type · scope:');
  for (const [k, c] of [...taxonomy.entries()].sort()) {
    console.warn(`  ${String(c).padStart(4)}  ${k}`);
  }
  console.warn('\ntool names seen:', [...toolNames].join(', ') || '(none)');
  console.warn('\nnamespaces seen:');
  for (const n of [...namespaces].sort()) {
    console.warn(`  "${n}"`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
