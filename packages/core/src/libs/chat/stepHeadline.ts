/**
 * The one line a finished group of steps folds to.
 *
 * "Worked it out · 1 step · 30 sources" counted the work; the line should
 * say what the work WAS — "Researched 30 sources and wrote the brief"
 * (Chris, 2026-09-18). Deterministic: it is composed from the steps' own
 * past-tense labels and the counts the trace already carries, so it never
 * says anything a step did not.
 */

export type HeadlineStep = {
  kind: 'reason' | 'tool' | 'skill' | 'search' | 'delegate' | 'draft';
  status: 'start' | 'progress' | 'done' | 'error';
  /** The step's finished label, e.g. `Read the brand guide`. */
  label: string;
  tool?: string;
};

const ARTIFACT_TOOLS = new Set(['render_markdown', 'render_document', 'edit_document', 'export_document_pdf', 'render_table', 'render_chart', 'render_record', 'create_artifact', 'update_artifact']);

function lower(s: string): string {
  return s.replace(/^→\s*/, '').replace(/^./, c => c.toLowerCase());
}

function joinPhrases(phrases: string[]): string {
  if (phrases.length <= 1) {
    return phrases[0] ?? '';
  }
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
}

/**
 * Compose the headline for a group of root steps.
 * @param steps - Root steps of the group (reasoning excluded or included; it is ignored).
 * @param sources - How many sources the group surfaced.
 */
export function stepHeadline(steps: HeadlineStep[], sources = 0): string {
  const actions = steps.filter(s => s.kind !== 'reason');
  if (actions.length === 0) {
    return sources > 0 ? `Grounded in ${sources} source${sources === 1 ? '' : 's'}` : 'Thought it through';
  }
  const phrases: string[] = [];
  const searches = actions.filter(s => s.kind === 'search');
  if (searches.length > 0) {
    phrases.push(sources > 0 ? `researched ${sources} source${sources === 1 ? '' : 's'}` : (searches.length === 1 ? lower(searches[0]!.label) : 'searched sources'));
  }
  const wrote = actions.filter(s => s.tool && ARTIFACT_TOOLS.has(s.tool));
  if (wrote.length > 0) {
    // One phrase for the whole artifact pass, named by its last step.
    phrases.push(lower(wrote[wrote.length - 1]!.label));
  }
  for (const s of actions) {
    if (s.kind === 'search' || (s.tool && ARTIFACT_TOOLS.has(s.tool))) {
      continue;
    }
    const phrase = s.kind === 'delegate'
      ? `consulted ${s.label.replace(/^→\s*/, '').replace(/^Delegated to |^Handing off to /, '').replace(/ finished$/, '')}`
      : lower(s.label);
    if (!phrases.includes(phrase)) {
      phrases.push(phrase);
    }
  }
  const shown = phrases.slice(0, 3);
  const extra = phrases.length - shown.length;
  const failed = actions.filter(s => s.status === 'error').length;
  let line = joinPhrases(shown);
  if (extra > 0) {
    line = `${line}, +${extra} more`;
  }
  line = line.replace(/^./, c => c.toUpperCase());
  return failed > 0 ? `${line} · ${failed} failed` : line;
}
