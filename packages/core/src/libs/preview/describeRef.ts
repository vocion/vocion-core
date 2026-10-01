import type { RecordRef } from '@/services/chat/pageContext';
import { nounCode } from '@/libs/codes';
import { evidenceRef } from './evidenceRef';
import { parseSourcesRefId } from './sourcesRef';

/**
 * WHAT A REFERENCE IS, IN WORDS, BEFORE ANYTHING IS LOADED.
 *
 * The preview pane shows a title while it loads, while the server restarts
 * and when a reference cannot be read — and in each of those it used to show
 * the raw id: "5974", "126.plan" (Chris, 2026-09-28). An id is a handle, not
 * a name. This says what kind of thing the reference names and which one
 * ("Agent run #5974", "Plan for #126"), and where its full page is, from the
 * ref alone: no I/O, so the client and the server read it the same way.
 *
 * `label` on the ref wins when a caller already holds the name.
 */

export type RefDescription = {
  /** "Agent run #5974", "Plan for #126". Never a bare id. */
  label: string;
  /** The in-app page that holds the whole thing, when the ref alone determines it. */
  href: string | null;
};

/** How each part of a feature page reads, as "<part> for #<request>". */
const FEATURE_PART: Record<string, string> = {
  status: 'Delivery status of',
  plan: 'Plan for',
  implementation: 'Implementation of',
  acceptance: 'Acceptance for',
  release: 'Release of',
  activity: 'Activity on',
  work: 'Connected work on',
  cost: 'Cost of',
  details: 'The records of',
};

/**
 * @param ref - The reference.
 */
export function describeRef(ref: Pick<RecordRef, 'type' | 'id' | 'label' | 'href'>): RefDescription {
  const own = describe(ref.type, ref.id);
  return {
    label: ref.label?.trim() || own.label,
    href: ref.href ?? own.href,
  };
}

function describe(type: RecordRef['type'], rawId: string): RefDescription {
  const id = rawId.trim();
  const n = /^\d+$/.test(id) ? id : null;
  switch (type) {
    case 'mission_run':
      return n ? { label: nounCode('run', n), href: `/dashboard/p/runs/agent-${n}` } : { label: 'Agent run', href: null };
    case 'worker_run':
      return n ? { label: nounCode('run', n), href: `/dashboard/p/runs/${n}` } : { label: 'Run', href: null };
    case 'feature_section': {
      const m = /^(\d+)\.([\w-]+)$/.exec(id);
      if (!m) {
        return { label: 'Part of a feature page', href: null };
      }
      const [, request, key] = m as unknown as [string, string, string];
      const criterion = /^criterion-(\d+)$/.exec(key);
      const part = criterion ? `Criterion ${Number(criterion[1]) + 1} of` : FEATURE_PART[key] ?? 'Part of';
      return { label: `${part} #${request}`, href: `/dashboard/p/feature/${request}` };
    }
    case 'artifact':
      return n ? { label: nounCode('artifact', n), href: `/dashboard/artifacts/${n}` } : { label: 'Artifact', href: null };
    case 'briefing':
      return n ? { label: `Briefing #${n}`, href: `/dashboard/briefings/${n}` } : { label: 'Briefing', href: null };
    case 'conversation': {
      // A turn's sources (`sourcesRef.ts`) open on their conversation.
      const sources = parseSourcesRefId(id);
      if (sources) {
        return { label: 'Sources', href: `/dashboard/chat?c=${sources.conversationId}` };
      }
      return n ? { label: nounCode('conversation', n), href: `/dashboard/chat?c=${n}` } : { label: 'Conversation', href: null };
    }
    case 'record_history':
      return n ? { label: `History of record #${n}`, href: `/dashboard/objects/${n}` } : { label: 'Record history', href: null };
    case 'request':
      return n ? { label: `Request #${n}`, href: `/dashboard/p/feature/${n}` } : { label: 'Request', href: null };
    case 'ask':
      return n ? { label: nounCode('ask', n), href: `/dashboard/inbox/${encodeURIComponent(`ask:${n}`)}` } : { label: 'Ask', href: null };
    case 'object':
      if (n) {
        return { label: `Record #${n}`, href: `/dashboard/objects/${n}` };
      }
      break;
    case 'lead':
      return { label: 'Lead', href: null };
    case 'agent':
      return { label: `Agent ${id}`, href: null };
    case 'team':
      return { label: `Team ${id}`, href: null };
    case 'mission':
      return { label: n ? `Mission #${n}` : `Mission ${id}`, href: null };
    case 'playbook':
      return { label: `Playbook ${id}`, href: `/dashboard/skills/${encodeURIComponent(id)}` };
    default:
      break;
  }
  // A citation (`granola:…`, `deals:123`, a URL) already says its system and
  // kind; a bare number from a document search is a document.
  if (n) {
    return { label: type === 'document' ? `Document #${n}` : `Record #${n}`, href: type === 'document' ? `/dashboard/search/${n}` : null };
  }
  const read = evidenceRef(id);
  return { label: read.label, href: null };
}
