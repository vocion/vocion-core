/**
 * The gate on the way out: a client-facing document is read as the buyer
 * before it can leave as a PDF.
 *
 * `red_team_document` already read a document the way the person on the other
 * side will. Until now it ran only when the agent remembered to — the skill
 * said so in prose, and prose is the weakest lever there is (CLAUDE.md —
 * structural over prompting). Chris settled it on 2026-09-19: the red team
 * "should self recommend or execute for high value and client facing and
 * complex artifacts, like Proposals". So the export is where it is enforced —
 * the one moment the document stops being a draft.
 *
 * Which documents count is CONFIG, not a list in here: `playbook` on the spec
 * against `defaults.clientFacingPlaybooks` in workspace.yaml (landing on
 * `project.client_facing_playbooks`). A document with no playbook tag is a
 * working note and is never gated.
 *
 * And it is done-for-you, not an approval gate (Chris's standing rule): a
 * gated document nobody has read is read HERE, by the export, and then sent
 * if it comes back clean. Only a blocking finding stops the PDF, and a red
 * team that could not run never does — an unusable model must not become an
 * embargo on sending anything.
 *
 * This module is the pure half — config and a stored receipt in, a decision
 * and the line a person reads out — so every branch is unit-tested without a
 * database, a model or a browser.
 */

import type { DocumentRedTeam } from '@/libs/cards/specs';

/**
 * The playbooks gated when a workspace says nothing: the client-facing
 * documents the shipped plugins write. `email-copy` and `work-sample` are
 * deliberately out — they are short, cheap to re-send, and gating them would
 * put a model call in front of every draft email.
 */
export const DEFAULT_CLIENT_FACING_PLAYBOOKS: readonly string[] = ['proposal', 'scope', 'partnership-update'];

/**
 * The gated playbook tags in force for a workspace.
 *
 * `null`/`undefined` is "the workspace authored none" and falls back to the
 * defaults; an explicitly EMPTY list is "this workspace gates nothing" and is
 * honoured, so a workspace can turn the gate off without a core change.
 * @param configured - `project.clientFacingPlaybooks`, as applied from workspace.yaml.
 */
export function clientFacingPlaybooks(configured: readonly string[] | null | undefined): readonly string[] {
  return configured ?? DEFAULT_CLIENT_FACING_PLAYBOOKS;
}

/**
 * Whether this document is one a client reads, and so one the gate applies to.
 * Tags are compared case- and space-insensitively, because a playbook tag is
 * free text an agent types.
 * @param playbook - `spec.playbook`.
 * @param configured - `project.clientFacingPlaybooks`, or null for the defaults.
 */
export function isClientFacing(playbook: string | null | undefined, configured?: readonly string[] | null): boolean {
  const tag = normalise(playbook);
  if (!tag) {
    return false;
  }
  return clientFacingPlaybooks(configured).some(p => normalise(p) === tag);
}

function normalise(tag: string | null | undefined): string {
  return (tag ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

/** What the export knows about this version having been read as the buyer. */
export type ReadState
  /** The row carries a receipt for this version. */
  = | { kind: 'read'; redTeam: DocumentRedTeam; fresh?: boolean }
  /** No receipt: this version has never been read. */
    | { kind: 'none' }
  /** The read was attempted just now and could not run (no key, unusable model). */
    | { kind: 'unavailable'; reason: string };

export type ExportGate
  /** Print it. `line` is what the export receipt adds about the read, or null when nothing applies. */
  = | { action: 'export'; line: string | null }
  /** Gated and never read: run the red team now, then ask again with what it found. */
    | { action: 'read-first' }
  /** Blocking findings: the document is not sent. `line` is the whole refusal. */
    | { action: 'refuse'; line: string };

/**
 * What the export does, given the document's playbook, the workspace's gated
 * tags and what is known about the read. Pure; the caller runs the red team
 * when this says `read-first` and asks again with the answer.
 * @param input
 * @param input.playbook - `spec.playbook`.
 * @param input.configured - `project.clientFacingPlaybooks`, or null for the defaults.
 * @param input.read - What is on the row, or what the red team just said.
 */
export function exportGate(input: {
  playbook?: string | null;
  configured?: readonly string[] | null;
  read: ReadState;
}): ExportGate {
  if (!isClientFacing(input.playbook, input.configured)) {
    return { action: 'export', line: null };
  }
  const { read } = input;
  if (read.kind === 'none') {
    return { action: 'read-first' };
  }
  if (read.kind === 'unavailable') {
    // Never a silent block: the PDF goes out and the receipt says what was
    // not checked and why (principle 10 — "I could not establish this").
    return { action: 'export', line: `It was NOT read as the buyer first: ${read.reason}. Exported anyway; read it yourself before it is sent.` };
  }
  const r = read.redTeam;
  if (r.blocks > 0) {
    return { action: 'refuse', line: refusal(r) };
  }
  return { action: 'export', line: cleared(r, read.fresh === true) };
}

/**
 * The line the export receipt carries when the document was read and cleared.
 * @param r - The stored review.
 * @param fresh - True when the export ran the read itself just now.
 */
function cleared(r: DocumentRedTeam, fresh: boolean): string {
  const counts = r.fixes + r.considers === 0
    ? 'no findings'
    : `no blocking findings (${r.fixes} to fix · ${r.considers} to consider)`;
  const when = fresh ? 'Read as the buyer first' : `Read as the buyer at v${r.version} on ${r.at.slice(0, 10)}`;
  return `${when} (${r.model}, ${r.sheets} sheets): ${counts}.`;
}

/**
 * The refusal: every blocking finding with its sheet and its fix, then what
 * has to happen. The agent should be able to act on this without another
 * tool call (principle 3 — evidence you can reach).
 * @param r - The stored review, blocks first.
 */
function refusal(r: DocumentRedTeam): string {
  const blocks = r.findings.filter(f => f.severity === 'block');
  const lines = [
    `NOT exported. "${r.model}" read this as the sceptical buyer at v${r.version} and found ${r.blocks} blocking ${r.blocks === 1 ? 'finding' : 'findings'}. This document is not sent until they are answered.`,
    '',
    ...blocks.map((f, i) => `${i + 1}. sheet ${f.sheet} · ${f.rule}: ${f.finding} → ${f.fix}`),
  ];
  if (blocks.length < r.blocks) {
    lines.push(`… and ${r.blocks - blocks.length} more; run red_team_document for the full list.`);
  }
  lines.push('', 'Fix each one with edit_document on the named sheet, then run red_team_document again. Export once it comes back with no blocks — or say to the person which finding you are overriding and why.');
  return lines.join('\n');
}
