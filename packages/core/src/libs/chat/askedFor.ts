/**
 * WHAT THE PERSON ASKED THE TURN TO USE — a composer tag that names a way of
 * working rather than a record: `@browser` says "do this in the browser". Sent
 * as a typed field (`asked_for`), like `@artifact`'s deliverable contract, so
 * the turn reads it as the person's instruction, never from their words.
 *
 * What it changes on the server: the model is told plainly what the person
 * asked for (`askedForLine`), and the tool it names reads the tag as the
 * person's word — a browser run starts at once, as theirs, with no suggestion
 * step (`services/agents/tools/browserTasks.ts`). Pure, client-safe.
 */

export const ASKED_FOR = ['browser'] as const;
export type AskedFor = (typeof ASKED_FOR)[number];

/**
 * Read `asked_for` off an untrusted request body: the known values, once each.
 * @param raw - `body.asked_for` as it arrived.
 */
export function readAskedFor(raw: unknown): AskedFor[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return [...new Set(raw.filter((v): v is AskedFor => (ASKED_FOR as readonly unknown[]).includes(v)))];
}

/**
 * What the model is told, after the person's message, for each thing they tagged.
 * @param asked - What they asked for.
 */
export function askedForLine(asked: readonly AskedFor[]): string {
  if (asked.length === 0) {
    return '';
  }
  const lines = asked.map(a => (a === 'browser' ? 'I tagged @browser: do this in the browser, with browser_task (it starts at once, as mine).' : ''));
  return `\n\n--- I asked for ---\n${lines.filter(Boolean).join('\n')}`;
}
