/**
 * The Audits register — `seo_audit`, one record per run per client project,
 * holding that run's findings (`audit.ts`).
 *
 * Code writes every row: a run creates its record (held unique by the
 * database through the external key `seo-audit` / `<project>:<checkedAt>`,
 * so the same run filed twice is one row), carries a person's verdicts
 * forward from the project's last run, and marks fixed on that run what this
 * one no longer finds. A finding's status moves only through
 * `updateFindings` (dismiss, mark fixed, reopen) or a "Fix it" that links
 * the page or task it made; each move carries its date, who and why. The
 * counts the Audits page lists are written with the findings, never later.
 */

import type { AuditCounts, AuditCoverage, AuditFinding, FindingEvent, FindingFix } from './audit';
import type { SeoProfile } from './profile';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { businessObjectSchema } from '@/models/Schema';
import { getObjectTypeBySlug } from '@/services/BusinessObjectService';
import { auditCounts, nextFindingStatus, nextSteps, renderAuditReport } from './audit';
import { mergeMeta } from './records';

export const SEO_AUDIT_TYPE = 'seo_audit';
export const AUDIT_EXTERNAL_SYSTEM = 'seo-audit';

export type SeoAuditMeta = {
  projectId: number;
  projectName: string;
  site: string;
  checkedAt: string;
  findings: AuditFinding[];
  counts: AuditCounts;
  /** The counts the list shows, flat. */
  openCount: number;
  highCount: number;
  /** The recommended next steps, in work order. */
  nextSteps: string[];
  /** The report as markdown: the record page shows it, each finding with its Fix it. */
  report: string;
  reportArtifactId?: number;
  inventoryArtifactId?: number;
  pagesRead: number;
  listed?: number;
  coverage?: AuditCoverage;
  /** The run this one followed, for the carry-forward. */
  previousAuditId?: number;
};

export type SeoAuditRecord = { id: number; title: string; meta: SeoAuditMeta; createdAt: Date };

/**
 * What a record's findings make of its counts, steps and report. Pure.
 * @param id - The audit's id (its Fix it links name it).
 * @param m - The audit's meta, findings already moved.
 * @param profile - The client's SEO profile.
 */
export function derived(id: number, m: Pick<SeoAuditMeta, 'findings' | 'projectName' | 'site' | 'checkedAt' | 'pagesRead' | 'listed' | 'inventoryArtifactId' | 'coverage'>, profile?: SeoProfile): Pick<SeoAuditMeta, 'counts' | 'openCount' | 'highCount' | 'nextSteps' | 'report'> {
  const counts = auditCounts(m.findings);
  return {
    counts,
    openCount: counts.open,
    highCount: counts.high,
    nextSteps: nextSteps(m.findings, profile),
    report: renderAuditReport({ auditId: id, projectName: m.projectName, site: m.site, checkedAt: m.checkedAt, findings: m.findings, profile, pagesRead: m.pagesRead, listed: m.listed, inventoryArtifactId: m.inventoryArtifactId ?? null, coverage: m.coverage }),
  };
}

/**
 * The audit's row status, which a strategy milestone linked to it reads:
 * `resolved` only when no finding remains open and all fixes are verified. Then the
 * project's strategy is read again.
 * @param orgId - The workspace.
 * @param id - The audit.
 * @param meta - Its meta as written.
 */
async function settleRowStatus(orgId: string, id: number, meta: SeoAuditMeta | null): Promise<void> {
  if (!meta) {
    return;
  }
  const { DONE_STATUS, refreshStrategy, setRowStatus } = await import('./strategy');
  await setRowStatus(orgId, id, meta.openCount === 0 && meta.coverage?.complete && !meta.findings.some(f => f.verification === 'not_checked' || (f.status === 'fixed' && f.verification !== 'verified_fixed')) ? DONE_STATUS.audit : 'active');
  await refreshStrategy(orgId, meta.projectId);
}

const toRecord = (r: { id: number; title: string; metadata: unknown; createdAt: Date }): SeoAuditRecord => ({ id: r.id, title: r.title, meta: r.metadata as SeoAuditMeta, createdAt: r.createdAt });

/**
 * One audit, or null when the id is not an audit here.
 * @param orgId - The workspace.
 * @param id - The record.
 */
export async function getAudit(orgId: string, id: number): Promise<SeoAuditRecord | null> {
  const type = await getObjectTypeBySlug(orgId, SEO_AUDIT_TYPE);
  if (!type) {
    return null;
  }
  const [row] = await db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title, metadata: businessObjectSchema.metadata, createdAt: businessObjectSchema.createdAt }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, type.id), eq(businessObjectSchema.id, id))).limit(1);
  return row ? toRecord(row) : null;
}

/**
 * A project's audits, newest first.
 * @param orgId - The workspace.
 * @param projectId - The project.
 */
export async function listProjectAudits(orgId: string, projectId: number): Promise<SeoAuditRecord[]> {
  const type = await getObjectTypeBySlug(orgId, SEO_AUDIT_TYPE);
  if (!type) {
    return [];
  }
  const rows = await db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title, metadata: businessObjectSchema.metadata, createdAt: businessObjectSchema.createdAt }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, type.id), sql`${businessObjectSchema.metadata}->>'projectId' = ${String(projectId)}`)).orderBy(desc(sql`${businessObjectSchema.metadata}->>'checkedAt'`), desc(businessObjectSchema.id));
  return rows.map(toRecord);
}

/** What one run hands the register. */
export type AuditRun = {
  project: { id: number; title: string; profile?: SeoProfile };
  site: string;
  checkedAt: string;
  findings: AuditFinding[];
  pagesRead: number;
  listed?: number;
  coverage?: AuditCoverage;
  inventoryArtifactId?: number;
  by: string;
};

/**
 * File one run as its own record, a person's verdicts carried forward from
 * the project's last run, and what this run no longer finds marked fixed on
 * that run. Null when the SEO app's `seo_audit` type is not installed.
 * @param orgId - The workspace.
 * @param run - The run.
 */
export async function fileAudit(orgId: string, run: AuditRun): Promise<{ audit: SeoAuditRecord; created: boolean; resolved: string[]; previous: SeoAuditRecord | null } | null> {
  const type = await getObjectTypeBySlug(orgId, SEO_AUDIT_TYPE);
  if (!type) {
    return null;
  }
  const { carryForward } = await import('./audit');
  const previous = (await listProjectAudits(orgId, run.project.id)).find(a => a.meta.checkedAt < run.checkedAt) ?? null;
  const { findings, resolved } = carryForward(previous?.meta.findings, run.findings, previous?.meta.site === run.site ? run.coverage : undefined);
  const base = { projectId: run.project.id, projectName: run.project.title, site: run.site, checkedAt: run.checkedAt, findings, coverage: run.coverage, pagesRead: run.pagesRead, ...(run.listed ? { listed: run.listed } : {}), ...(run.inventoryArtifactId ? { inventoryArtifactId: run.inventoryArtifactId } : {}), ...(previous ? { previousAuditId: previous.id } : {}) };
  const title = `Audit · ${run.project.title} · ${run.checkedAt.slice(0, 10)}`;
  const externalId = `${run.project.id}:${run.checkedAt}`;
  const [inserted] = await db
    .insert(businessObjectSchema)
    .values({ orgId, typeId: type.id, title, status: 'active', metadata: { ...base, ...derived(0, base, run.project.profile) }, externalSystem: AUDIT_EXTERNAL_SYSTEM, externalId, createdBy: run.by })
    .onConflictDoNothing({ target: [businessObjectSchema.orgId, businessObjectSchema.externalSystem, businessObjectSchema.externalId] })
    .returning({ id: businessObjectSchema.id, title: businessObjectSchema.title });
  let id: number;
  if (inserted) {
    id = inserted.id;
    const { announceObjectCreated } = await import('@/services/objects/objectCreated');
    await announceObjectCreated(orgId, inserted, SEO_AUDIT_TYPE, { source: 'service', actor: run.by });
  } else {
    const [existing] = await db.select({ id: businessObjectSchema.id }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.externalSystem, AUDIT_EXTERNAL_SYSTEM), eq(businessObjectSchema.externalId, externalId))).limit(1);
    id = existing!.id;
  }
  // The report's Fix it links name the record, known only now.
  const written = await mergeMeta<SeoAuditMeta>(orgId, id, current => derived(id, current, run.project.profile));
  await settleRowStatus(orgId, id, written);
  if (previous && resolved.length) {
    await moveFindings(orgId, previous.id, resolved, { kind: 'not_found' }, { by: run.by, note: `not found on the run of ${run.checkedAt.slice(0, 10)}` }, run.project.profile);
  }
  return { audit: (await getAudit(orgId, id))!, created: Boolean(inserted), resolved, previous };
}

/** One finding's move: what it is now, or why it did not move. */
export type FindingMove = { key: string; status?: AuditFinding['status']; refused?: string };

/**
 * Move findings on one audit under its row lock: each by `nextFindingStatus`,
 * with when, who and why; a fix links what it made. Unknown keys are refused
 * by name.
 * @param orgId - The workspace.
 * @param auditId - The audit.
 * @param keys - The findings, by key.
 * @param event - What happened (or a fix to link, which leaves the status open).
 * @param who - Who, and why.
 * @param who.by
 * @param who.note
 * @param profile - The client's profile, for the next steps.
 * @param fix - What a Fix it made, to link on each finding.
 */
export async function moveFindings(orgId: string, auditId: number, keys: readonly string[], event: FindingEvent | null, who: { by: string; note?: string }, profile?: SeoProfile, fix?: FindingFix): Promise<FindingMove[]> {
  const moves: FindingMove[] = [];
  const at = new Date().toISOString();
  await mergeMeta<SeoAuditMeta>(orgId, auditId, (current) => {
    moves.length = 0;
    const want = new Set(keys);
    const findings = current.findings.map((f) => {
      if (!want.has(f.key)) {
        return f;
      }
      want.delete(f.key);
      if (fix) {
        moves.push({ key: f.key, status: f.status });
        return { ...f, fix };
      }
      const next = nextFindingStatus(f.status, event!);
      if (typeof next !== 'string') {
        moves.push({ key: f.key, refused: next.refused });
        return f;
      }
      moves.push({ key: f.key, status: next });
      const verification = event?.kind === 'mark_fixed' ? 'reported_fixed' as const : event?.kind === 'not_found' ? 'verified_fixed' as const : f.verification;
      return next === f.status && verification === f.verification ? f : { ...f, status: next, verification, statusAt: at, statusBy: who.by, ...(event?.kind === 'mark_fixed' ? { reportedFixedBy: who.by, reportedFixedAt: at } : {}), ...(event?.kind === 'not_found' ? { verifiedBy: who.by, verifiedAt: at } : {}), ...(who.note ? { statusNote: who.note } : {}) };
    });
    for (const k of want) {
      moves.push({ key: k, refused: 'no such finding on this audit' });
    }
    return { findings, ...derived(auditId, { ...current, findings }, profile) };
  });
  const audit = await getAudit(orgId, auditId);
  await settleRowStatus(orgId, auditId, audit?.meta ?? null);
  return moves;
}
