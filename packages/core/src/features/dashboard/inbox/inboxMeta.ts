import type { LucideIcon } from 'lucide-react';
import type { InboxGroup } from '@/services/InboxService';
import { CheckSquare, DoorOpen, Gavel, GitMerge, KeyRound, Lightbulb, PlayCircle, Sparkles } from 'lucide-react';

/** How each inbox group is named and drawn. Order here is the order on the page. */
export const INBOX_GROUP_META: Record<InboxGroup, { label: string; blurb: string; icon: LucideIcon }> = {
  rulings: { label: 'Rulings', blurb: 'Decisions only you can make — the team is blocked on the answer.', icon: Gavel },
  approvals: { label: 'Approvals', blurb: 'Things the team wants to do, and proposed actions in the review queue.', icon: CheckSquare },
  merges: { label: 'Merges', blurb: 'Pull requests ready for a human to merge.', icon: GitMerge },
  inputs: { label: 'Inputs & credentials', blurb: 'Something the team needs from you — a key, a file, an answer.', icon: KeyRound },
  recommendations: { label: 'Recommendations', blurb: 'Changes the team proposes to itself — roles, models, budget.', icon: Lightbulb },
  gates: { label: 'Gates', blurb: 'Runs waiting for you to say go.', icon: DoorOpen },
  runs: { label: 'Runs waiting', blurb: 'Paused, awaiting review, or recently failed.', icon: PlayCircle },
  learnings: { label: 'Suggested rules', blurb: 'Rules proposed from feedback, waiting to be adopted.', icon: Sparkles },
};

/** Short human labels for ask kinds and the other inbox row kinds, for the chip on a row. */
export const KIND_LABEL: Record<string, string> = {
  approval: 'Approval',
  input: 'Input',
  ruling: 'Ruling',
  credential: 'Credential',
  merge: 'Merge',
  recommendation: 'Recommendation',
  gate: 'Gate',
  sheet: 'Decision sheet',
  review: 'Review',
  run: 'Run',
  learning: 'Suggested rule',
};

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
