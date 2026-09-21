/**
 * First-party Card registry side-effects. Importing this module registers
 * all built-in Cards. Order matters only insofar as collisions overwrite:
 * later registrations win.
 *
 * Boot order: `libs/cards/firstParty/index.ts` is imported by the app's
 * server boot (see `app/[locale]/(auth)/dashboard/workflows/[slug]/runs/[runId]/page.tsx`
 * — every page that calls `resolveCard()` needs the cards registered).
 */

import { registerCard } from '../registry';
import { chartCard } from './chart';
import { dataTableCard } from './dataTable';
import { documentCard } from './document';
import { jsonDumpCard } from './jsonDump';
import { keyValueCard } from './keyValue';
import { linkCard } from './link';
import { markdownCard } from './markdown';
import { missionCard } from './mission';
import { playbookCard } from './playbook';
import { recordCard } from './record';
import { sendStubCard } from './sendStub';
import { sequenceCard } from './sequence';

let registered = false;

/**
 * Idempotently register all first-party Cards. Called from server-side
 * boot. Safe to call multiple times.
 */
export function registerFirstPartyCards(): void {
  if (registered) {
    return;
  }
  registerCard(jsonDumpCard);
  registerCard(keyValueCard);
  registerCard(sendStubCard);
  // Canvas cards (0095): what `render_table` / `render_markdown` /
  // `render_chart` / `render_record` produce, on the chat and artifact surfaces.
  registerCard(dataTableCard);
  registerCard(markdownCard);
  registerCard(chartCard);
  registerCard(recordCard);
  registerCard(linkCard);
  // The typed draft sequence (0112) — the personalization lead page's third
  // artifact, previewed here and edited where its decision is.
  registerCard(sequenceCard);
  // The paginated document (render_document) — rendered the way it prints,
  // with its render-verify verdict.
  registerCard(documentCard);
  // Workspace sources (libs/workspace/source.ts): a mission's YAML and a
  // SKILL.md, mirrored so they edit like artifacts.
  registerCard(missionCard);
  registerCard(playbookCard);
  registered = true;
}

// Eager registration so simply importing `firstParty` is sufficient. Modules
// that need a deterministic boot order can call `registerFirstPartyCards()`
// explicitly.
registerFirstPartyCards();

export { CHART_SLUG, chartCard } from './chart';
export { DATA_TABLE_SLUG, dataTableCard } from './dataTable';
export { JSON_DUMP_SLUG, jsonDumpCard } from './jsonDump';
export { KEY_VALUE_SLUG, keyValueCard } from './keyValue';
export { LINK_SLUG, linkCard } from './link';
export { MARKDOWN_SLUG, markdownCard } from './markdown';
export { MISSION_SLUG, missionCard } from './mission';
export { PLAYBOOK_SLUG, playbookCard } from './playbook';
export { RECORD_SLUG, recordCard } from './record';
export { SEND_STUB_SLUG, sendStubCard } from './sendStub';
export { SEQUENCE_SLUG, sequenceCard } from './sequence';
