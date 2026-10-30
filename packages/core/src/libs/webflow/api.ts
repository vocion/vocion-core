/**
 * WEBFLOW'S DATA API (v2), the few calls Vocion makes: which sites a token
 * reaches, a site's CMS collections and their fields, a collection's items by
 * slug, and an item created, updated, published or deleted. One small client,
 * no SDK: the login (`libs/connect/providers/webflow.ts`), the connector
 * (`libs/sources/webflow.ts`) and publishing (`services/publish/webflowPublish.ts`)
 * all call through it, and tests answer it with recorded fixtures
 * (`libs/fixtures/webflow.ts`).
 *
 * A failed call throws `WebflowApiError` with Webflow's status and its short
 * message, never the token.
 */

export const WEBFLOW_API = 'https://api.webflow.com/v2';
const TIMEOUT_MS = 15_000;

/** A site, as `GET /v2/sites` lists it (the fields Vocion reads). */
export type WebflowSite = {
  id: string;
  workspaceId?: string;
  displayName: string;
  shortName: string;
  previewUrl?: string | null;
  lastPublished?: string | null;
  customDomains?: Array<{ id: string; url: string }>;
};

/** A collection, as `GET /v2/sites/:id/collections` lists it. */
export type WebflowCollectionSummary = { id: string; displayName: string; singularName: string; slug: string; lastUpdated?: string | null };

/** One field of a collection's schema. */
export type WebflowField = {
  id: string;
  slug: string;
  displayName: string;
  type: string;
  isRequired?: boolean;
  isEditable?: boolean;
  helpText?: string | null;
  validations?: { collectionId?: string; options?: Array<{ id: string; name: string }> } | null;
};

/** A collection with its fields, as `GET /v2/collections/:id` returns it. */
export type WebflowCollection = WebflowCollectionSummary & { fields: WebflowField[] };

/** One CMS item. `fieldData` is keyed by field slug. */
export type WebflowItem = {
  id: string;
  isDraft?: boolean;
  isArchived?: boolean;
  lastPublished?: string | null;
  lastUpdated?: string | null;
  createdOn?: string | null;
  fieldData: Record<string, unknown> & { name?: string; slug?: string };
};

/** What `GET /v2/token/introspect` says a token was granted. */
export type WebflowGrant = { scope: string | null; siteIds: string[]; workspaceIds: string[] };

/** A call Webflow refused or never answered. `status` is null when it never answered. */
export class WebflowApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(what: string, status: number | null, message: string, code: string | null = null) {
    super(`Webflow ${what}: ${message}`);
    this.name = 'WebflowApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Webflow's own short message from a refusal body, never more than a line.
 * @param body - The parsed body, if it parsed.
 * @param status - The HTTP status.
 */
function messageOf(body: unknown, status: number): { message: string; code: string | null } {
  const b = (body && typeof body === 'object' ? body : {}) as { message?: unknown; msg?: unknown; code?: unknown; err?: unknown };
  const text = [b.message, b.msg, b.err].find(v => typeof v === 'string' && v.trim()) as string | undefined;
  const code = typeof b.code === 'string' ? b.code : null;
  const fallback = status === 401 ? 'the token was refused (revoked, or for another site)' : status === 403 ? 'the token lacks the access this needs' : status === 404 ? 'not found' : status === 429 ? 'rate limited; try again in a minute' : `HTTP ${status}`;
  return { message: (text ?? fallback).replace(/\s+/g, ' ').slice(0, 300), code };
}

/** A token's calls. */
export type WebflowClient = ReturnType<typeof webflowClient>;

/**
 * The calls one token makes.
 * @param token - An OAuth access token or a site API token.
 */
export function webflowClient(token: string) {
  const call = async <T>(what: string, method: string, path: string, body?: unknown): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`${WEBFLOW_API}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new WebflowApiError(what, null, error instanceof Error && error.name === 'TimeoutError' ? 'no answer in 15 seconds' : 'could not be reached');
    }
    if (res.status === 204) {
      return {} as T;
    }
    const parsed = await res.json().catch(() => null) as unknown;
    if (!res.ok) {
      const { message, code } = messageOf(parsed, res.status);
      throw new WebflowApiError(what, res.status, message, code);
    }
    return (parsed ?? {}) as T;
  };
  const enc = encodeURIComponent;
  return {
    /** What the token was granted: its scopes and the sites and workspaces it reaches. */
    async introspect(): Promise<WebflowGrant> {
      const out = await call<{ authorization?: { scope?: string; authorizedTo?: { siteIds?: string[]; workspaceIds?: string[] } } }>('token check', 'GET', '/token/introspect');
      const to = out.authorization?.authorizedTo ?? {};
      return { scope: out.authorization?.scope ?? null, siteIds: to.siteIds ?? [], workspaceIds: to.workspaceIds ?? [] };
    },
    async listSites(): Promise<WebflowSite[]> {
      return (await call<{ sites?: WebflowSite[] }>('site list', 'GET', '/sites')).sites ?? [];
    },
    async getSite(siteId: string): Promise<WebflowSite> {
      return call<WebflowSite>('site', 'GET', `/sites/${enc(siteId)}`);
    },
    async listCollections(siteId: string): Promise<WebflowCollectionSummary[]> {
      return (await call<{ collections?: WebflowCollectionSummary[] }>('collection list', 'GET', `/sites/${enc(siteId)}/collections`)).collections ?? [];
    },
    async getCollection(collectionId: string): Promise<WebflowCollection> {
      const c = await call<WebflowCollection>('collection', 'GET', `/collections/${enc(collectionId)}`);
      return { ...c, fields: c.fields ?? [] };
    },
    /**
     * A collection's items, newest first, or those with one slug.
     * @param collectionId - The collection.
     * @param opts - A slug to find, and how many.
     * @param opts.slug - Only the item with this slug.
     * @param opts.limit - At most this many (Webflow's cap is 100).
     */
    async listItems(collectionId: string, opts: { slug?: string; limit?: number } = {}): Promise<WebflowItem[]> {
      const q = new URLSearchParams({ limit: String(Math.min(opts.limit ?? 10, 100)) });
      if (opts.slug) {
        q.set('slug', opts.slug);
      } else {
        q.set('sortBy', 'lastPublished');
        q.set('sortOrder', 'desc');
      }
      const items = (await call<{ items?: WebflowItem[] }>('item list', 'GET', `/collections/${enc(collectionId)}/items?${q}`)).items ?? [];
      // The slug filter is Webflow's; the check is ours too, so a server that ignored it never hands back another post.
      return opts.slug ? items.filter(i => i.fieldData?.slug === opts.slug) : items;
    },
    async getItem(collectionId: string, itemId: string): Promise<WebflowItem> {
      return call<WebflowItem>('item', 'GET', `/collections/${enc(collectionId)}/items/${enc(itemId)}`);
    },
    /**
     * A new staged item: a draft unless told otherwise.
     * @param collectionId - The collection.
     * @param fieldData - The item's values, by field slug.
     * @param isDraft - Saved as a draft (the default).
     */
    async createItem(collectionId: string, fieldData: Record<string, unknown>, isDraft = true): Promise<WebflowItem> {
      return call<WebflowItem>('item create', 'POST', `/collections/${enc(collectionId)}/items`, { isArchived: false, isDraft, fieldData });
    },
    async updateItem(collectionId: string, itemId: string, patch: { fieldData?: Record<string, unknown>; isDraft?: boolean }): Promise<WebflowItem> {
      return call<WebflowItem>('item update', 'PATCH', `/collections/${enc(collectionId)}/items/${enc(itemId)}`, { isArchived: false, ...patch });
    },
    /**
     * Publish staged items to the live site.
     * @param collectionId - The collection.
     * @param itemIds - The items.
     */
    async publishItems(collectionId: string, itemIds: string[]): Promise<{ publishedItemIds: string[]; errors: string[] }> {
      const out = await call<{ publishedItemIds?: string[]; errors?: unknown[] }>('item publish', 'POST', `/collections/${enc(collectionId)}/items/publish`, { itemIds });
      return { publishedItemIds: out.publishedItemIds ?? [], errors: (out.errors ?? []).map(e => (typeof e === 'string' ? e : JSON.stringify(e))) };
    },
    async deleteItem(collectionId: string, itemId: string): Promise<void> {
      await call<unknown>('item delete', 'DELETE', `/collections/${enc(collectionId)}/items/${enc(itemId)}`);
    },
  };
}

/**
 * Where a site is seen: its first custom domain, else its webflow.io address.
 * @param site - The site.
 */
export function siteUrlOf(site: Pick<WebflowSite, 'shortName' | 'customDomains'>): string {
  const domain = site.customDomains?.find(d => d.url)?.url;
  return domain ? `https://${domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}` : `https://${site.shortName}.webflow.io`;
}

/**
 * A site's host as compared: lower case, no scheme, no `www.`, no path.
 * @param url - An address or a bare host.
 */
export function hostOf(url: string): string {
  return url.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0] ?? '';
}

/**
 * The site among these a target or a person names: by id, by its webflow.io
 * name, or by any of its domains.
 * @param sites - The sites the token reaches.
 * @param ref - A site id, a shortName, or an address.
 */
export function findSite(sites: readonly WebflowSite[], ref: string): WebflowSite | null {
  const r = ref.trim();
  const host = hostOf(r);
  return sites.find(s => s.id === r)
    ?? sites.find(s => s.shortName.toLowerCase() === r.toLowerCase() || `${s.shortName.toLowerCase()}.webflow.io` === host)
    ?? sites.find(s => (s.customDomains ?? []).some(d => hostOf(d.url) === host))
    ?? null;
}
