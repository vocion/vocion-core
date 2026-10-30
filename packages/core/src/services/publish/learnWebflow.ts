/**
 * LEARN A WEBFLOW TARGET FROM THE SITE'S OWN BLOG, and put it in front of a
 * person — the Webflow twin of `learnTemplate.ts`. The site is found among
 * the ones the workspace's Webflow login reaches (by id, webflow.io name or
 * domain), its blog collection by name, and the field mapping from the
 * collection's schema and its latest posts (`libs/publish/webflowMapping.ts`).
 * What comes out is written on the project as `publishTargetSuggestion`,
 * which the project page's Publishing shows with Apply and Dismiss: nothing
 * here writes `publishTargets`.
 *
 * Runs when a person saves a Webflow target with no field mapping (the
 * project PATCH), and when an agent asks (`seo_learn_frontmatter` with
 * `webflow_site`, onboarding with Webflow connected).
 */

import type { LearnOutcome } from './learnTemplate';
import type { PublishTargetSuggestion } from '@/libs/publish/learnTemplate';
import type { StoredPublishTarget } from '@/libs/publish/targets';
import type { WebflowClient } from '@/libs/webflow/api';

/** What to learn from: a Webflow target the project has, or a site and (optionally) its blog collection. */
export type WebflowLearnRequest = {
  targetId?: string;
  /** The site: its id, its webflow.io name, or its address. */
  site?: string;
  /** The blog collection: its id, slug or name, when the site has more than one that looks like a blog. */
  collection?: string;
  /** Who asked: a person's id, or `agent:<slug>`. */
  by: string | null;
};

/**
 * Learn the target from the site's blog and keep it on the project as a
 * suggestion. Never writes the project's targets.
 * @param orgId - The workspace.
 * @param projectId - The project.
 * @param req - What to learn from.
 * @param client - The Webflow client (the workspace's login by default).
 */
export async function suggestWebflowTarget(orgId: string, projectId: number, req: WebflowLearnRequest, client?: WebflowClient): Promise<LearnOutcome> {
  const { getDataRoom, updateDataRoom } = await import('@/services/DataRoomService');
  const { blogCollectionOf, learnWebflowFields, WEBFLOW_FIELD_LABEL } = await import('@/libs/publish/webflowMapping');
  const { findSite, siteUrlOf } = await import('@/libs/webflow/api');
  const { publishTargetSchema } = await import('@/libs/publish/targets');
  const project = await getDataRoom(orgId, projectId);
  if (!project) {
    return { ok: false, why: `#${projectId} is not a project in this workspace.` };
  }
  const targets = (project.meta.publishTargets ?? []) as StoredPublishTarget[];
  const webflowTargets = targets.filter(t => t.kind === 'webflow');
  const existing = req.targetId ? targets.find(t => t.id === req.targetId) : !req.site && webflowTargets.length === 1 ? webflowTargets[0] : undefined;
  if (req.targetId && !existing) {
    return { ok: false, why: `The project has no publish target "${req.targetId}".` };
  }
  if (existing && existing.kind !== 'webflow') {
    return { ok: false, why: `"${existing.id}" publishes to ${existing.kind}, not Webflow.` };
  }
  const config = (existing?.config ?? {}) as { siteId?: string; siteUrl?: string; collectionId?: string; collectionPath?: string };
  const siteRef = req.site?.trim() || config.siteId || config.siteUrl;
  if (!siteRef) {
    return { ok: false, why: 'Name the client\'s Webflow site (its address, or its webflow.io name), or a Webflow target of the project.' };
  }
  let api = client;
  if (!api) {
    const { webflowAccessFor } = await import('./webflowPublish');
    const token = await webflowAccessFor(orgId, /^[a-f0-9]{24}$/i.test(siteRef) ? siteRef : null, projectId);
    if (!token) {
      return { ok: false, why: 'Webflow is not connected: connect it (Log in with Webflow) and pick the client\'s site, then learn the mapping.' };
    }
    const { webflowClient } = await import('@/libs/webflow/api');
    api = webflowClient(token);
  }
  try {
    const sites = await api.listSites();
    const site = findSite(sites, siteRef) ?? (config.siteId ? findSite(sites, config.siteId) : null);
    if (!site) {
      return { ok: false, why: `The Webflow login does not reach ${siteRef}${sites.length > 0 ? ` (it reaches ${sites.map(s => s.displayName).join(', ')})` : ''}: log in with Webflow again and pick that site.` };
    }
    const collections = await api.listCollections(site.id);
    const wanted = req.collection?.trim().toLowerCase() || config.collectionId?.toLowerCase();
    const summary = wanted
      ? collections.find(c => [c.id, c.slug, c.displayName, c.singularName].some(v => v.toLowerCase() === wanted))
      : blogCollectionOf(collections);
    if (!summary) {
      return { ok: false, why: `${wanted ? `${site.displayName} has no collection "${req.collection ?? config.collectionId}"` : `No collection on ${site.displayName} looks like its blog`}: name it (it has ${collections.map(c => c.displayName).join(', ') || 'none'}).` };
    }
    const [collection, items] = await Promise.all([api.getCollection(summary.id), api.listItems(summary.id, { limit: 3 })]);
    const learned = learnWebflowFields(collection, items.filter(i => !i.isDraft).slice(0, 2));
    const id = existing?.id ?? (targets.some(t => t.id === 'site') ? `site-${targets.length + 1}` : 'site');
    const target: StoredPublishTarget = {
      id,
      kind: 'webflow',
      ...(existing?.label ? { label: existing.label } : {}),
      config: {
        siteId: site.id,
        siteUrl: config.siteUrl ?? siteUrlOf(site),
        collectionId: collection.id,
        collectionPath: config.collectionPath ?? `/${collection.slug}`,
        fields: learned.fields,
      },
    };
    const checked = publishTargetSchema.safeParse(target);
    if (!checked.success) {
      return { ok: false, why: `The learned target does not hold: ${checked.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}.` };
    }
    const read = items.slice(0, 2).map(i => String(i.fieldData.name ?? i.id));
    const from = `${collection.displayName} on ${site.displayName}`;
    const suggestion: PublishTargetSuggestion = { target, replaces: existing?.id ?? null, repo: site.displayName, ref: collection.displayName, from, read, notes: learned.notes, at: new Date().toISOString(), by: req.by };
    await updateDataRoom(orgId, projectId, { publishTargetSuggestion: suggestion });
    const mapped = Object.entries(learned.fields).map(([k, v]) => `${WEBFLOW_FIELD_LABEL[k as keyof typeof WEBFLOW_FIELD_LABEL]} → ${v}`).join(', ');
    return {
      ok: true,
      suggestion,
      line: `Read ${from} (${collection.fields.length} fields${read.length > 0 ? `, and ${read.join(', ')}` : ''}): ${mapped || 'nothing mapped'}. It waits on the project's Publishing for a person to apply.${learned.notes.length > 0 ? ` To check: ${learned.notes.join(' ')}` : ''}`,
    };
  } catch (error) {
    return { ok: false, why: `${(error as Error).message}.` };
  }
}
