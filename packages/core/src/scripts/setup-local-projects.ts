/**
 * Give a local instance one project per workspace, so the workspace switcher
 * has something to switch between.
 *
 * Signup creates a single "Default project", but this deployment carries two
 * workspaces (metacto-revenue, delivery-stack) that each expect their own
 * project — on prod those exist and each manifest's placeholder `orgId`
 * re-keys onto one. Locally the sole project gets auto-targeted instead, so
 * whichever workspace was applied last silently owns "Default project" and
 * the other is invisible.
 *
 * This renames the default project IN PLACE (keeping its id, so an active
 * session and the `vocion_active_project` cookie stay valid) and adds the
 * missing sibling. Idempotent: re-running reports and changes nothing.
 *
 * Apply the workspaces afterwards, naming the project explicitly — with more
 * than one project, auto-targeting no longer applies:
 *
 *   npm run workspace:apply -- <path>/metacto-revenue --project revenue
 *   npm run workspace:apply -- <path>/delivery-stack  --project delivery-stack
 *
 * Usage:
 *   npm run local:setup-projects
 */

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema, tenantAccountSchema } from '@/models/Schema';
import 'dotenv/config';

/** The project each workspace expects, keyed by the slug its manifest re-keys onto. */
const PROJECTS = [
  { slug: 'revenue', name: 'Metacto Revenue', description: 'RevOps workspace — workspace/metacto-revenue' },
  { slug: 'delivery-stack', name: 'Delivery Stack', description: 'Delivery workspace — workspace/delivery-stack' },
];

/** The default project signup creates; renamed rather than left as a duplicate. */
const DEFAULT_SLUG = 'default';

async function main() {
  const accounts = await db.select({ id: tenantAccountSchema.id, slug: tenantAccountSchema.slug }).from(tenantAccountSchema);
  // Prefer the real tenant over the bootstrap "default" account.
  const account = accounts.find(a => a.slug !== 'default') ?? accounts[0];
  if (!account) {
    console.error('no tenant_account rows — sign in once first');
    process.exit(1);
  }
  console.log(`account: ${account.slug} (${account.id})`);

  const existing = await db
    .select({ id: projectSchema.id, slug: projectSchema.slug, name: projectSchema.name })
    .from(projectSchema)
    .where(eq(projectSchema.accountId, account.id));

  // Rename the default in place so its content (already applied there) keeps
  // its id — a new row would orphan every agent/skill/mission scoped to it.
  const fallback = existing.find(p => p.slug === DEFAULT_SLUG);
  const first = PROJECTS[0]!;
  if (fallback && !existing.some(p => p.slug === first.slug)) {
    await db
      .update(projectSchema)
      .set({ slug: first.slug, name: first.name, description: first.description })
      .where(eq(projectSchema.id, fallback.id));
    console.log(`renamed "${fallback.name}" → ${first.name} (${first.slug}), id unchanged: ${fallback.id}`);
  }

  for (const spec of PROJECTS) {
    const [found] = await db
      .select({ id: projectSchema.id })
      .from(projectSchema)
      .where(and(eq(projectSchema.accountId, account.id), eq(projectSchema.slug, spec.slug)))
      .limit(1);

    if (found) {
      console.log(`  ${spec.slug.padEnd(15)} exists  ${found.id}`);
      continue;
    }
    const id = `proj-${randomUUID()}`;
    await db.insert(projectSchema).values({ id, accountId: account.id, slug: spec.slug, name: spec.name, description: spec.description });
    console.log(`  ${spec.slug.padEnd(15)} created ${id}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
