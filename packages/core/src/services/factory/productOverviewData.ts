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
 */
export async function loadProductOverview(orgId: string, id: string, now = new Date()): Promise<ProductOverview | null> {
  const recordId = Number(id);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    return null;
  }
  const products = await loadObjectRows(orgId, 'product');
  const product = products.find(p => Number(p.id) === recordId);
  if (!product) {
    return null;
  }
  const [requests, releases, environments, work, rel] = await Promise.all([
    loadObjectRows(orgId, 'request'),
    loadObjectRows(orgId, 'release'),
    loadObjectRows(orgId, 'environment'),
    readPageForOrg(WORK_PAGE, orgId).catch(() => null),
    readPageForOrg(RELEASES_PAGE, orgId).catch(() => null),
  ]);
  const email = typeof product.meta.accountableUser === 'string' ? product.meta.accountableUser : null;
  const links: OverviewLinks = {
    workSlug: work?.slug ?? null,
    releasesSlug: rel?.slug ?? null,
    record: await recordLinkerForOrg(orgId),
  };
  return buildProductOverview({ product, products, requests, releases, ownerName: await memberName(orgId, email), links, environments, now });
}
