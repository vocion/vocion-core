/**
 * seo_propose_profile — a client's SEO profile, pre-filled from their site,
 * put in front of a person as ONE card they edit and save.
 *
 * Code reads what the site and the project already say: the home page's
 * language, description, schema.org types and the places its schema names;
 * the site inventory's URLs (a `/pricing` and `/integrations` read as B2B
 * SaaS, `/products/` as ecommerce, LocalBusiness schema as local services);
 * the competitors Google ranked; the project's first publish target; links
 * to its Instructions, Wiki and guideline documents. The agent adds what
 * only a reader can (industry, offering, audience, tone, the goals the
 * person named), each with where it read it. The card (`seo.save_profile`)
 * shows every value and where it came from; nothing is saved until the
 * person saves it. The profile's logic is `services/seo/profile.ts`.
 */

import type { RuntimeContext } from '../types';
import type { SeoProfileInput } from '@/services/seo/profile';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { SEO_CLIENT_TYPES, SEO_GOALS } from '@/services/seo/profile';

/**
 * The tool.
 * @param ctx - The turn.
 */
export function seoProposeProfileTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const [{ getDataRoom, publishTargetLine }, { getArtifact }, profile, prefill] = await Promise.all([
        import('@/services/DataRoomService'),
        import('@/services/ArtifactService'),
        import('@/services/seo/profile'),
        import('@/services/seo/profilePrefill'),
      ]);
      const room = await getDataRoom(ctx.orgId, args.project_id);
      if (!room) {
        return `No project #${args.project_id} in this workspace. list_projects names them.`;
      }
      const m = room.meta;
      const site = profile.websiteOf(args.website ?? m.siteInventory?.site ?? m.domains?.[0] ?? '');
      // The home page, read now: what it says about itself today.
      let signals: ReturnType<typeof prefill.homepageSignals> = {};
      let homepageNote: string | null = null;
      if (site) {
        try {
          const { getBrowseProvider } = await import('@/libs/tools/browse/registry');
          const page = await getBrowseProvider().fetchHtml(`${site}/`, { orgId: ctx.orgId });
          if (page) {
            signals = prefill.homepageSignals(page.html, page.url);
          }
        } catch (err) {
          homepageNote = `The home page could not be read (${(err as Error).message ?? 'unknown error'}); the card says so by leaving those fields empty.`;
        }
      }
      if (m.siteInventory?.artifactId) {
        const inv = await getArtifact({ orgId: ctx.orgId, id: m.siteInventory.artifactId }).catch(() => null);
        const md = typeof (inv?.spec as { md?: unknown } | undefined)?.md === 'string' ? (inv!.spec as { md: string }).md : '';
        signals = { ...signals, urls: prefill.inventoryUrls(md) };
      }
      const guidelineDocs = (m.sources ?? [])
        .filter(s => s.rating === 3 && (s.kind === 'attachment' || s.kind === 'note'))
        .map(s => ({ label: s.title, href: s.artifactId ? `/dashboard/artifacts/${s.artifactId}` : s.documentId ? `/dashboard/search/${s.documentId}` : (s.url ?? '') }))
        .filter(g => g.href);
      const base = profile.prefillSeoProfile({
        id: room.id,
        domains: m.domains,
        competitors: m.competitors?.domains.map(d => d.domain),
        publishTargets: m.publishTargets,
        hasWiki: Boolean(m.notes?.trim()),
        guidelineDocs,
        voiceTone: m.voice?.tone?.map(t => t.text),
      }, signals);
      const read: SeoProfileInput = {
        ...(args.client_type ? { clientType: args.client_type } : {}),
        ...(args.goals?.length ? { goals: args.goals } : {}),
        ...(args.industry ? { industry: args.industry } : {}),
        ...(args.offering ? { offering: args.offering } : {}),
        ...(args.audience ? { audience: args.audience } : {}),
        ...(args.locations?.length ? { locations: args.locations } : {}),
        ...(args.language ? { language: args.language } : {}),
        ...(args.tone ? { tone: args.tone } : {}),
        ...(args.competitors?.length ? { competitors: args.competitors } : {}),
        ...(args.website ? { website: args.website } : {}),
        ...(args.read_from ? { evidence: args.read_from } : {}),
      };
      // What the person already saved stays theirs: the draft starts from it.
      const held = m.seoProfile ? profile.cleanSeoProfile(m.seoProfile) : null;
      const draft = profile.overlayProfile(held ? { ...base, ...held, evidence: { ...base.evidence, ...held.evidence } } : base, read);
      const targetLines = Object.fromEntries((m.publishTargets ?? []).map(t => [t.id, publishTargetLine(t)]));
      const input = { project_id: room.id, project_title: room.title, profile: draft, target_lines: targetLines, ...(args.reason ? { reason: args.reason } : {}) };
      const { SEO_SAVE_PROFILE_ACTION_ID } = await import('@/libs/actions/seo-save-profile');
      ctx.emit({
        type: 'recommended_action',
        recommendation: {
          actionId: SEO_SAVE_PROFILE_ACTION_ID,
          input,
          label: `Save the SEO profile: ${room.title}`,
          rationale: args.reason ?? 'Read off the client\'s site; the client type and goals decide what the SEO team does first.',
          confidence: 0.8,
          agentSlug: ctx.agentSlug,
          suggestedDecision: 'approve',
          suggestedDecisionReason: 'Each value says where it was read; the goals are a starting order for you to set.',
        },
      });
      const missing = profile.missingFields(draft).map(k => profile.FIELD_LABEL[k]);
      return [
        `Put the SEO profile for ${room.title} in front of the person as one card: they edit it and save it, or decline. Nothing is saved until they do. Your turn ends there; do not paste the profile as text.`,
        missing.length ? `Still empty on the card: ${missing.join(', ')}. Say so in one line.` : null,
        homepageNote,
      ].filter(Boolean).join('\n');
    },
    {
      name: 'seo_propose_profile',
      description: 'Draft a client project\'s SEO PROFILE as one card the person edits and saves: client type, goals ranked, industry, offering, audience, locations, language, tone, competitors, website, publish target and links to its guidelines. Code pre-fills what the site and project say (home page language, description and schema, the site inventory\'s pages, the competitors Google ranked, the publish target); pass what you read off the client\'s pages, with where (read_from). Call it during onboarding after site_inventory and record_competitors, or when the person asks to set or change the profile. Never saves on its own.',
      schema: z.object({
        project_id: z.number().int().positive().describe('The client\'s project.'),
        client_type: z.enum(SEO_CLIENT_TYPES).optional().describe('Only when the pages make it clear, or the person said.'),
        goals: z.array(z.enum(SEO_GOALS)).optional().describe('Most important first, when the person named them. Otherwise left for the card to suggest from the client type.'),
        industry: z.string().max(120).optional(),
        offering: z.string().max(400).optional().describe('What they sell, in a line, in the client\'s words.'),
        audience: z.string().max(300).optional().describe('Who buys it.'),
        locations: z.array(z.string().max(120)).max(50).optional().describe('The places a local client serves, as its site names them.'),
        language: z.string().max(40).optional(),
        tone: z.string().max(200).optional().describe('A few words; the sourced voice block is the full version.'),
        competitors: z.array(z.string().max(200)).max(30).optional().describe('Domains, when you know more than record_competitors found.'),
        website: z.string().max(300).optional().describe('The site, when the project has no domain yet.'),
        read_from: z.record(z.string(), z.string().max(300)).optional().describe('Where each value you pass was read, by field name (industry, offering, audience, tone, …): a page URL.'),
        reason: z.string().max(300).optional().describe('One line the card shows.'),
      }),
    },
  );
}
