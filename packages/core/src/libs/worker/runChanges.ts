/**
 * WHAT AN AGENT RUN FILED OR CHANGED, read off its tool calls.
 *
 * An agent run's preview leads with what it did (Chris, 2026-09-28: "what
 * should be on this preview pane?"), and what it did is the records it wrote:
 * an object updated, a candidate filed, a task dispatched, an ask filed, an
 * artifact rendered. Every one of those is a `tool_call` row whose output the
 * tool wrote in a fixed sentence (`services/agents/tools/*`), so this reads
 * the row the tool left — never the model's account of it.
 *
 * A write that is waiting for a person says so ("waiting for a person"), and
 * a refused or failed call is not a change. Pure, so what a run is credited
 * with is tested from fixtures.
 */

import type { RecordLinker } from '@/libs/workspace/recordHref';
import { restProposalWords } from '@/libs/chat/stepLabels';
import { nounCode } from '@/libs/codes';
import { genericRecordLinker } from '@/libs/workspace/recordHref';

export type RunCallRow = {
  tool: string;
  input: Record<string, unknown> | null;
  output: string | null;
  error: string | null;
};

export type RunChange = {
  /** "Updated request #126", "Filed ask #88 — waiting for a person". */
  text: string;
  /** Where to open what changed, when the call names it. Relative. */
  href: string | null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

function objectHref(link: RecordLinker, objectType: string | null, id: string | null): string | null {
  return id && /^\d+$/.test(id) ? link({ objectType, id }) : null;
}

/**
 * `objects.propose_candidate` → "propose candidate", for a sentence.
 * @param actionId
 */
function actionWords(actionId: string): string {
  const verb = actionId.split('.').pop() ?? actionId;
  return verb.replace(/_/g, ' ');
}

/**
 * The JSON after "Result: " on a done `propose_action`, cut at 400 chars by the tool — read what survived.
 * @param output
 */
function resultIds(output: string): { objectId: string | null; objectType: string | null; workerRunId: string | null; taskId: string | null; requestId: string | null } {
  const tail = output.slice(output.indexOf('Result:') + 7);
  const num = (key: string) => new RegExp(`"${key}"\\s*:\\s*(\\d+)`).exec(tail)?.[1] ?? null;
  const objectType = /"objectType"\s*:\s*"([\w-]+)"/.exec(tail)?.[1] ?? null;
  return { objectId: num('objectId'), objectType, workerRunId: num('workerRunId'), taskId: num('taskId') ?? num('createdTaskId'), requestId: num('requestId') };
}

/**
 * One call as a change, or null when it changed nothing.
 * @param call - The tool call row.
 * @param link
 */
export function callChange(call: RunCallRow, link: RecordLinker = genericRecordLinker): RunChange | null {
  if (call.error) {
    return null;
  }
  const out = (call.output ?? '').trim();
  const input = call.input ?? {};
  const pending = /\bPENDING\b/.test(out);
  const wait = pending ? ' — waiting for a person' : '';
  switch (call.tool) {
    case 'update_object': {
      // "FE-294 "…" updated", or an older "request #294 "…" updated".
      const m = /^(?:(\S+) #|([A-Z]{2,5})-)(\d+)(?: "([^"]*)")? updated/.exec(out);
      const type = m?.[1] ?? str(input.object_type) ?? 'record';
      const id = m?.[3] ?? str(input.id);
      if (!m && !pending) {
        return null;
      }
      const name = m?.[4] ? ` "${m[4]}"` : '';
      const named = m?.[2] ? `${m[2]}-${id}` : `${type.replace(/_/g, ' ')} #${id}`;
      return { text: pending ? `Proposed a change to ${named}${wait}` : `Updated ${named}${name}`, href: objectHref(link, type, id) };
    }
    case 'propose_action': {
      const action = str(input.action_id) ?? 'an action';
      if (/is DONE \((?:run #|ACT-)/.test(out)) {
        const ids = resultIds(out);
        const href = ids.workerRunId ? `/dashboard/p/runs/${ids.workerRunId}` : ids.objectId ? objectHref(link, ids.objectType, ids.objectId) : ids.taskId ? objectHref(link, 'engineering_task', ids.taskId) : objectHref(link, 'request', ids.requestId);
        const record = ids.objectId ? `${ids.objectType ? ids.objectType.replace(/_/g, ' ') : 'record'} #${ids.objectId}` : null;
        // A filed candidate is the record it created, said as that.
        if (action === 'objects.propose_candidate' && record) {
          return { text: `Filed ${record}`, href };
        }
        const what = ids.workerRunId ? ` — ${nounCode('run', ids.workerRunId)}` : record ? ` — ${record}` : '';
        return { text: `Ran ${actionWords(action)}${what}`, href };
      }
      if (pending || /was updated in place/.test(out)) {
        // A REST write says which endpoint on which source, not "request".
        const words = action === 'rest.request' ? restProposalWords(input.action_input) : null;
        return { text: `Proposed ${words ?? actionWords(action)} — waiting for a person`, href: null };
      }
      return null;
    }
    case 'file_ask': {
      const m = /^Ask #(\d+) (filed|already existed)/.exec(out);
      if (m) {
        return { text: `${m[2] === 'filed' ? 'Filed' : 'Updated'} ask #${m[1]}${str(input.title) ? ` "${str(input.title)}"` : ''}`, href: `/dashboard/inbox/${encodeURIComponent(`ask:${m[1]}`)}` };
      }
      return pending ? { text: `Proposed an ask${str(input.title) ? ` "${str(input.title)}"` : ''}${wait}`, href: null } : null;
    }
    case 'record_verdict': {
      const m = /^Verdict recorded on task #(\d+): (\w+)/.exec(out);
      return m ? { text: `Recorded a verdict on task #${m[1]}: ${m[2]}`, href: objectHref(link, 'engineering_task', m[1]!) } : null;
    }
    case 'update_artifact': {
      const m = /^Updated "([^"]+)" to (v\d+)/.exec(out);
      const id = str(input.id);
      return m ? { text: `Updated "${m[1]}" to ${m[2]}`, href: id && /^\d+$/.test(id) ? `/dashboard/artifacts/${id}` : null } : null;
    }
    default:
      break;
  }
  if (call.tool.startsWith('render_')) {
    const m = /^Rendered (\w+) "([^"]+)"/.exec(out);
    const id = /update_artifact\((\d+)/.exec(out)?.[1] ?? null;
    return m ? { text: `Made ${m[1]} "${m[2]}"`, href: id ? `/dashboard/artifacts/${id}` : null } : null;
  }
  if (call.tool === 'create_artifact') {
    const m = /^Artifact created: (.+)$/m.exec(out);
    return m ? { text: `Made ${m[1]}`, href: null } : null;
  }
  return null;
}

/**
 * Every change a run's calls made, in order, each named once.
 * @param calls - The run's tool calls, oldest first.
 * @param link
 */
export function runChanges(calls: readonly RunCallRow[], link: RecordLinker = genericRecordLinker): RunChange[] {
  // The same record written five times by the same tool is one line: the last
  // word on it. A different kind of write to it (a verdict on a task it also
  // updated) is its own line.
  const byKey = new Map<string, RunChange>();
  for (const c of calls) {
    const change = callChange(c, link);
    if (!change) {
      continue;
    }
    const key = `${c.tool}:${change.href ?? change.text}`;
    byKey.delete(key);
    byKey.set(key, change);
  }
  return [...byKey.values()];
}
/**
 * The first lines of a run's final report, as one or two sentences: headings
 * and emphasis marks off, cut at a sentence end.
 * @param text - The report.
 * @param max - The most characters.
 */
export function reportLead(text: string, max = 280): string | null {
  const lines = text
    .split('\n')
    .map(l => l.replace(/^\s{0,3}(?:#{1,6}\s+|[-*]\s+|>\s*)/, '').replace(/\*\*|__|`/g, '').trim())
    .filter(Boolean);
  const one = lines.slice(0, 2).join(' ');
  if (!one) {
    return null;
  }
  if (one.length <= max) {
    return one;
  }
  const head = one.slice(0, max);
  const end = [...head.matchAll(/[.!?](?=\s|$)/g)].map(m => m.index!).at(-1);
  return end !== undefined && end >= 40 ? head.slice(0, end + 1) : `${head.slice(0, head.lastIndexOf(' ') > 40 ? head.lastIndexOf(' ') : max).trimEnd()}…`;
}
