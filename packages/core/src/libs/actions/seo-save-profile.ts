import type { Action, ReviewCard } from './types';
import type { SeoProfile } from '@/services/seo/profile';
import { z } from 'zod';
import { applyProfileDraft, cleanSeoProfile, FIELD_LABEL, missingFields, profileDraftText, seoPriorities, seoProfileSchema } from '@/services/seo/profile';

/**
 * seo.save_profile — a client's SEO profile, pre-filled from their site, as
 * ONE card a person edits and saves.
 *
 * Onboarding reads the client's site and drafts the profile (client type,
 * ranked goals, industry, offering, audience, places, language, tone,
 * competitors, website, publish target, links to the guidelines) with where
 * each value came from (`seo_propose_profile`). The draft is this card: the
 * person edits the text in place and saves it, or declines. It never writes
 * silently: every run waits for a person (`approvalRequired`), and the
 * profile is refused to every other agent write (`PERSON_ONLY_FIELDS`).
 * Undo puts back the profile the project had before.
 */

export const SEO_SAVE_PROFILE_ACTION_ID = 'seo.save_profile';

const input = z.object({
  project_id: z.number().int().positive(),
  /** The project's name, for the card's title. */
  project_title: z.string().max(200).optional(),
  profile: seoProfileSchema,
  /** Each publish target in words, by id, for the card. */
  target_lines: z.record(z.string(), z.string().max(300)).optional(),
  reason: z.string().max(300).optional(),
});

export type SeoSaveProfileInput = z.infer<typeof input>;

const lineFor = (i: SeoSaveProfileInput) => (id: string) => i.target_lines?.[id] ?? null;

export const seoSaveProfileAction: Action<typeof input> = {
  id: SEO_SAVE_PROFILE_ACTION_ID,
  name: 'Save a client\'s SEO profile',
  description: 'Save a client project\'s SEO profile: client type (b2b_saas, local_services, ecommerce, other), goals ranked (organic_leads, google_business_profile, ai_answers, rankings, other), industry, offering, audience, locations, language, tone, competitor domains, website, publish target and guideline links. Drafted by seo_propose_profile from the client\'s site; a person edits it on the card and saves it. Undo restores the profile before.',
  inputSchema: input,
  grant: 'update_object',
  external: false,
  approvalRequired: true,
  dedupKeyFor: i => `seo.save_profile:${i.project_id}`,
  async precheck(ctx, i) {
    const { getProject } = await import('@/services/DataRoomService');
    return (await getProject(ctx.orgId, i.project_id)) ? undefined : `There is no project #${i.project_id} in this workspace.`;
  },
  async reviewCard(_ctx, i): Promise<ReviewCard> {
    const profile = cleanSeoProfile(i.profile);
    const name = i.project_title ?? `project #${i.project_id}`;
    const missing = missingFields(profile);
    const priorities = seoPriorities(profile).lines;
    const read = Object.entries(profile.evidence ?? {}).map(([k, v]) => `${FIELD_LABEL[k as keyof typeof FIELD_LABEL] ?? k}: ${v}`);
    return {
      title: `Save the SEO profile: ${name}`,
      system: 'Projects',
      headline: `Saving puts this profile on ${name}: the client type and the goals decide what the SEO team works on first. Undo puts back what was there.`,
      badges: [{ label: 'SEO' }, { label: 'Reversible' }],
      ...(i.reason ? { summary: i.reason } : {}),
      contentHeading: { label: 'Profile', meta: 'Read off the client\'s site. Edit it before you save' },
      content: [{ kind: 'message', id: 'profile', label: 'SEO profile', body: profileDraftText(profile, lineFor(i)) }],
      fields: [
        ...(priorities.length ? [{ label: 'What comes first', value: priorities.map((l, n) => `${n + 1}. ${l.split(':')[0]}`).join('  ') }] : []),
        ...(missing.length ? [{ label: 'Still empty', value: missing.map(k => FIELD_LABEL[k]).join(', ') }] : []),
        ...(read.length ? [{ label: 'Where it was read', value: read.join(' · ') }] : []),
      ],
      links: [{ label: name, href: `/dashboard/projects/${i.project_id}` }, ...(profile.guidelines ?? [])],
      nextAction: 'Saving keeps it on the project, where you can change it any time.',
      verbs: { approve: 'Save the profile', reject: 'Don\'t save it' },
    };
  },
  applyContentEdits(i, edits) {
    const edit = edits.find(e => e.id === 'profile');
    return edit?.body === undefined ? i : { ...i, profile: applyProfileDraft(cleanSeoProfile(i.profile), edit.body) };
  },
  async execute(ctx, i) {
    const { getProject, updateDataRoom } = await import('@/services/DataRoomService');
    const room = await getProject(ctx.orgId, i.project_id);
    if (!room) {
      throw new Error(`No project #${i.project_id} in this workspace.`);
    }
    const previous: SeoProfile | null = room.meta.seoProfile ?? null;
    const by = ctx.reviewedBy ?? ctx.origin?.userId ?? ctx.invokedBy ?? undefined;
    await updateDataRoom(ctx.orgId, room.id, { seoProfile: { ...cleanSeoProfile(i.profile), savedAt: new Date().toISOString(), ...(by ? { savedBy: by } : {}) } });
    return { projectId: room.id, previous, href: `/dashboard/projects/${room.id}`, line: `Saved the SEO profile on ${room.title}.` };
  },
  async undo(ctx, i, result) {
    const { updateDataRoom } = await import('@/services/DataRoomService');
    const previous = (result?.previous ?? null) as SeoProfile | null;
    await updateDataRoom(ctx.orgId, i.project_id, { seoProfile: previous });
    return { line: previous ? 'Put back the SEO profile the project had before.' : 'Removed the SEO profile.' };
  },
};
