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
 * shows every value and where it came from. Sourced preparation is saved as
 * a separate draft; only a person can save the approved profile. The profile's logic is `services/seo/profile.ts`.
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
      const [{ getDataRoom, updateDataRoom, publishTargetLine }, { getArtifact }, profile, prefill] = await Promise.all([
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
      const held = m.seoProfile ? profile.cleanSeoProfile(m.seoProfile) : null;
      const changes = Object.keys(args).some(k => !['project_id', 'reason', 'read_from'].includes(k));
      if (held?.savedBy && held.savedAt && held.goals?.length && !changes) {
        return `The approved SEO profile for ${room.title} is already saved and unchanged. No new approval is needed. Use it for the next requested step.`;
      }
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
      // A site's business category is evidence for its type, not authority to
      // invent the client's goals or their order of importance.
      delete base.goals;
      if (base.evidence) {
        delete base.evidence.goals;
      }
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
      // Agent-supplied additions need a source. Goals need the person's stated
      // priorities, never an inference from a home page or client category.
      for (const field of profile.SEO_PROFILE_FIELDS) {
        if (field in read && !read.evidence?.[field]?.trim()) {
          delete read[field];
        }
      }
      const previousDraft = m.seoProfileDraft?.profile;
      const start = previousDraft ?? held;
      const draft = profile.overlayProfile(start ? { ...base, ...start, evidence: { ...base.evidence, ...start.evidence } } : base, read);
      delete draft.savedAt;
      delete draft.savedBy;
      // Evidence-only refreshes do not ask a person to reapprove the same values.
      if (held?.savedBy && held.savedAt && held.goals?.length && profile.SEO_PROFILE_FIELDS.every(k => JSON.stringify(held[k] ?? null) === JSON.stringify(draft[k] ?? null))) {
        return `The approved SEO profile for ${room.title} is unchanged. No new approval is needed. Use it for the next requested step.`;
      }
      const persisted = await updateDataRoom(ctx.orgId, room.id, {
        seoProfileDraft: { profile: draft, preparedAt: new Date().toISOString(), preparedBy: ctx.agentSlug ?? 'agent' },
      });
      if (!persisted) {
        return 'The project is no longer available. No profile was saved and no approval was requested.';
      }
      if (!draft.goals?.length) {
        return [
          `Saved sourced preparation for ${room.title} as a draft, not an approved profile. No approval is needed to prepare it.`,
          'Ask the person: What should SEO achieve for this client first — qualified organic leads, local Google Business visibility, being cited in AI answers, rankings, or another business outcome? Which comes first?',
          'Use their answer as goals with read_from.goals naming the conversation or message. Do not infer goals from the site. Then present the completed profile for review.',
          homepageNote,
        ].filter(Boolean).join('\n');
      }
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
          suggestedDecisionReason: 'Sourced preparation is saved separately; review the profile and the stated business priorities before adopting it.',
        },
      });
      const missing = profile.missingFields(draft).map(k => profile.FIELD_LABEL[k]);
      return [
        `Put the SEO profile for ${room.title} in front of the person as one card: they edit it and save it, or decline. The sourced draft is saved separately; the approved profile is unchanged until they save the card. Your turn ends there; do not paste the profile as text.`,
        missing.length ? `Still empty on the card: ${missing.join(', ')}. Say so in one line.` : null,
        homepageNote,
      ].filter(Boolean).join('\n');
    },
    {
      name: 'seo_propose_profile',
      description: 'Draft a client project\'s SEO PROFILE as one card the person edits and saves: client type, goals ranked, industry, offering, audience, locations, language, tone, competitors, website, publish target and links to its guidelines. Code pre-fills what the site and project say (home page language, description and schema, the site inventory\'s pages, the competitors Google ranked, the publish target); pass what you read off the client\'s pages, with where (read_from). Call it during onboarding after site_inventory and record_competitors, or when the person asks to set or change the profile. Automatically saves sourced preparation as a separate draft, never as the approved profile. If goals are missing, ask for the person’s business priorities first. Unchanged approved profiles do not need another approval.',
      schema: z.object({
        project_id: z.number().int().positive().describe('The client\'s project.'),
        client_type: z.enum(SEO_CLIENT_TYPES).optional().describe('Only when the pages make it clear, or the person said.'),
        goals: z.array(z.enum(SEO_GOALS)).optional().describe('Most important first, when the person named them. Include read_from.goals identifying their message; never infer goals from the site or client type.'),
        industry: z.string().max(120).optional(),
        offering: z.string().max(400).optional().describe('What they sell, in a line, in the client\'s words.'),
        audience: z.string().max(300).optional().describe('Who buys it.'),
        locations: z.array(z.string().max(120)).max(50).optional().describe('The places a local client serves, as its site names them.'),
        language: z.string().max(40).optional(),
        tone: z.string().max(200).optional().describe('A few words; the sourced voice block is the full version.'),
        competitors: z.array(z.string().max(200)).max(30).optional().describe('Domains, when you know more than record_competitors found.'),
        website: z.string().max(300).optional().describe('The site, when the project has no domain yet.'),
        read_from: z.record(z.string(), z.string().max(300)).optional().describe('Where each value you pass was read, by field name (industry, offering, audience, tone, …): a page URL, or the person’s message for stated goals. Unsourced additions are left out.'),
        reason: z.string().max(300).optional().describe('One line the card shows.'),
      }),
    },
  );
}
