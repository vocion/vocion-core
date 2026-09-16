import type { RecordRef } from '@/services/chat/pageContext';

/**
 * An evidence string is a reference. This turns it into one.
 *
 * Proposals, briefs and claims all cite their sources as bare strings —
 * `granola:<uuid>`, `zoom:<meeting>`, `gmail:<subject>`, `https://…`. On the
 * screen those rendered as themselves, so a reviewer read a UUID and had no
 * way to check what it said without leaving the decision.
 *
 * Every one of them is a `RecordRef` in disguise, which is the whole seam:
 * once it is a ref, the preview registry can resolve it and every surface that
 * shows evidence gets a peek for free.
 *
 * The label rule, which is not negotiable: **a raw id is never the whole
 * label.** Until the resolver answers with the real title, the item reads as
 * its kind ("Granola meeting", "Email"), and the id lives behind the preview.
 */

/** The evidence prefixes we know how to resolve, and what to call each. */
const SOURCES: Record<string, { label: string; noun: string }> = {
  'granola': { label: 'Granola', noun: 'Granola meeting' },
  'zoom': { label: 'Zoom', noun: 'Zoom meeting' },
  'gmail': { label: 'Gmail', noun: 'Email' },
  'gmail-thread': { label: 'Gmail', noun: 'Email thread' },
  'gcal': { label: 'Calendar', noun: 'Calendar event' },
  'slack': { label: 'Slack', noun: 'Slack message' },
  'notion': { label: 'Notion', noun: 'Notion page' },
  'drive': { label: 'Drive', noun: 'Drive file' },
  'docuseal': { label: 'DocuSeal', noun: 'Contract' },
  'hubspot': { label: 'HubSpot', noun: 'CRM record' },
  'deals': { label: 'HubSpot', noun: 'Deal' },
  'contacts': { label: 'HubSpot', noun: 'Contact' },
  'companies': { label: 'HubSpot', noun: 'Company' },
};

export type EvidenceRef = {
  ref: RecordRef;
  /** The chip beside the item. */
  sourceLabel: string;
  /** What the item reads as before the preview resolves it. Never a bare id. */
  label: string;
  /** The citation as written, kept verbatim for the unresolvable case. */
  raw: string;
};

/**
 * A URL's host and path, the way a person would read it aloud.
 * @param url
 */
function urlLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return `${u.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return url;
  }
}

/**
 * Does this look like an opaque handle rather than a name a person wrote?
 * @param s
 */
export function looksLikeId(s: string): boolean {
  const t = s.trim();
  if (t.includes(' ')) {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) // uuid
    || /^\d+$/.test(t) // bare number
    || /^[0-9a-f]{6,}$/i.test(t) // hex handle, e.g. a short contract id
    || /^[\w+/=-]{16,}$/.test(t); // long opaque token / base64-ish
}

/**
 * One evidence citation as a reference the preview registry can resolve.
 * @param source - The citation string as the proposer or researcher wrote it.
 */
export function evidenceRef(source: string): EvidenceRef {
  const raw = source.trim();
  if (/^https?:\/\//i.test(raw)) {
    return {
      ref: { type: 'page', id: raw, label: urlLabel(raw) },
      sourceLabel: 'Link',
      label: urlLabel(raw),
      raw,
    };
  }
  const m = /^([a-z][\w-]*):(.+)$/i.exec(raw);
  if (!m) {
    return { ref: { type: 'document', id: raw, label: raw }, sourceLabel: 'Note', label: raw, raw };
  }
  const prefix = m[1]!.toLowerCase();
  const rest = m[2]!.trim();
  const known = SOURCES[prefix];
  const sourceLabel = known?.label ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
  // A ref whose tail is a handle reads as its kind; a tail someone typed —
  // a subject line, a meeting title — already reads as itself.
  const label = known && looksLikeId(rest) ? known.noun : rest;
  const type = prefix === 'deals' || prefix === 'hubspot' ? 'deal' : prefix === 'contacts' || prefix === 'companies' ? 'object' : 'document';
  return { ref: { type, id: raw, label }, sourceLabel, label, raw };
}

/**
 * The briefing document carries its own reference vocabulary
 * (`services/briefings/document.ts`: `crm-deal | crm-company | email | call |
 * contract | team-briefing | inbox | …`). Translate it here rather than in the
 * briefing components, so there is one place that knows how a foreign ref
 * spelling becomes a previewable one.
 *
 * Returns null for a reference that must NOT be previewed. `inbox` is the
 * case: it points at a decision, and a decision is a detail page, not a peek
 * (`docs/design/patterns.md`).
 * @param ref - The briefing document's evidence entry.
 * @param ref.kind
 * @param ref.id
 * @param ref.label
 * @param ref.href
 */
export function briefingEvidenceRef(ref: { kind: string; id: string; label: string; href?: string }): RecordRef | null {
  const id = ref.id;
  switch (ref.kind) {
    case 'crm-deal':
      return { type: 'deal', id: id.includes(':') ? id : `deals:${id}`, label: ref.label };
    case 'crm-company':
      return { type: 'object', id: id.includes(':') ? id : `companies:${id}`, label: ref.label };
    case 'crm-contact':
      return { type: 'object', id: id.includes(':') ? id : `contacts:${id}`, label: ref.label };
    case 'email':
      return { type: 'document', id: id.includes(':') ? id : `gmail:${id}`, label: ref.label };
    case 'call':
    case 'meeting':
      return { type: 'document', id, label: ref.label };
    case 'contract':
      return { type: 'document', id: id.includes(':') ? id : `docuseal:${id}`, label: ref.label };
    case 'team-briefing':
      return { type: 'briefing', id, label: ref.label };
    case 'artifact':
      return { type: 'artifact', id, label: ref.label };
    case 'inbox':
      // A decision is the task, not a reference to confirm. It stays a link.
      return null;
    default:
      return { type: 'document', id, label: ref.label };
  }
}
