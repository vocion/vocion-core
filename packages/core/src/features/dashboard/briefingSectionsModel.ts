/**
 * Pure helpers behind `BriefingSections.tsx` — kept apart so they unit-test
 * without the React/next-intl tree, and so the component file exports only
 * components (fast refresh).
 *
 * `isActionSection` used to live here: a heading heuristic that decided which
 * bullets got a "Do this" chip. The chip sent the bullet's text to the
 * conversation as a chat message rather than doing anything, so both it and
 * the heuristic are gone (`docs/specs/briefing-v2.md`; a typed brief routes
 * each actionable item to the surface that acts on it).
 */

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
