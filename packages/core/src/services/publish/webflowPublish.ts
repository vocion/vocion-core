/**
 * PUBLISHING A PAGE TO A WEBFLOW SITE — the Webflow half of
 * `site.publish_page` and `site.publish_live` (`libs/actions/site-publish-page.ts`).
 *
 * Two approvals, never one:
 *
 * 1. **The draft.** The page becomes an item in the site's blog collection
 *    through the Data API, saved with `isDraft: true`: its markdown as
 *    Webflow rich text (`libs/publish/webflowRichText.ts`), each value in the
 *    field the project's mapping names (`libs/publish/webflowMapping.ts`),
 *    images by URL (Webflow fetches and hosts them). One item per slug: the
 *    page's own item, a draft at its slug, or the live post it refreshes is
 *    updated in place; a live post at its slug that is someone else's is
 *    never touched.
 * 2. **Going live** (`site.publish_live`). The item is taken out of draft and
 *    published, which `cms:write` covers: the site itself is not published,
 *    so nothing else waiting in the Designer goes out with it. Webflow refuses
 *    an item of a collection the site has never published; the page then
 *    stays a draft and the line says to publish the site once in Webflow.
 *
 * Which login: the workspace's Webflow connector whose login reaches the
 * target's site (`webflowAccessFor`).
 */

import type { PublishPlan } from './sitePublish';
import type { WebflowTarget } from '@/libs/publish/targets';
import type { WebflowClient, WebflowCollection, WebflowItem } from '@/libs/webflow/api';

/** The connector slug a Webflow site's connection runs. */
const CONNECTOR = 'webflow';

const NO_LOGIN = 'There is no Webflow login for this site yet. Connect Webflow (Connectors → Webflow → Log in with Webflow) and pick the client\'s site on Webflow\'s screen; a site API token under Advanced works too.';

/**
 * The token that reaches a site, among the Webflow connections this work may
 * use (`connectionScope.ts`: the workspace's, and the project's own, never
 * another client's): the one whose login lists the site, else one that does
 * not say which sites it reaches (a pasted site token). Null when there is none.
 * @param orgId - The workspace.
 * @param siteId - The site, when known.
 * @param projectId - The project the work is for; the current work's when omitted.
 */
export async function webflowAccessFor(orgId: string, siteId: string | null, projectId?: number | null): Promise<string | null> {
  const { connectionsFor } = await import('@/services/connect/connectionScope');
  const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
  const { webflowTokenOf } = await import('@/libs/sources/webflow');
  const rows = (await connectionsFor(orgId, projectId === undefined ? undefined : { projectId }))
    .filter(r => ((r.configJson?._connector as string | undefined) ?? r.slug) === CONNECTOR && r.apiTokenId);
  let unlisted: string | null = null;
  for (const row of rows) {
    const bag = await getCredentialsForConnector({ orgId, connectorSlug: CONNECTOR, apiTokenId: row.apiTokenId }).catch(() => undefined);
    const token = webflowTokenOf(bag);
    if (!token) {
      continue;
    }
    const ids = Array.isArray(bag?.siteIds) ? bag.siteIds as unknown[] : null;
    if (!ids || ids.length === 0) {
      unlisted ??= token;
    } else if (!siteId || ids.includes(siteId)) {
      return token;
    }
  }
  return unlisted;
}

/**
 * The client for a target's site, or why there is none.
 * @param orgId - The workspace.
 * @param target - The Webflow target.
 * @param projectId - The project it publishes for.
 */
export async function webflowClientFor(orgId: string, target: WebflowTarget, projectId?: number | null): Promise<{ ok: true; api: WebflowClient } | { ok: false; why: string }> {
  const token = await webflowAccessFor(orgId, target.config.siteId ?? null, projectId);
  if (!token) {
    return { ok: false, why: NO_LOGIN };
  }
  const { webflowClient } = await import('@/libs/webflow/api');
  return { ok: true, api: webflowClient(token) };
}

/** What a Webflow draft would be, checked against the site: the item, and whether it is new. */
export type WebflowPreflight = {
  api: WebflowClient;
  collection: WebflowCollection;
  fieldData: Record<string, unknown>;
  /** The item at the page's slug that this save updates, or null for a new one. */
  existing: WebflowItem | null;
  /** The post's address once live, when the target says where the blog is. */
  postUrl: string | null;
  /** What the conversion and the mapping changed or left out, for the card. */
  notes: string[];
  bodyHtml: string;
};

/**
 * The page's body without its `# Title`: Webflow's `name` field is the title.
 * @param markdown - The draft.
 */
function bodyOf(markdown: string): string {
  return markdown.replace(/^\s*#\s+(?:\S[^\n]*)?\n+/, '').trim();
}

/**
 * The referenced items the page's author, category and tags name, for the
 * mapped fields that are references to another collection.
 * @param api - The client.
 * @param collection - The blog collection.
 * @param target - The target, for its mapping.
 * @param page - The page.
 */
async function resolveRefs(api: WebflowClient, collection: WebflowCollection, target: WebflowTarget, page: PublishPlan['page']): Promise<Record<string, string | string[] | null>> {
  const { referencedItem } = await import('@/libs/publish/webflowMapping');
  const refs: Record<string, string | string[] | null> = {};
  const wanted: Array<{ slug: string | undefined; values: string[]; own?: string | null }> = [
    { slug: target.config.fields?.author, values: page.author ? [page.author] : [], own: page.authorSlug },
    { slug: target.config.fields?.category, values: page.category ? [page.category] : [] },
    { slug: target.config.fields?.tags, values: [...(page.tags ?? [])] },
  ];
  for (const w of wanted) {
    const field = w.slug ? collection.fields.find(f => f.slug === w.slug) : undefined;
    const refCollection = field?.validations?.collectionId;
    if (!field || !refCollection || w.values.length === 0 || (field.type !== 'Reference' && field.type !== 'MultiReference')) {
      continue;
    }
    const items = await api.listItems(refCollection, { limit: 100 }).catch(() => [] as WebflowItem[]);
    const ids = w.values.map(v => referencedItem(items, v, w.own)).filter((id): id is string => Boolean(id));
    refs[field.slug] = field.type === 'MultiReference' ? ids : ids[0] ?? null;
  }
  return refs;
}

/**
 * What a Webflow publish would save, checked against the site: the target
 * set up, a login that reaches the site, every field Webflow requires filled,
 * and the item at the page's slug, when there is one, the page's own to update.
 * @param orgId - The workspace.
 * @param plan - The plan; its target must be webflow.
 */
export async function webflowPreflight(orgId: string, plan: PublishPlan): Promise<{ ok: true; pre: WebflowPreflight } | { ok: false; why: string }> {
  if (plan.target.kind !== 'webflow') {
    throw new Error('not a Webflow target');
  }
  const target = plan.target;
  const { collectionId, siteId, fields } = target.config;
  if (!siteId || !collectionId || !fields?.body) {
    return { ok: false, why: `The project's Webflow target "${target.id}" does not say ${!siteId ? 'which site' : !collectionId ? 'which collection is the blog' : 'which field holds the body'} yet: apply the mapping learned under Publishing on the project (or learn it again).` };
  }
  const client = await webflowClientFor(orgId, target, plan.project.id);
  if (!client.ok) {
    return client;
  }
  const { api } = client;
  const { markdownToWebflowRichText, firstImageOf } = await import('@/libs/publish/webflowRichText');
  const { webflowFieldData } = await import('@/libs/publish/webflowMapping');
  const { webflowPostUrl } = await import('@/libs/publish/targets');
  let collection: WebflowCollection;
  let atSlug: WebflowItem[];
  try {
    [collection, atSlug] = await Promise.all([api.getCollection(collectionId), api.listItems(collectionId, { slug: plan.page.slug })]);
  } catch (error) {
    return { ok: false, why: `${(error as Error).message}.` };
  }
  const body = bodyOf(plan.draft.markdown);
  const rich = markdownToWebflowRichText(body);
  const image = plan.page.image ?? firstImageOf(body)?.url ?? null;
  const page = { ...plan.page, image };
  const refs = await resolveRefs(api, collection, target, page);
  const built = webflowFieldData({ fields, collection, page, bodyHtml: rich.html, refs });
  if (built.problems.length > 0) {
    return { ok: false, why: built.problems.join(' ') };
  }
  const existing = atSlug[0] ?? null;
  const postUrl = webflowPostUrl(target, plan.page.slug);
  if (existing) {
    const ours = existing.id === plan.page.webflowItemId;
    const sameUrl = (u: string | null | undefined) => Boolean(u && postUrl && u.replace(/\/+$/, '').toLowerCase().replace(/^https?:\/\/(?:www\.)?/, '') === postUrl.toLowerCase().replace(/^https?:\/\/(?:www\.)?/, ''));
    const refresh = plan.page.refresh || sameUrl(plan.page.publishedUrl) || sameUrl(plan.page.existingUrl);
    const live = Boolean(existing.lastPublished) && existing.isDraft !== true;
    if (!ours && !refresh && live) {
      return { ok: false, why: `A live post is already at /${plan.page.slug} on the site ("${existing.fieldData.name ?? existing.id}"), and it is not this page's. Give this page another slug, or say it refreshes that post (refresh: true).` };
    }
  }
  return { ok: true, pre: { api, collection, fieldData: built.fieldData, existing, postUrl, notes: [...rich.notes, ...built.notes], bodyHtml: rich.html } };
}

/**
 * Save the page as a draft item: created, or updated in place at its slug.
 * Never published here.
 * @param orgId - The workspace.
 * @param plan - The plan; its target must be webflow.
 */
export async function saveWebflowDraft(orgId: string, plan: PublishPlan): Promise<{ itemId: string; collectionId: string; siteId: string; created: boolean; postUrl: string | null; notes: string[] }> {
  const checked = await webflowPreflight(orgId, plan);
  if (!checked.ok) {
    throw new Error(checked.why);
  }
  const { api, existing, fieldData, postUrl, notes } = checked.pre;
  const target = plan.target as WebflowTarget;
  const collectionId = target.config.collectionId!;
  const item = existing
    ? await api.updateItem(collectionId, existing.id, { fieldData, isDraft: true })
    : await api.createItem(collectionId, fieldData, true);
  return { itemId: item.id, collectionId, siteId: target.config.siteId!, created: !existing, postUrl, notes };
}

/**
 * Undo a draft this page created: the item is deleted. An item that was
 * updated in place is left as it is, since the post was there before.
 * @param orgId - The workspace.
 * @param draft - The saved draft.
 * @param draft.siteId - Its site.
 * @param draft.collectionId - Its collection.
 * @param draft.itemId - The item.
 * @param draft.projectId - The project it was published for.
 */
export async function deleteWebflowDraft(orgId: string, draft: { siteId: string; collectionId: string; itemId: string; projectId?: number | null }): Promise<void> {
  const token = await webflowAccessFor(orgId, draft.siteId, draft.projectId);
  if (!token) {
    throw new Error(NO_LOGIN);
  }
  const { webflowClient } = await import('@/libs/webflow/api');
  const api = webflowClient(token);
  const item = await api.getItem(draft.collectionId, draft.itemId);
  if (item.lastPublished && item.isDraft !== true) {
    throw new Error('The post went live after it was saved, so it is not deleted from here: unpublish it in Webflow if it should go.');
  }
  await api.deleteItem(draft.collectionId, draft.itemId);
}

/** A drafted Webflow post to take live. */
export type WebflowLivePost = { pageRecordId: number; projectId: number | null; title: string; slug: string; siteId: string; collectionId: string; itemId: string; postUrl: string | null; actionRunId: number | null };

/** What going live did for one post. */
export type WebflowLiveOutcome = { pageRecordId: number; live: boolean; url: string | null; line: string };

/**
 * Words for a publish Webflow refused: a collection the site never published
 * needs the site published once, which this login does not do.
 * @param message - Webflow's message.
 */
function refusalLine(message: string): string {
  return /not (?:been )?published|publish the site|never published|collection.*publish/i.test(message)
    ? `Webflow will not publish an item until the site has been published with this collection: publish the site once in Webflow, then approve going live again. (${message})`
    : message;
}

/**
 * Take drafted posts live, one approval for all of them: each item out of
 * draft and published, then recorded on its page as live at its address.
 * @param orgId - The workspace.
 * @param posts - The drafted posts.
 */
export async function publishWebflowLive(orgId: string, posts: WebflowLivePost[]): Promise<WebflowLiveOutcome[]> {
  const { recordOnPage, markRunLive } = await import('./sitePublish');
  const { webflowClient } = await import('@/libs/webflow/api');
  const out: WebflowLiveOutcome[] = [];
  for (const p of posts) {
    const at = new Date().toISOString();
    const token = await webflowAccessFor(orgId, p.siteId, p.projectId);
    if (!token) {
      out.push({ pageRecordId: p.pageRecordId, live: false, url: null, line: `"${p.title}": ${NO_LOGIN}` });
      continue;
    }
    const api = webflowClient(token);
    try {
      await api.updateItem(p.collectionId, p.itemId, { isDraft: false });
      const published = await api.publishItems(p.collectionId, [p.itemId]);
      if (!published.publishedItemIds.includes(p.itemId)) {
        throw new Error(published.errors.join('; ') || 'Webflow did not publish it');
      }
    } catch (error) {
      const line = `"${p.title}" stays a draft in Webflow: ${refusalLine((error as Error).message)}`;
      // Back to a draft, so the site's next publish in the Designer does not take it live either.
      await api.updateItem(p.collectionId, p.itemId, { isDraft: true }).catch(() => undefined);
      await recordOnPage(orgId, p.pageRecordId, { status: 'publishing', publishing: { kind: 'webflow', phase: 'live', itemId: p.itemId, at, error: line } });
      out.push({ pageRecordId: p.pageRecordId, live: false, url: null, line });
      continue;
    }
    const url = p.postUrl;
    const line = url ? `"${p.title}" is live at ${url}.` : `"${p.title}" is published in Webflow.`;
    await recordOnPage(orgId, p.pageRecordId, { status: 'published', publishedAt: at, ...(url ? { publishedUrl: url } : {}), publishing: { kind: 'webflow', phase: 'live', itemId: p.itemId, publishedAt: at, note: line } });
    await markRunLive(orgId, p.actionRunId, { at, url: url ?? `webflow:${p.collectionId}/${p.itemId}`, how: 'published' });
    out.push({ pageRecordId: p.pageRecordId, live: true, url, line });
  }
  return out;
}
