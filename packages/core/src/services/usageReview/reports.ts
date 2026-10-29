/**
 * A workspace's usage reviews, as the Manage page lists them: the briefings
 * the review published, newest first, with the figures each one carries. The
 * report is the artifact; this only reads it back.
 */

import type { ReadModeDecision } from './privacy';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { briefingSchema } from '@/models/Schema';
import { pluginEnabled } from '@/services/PluginService';
import { readModeForAccount } from './privacy';
import { METRIC, USAGE_REVIEW_TITLE } from './report';
import { reportMode } from './rollup';
import { USAGE_REVIEW_SEAT } from './UsageReviewService';

export type UsageReportRow = {
  briefingId: number;
  title: string;
  createdAt: string;
  summary: string | null;
  readAs: 'content' | 'metadata';
  threads: number | null;
  outcomeRate: number | null;
  reaskRate: number | null;
  /** The friction themes it led with, labels and counts. */
  themes: string[];
};

export type UsageReports = {
  /** Whether the Workspace manager plugin is on here: the daily review runs only then. */
  on: boolean;
  /** How the Org is read now. */
  mode: ReadModeDecision;
  reports: UsageReportRow[];
};

/**
 * The workspace's recent usage reviews.
 * @param orgId - The workspace.
 * @param accountId - Its Org, for the mode it is read in now.
 * @param limit - How many (default 14: two weeks).
 */
export async function listUsageReports(orgId: string, accountId: string | null, limit = 14): Promise<UsageReports> {
  const [rows, on, mode] = await Promise.all([
    db.select({ id: briefingSchema.id, title: briefingSchema.title, createdAt: briefingSchema.createdAt, document: briefingSchema.document })
      .from(briefingSchema)
      .where(and(eq(briefingSchema.orgId, orgId), eq(briefingSchema.teamSlug, USAGE_REVIEW_SEAT), eq(briefingSchema.agentSlug, USAGE_REVIEW_SEAT)))
      .orderBy(desc(briefingSchema.createdAt))
      .limit(limit),
    pluginEnabled(orgId, USAGE_REVIEW_SEAT),
    readModeForAccount(accountId),
  ]);
  return {
    on,
    mode,
    reports: rows.filter(r => r.title.startsWith(USAGE_REVIEW_TITLE)).map((r) => {
      const metric = (key: string) => r.document?.today?.metrics.find(m => m.key === key)?.value ?? null;
      return {
        briefingId: r.id,
        title: r.title,
        createdAt: r.createdAt.toISOString(),
        summary: r.document?.today?.summary ?? null,
        readAs: r.document ? reportMode(r.document) : 'metadata',
        threads: metric(METRIC.threads),
        outcomeRate: metric(METRIC.outcome),
        reaskRate: metric(METRIC.reask),
        themes: (r.document?.exceptions?.items ?? []).filter(e => e.key.startsWith('theme-')).map(e => e.label),
      };
    }),
  };
}
