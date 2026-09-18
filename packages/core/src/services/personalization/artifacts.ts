/**
 * The lead's three artifacts, and the decision that pins them.
 *
 * > **Evidence → Brief → Recommendation → Draft sequence → Human decision → Action**
 * > "Each link an artifact with a version and an author, and the decision
 * > pinning the exact versions it approved."
 * > — `docs/design/reduction.md` Part 2, from `docs/specs/personalization-v2.md`
 *
 * Three artifacts, one record:
 *
 * | Role | Kind | What it answers |
 * |---|---|---|
 * | `brief` | `markdown` | What do we know? |
 * | `recommendation` | `markdown` | Given that, what should we do, and why? |
 * | `sequence` | `sequence` (typed) | What exactly will be sent? |
 *
 * They are artifacts rather than columns because a brief is markdown produced
 * by an agent, edited by a human, that needs versions, authorship, a change
 * summary, a stable id and citation — which is the artifact contract exactly.
 * Building a `brief` table beside `artifact` would be the §19 mistake: a real
 * gap closed locally, leaving the platform worse. Using artifacts closes it
 * generically, and the brief inherits version history, restore, the preview
 * panel, `@mention` and the artifacts log for free.
 *
 * `lead_brief` stays the LEDGER — the row is still the record that the pass
 * happened, and it still holds the queue lane, the attempts and the audit
 * stamps. What moved is the CONTENT a person reads, edits and cites.
 *
 * Two rules this module exists to enforce:
 *
 * - **Regeneration is a new version, never a silent overwrite** — with the
 *   reason in the change summary, so the history reads "v3 — regenerated: the
 *   angle leans on an industry pattern rather than anything about this
 *   company".
 * - **A decision pins the versions it approved.** `pinDecisionArtifacts`
 *   writes the exact ids and version numbers onto the `action_run` at decide
 *   time, so the audit answers *what did the human approve* rather than *what
 *   does this look like now*.
 */

import type { BriefClaim, BriefSection } from './brief';
import type { ConfidenceDimensions } from './confidence';
import type { CurrentSequence, RecommendedSequence } from './sequenceState';
import type { SequenceSpec } from '@/libs/cards/specs';
import type { ArtifactRow } from '@/services/ArtifactService';
import type { RecordRef } from '@/services/chat/pageContext';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, leadBriefSchema } from '@/models/Schema';
import { listArtifactsForRecord, upsertRecordArtifact } from '@/services/ArtifactService';
import { briefMarkdown, reduceBrief } from './brief';
import { computeConfidenceDimensions, recommendedPosture } from './confidence';
import { resolveSequenceState } from './sequenceState';

/** What each artifact IS to the lead. One artifact per role. */
export const LEAD_ARTIFACT_ROLES = ['brief', 'recommendation', 'sequence'] as const;
export type LeadArtifactRole = (typeof LEAD_ARTIFACT_ROLES)[number];

/** How each role reads in the "Working with:" indicator and the artifacts log. */
export const ROLE_LABEL: Record<LeadArtifactRole, string> = {
  brief: 'Research brief',
  recommendation: 'Outreach recommendation',
  sequence: 'Draft sequence',
};

/**
 * The `RecordRef` a lead's artifacts hang off.
 *
 * `lead` is already a `RECORD_TYPES` member, and the id is the `lead_brief`
 * row — the ledger row that IS the record of the pass.
 * @param leadId - `lead_brief.id`.
 */
export function leadRecordRef(leadId: number): { type: string; id: string } {
  return { type: 'lead', id: String(leadId) };
}

/** Everything the three artifacts are written from. */
export type LeadArtifactSource = {
  id: number;
  contactName: string;
  contactTitle?: string | null;
  companyName?: string | null;
  sections: readonly BriefSection[];
  claims: readonly BriefClaim[];
  missing: readonly string[];
  confidence?: number | null;
  dimensions?: ConfidenceDimensions | null;
  draftSequence: ReadonlyArray<{ step: number; day?: number; subject: string; body: string }>;
  recommendedSequence?: RecommendedSequence | null;
  currentSequence?: CurrentSequence | null;
};

/** Who wrote this version, and why. */
export type ArtifactAuthorship = {
  author: { kind: 'agent' | 'human' | 'system'; id?: string | null };
  /** The reason, which becomes the version's change summary. */
  changeSummary?: string | null;
  runId?: string | null;
};

/**
 * The recommendation artifact's markdown.
 *
 * Deliberately short and deliberately transactional: what, why, and — the P0
 * the review opened with — exactly what approving will do, or why it cannot
 * say. The posture sentence comes from the dimensions, so the recommendation
 * and the brief cannot disagree about how much is known.
 * @param lead - The lead's content.
 */
export function recommendationMarkdown(lead: LeadArtifactSource): string {
  const state = resolveSequenceState(lead.currentSequence, lead.recommendedSequence, lead.draftSequence.length);
  const lines: string[] = [`# Outreach recommendation — ${lead.contactName}`];

  lines.push('## What', lead.recommendedSequence
    ? `Enroll in **${lead.recommendedSequence.name}**${lead.draftSequence.length > 0 ? ` · ${lead.draftSequence.length} ${lead.draftSequence.length === 1 ? 'send' : 'sends'}` : ''}.`
    : 'No sequence chosen yet.');

  const why: string[] = [];
  if (lead.dimensions) {
    why.push(recommendedPosture(lead.dimensions).reason);
  }
  if (lead.recommendedSequence?.reason) {
    why.push(lead.recommendedSequence.reason);
  }
  if (why.length > 0) {
    lines.push('## Why', why.join(' '));
  }

  lines.push('## Current state', state.currentLine);
  lines.push(
    '## Approving will',
    state.approvingWill ?? `Nothing — held. ${state.blockedReason ?? 'The current and recommended sequences cannot be reconciled.'}`,
  );
  return lines.join('\n\n');
}

/**
 * The typed sequence artifact's spec.
 * @param lead
 */
export function sequenceSpecFor(lead: LeadArtifactSource): SequenceSpec {
  return {
    ...(lead.recommendedSequence?.id ? { sequenceId: lead.recommendedSequence.id } : {}),
    ...(lead.recommendedSequence?.name ? { sequenceName: lead.recommendedSequence.name } : {}),
    ...(lead.recommendedSequence?.reason ? { rationale: lead.recommendedSequence.reason } : {}),
    sends: lead.draftSequence.map(s => ({
      step: s.step,
      ...(s.day === undefined ? {} : { day: s.day }),
      subject: s.subject,
      body: s.body,
    })),
  };
}

export type SyncedArtifact = {
  role: LeadArtifactRole;
  id: number;
  title: string;
  version: number;
  kind: string;
  created: boolean;
  unchanged: boolean;
};

/**
 * Write (or re-version) the lead's three artifacts.
 *
 * Idempotent: a sync that produces identical content writes nothing, so the
 * hourly sweep does not fill three version menus with versions that changed
 * nothing. A regeneration passes its instruction as `changeSummary`, which is
 * what makes the history legible.
 * @param orgId - The project id.
 * @param lead - The lead's content.
 * @param by - Who wrote this version, and why.
 * @param only - Restrict the sync to these roles (a per-artifact regenerate).
 */
export async function syncLeadArtifacts(
  orgId: string,
  lead: LeadArtifactSource,
  by: ArtifactAuthorship,
  only?: readonly LeadArtifactRole[],
): Promise<SyncedArtifact[]> {
  const record = leadRecordRef(lead.id);
  const roles = only ?? LEAD_ARTIFACT_ROLES;
  const folder = 'personalization/leads';
  const out: SyncedArtifact[] = [];

  const write = async (role: LeadArtifactRole, kind: string, title: string, spec: unknown): Promise<void> => {
    const res = await upsertRecordArtifact({
      orgId,
      kind,
      title,
      spec,
      folder,
      record: { ...record, role },
      author: by.author,
      changeSummary: by.changeSummary ?? null,
      runId: by.runId ?? null,
      // The recommendation is already rendered on the decision card it belongs
      // to, so a second copy in the artifacts log is a duplicate of something
      // the person has already read. It stays an artifact rather than being
      // deleted because `action_run.pinned_artifacts` pins the exact versions
      // a human approved — the audit answer must not move.
      visibility: role === 'recommendation' ? 'system' : 'user',
    });
    out.push({
      role,
      id: res.artifact.id,
      title: res.artifact.title,
      version: res.artifact.currentVersion,
      kind: res.artifact.kind,
      created: res.created,
      unchanged: res.unchanged,
    });
  };

  if (roles.includes('brief')) {
    const reduced = reduceBrief({
      sections: lead.sections,
      missing: lead.missing,
      claims: lead.claims,
      dimensions: lead.dimensions ?? null,
      confidence: lead.confidence ?? null,
    });
    const title = `${lead.contactName} — research brief`;
    await write('brief', 'markdown', title, { title, md: briefMarkdown(reduced, title) });
  }

  if (roles.includes('recommendation')) {
    const title = `${lead.contactName} — outreach recommendation`;
    await write('recommendation', 'markdown', title, { title, md: recommendationMarkdown(lead) });
  }

  if (roles.includes('sequence')) {
    const title = lead.recommendedSequence?.name
      ? `${lead.contactName} — ${lead.recommendedSequence.name}`
      : `${lead.contactName} — draft sequence`;
    await write('sequence', 'sequence', title, sequenceSpecFor(lead));
  }

  return out;
}

/** An artifact as the page and the chat both refer to it. */
export type LeadArtifactRef = {
  role: LeadArtifactRole;
  id: number;
  title: string;
  version: number;
  kind: string;
  /** The `RecordRef` the chat attaches and the preview pane opens. */
  ref: RecordRef;
};

const toRef = (row: ArtifactRow): LeadArtifactRef | null => {
  const role = row.recordRole as LeadArtifactRole | null;
  if (!role || !LEAD_ARTIFACT_ROLES.includes(role)) {
    return null;
  }
  return {
    role,
    id: row.id,
    title: row.title,
    version: row.currentVersion,
    kind: row.kind,
    ref: { type: 'artifact', id: String(row.id), label: row.title, href: `/dashboard/artifacts/${row.id}` },
  };
};

/**
 * The lead's artifacts, in causal order: brief, then recommendation, then the
 * draft sequence they justify.
 * @param orgId - The project id.
 * @param leadId - `lead_brief.id`.
 */
export async function leadArtifacts(orgId: string, leadId: number): Promise<LeadArtifactRef[]> {
  const rows = await listArtifactsForRecord({ orgId, record: leadRecordRef(leadId) });
  const byRole = new Map<LeadArtifactRole, LeadArtifactRef>();
  for (const row of rows) {
    const ref = toRef(row);
    if (ref && !byRole.has(ref.role)) {
      byRole.set(ref.role, ref);
    }
  }
  return LEAD_ARTIFACT_ROLES.map(r => byRole.get(r)).filter((x): x is LeadArtifactRef => x !== undefined);
}

export type PinnedArtifact = { artifactId: number; role: string; version: number; title: string };

/**
 * Pin the versions a decision approved.
 *
 * Written at decide time onto the `action_run`, and never rewritten: a later
 * regeneration writes a new `artifact_version` and the pin keeps pointing at
 * what was on screen. That is the difference between an audit that answers
 * "what did they approve" and one that answers "what does this look like now"
 * (design principles 1 and 9).
 * @param orgId - The project id.
 * @param runId - The `action_run` being decided.
 * @param artifacts - What the page was showing.
 */
export async function pinDecisionArtifacts(
  orgId: string,
  runId: number,
  artifacts: readonly LeadArtifactRef[],
): Promise<PinnedArtifact[]> {
  const pinned: PinnedArtifact[] = artifacts.map(a => ({
    artifactId: a.id,
    role: a.role,
    version: a.version,
    title: a.title,
  }));
  if (pinned.length === 0) {
    return pinned;
  }
  await db
    .update(actionRunSchema)
    .set({ pinnedArtifacts: pinned })
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, runId)));
  return pinned;
}

/**
 * Pin whatever the lead behind this run currently has. Called from the decide
 * path, where the run id is what is in hand and the lead is a lookup.
 * @param orgId - The project id.
 * @param runId - The `action_run` being decided.
 */
export async function pinLeadArtifactsForRun(orgId: string, runId: number): Promise<PinnedArtifact[]> {
  const [lead] = await db
    .select({ id: leadBriefSchema.id })
    .from(leadBriefSchema)
    .where(and(eq(leadBriefSchema.orgId, orgId), eq(leadBriefSchema.reviewActionRunId, runId)))
    .limit(1);
  if (!lead) {
    return [];
  }
  return pinDecisionArtifacts(orgId, runId, await leadArtifacts(orgId, lead.id));
}

/**
 * Read one lead row and materialise its three artifacts from it.
 *
 * `lead_brief` stays the LEDGER — the row is the record that the pass
 * happened — and the artifacts are what a person reads, edits and cites. This
 * is the one function that keeps the two in step, and it is called from both
 * ends deliberately:
 *
 * - from the pipeline writes (`saveLeadBrief`, `saveDraftSequence`), which is
 *   where a new version genuinely belongs;
 * - from the lead page's read, as a backfill, so a lead briefed before this
 *   shipped has its artifacts the first time somebody opens it rather than
 *   only after the next sweep.
 *
 * Idempotent by construction: `upsertRecordArtifact` writes nothing when the
 * content is identical, so the read path costs three selects on a lead that is
 * already in step.
 * @param orgId - The project id.
 * @param leadId - `lead_brief.id`.
 * @param by - Who wrote this version, and why.
 * @param only - Restrict to these roles.
 */
export async function ensureLeadArtifacts(
  orgId: string,
  leadId: number,
  by: ArtifactAuthorship = { author: { kind: 'system' } },
  only?: readonly LeadArtifactRole[],
): Promise<LeadArtifactRef[]> {
  const [row] = await db
    .select()
    .from(leadBriefSchema)
    .where(and(eq(leadBriefSchema.orgId, orgId), eq(leadBriefSchema.id, leadId)))
    .limit(1);
  if (!row) {
    return [];
  }
  // Nothing has been researched yet: a lead on the queue with no brief has no
  // artifacts to write, and writing three empty ones would be the empty-state
  // branch the reduction pass exists to delete.
  if (row.sections.length === 0 && row.draftSequence.length === 0) {
    return [];
  }
  const dimensions = row.confidenceDimensions
    ? row.confidenceDimensions as unknown as ConfidenceDimensions
    : computeConfidenceDimensions({
        contactName: row.contactName,
        contactTitle: row.contactTitle,
        companyName: row.companyName,
        entranceSource: row.entranceSource,
        utmCampaign: row.utmCampaign,
        mqlAt: row.mqlAt,
        arrivedAt: row.arrivedAt,
        engagementSent: row.engagementSent,
        engagementOpened: row.engagementOpened,
        claims: row.claims,
        missing: row.missing,
      });

  await syncLeadArtifacts(orgId, {
    id: row.id,
    contactName: row.contactName,
    contactTitle: row.contactTitle,
    companyName: row.companyName,
    sections: row.sections,
    claims: row.claims,
    missing: row.missing,
    confidence: row.confidence,
    dimensions,
    draftSequence: row.draftSequence.map((s, i) => ({ ...s, step: s.step ?? i + 1 })),
    recommendedSequence: row.recommendedSequence ?? null,
    currentSequence: row.currentSequence ?? null,
  }, by, only);

  return leadArtifacts(orgId, leadId);
}
