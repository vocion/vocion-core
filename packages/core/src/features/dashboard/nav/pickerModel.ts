/**
 * The workspace picker in two levels, iOS style (founder, 2026-10-09: "can I
 * get an iOS nav style: pick org, then pick workspace on next? For orgs with 1
 * workspace, I should just be able to click on the top level entry").
 *
 * Level 1 is Personal, then one row per Org; level 2 is one Org's
 * workspaces. Pure, so what each level lists is tested without a browser.
 * A single-Org install never sees level 1.
 */

import type { SwitcherAccount, SwitcherProject } from './workspaceSwitch';
import { byRecentUse } from './workspacesPage';

/** What the picker knows about a workspace beyond the directory (`projects.overview`, `inbox.mineCount`). */
export type PickerDetail = { leadName: string | null; lastActiveAt: string | null; waiting: number };

/** One Org on level 1. */
export type PickerOrg = {
  account: SwitcherAccount;
  workspaces: SwitcherProject[];
  /** Its one workspace, when it has exactly one: tapping the Org opens it. */
  only: SwitcherProject | null;
  /** What waits on the person across its workspaces. */
  waiting: number;
  current: boolean;
};

/**
 * One Org's workspaces in the order level 2 lists them: real ones by recent
 * use, then empty ones, then placeholders.
 * @param projects - Its live workspaces.
 * @param details - What is known about each, by id.
 */
export function orderForPicker(projects: readonly SwitcherProject[], details: Readonly<Record<string, PickerDetail>>): SwitcherProject[] {
  const ranked = (p: SwitcherProject) => ({ name: p.name, placeholder: p.placeholder, agentCount: p.agentCount ?? 0, lastActiveAt: details[p.id]?.lastActiveAt ?? null });
  return [...projects].sort((a, b) => byRecentUse(ranked(a), ranked(b)));
}

/**
 * Level 1: the person's Personal, then each Org they belong to, in the order
 * they joined. An Org with no workspace the person can open is left out.
 * @param projects - Every live workspace the person can open.
 * @param accounts - Their Orgs, oldest membership first.
 * @param details - What is known about each workspace.
 * @param currentAccountId - The Org the session is in.
 */
export function pickerOrgs(projects: readonly SwitcherProject[], accounts: readonly SwitcherAccount[], details: Readonly<Record<string, PickerDetail>>, currentAccountId: string | null | undefined): { personal: SwitcherProject[]; orgs: PickerOrg[] } {
  const personal = projects.filter(p => p.kind === 'personal');
  const shared = projects.filter(p => p.kind !== 'personal');
  const orgs: PickerOrg[] = [];
  for (const account of accounts) {
    const workspaces = orderForPicker(shared.filter(p => p.accountId === account.id), details);
    if (workspaces.length === 0) {
      continue;
    }
    orgs.push({
      account,
      workspaces,
      only: workspaces.length === 1 ? workspaces[0]! : null,
      waiting: workspaces.reduce((n, w) => n + (details[w.id]?.waiting ?? 0), 0),
      current: account.id === currentAccountId,
    });
  }
  return { personal, orgs };
}

/**
 * The one quiet line under a workspace in the picker: "Atlas · 7 agents ·
 * active 2h ago". Unknown facts leave no separator; nothing known, nothing shown.
 * @param p - The workspace.
 * @param d - What is known about it.
 * @param words - Translated pieces.
 * @param words.agents - "7 agents", for its count.
 * @param words.active - "active 2h ago", for its last activity.
 */
export function pickerLine(p: SwitcherProject, d: PickerDetail | undefined, words: { agents: (n: number) => string; active: (iso: string) => string }): string | null {
  const parts = [d?.leadName ?? null, p.agentCount ? words.agents(p.agentCount) : null, d?.lastActiveAt ? words.active(d.lastActiveAt) : null].filter((x): x is string => Boolean(x));
  return parts.length > 0 ? parts.join(' · ') : null;
}
