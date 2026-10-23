/**
 * The export gate, run: the impure half of `exportGate.ts`, shared by
 * `export_document_pdf` and `export_deck_pdf`.
 *
 * It lives beside the printers rather than inside them on purpose: a printer
 * is a mechanism (spec in, file out), the gate is a judgement that may need a
 * model call and whose answer is a receipt. Done-for-you, not an approval
 * gate: a gated deliverable nobody has read is read HERE, and then sent if it
 * comes back clean (Chris, 2026-09-19). A person who asked for the PDF gets
 * it, with any block as one line of advice.
 */

import type { DeliverableUnit } from './exportGate';
import type { DocumentRedTeam } from '@/libs/cards/specs';
import type { RedTeamOutcome } from '@/services/documents/redTeam';
import { clientFacingPlaybooksFor } from '@/libs/documents/clientFacing';
import { exportGate } from './exportGate';

export type GateDecision = { action: 'export'; line: string | null } | { action: 'refuse'; line: string };

/**
 * Decide whether this export goes out, reading the deliverable as the buyer
 * first when it is client-facing and this version is unread.
 * @param input - The deliverable's playbook and stored read, how to read it now, and who asked.
 * @param input.orgId
 * @param input.playbook
 * @param input.redTeam
 * @param input.unit
 * @param input.onPersonsWord
 * @param input.readNow - Runs the red team and records it on the version (the engine's own door).
 */
export async function gateExport(input: {
  orgId: string;
  playbook?: string | null;
  redTeam?: DocumentRedTeam | null;
  unit?: DeliverableUnit;
  onPersonsWord?: boolean;
  readNow: () => Promise<{ outcome: RedTeamOutcome; record: DocumentRedTeam | null }>;
}): Promise<GateDecision> {
  const configured = await clientFacingPlaybooksFor(input.orgId).catch(() => null);
  const common = { playbook: input.playbook ?? null, configured, ...(input.unit ? { unit: input.unit } : {}), ...(input.onPersonsWord ? { onPersonsWord: true } : {}) };
  const first = exportGate({ ...common, read: input.redTeam ? { kind: 'read', redTeam: input.redTeam } : { kind: 'none' } });
  if (first.action !== 'read-first') {
    return first;
  }
  // Nobody has read this version. Read it now rather than refusing — and if
  // the read cannot run at all, say so and still send (never a silent block).
  const { outcome, record } = await input.readNow();
  const after = exportGate({
    ...common,
    read: record ? { kind: 'read', redTeam: record, fresh: true } : { kind: 'unavailable', reason: outcome.status === 'skipped' ? outcome.reason : 'the review returned nothing usable' },
  });
  return after.action === 'read-first' ? { action: 'export', line: null } : after;
}
