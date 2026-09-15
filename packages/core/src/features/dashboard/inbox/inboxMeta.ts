import type { LucideIcon } from 'lucide-react';
import type { InboxKind } from '@/services/InboxService';
import { CheckSquare, ClipboardCheck, DoorOpen, Gavel, GitMerge, KeyRound, Lightbulb, MessageSquareText, PlayCircle, Sparkles } from 'lucide-react';

/** How each kind is named and drawn. Order here is the order of the chips. */
export const INBOX_KIND_META: Record<InboxKind, { label: string; plural: string; blurb: string; icon: LucideIcon }> = {
  proposal: { label: 'Proposal', plural: 'Proposals', blurb: 'An action an agent wants to take — a CRM update, an email, an enrollment. Approving executes it.', icon: ClipboardCheck },
  ruling: { label: 'Ruling', plural: 'Rulings', blurb: 'Decisions only you can make — the team is blocked on the answer.', icon: Gavel },
  approval: { label: 'Approval', plural: 'Approvals', blurb: 'Something the team wants to do and is asking permission for.', icon: CheckSquare },
  merge: { label: 'Merge', plural: 'Merges', blurb: 'Pull requests ready for a human to merge.', icon: GitMerge },
  input: { label: 'Input', plural: 'Inputs', blurb: 'Something the team needs from you — a file, a fact, an answer.', icon: MessageSquareText },
  credential: { label: 'Credential', plural: 'Credentials', blurb: 'A key or a login the team needs to keep going.', icon: KeyRound },
  gate: { label: 'Gate', plural: 'Gates', blurb: 'Runs waiting for you to say go.', icon: DoorOpen },
  recommendation: { label: 'Recommendation', plural: 'Recommendations', blurb: 'Changes the team proposes to itself — roles, models, budget.', icon: Lightbulb },
  run: { label: 'Run', plural: 'Runs', blurb: 'Paused, awaiting review, or recently failed.', icon: PlayCircle },
  learning: { label: 'Suggested rule', plural: 'Suggested rules', blurb: 'Rules proposed from your feedback, waiting to be adopted.', icon: Sparkles },
};

/** Short human labels for a kind, for the chip on a row or a sheet. Ask kinds and inbox kinds share names. */
export const KIND_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(INBOX_KIND_META).map(([k, m]) => [k, m.label]),
);

/**
 * Tone classes for a risk label.
 * @param risk
 */
export function riskTone(risk: string | null): string {
  switch (risk) {
    case 'high':
      return 'border-red-500/40 text-red-600 dark:text-red-400';
    case 'medium':
      return 'border-amber-500/40 text-amber-600 dark:text-amber-400';
    case 'low':
      return 'border-border text-muted-foreground';
    default:
      return 'border-border text-muted-foreground';
  }
}

/**
 * "3h", "2d", "just now" — how long something has been waiting.
 * @param at
 * @param now
 */
export function waitingFor(at: Date, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - at.getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 2) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

/**
 * "just now" or "3h ago" — `waitingFor` with the suffix only where it reads right.
 * @param at
 * @param now
 */
export function agoLabel(at: Date, now: Date = new Date()): string {
  const w = waitingFor(at, now);
  return w === 'just now' ? w : `${w} ago`;
}

/** The crumbs every detail screen starts with. */
export const NEEDS_YOU_CRUMB = { label: 'Needs you', href: '/dashboard/inbox' } as const;

/**
 * "Needs you › <kind> › <record>" — the breadcrumb for one decision screen.
 * The kind crumb links to the list filtered to that kind.
 * @param kind
 * @param record - The thing the decision is about, when the title does not already say.
 */
export function decisionCrumbs(kind: InboxKind, record?: string | null): Array<{ label: string; href?: string }> {
  const crumbs: Array<{ label: string; href?: string }> = [
    { label: 'Workspace', href: '/dashboard' },
    NEEDS_YOU_CRUMB,
    { label: INBOX_KIND_META[kind].plural, href: `/dashboard/inbox?kind=${kind}` },
  ];
  if (record) {
    crumbs.push({ label: record });
  }
  return crumbs;
}
