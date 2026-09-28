import type { LucideIcon } from 'lucide-react';
import type { InboxKind, InboxTab } from '@/services/InboxService';
import { AlertTriangle, CheckSquare, ClipboardCheck, DoorOpen, Gavel, GitMerge, KeyRound, Lightbulb, MessageSquareText, PlayCircle, Sparkles } from 'lucide-react';

/** How each kind is named and drawn. Order here is the order of the chips. */
export const INBOX_KIND_META: Record<InboxKind, { label: string; plural: string; blurb: string; icon: LucideIcon }> = {
  // Chris, 2026-09-19: "Reviews should not be proposals. 'Recommendation(s)'
  // should probably be the term there under Reviews > X. 'As a human, I review
  // the recommendations made by the system.'" A proposal is a specific artifact
  // concretion of the GTM stack (`/gtm/proposals`, the `proposals` plugin, the
  // Proposal Writer) — a different noun from a queued action awaiting a human.
  // The stored kind stays `proposal`: this is a label, not a schema change.
  proposal: { label: 'Recommendation', plural: 'Recommendations', blurb: 'An action an agent recommends taking — a CRM update, an email, an enrollment. Approving executes it.', icon: ClipboardCheck },
  ruling: { label: 'Ruling', plural: 'Rulings', blurb: 'Decisions only you can make — the team is blocked on the answer.', icon: Gavel },
  approval: { label: 'Approval', plural: 'Approvals', blurb: 'Something the team wants to do and is asking permission for.', icon: CheckSquare },
  merge: { label: 'Merge', plural: 'Merges', blurb: 'Pull requests ready for a human to merge.', icon: GitMerge },
  input: { label: 'Input', plural: 'Inputs', blurb: 'Something the team needs from you — a file, a fact, an answer.', icon: MessageSquareText },
  credential: { label: 'Credential', plural: 'Credentials', blurb: 'A key or a login the team needs to keep going.', icon: KeyRound },
  gate: { label: 'Gate', plural: 'Gates', blurb: 'Runs waiting for you to say go.', icon: DoorOpen },
  // Relabelled off "Recommendation" so that word belongs to the queue's main
  // kind above. What this one actually is, everywhere it is raised — filing a
  // document into a room (`DataRoomService.proposeFiling`), turning feedback
  // into work, changing the team's own shape — is a short list with one option
  // marked recommended. Its old blurb ("roles, models, budget") described only
  // the third of those.
  recommendation: { label: 'Choice', plural: 'Choices', blurb: 'A short list the team narrowed down, with the one it recommends marked — take it or pick another.', icon: Lightbulb },
  run: { label: 'Run', plural: 'Runs', blurb: 'Paused or awaiting review, a run that is waiting on you.', icon: PlayCircle },
  // Chris, 2026-09-21: a failure is a log line, not a decision. What reaches
  // Review is the one the factory cannot recover, a third attempt, or a
  // failure class nothing retries, and it arrives as a decision with a
  // recommendation. Plain failures live on the run, inside the work item.
  exception: { label: 'Exception', plural: 'Exceptions', blurb: 'Automation could not recover. The system says what it thinks you should do; you decide.', icon: AlertTriangle },
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
export const REVIEW_CRUMB = { label: 'Review', href: '/dashboard/inbox' } as const;

/**
 * "Review queue › <kind> › <record>" — the breadcrumb for one decision screen.
 * The kind crumb links to the list filtered to that kind.
 * @param kind
 * @param record - The thing the decision is about, when the title does not already say.
 * @param section - Overrides the kind's label, for a card that names its own section.
 */
export function decisionCrumbs(kind: InboxKind, record?: string | null, section?: string | null): Array<{ label: string; href?: string }> {
  const crumbs: Array<{ label: string; href?: string }> = [
    { label: 'Workspace', href: '/dashboard' },
    REVIEW_CRUMB,
    // The middle crumb still LINKS to the kind's lane; a card that names its
    // own section ("Discovery") relabels it, because "Review queue ›
    // Recommendations › Project Ranger" says less about where you are than
    // "Review queue › Discovery › Project Ranger" does.
    { label: section || INBOX_KIND_META[kind].plural, href: `/dashboard/inbox?kind=${kind}` },
  ];
  if (record) {
    crumbs.push({ label: record });
  }
  return crumbs;
}

/**
 * "136 decisions, oldest waiting 53d." — or, on the other tabs, what the tab holds.
 * @param tab
 * @param open - Open rows, unfiltered.
 * @param oldest - The oldest open row's timestamp, when there is one.
 * @param shown - Rows on this tab after filters.
 */
export function contextLine(tab: InboxTab, open: number, oldest: Date | undefined, shown: number): string {
  if (tab === 'decided') {
    return shown === 0 ? 'No decisions yet.' : `${shown} decided, newest first.`;
  }
  if (tab === 'snoozed') {
    return shown === 0 ? 'Nothing snoozed.' : `${shown} snoozed, back when their time comes.`;
  }
  if (open === 0) {
    return 'Nothing right now — the team keeps working; new decisions land here.';
  }
  return `${open} ${open === 1 ? 'decision' : 'decisions'}${oldest ? `, oldest waiting ${waitingFor(oldest)}` : ''}.`;
}
