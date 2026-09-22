import type { ArtifactPayload } from '@/services/agents/types';
import { BarChart3, Files, FileText, IdCard, Link2, MailPlus, Paperclip, ScrollText, Table2, Target } from 'lucide-react';

/** One noun and one glyph per artifact kind — the badge, the chip and the log all read from here. */
export const ARTIFACT_KIND_LABEL: Record<ArtifactPayload['kind'], string> = {
  table: 'Table',
  markdown: 'Doc',
  chart: 'Chart',
  record: 'Record',
  link: 'Link',
  file: 'File',
  sequence: 'Sequence',
  document: 'Document',
  mission: 'Mission',
  playbook: 'Playbook',
};

export const ARTIFACT_KIND_ICON = {
  table: Table2,
  markdown: FileText,
  chart: BarChart3,
  record: IdCard,
  link: Link2,
  file: Paperclip,
  sequence: MailPlus,
  document: Files,
  mission: Target,
  playbook: ScrollText,
} satisfies Record<ArtifactPayload['kind'], typeof Table2>;

/**
 * "agent:revenue-lead" → "Revenue lead"; a user id stays "you"/"a teammate" upstream.
 * @param kind
 * @param id
 * @param selfId
 */
export function authorLabel(kind: 'agent' | 'human' | 'system', id: string | null, selfId?: string | null): string {
  if (kind === 'agent') {
    const slug = (id ?? '').replace(/^agent:/, '');
    if (!slug) {
      return 'agent';
    }
    const words = slug.replaceAll('-', ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  if (kind === 'system') {
    return 'system';
  }
  return selfId && id === selfId ? 'you' : 'a teammate';
}

/**
 * "2 min ago", "3 h ago", "Sep 15" — the version indicator's tail.
 * @param iso
 * @param now
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return '';
  }
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 45) {
    return 'just now';
  }
  const mins = Math.round(secs / 60);
  if (mins < 60) {
    return `${mins} min ago`;
  }
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
