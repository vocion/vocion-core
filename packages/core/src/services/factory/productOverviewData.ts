import type { MediaSlide } from '@/features/dashboard/factory/MediaCarousel';
import type { RecordStatus } from '@/libs/factory/liveStatus';
import type { OverviewLinks, ProductOverview } from '@/libs/workspace/productOverview';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { buildProductOverview } from '@/libs/workspace/productOverview';
import { accountMembershipSchema, projectSchema, userSchema } from '@/models/Schema';
import { recordLinkerForOrg } from '@/services/objects/recordHref';
import { readPageForOrg } from '@/services/PluginService';
import { loadObjectRows } from '@/services/workspace/objectRows';

/**
 * The pages a product's overview links into: Work (a product's queue, and
 * where one request opens) and Releases (the product's releases, and where
 * one release opens). Read from the pages themselves, so when a workspace
 * points Releases' rows somewhere new the overview follows without an edit.
 */
const WORK_PAGE = 'work';
const RELEASES_PAGE = 'releases';

/**
 * The accountable person's name, if they are a member of this workspace's
 * account. A name is only looked up among the account's own members, so an
 * email typed on a record never reveals who someone is in another tenant.
 * @param orgId - The workspace (project).
 * @param email - The address on the record.
 */
async function memberName(orgId: string, email: string | null): Promise<string | null> {
  if (!email) {
    return null;
  }
  const [hit] = await db
    .select({ name: userSchema.name })
    .from(userSchema)
    .innerJoin(accountMembershipSchema, eq(accountMembershipSchema.userId, userSchema.id))
    .innerJoin(projectSchema, eq(projectSchema.accountId, accountMembershipSchema.accountId))
    .where(and(eq(projectSchema.id, orgId), sql`lower(${userSchema.email}) = ${email.toLowerCase()}`))
    .limit(1);
  return hit?.name?.trim() || null;
}

/**
 * Load one product's overview, or null when the id is not a product in
 * this workspace.
 * @param orgId - The workspace.
 * @param id - The product record's id, from the URL.
 * @param now - The clock.
 * @param opts - Options.
 * @param opts.paused - How many of the plugin's automations are paused.
 */
export async function loadProductOverview(orgId: string, id: string, now = new Date(), opts: { paused?: number } = {}): Promise<ProductOverview | null> {
  const recordId = Number(id);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    return null;
  }
  const { factoryTypes } = await import('@/libs/factory/types');
  const types = await factoryTypes(orgId);
  const products = await loadObjectRows(orgId, types.product);
  const found = products.find(p => Number(p.id) === recordId);
  if (!found) {
    return null;
  }
  // Where it lives and what makes it are read from its environment and
  // repository records (`x-derived` on its type), not from what it stored.
  const { derivedFieldsOf } = await import('@/services/objects/related');
  const derived = await derivedFieldsOf(orgId, recordId).catch(() => ({ values: {}, drift: {} }));
  const product = { ...found, meta: { ...found.meta, ...derived.values } };
  const slug = typeof product.meta.slug === 'string' ? product.meta.slug : null;
  const [requests, releases, environments, repos, tasks, work, rel] = await Promise.all([
    loadObjectRows(orgId, types.request),
    loadObjectRows(orgId, types.release),
    loadObjectRows(orgId, types.environment),
    loadObjectRows(orgId, types.repo).catch(() => []),
    loadObjectRows(orgId, types.task).catch(() => []),
    readPageForOrg(WORK_PAGE, orgId).catch(() => null),
    readPageForOrg(RELEASES_PAGE, orgId).catch(() => null),
  ]);
  const mine = slug ? requests.filter(r => r.meta.product === slug) : [];
  const myReleases = slug ? releases.filter(r => r.meta.product === slug) : [];
  const { loadWorkLive } = await import('./liveStatusData');
  const { loadPendingBuilds } = await import('./pendingBuilds');
  const { loadReleaseLinked } = await import('./releaseData');
  const { workspaceTimeZone } = await import('@/libs/time/workspaceTimeZone');
  const [live, pendingBuilds, releaseLinked, timeZone] = await Promise.all([
    loadWorkLive(orgId, mine, tasks, now),
    loadPendingBuilds(orgId).catch(() => []),
    loadReleaseLinked(orgId, myReleases.slice(0, 60)).catch(() => undefined),
    workspaceTimeZone(orgId).catch(() => 'UTC'),
  ]);
  const email = typeof product.meta.accountableUser === 'string' ? product.meta.accountableUser : null;
  const links: OverviewLinks = {
    workSlug: work?.slug ?? null,
    releasesSlug: rel?.slug ?? null,
    record: await recordLinkerForOrg(orgId),
    types,
  };
  return buildProductOverview({
    product,
    products,
    requests,
    releases,
    ownerName: await memberName(orgId, email),
    links,
    environments,
    repos,
    work: { tasks, live, pendingBuilds },
    releaseLinked,
    timeZone,
    paused: opts.paused,
    now,
  });
}

/** How many in-flight records the overview reads a live status for. */
const STATUS_SHOWN = 6;

/**
 * You, Now, Next for each piece of work in flight — the feature page's own
 * read (`loadRecordStatus`), so the overview, the pane and the feature say
 * the same thing; each row then keeps itself current on the live stream.
 * @param orgId - Tenant.
 * @param ids - The in-flight records.
 * @param now - The clock.
 */
export async function loadWorkStatuses(orgId: string, ids: ReadonlyArray<string | number>, now = new Date()): Promise<Map<number, RecordStatus>> {
  const { loadRecordStatus } = await import('@/services/objects/recordStatus');
  const reads = await Promise.all(ids.slice(0, STATUS_SHOWN).map(async (id) => {
    const read = await loadRecordStatus(orgId, Number(id), now).catch(() => null);
    return read?.ok ? [Number(id), read.status] as const : null;
  }));
  return new Map(reads.filter((r): r is readonly [number, RecordStatus] => r !== null));
}

/**
 * The overview's pictures as the carousel draws them: each one an image
 * artifact that exists in this workspace, the same picture once.
 * @param orgId - Tenant.
 * @param pictures - The overview's pictures.
 */
export async function loadProductSlides(orgId: string, pictures: ProductOverview['pictures']): Promise<MediaSlide[]> {
  const ids = [...new Set(pictures.map(p => p.artifactId))];
  if (ids.length === 0) {
    return [];
  }
  const { listArtifactsByIds } = await import('@/services/ArtifactService');
  const { imageUrlOf } = await import('@/services/workspace/pageImages');
  const rows = new Map((await listArtifactsByIds({ orgId, ids })).map(a => [a.id, a]));
  const seen = new Set<number>();
  const out: MediaSlide[] = [];
  for (const p of pictures) {
    const a = rows.get(p.artifactId);
    const src = a && a.kind !== 'markdown' ? imageUrlOf(a) : null;
    if (!a || !src || seen.has(a.id)) {
      continue;
    }
    seen.add(a.id);
    out.push({ id: a.id, src, label: p.label, title: a.title ?? p.caption, caption: p.caption, source: p.source });
  }
  return out.slice(0, 8);
}
