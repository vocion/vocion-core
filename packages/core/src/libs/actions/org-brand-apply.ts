/**
 * org.brand_apply — give the Org a brand: its logo, its accent colour, its
 * heading font and the name its mail goes under.
 *
 * The "Make it yours" step of setting a workspace up (`propose_brand`, the
 * brand preview card): the workspace lead drafts the brand from the company's
 * own site (`brand_lookup`), the person sees it on a sidebar and a sign-in
 * page, and pressing "Use this brand" runs this as their action. The draft's
 * logos are still on the company's site, so they are fetched (public
 * addresses only), cleaned (an SVG rebuilt from an allowlist) and kept in the
 * Org's media store first; the guide is then saved through the same check the
 * Brand settings page uses — an accent that cannot be worn readably is
 * refused with the reason, before anything is written.
 *
 * Reversible: `undo` puts back the brand the Org had (or none), unless
 * someone has changed it since, in which case Undo says so rather than
 * throwing their change away. Internal, and only an Org admin can brand the
 * Org, here as on the Brand page: the check reads the person who decided,
 * never the agent that offered it.
 */

import type { Action, ActionContext } from './types';
import type { OrgBrandFields } from '@/libs/branding/orgBrand';
import type { BrandManifest } from '@/libs/workspace/brand';
import { z } from 'zod';

const LogoRef = z.string().trim().min(1).max(4096);

export const orgBrandApplyInput = z.object({
  /** The company as it appears in prose. */
  name: z.string().trim().min(1).max(80),
  /** `#rrggbb`; null keeps Vocion's accent. */
  accent: z.string().trim().regex(/^#[0-9a-f]{6}$/i, 'a hex colour like #1F6FEB').nullable().optional(),
  /** A heading font family; null keeps the app's own face. */
  headingFont: z.string().trim().max(60).nullable().optional(),
  /** The display name outbound mail goes under. */
  senderName: z.string().trim().max(80).nullable().optional(),
  /** Each a URL on the company's site or a file this Org already keeps. */
  logos: z.object({ wordmark: LogoRef.optional(), wordmarkOnDark: LogoRef.optional(), mark: LogoRef.optional(), markOnDark: LogoRef.optional() }).default({}),
  /** The site the brand was read from. */
  website: z.string().trim().url().max(500).nullable().optional(),
});

export type OrgBrandApplyInput = z.infer<typeof orgBrandApplyInput>;

/** Where an Org's brand is edited. */
export const BRAND_SETTINGS_HREF = '/dashboard/brand';

/**
 * The Org this workspace belongs to.
 * @param orgId - The workspace (project).
 */
async function accountOf(orgId: string): Promise<string | null> {
  const { accountOfWorkspace } = await import('@/services/branding/OrgBrandService');
  return accountOfWorkspace(orgId);
}

/**
 * Whether the person behind this run — who decided it, else whose turn it was
 * — is an admin of the Org. Null when no person can be named.
 * @param ctx - The action's context.
 * @param accountId - The Org.
 */
async function personIsAdmin(ctx: ActionContext, accountId: string): Promise<boolean | null> {
  const candidate = ctx.reviewedBy ?? ctx.origin?.userId ?? (ctx.invokedBy && !ctx.invokedBy.includes(':') ? ctx.invokedBy : undefined);
  if (!candidate) {
    return null;
  }
  const [{ db }, { accountMembershipSchema }, { and, eq }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
  const [row] = await db
    .select({ role: accountMembershipSchema.role })
    .from(accountMembershipSchema)
    .where(and(eq(accountMembershipSchema.accountId, accountId), eq(accountMembershipSchema.userId, candidate)))
    .limit(1);
  return row?.role === 'admin';
}

/**
 * The input as the fields of a brand.
 * @param input - The input.
 * @param logos - The logos, once kept.
 */
function fieldsFrom(input: OrgBrandApplyInput, logos: OrgBrandFields['logos']): OrgBrandFields {
  return {
    name: input.name,
    accent: input.accent ?? null,
    headingFont: input.headingFont ?? null,
    senderName: input.senderName ?? null,
    logos,
    website: input.website ?? null,
  };
}

/**
 * A value as JSON with every object's keys sorted, so a guide read back from
 * the run (Postgres reorders `jsonb` keys) compares equal to the same guide
 * read from the Org.
 * @param value - Anything JSON.
 */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => (Array.isArray(v)
    ? v.map(sort)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)]))
      : v);
  return JSON.stringify(sort(value));
}

export const orgBrandApplyAction: Action<typeof orgBrandApplyInput> = {
  id: 'org.brand_apply',
  name: 'Brand this Org',
  description: 'Give the Org its brand — name, logo and mark, accent colour, heading font, the name mail is sent under — worn by the sidebar, sign-in, the browser tab and outbound mail. Logos on the company\'s site are fetched and kept here. Reversible — undo restores the brand it had.',
  inputSchema: orgBrandApplyInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `org.brand_apply:${input.name.toLowerCase()}:${input.accent ?? ''}:${input.logos.wordmark ?? input.logos.mark ?? ''}`,

  async precheck(ctx, input) {
    const accountId = await accountOf(ctx.orgId);
    if (!accountId) {
      return 'this workspace belongs to no Org, so there is nothing to brand';
    }
    if ((await personIsAdmin(ctx, accountId)) === false) {
      return 'only an Org admin can change the brand; ask an admin, or they can set it in Brand settings';
    }
    if (input.accent) {
      const { accentTokens } = await import('@/libs/branding/contrast');
      const tokens = accentTokens(input.accent);
      if (!tokens.ok) {
        return tokens.reason;
      }
    }
    return undefined;
  },

  async reviewCard(_ctx, input) {
    return {
      title: `Brand this Org as ${input.name}`,
      system: 'Brand',
      headline: `Use ${input.name}'s logo and colours across the app, sign-in and mail.`,
      badges: [{ label: 'Reversible' }],
      fields: [
        { label: 'Name', value: input.name },
        ...(input.accent ? [{ label: 'Accent', value: input.accent.toUpperCase() }] : []),
        ...(input.headingFont ? [{ label: 'Headings', value: input.headingFont }] : []),
        ...(input.website ? [{ label: 'From', value: input.website, href: input.website }] : []),
      ],
      links: [{ label: 'Brand settings', href: BRAND_SETTINGS_HREF }],
      nextAction: 'Applying brands the sidebar, sign-in, the browser tab and outbound mail. Undo puts the previous brand back.',
      verbs: { approve: 'Use this brand', reject: 'Skip' },
    };
  },

  async execute(ctx, input) {
    const accountId = await accountOf(ctx.orgId);
    if (!accountId) {
      throw new Error('This workspace belongs to no Org, so there is nothing to brand.');
    }
    if ((await personIsAdmin(ctx, accountId)) !== true) {
      throw new Error('Only an Org admin can change the brand. Ask an admin to use this card, or to set it in Brand settings.');
    }
    const { getOrgBrand, importBrandLogo, saveOrgBrand } = await import('@/services/branding/OrgBrandService');
    const { withFields } = await import('@/libs/branding/orgBrand');
    // The drafted logos live on the company's site until they are kept here.
    const logos: OrgBrandFields['logos'] = {};
    const notes: string[] = [];
    for (const [key, ref] of Object.entries(input.logos) as Array<[keyof OrgBrandFields['logos'], string | undefined]>) {
      if (!ref) {
        continue;
      }
      const kept = await importBrandLogo({ accountId, name: key, url: ref });
      if (kept.ok) {
        logos[key] = kept.url;
      } else {
        notes.push(`The ${key.startsWith('mark') ? 'mark' : 'logo'} was left out: ${kept.reason}.`);
      }
    }
    const base = await getOrgBrand(accountId);
    const saved = await saveOrgBrand({ accountId, brand: withFields(base, fieldsFrom(input, logos)) });
    return {
      applied: true,
      name: saved.after.name,
      before: saved.before,
      after: saved.after,
      notes: [...notes, ...saved.notes],
      href: BRAND_SETTINGS_HREF,
    };
  },

  async undo(ctx, _input, result) {
    if (result.applied !== true) {
      return { undone: false, reason: 'the brand was not applied' };
    }
    const accountId = await accountOf(ctx.orgId);
    if (!accountId) {
      return { undone: false, reason: 'this workspace belongs to no Org' };
    }
    const { getOrgBrand, restoreOrgBrand } = await import('@/services/branding/OrgBrandService');
    const now = await getOrgBrand(accountId);
    // Someone changed the brand after this run: Undo would throw their work away.
    if (canonical(now) !== canonical(result.after ?? null)) {
      throw new Error('The brand has changed since this was applied, so Undo would discard that change. Edit it in Brand settings instead.');
    }
    const before = (result.before ?? null) as BrandManifest | null;
    await restoreOrgBrand(accountId, before);
    return { undone: true, restored: before ? before.name : 'Vocion default' };
  },
};
