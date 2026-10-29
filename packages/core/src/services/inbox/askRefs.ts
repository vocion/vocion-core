/**
 * What an ask says it is about, read off its `object_refs` and its context
 * link: the mail thread (or a message in one) and the CRM records. Pure, and
 * shared by the ask's evidence (`askEvidence.ts`) and the related-items join
 * (`relatedItems.ts`), so both read an ask's subject the same way.
 */

import type { Ask } from '@/services/AskService';

type Ref = { type: string; id: string };

const norm = (type: string) => type.trim().toLowerCase().replace(/-/g, '_');
const THREAD_TYPES = new Set(['gmail_thread', 'email_thread', 'mail_thread', 'thread']);
const MESSAGE_TYPES = new Set(['gmail_message', 'gmail', 'email_message', 'email']);
const CRM_KINDS: Record<string, 'deals' | 'contacts' | 'companies'> = {
  deal: 'deals',
  deals: 'deals',
  hubspot_deal: 'deals',
  contact: 'contacts',
  contacts: 'contacts',
  hubspot_contact: 'contacts',
  company: 'companies',
  companies: 'companies',
  hubspot_company: 'companies',
};

/**
 * What the ask says about its thread: a thread id, a message id, or neither. Pure.
 * @param ask - The ask.
 * @param ask.objectRefs - What it is about.
 * @param ask.contextUrl - Its long form; a Gmail link names the thread.
 */
export function threadPointerOf(ask: Pick<Ask, 'objectRefs' | 'contextUrl'>): { threadId: string } | { messageId: string } | null {
  for (const r of ask.objectRefs ?? []) {
    if (THREAD_TYPES.has(norm(r.type))) {
      return { threadId: r.id.replace(/^gmail(?:-thread)?:/, '') };
    }
  }
  for (const r of ask.objectRefs ?? []) {
    if (MESSAGE_TYPES.has(norm(r.type))) {
      return { messageId: r.id.replace(/^gmail:/, '') };
    }
  }
  const m = /^https:\/\/mail\.google\.com\/mail\/[^#]*#[^/]+\/([0-9a-f]{12,})$/i.exec(ask.contextUrl ?? '');
  return m ? { threadId: m[1]! } : null;
}

/**
 * The CRM records an ask names, as mirror keys (`deals:123`). Pure.
 * @param refs - The ask's object refs.
 */
export function crmKeysOf(refs: readonly Ref[]): string[] {
  const out: string[] = [];
  for (const r of refs) {
    const prefixed = /^(?:hubspot:)?(deals|contacts|companies):(.+)$/.exec(r.id);
    const kind = prefixed?.[1] ?? CRM_KINDS[norm(r.type)];
    const id = prefixed?.[2] ?? r.id;
    if (kind && id && !out.includes(`${kind}:${id}`)) {
      out.push(`${kind}:${id}`);
    }
  }
  return out;
}

/**
 * An ask's subject as record keys — `gmail-thread:<id>`, `deals:<id>`, … —
 * the same keys an action declares with `subjectRefs`. Pure.
 * @param ask - The ask.
 * @param ask.objectRefs - What it is about.
 * @param ask.contextUrl - Its long form.
 */
export function askSubjectKeys(ask: Pick<Ask, 'objectRefs' | 'contextUrl'>): string[] {
  const pointer = threadPointerOf(ask);
  return [...(pointer && 'threadId' in pointer ? [`gmail-thread:${pointer.threadId}`] : []), ...crmKeysOf(ask.objectRefs ?? [])];
}
