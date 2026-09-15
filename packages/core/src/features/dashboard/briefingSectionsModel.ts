/**
 * Pure helpers behind `BriefingSections.tsx` — kept apart so they unit-test
 * without the React/next-intl tree, and so the component file exports only
 * components (fast refresh).
 */

const ACTION_WORDS = /needs?\s+(?:you|me|attention|a\s+person)|moves?\b|action|urgent|at.?risk|close\s+this|not\s+in\s+hubspot|contracts?\s+out|decision|next\s+step|to.?do|owed|follow.?up/i;

/**
 * Which sections carry work for a person (heading heuristic, tuned on the revenue brief).
 * @param heading
 */
export function isActionSection(heading: string): boolean {
  return ACTION_WORDS.test(heading);
}

export function splitSections(md: string): Array<{ heading: string | null; body: string }> {
  const lines = md.split('\n');
  const out: Array<{ heading: string | null; body: string[] }> = [];
  let cur: { heading: string | null; body: string[] } = { heading: null, body: [] };
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
    }
    const m = !inFence ? /^##[ \t]+(\S.*)$/.exec(line) : null;
    if (m) {
      if (cur.heading !== null || cur.body.some(l => l.trim())) {
        out.push(cur);
      }
      cur = { heading: m[1]!.trim().replace(/^[^\p{L}\p{N}]+/u, '').trim() || m[1]!.trim(), body: [] };
    } else {
      cur.body.push(line);
    }
  }
  if (cur.heading !== null || cur.body.some(l => l.trim())) {
    out.push(cur);
  }
  return out.map(s => ({ heading: s.heading, body: s.body.join('\n').trim() }));
}
