/**
 * Record refs as the app builds them — one place that knows which route a
 * record type lives at, so every "Ask about this" and every chip agree.
 * Pure; safe on the client and the server.
 */

import type { RecordRef, RecordType } from './pageContext';

const ROUTES: Record<RecordType, (id: string) => string | undefined> = {
  // One brief, one URL (docs/specs/briefing-v2.md §10) — the chip opens the
  // brief the rail is scoped to, not the list.
  briefing: id => (/^\d+$/.test(id) ? `/dashboard/briefings/${id}` : '/dashboard/briefings'),
  ask: id => `/dashboard/inbox/${encodeURIComponent(id)}`,
  agent: id => `/dashboard/agents/${encodeURIComponent(id)}`,
  team: id => `/dashboard/teams/${encodeURIComponent(id)}`,
  mission: id => `/dashboard/missions/${encodeURIComponent(id)}`,
  mission_run: id => `/dashboard/missions/runs/${encodeURIComponent(id)}`,
  // Skills and playbooks share one catalog and one page.
  playbook: id => `/dashboard/skills/${encodeURIComponent(id)}`,
  object: id => (id.includes(':') ? undefined : `/dashboard/objects/${encodeURIComponent(id)}`),
  deal: () => undefined,
  worker_run: id => `/dashboard/team-report/${encodeURIComponent(id)}`,
  conversation: () => '/dashboard/chat',
  artifact: id => `/dashboard/artifacts/${encodeURIComponent(id)}`,
  document: id => `/dashboard/search/${encodeURIComponent(id)}`,
  lead: id => `/gtm/lead/${encodeURIComponent(id.split(':').pop() ?? id)}`,
  // A `@page` tag points at wherever the person already is — no record route.
  page: () => undefined,
};

/**
 * Build a record ref with its in-app route filled in.
 * @param type - Record type.
 * @param id - Record id (a slug, a numeric id as string, or a CRM ref).
 * @param label - Human name.
 */
export function recordRef(type: RecordType, id: string | number, label?: string): RecordRef {
  const sid = String(id);
  const href = ROUTES[type](sid);
  const ref: RecordRef = { type, id: sid };
  if (label) {
    ref.label = label;
  }
  if (href) {
    ref.href = href;
  }
  return ref;
}

/**
 * One-line human description, for buttons and chips.
 * @param ref
 */
export function recordLabel(ref: RecordRef): string {
  return ref.label ?? `${ref.type.replace('_', ' ')} ${ref.id}`;
}
