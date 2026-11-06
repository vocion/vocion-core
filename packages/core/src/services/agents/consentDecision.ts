/**
 * THE DECISION A PERSON'S CONSENT IS READ AGAINST: the action, what it acts
 * on, and what it does — never only the agent's label for it.
 *
 * Action 5949 (2026-10-01): the person said "Defer FE-318: it duplicates
 * FE-314 … the outage itself is already fixed by the revert", and the agent
 * put up "Revert squatch-core#151" — the pull request that had fixed the
 * outage. Judged as `repo.revert_pull: Revert squatch-core#151`, a revert sat
 * beside words that talked about reverts. Judged as what it is — "Roll a
 * release back (repo.revert_pull): Roll back <owner>/<repo>/pull/151, which
 * undoes "<its title>", shipped in REL-307 (production read ok after it).
 * What it does: opens GitHub's revert … and deploys what was live before" —
 * a person who asked to defer a record plainly did not ask for it.
 *
 * Read off the action's own definition and its review card, the one place an
 * action says how it reads to a person; nothing here names an action.
 *
 * The same sentence, built the same way, describes the two kinds of work an
 * agent starts that are not registry actions: a run of a saved automation
 * (`routineConsentDecision` — its purpose, its sites, what it changes, its
 * trust level and whose rows) and a browser task (`browserConsentDecision` —
 * the site, and whether it only reads or also changes things). Before
 * 2026-11-06 those were judged as "run the automation "<name>" for 12 rows"
 * and "use a browser to do this task: …", so "Read the board and list who's
 * ready" never read as consent to a browser read of the board.
 */
import type { RoutineView } from '@/libs/routines/types';
import { getAction } from '@/libs/actions/registry';
import { automationChanges, automationSites } from '@/libs/routines/describe';
import { TRUST_LABEL } from '@/libs/routines/types';

/** One decision, in the shape every consent read takes. */
export type DecisionParts = {
  /** What kind of thing it is, as a person names it ("Roll a release back"). */
  name: string;
  /** Its id (`repo.revert_pull`, `routine_run`). */
  id: string;
  /** This one, in a line ("Roll back Acme/core/pull/150"). */
  title: string;
  /** What it acts on, label: value. */
  facts: string[];
  /** Its payload, when there are no facts to show. */
  payload?: unknown;
  /** What it does. */
  does: string;
  /** The agent's own words for it. */
  label: string;
};

/**
 * The sentence `saidToDecide` judges, from its parts. One shape for every
 * decision a person's words are read against.
 * @param p - The decision.
 */
export function decisionSentence(p: DecisionParts): string {
  const facts = p.facts.map(f => f.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [
    `${p.name} (${p.id}): ${p.title}.`,
    facts.length > 0 ? `What it acts on — ${facts.join('; ')}.` : `Its payload: ${JSON.stringify(p.payload ?? {}).slice(0, 400)}.`,
    `What it does: ${p.does.slice(0, 600)}`,
    p.label ? `The agent called it: ${p.label.slice(0, 200)}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * The sentence `saidToDecide` judges for one proposed action.
 * @param orgId - The workspace.
 * @param actionId - The action.
 * @param input - Its payload.
 * @param label - The agent's own words for it (a card's label, a rationale).
 */
export async function consentDecision(orgId: string, actionId: string, input: Record<string, unknown>, label: string): Promise<string> {
  const action = getAction(actionId);
  if (!action) {
    return `${actionId}: ${label}`;
  }
  const parsed = action.inputSchema.safeParse(input);
  const card = action.reviewCard
    ? await action.reviewCard({ orgId }, (parsed.success ? parsed.data : input) as never).catch(() => null)
    : null;
  const facts = (card?.fields ?? [])
    .filter(f => typeof f.value === 'string' && f.value.trim() !== '')
    .slice(0, 10)
    .map(f => `${f.label}: ${String(f.value).replace(/\s+/g, ' ').slice(0, 300)}`);
  return decisionSentence({ name: action.name, id: action.id, title: card?.title ?? label, facts, payload: input, does: action.description.slice(0, 400), label });
}

/** How many rows a run's decision names before it counts the rest. */
const ROWS_NAMED = 12;

/**
 * A row as a person reads it: its own values (never a secret or an input
 * every row shares), the first two.
 * @param row - The row.
 * @param r - The automation.
 */
function rowWords(row: Record<string, string>, r: RoutineView): string {
  const spec = r.version?.spec;
  const own = (spec?.inputs ?? []).filter(i => !i.secret && !i.shared).map(i => row[i.name]).filter((v): v is string => Boolean(v && v.trim()));
  const values = own.length > 0 ? own : Object.values(row).filter(v => typeof v === 'string' && v.trim());
  return values.slice(0, 2).join(' · ').slice(0, 120);
}

/**
 * The sentence `saidToDecide` judges for running a saved automation: its
 * purpose, the sites it works on, what it changes, its trust level, and who
 * the rows are.
 * @param r - The automation.
 * @param rows - The rows it would run for.
 * @param label - The agent's own words for it, when it gave any.
 */
export function routineConsentDecision(r: RoutineView, rows: ReadonlyArray<Record<string, string>>, label = ''): string {
  const spec = r.version?.spec;
  const named = rows.slice(0, ROWS_NAMED).map(row => rowWords(row, r)).filter(Boolean);
  const more = rows.length - named.length;
  const sites = automationSites(r);
  return decisionSentence({
    name: 'Run a saved automation',
    id: 'routine_run',
    title: `run "${r.name}" for ${rows.length} row${rows.length === 1 ? '' : 's'}, one browser run each`,
    facts: [
      named.length > 0 ? `Rows: ${named.join('; ')}${more > 0 ? `; and ${more} more` : ''}` : '',
      sites.length > 0 ? `Sites: ${sites.join(', ')}` : '',
      `Trust: ${TRUST_LABEL[r.trust]}`,
    ],
    payload: { rows: rows.length },
    does: [
      r.description ?? spec?.summary ?? '',
      automationChanges(r) ? `What it changes: ${automationChanges(r)}.` : '',
    ].filter(Boolean).join(' '),
    label,
  });
}

/** Whether a browser task only reads, or also changes something on the site. */
export type BrowserEffect = 'reads' | 'changes';

/**
 * A site's host, or null for something that is not an address.
 * @param url - The address.
 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/**
 * The sentence `saidToDecide` judges for a browser task: the site, and
 * whether it only reads or also changes things — never "use a browser".
 * @param task - The task, as the agent briefed it.
 * @param startUrl - Where it starts, when the agent gave it.
 * @param effect - What the agent says it does to the site.
 */
export function browserConsentDecision(task: string, startUrl: string | null | undefined, effect: BrowserEffect): string {
  const host = startUrl ? hostOf(startUrl) : null;
  const site = host ?? 'the site the task names';
  return decisionSentence({
    name: effect === 'reads' ? 'Read a website' : 'Change something on a website',
    id: 'browser_task',
    title: `${effect === 'reads' ? 'read' : 'work on'} ${site}: ${task.replace(/\s+/g, ' ').trim().slice(0, 400)}`,
    facts: [
      `Site: ${site}`,
      effect === 'reads' ? 'Effect: only reads pages; changes nothing' : 'Effect: changes something on the site (fills in, saves, submits or sends)',
    ],
    does: effect === 'reads'
      ? 'Opens the site in the person\'s browser session beside the conversation and reads what the task asks for. Nothing is saved, sent or submitted.'
      : 'Opens the site in the person\'s browser session beside the conversation and does the task; each submit, save, send, pay or delete step waits for the person to approve it in the pane.',
    label: '',
  });
}
