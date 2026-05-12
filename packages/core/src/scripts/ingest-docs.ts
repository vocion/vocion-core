/**
 * ingest-docs — load every `docs/**\/*.md` + `requirements/**\/*.md`
 * file into the native knowledge tables, per-org.
 *
 * Why per-org rather than a shared "system" tenant? The knowledge_*
 * tables are org-scoped at the column level (the HNSW index seek
 * intersects against `org_id`), so a shared tenant would need a
 * special-case bypass everywhere. Re-ingesting per-org is cheap —
 * `content_hash` dedup means re-running is O(orgs * unchanged_docs)
 * disk reads, no embeddings spent.
 *
 * Usage:
 *
 *   # Ingest for one org:
 *   ORG_ID=org_xyz npm run docs:ingest
 *
 *   # Bootstrap every existing org in the system:
 *   ALL_ORGS=1 npm run docs:ingest
 *
 * Tracks the source as slug `vocion-docs` so the agent's
 * search_knowledge tool can target `source_types=['vocion-docs']`.
 */

import process from 'node:process';
import { db } from '@/libs/DB';
import { listDocs, readDoc } from '@/libs/docs';
import { organizationSchema } from '@/models/Schema';
import { ensureSource, ingestDocument, markSourceSynced, tombstoneMissing } from '@/services/IngestionService';

const DOCS_SOURCE_SLUG = 'vocion-docs';

async function ingestForOrg(orgId: string): Promise<{ orgId: string; created: number; updated: number; unchanged: number; total: number }> {
  const src = await ensureSource({ orgId, slug: DOCS_SOURCE_SLUG, kind: 'plugin' });
  const cutoff = new Date();
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const entries = listDocs({ kind: 'all' });
  for (const entry of entries) {
    const doc = readDoc(entry.slug);
    if (!doc) {
      continue;
    }
    const res = await ingestDocument(src, {
      externalId: entry.path,
      title: entry.title,
      uri: `/docs/${entry.slug}`,
      content: doc.content,
      metadata: {
        group: entry.group,
        navLabel: entry.navLabel,
        navOrder: entry.navOrder,
        description: entry.description,
      },
    });
    if (res.status === 'created') {
      created += 1;
    } else if (res.status === 'updated') {
      updated += 1;
    } else {
      unchanged += 1;
    }
  }
  // Prune docs that were removed from disk (`last_seen_at < cutoff`).
  await tombstoneMissing(src, cutoff);
  await markSourceSynced(src.sourceId);
  return { orgId, created, updated, unchanged, total: entries.length };
}

async function main(): Promise<void> {
  const allOrgs = process.env.ALL_ORGS === '1';
  const orgId = process.env.ORG_ID;
  if (!allOrgs && !orgId) {
    console.error('Set ORG_ID=org_... or ALL_ORGS=1');
    process.exit(2);
  }
  const orgs: string[] = allOrgs
    ? (await db.select({ id: organizationSchema.id }).from(organizationSchema)).map(r => r.id)
    : [orgId!];
  if (orgs.length === 0) {
    console.warn('No orgs found.');
    return;
  }
  for (const o of orgs) {
    const summary = await ingestForOrg(o);
    console.log(`[ingest-docs] ${summary.orgId}: ${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged (of ${summary.total})`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
