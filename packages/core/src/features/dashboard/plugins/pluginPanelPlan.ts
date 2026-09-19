import type { PluginContents } from '@/libs/workspace/plugins';
import type { MeasureReading } from '@/services/team-report';
import type { Status } from '@/types/Status';

/**
 * The plugin outcome panel's view model — pure, so what the panel says is
 * testable without a database (`pluginPanel.test.ts`).
 *
 * Everything here is derived from the plugin's own manifest and contents
 * (`loadPlugin`, `pluginContents`, `readPluginTeams`) plus readings, learnings
 * and decisions read for the slugs those declare. Nothing is keyed on a
 * particular plugin: a fourth plugin costs a descriptor, not a branch
 * (principle 7), and a concretion never enters core (principle 12).
 *
 * The four groups answer, in order, the questions Chris asked of the Proposals
 * page — "can I get more than just a list. Should I see the Agents and their
 * measures. Links to Playbooks that can be customized. List of learnings /
 * updates generated through use?"
 */

/** One plugin agent as the panel reads it — the live row when apply has run, else its slug. */
export type PluginPanelAgent = { slug: string; name: string; description: string | null };

/** A learning candidate or adopted rule whose step belongs to a plugin agent. */
export type PluginPanelLearning = { id: string; text: string; status: string; at: Date | null; step: string };

/** A decided action a plugin agent proposed. */
export type PluginPanelAction = { id: number; title: string; status: string; at: Date | null };

export type PluginPanelInput = {
  /** The plugin's display name, for the disclosure's summary. */
  pluginName: string;
  /** What the plugin ships, by kind. */
  contents: PluginContents;
  /** The plugin's teams, with the name the workspace shows them under. */
  teams: readonly { slug: string; name: string }[];
  /** `readTeamMeasures` output, keyed `${teamSlug}/${measureKey}`. */
  readings: ReadonlyMap<string, MeasureReading>;
  agents: readonly PluginPanelAgent[];
  learnings: readonly PluginPanelLearning[];
  actions: readonly PluginPanelAction[];
};

export type PluginPanelView = {
  /** "How Proposals is doing". */
  title: string;
  measures: { id: string; teamName: string; reading: MeasureReading }[];
  agents: { slug: string; name: string; description: string | null; profileHref: string; chatHref: string }[];
  skills: { slug: string; label: string; href: string; hint: string }[];
  learnings: { id: string; text: string; status: string; at: Date | null }[];
  actions: { id: number; title: string; status: string; at: Date | null }[];
  /** Neither a learning nor a decision yet — one honest line instead of two empty groups. */
  nothingLearned: boolean;
};

/** How much of a rule's text a row carries before it is cut. */
const LEARNING_TEXT_MAX = 120;

/**
 * A learning candidate's state as a pill. `approved` reads "Adopted" because
 * that is what approving one does — it becomes a rule the agent follows.
 * @param status - `learning_candidate.status`.
 */
export function learningPill(status: string): { status: Status; label: string } {
  switch (status) {
    case 'adopted':
    case 'approved': return { status: 'completed', label: 'Adopted' };
    case 'rejected': return { status: 'rejected', label: 'Rejected' };
    default: return { status: 'pending', label: 'Pending' };
  }
}

/**
 * A decided action's state as a pill — the three ends a proposal reaches once
 * somebody (or the trust ladder) has decided it.
 * @param status - `action_run.status`.
 */
export function actionPill(status: string): { status: Status; label: string } {
  switch (status) {
    case 'done': return { status: 'completed', label: 'Executed' };
    case 'rejected': return { status: 'rejected', label: 'Rejected' };
    case 'undone': return { status: 'cancelled', label: 'Undone' };
    default: return { status: 'inactive', label: status };
  }
}

/**
 * `proposal-document` → `Proposal document`.
 * @param slug
 */
function label(slug: string): string {
  const spaced = slug.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * One line of rule text, cut at {@link LEARNING_TEXT_MAX} on a word boundary
 * where there is one — a rule is a sentence a person wrote, and a hard cut
 * mid-word reads like a bug.
 * @param text - The rule as it was written.
 */
export function truncateRule(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= LEARNING_TEXT_MAX) {
    return clean;
  }
  const cut = clean.slice(0, LEARNING_TEXT_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > LEARNING_TEXT_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Turn a plugin's declared contents and what has been read for it into the
 * panel's four groups.
 *
 * A measure appears only when a reading was produced for it, and the reading
 * is passed through untouched — the panel renders it exactly as the team
 * report does, provenance and all, so a number here can never say more than
 * the same number says there (principle 10).
 * @param input - The plugin, its contents, and what was read for its slugs.
 */
export function planPluginPanel(input: PluginPanelInput): PluginPanelView {
  const byName = new Map(input.agents.map(a => [a.slug, a]));
  const measures = input.teams.flatMap(team =>
    [...input.readings.entries()]
      .filter(([id]) => id.startsWith(`${team.slug}/`))
      .map(([id, reading]) => ({ id, teamName: team.name, reading })),
  );

  const agents = input.contents.agents.map((slug) => {
    const row = byName.get(slug);
    return {
      slug,
      name: row?.name ?? label(slug),
      description: row?.description ?? null,
      profileHref: `/dashboard/agents/${slug}`,
      chatHref: `/dashboard/chat?agent=${slug}`,
    };
  });

  // A skill and a playbook are customised the same way — a same-slug file in
  // the workspace replaces the plugin's — so they read as one group with the
  // path that overrides each one.
  const skills = [
    ...input.contents.skills.map(slug => ({ slug, label: label(slug), href: `/dashboard/skills/${slug}`, hint: `override at workspace/skills/${slug}` })),
    ...input.contents.playbooks.map(slug => ({ slug, label: label(slug), href: `/dashboard/skills/${slug}`, hint: `override at workspace/playbooks/${slug}` })),
  ];

  const learnings = input.learnings.map(l => ({ id: l.id, text: truncateRule(l.text), status: l.status, at: l.at }));
  const actions = input.actions.map(a => ({ id: a.id, title: a.title, status: a.status, at: a.at }));

  return {
    title: `How ${input.pluginName} is doing`,
    measures,
    agents,
    skills,
    learnings,
    actions,
    nothingLearned: learnings.length === 0 && actions.length === 0,
  };
}
