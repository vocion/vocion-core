'use client';

/**
 * The project's SEO profile, edited in place: what kind of client this is
 * (B2B SaaS, local services, ecommerce), its goals ranked, what it sells and
 * to whom, where, in what language and tone, who it competes with, its site,
 * where its pages ship, and links to its guidelines. Under it, what the
 * client type and goals put first for the SEO team (`seoPriorities`), so a
 * person sees how the profile steers the work. The same edit-in-place as
 * Instructions and Wiki; a save PATCHes the project as the person.
 * Onboarding drafts it on a card (`seo.save_profile`); nothing writes it
 * silently. The logic is `services/seo/profile.ts`.
 */

import type { GuidelineLink, SeoClientType, SeoGoal, SeoProfile, SeoProfileField } from '@/services/seo/profile';
import { ArrowUp, X } from 'lucide-react';
import { useState } from 'react';
import { FactList, Section } from '@/components/patterns';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Link } from '@/libs/I18nNavigation';
import { CLIENT_TYPE_LABEL, GOAL_LABEL, playbookLinks, profileFacts, SEO_CLIENT_TYPES, SEO_GOALS, SEO_PROFILE_FIELDS, seoPriorities } from '@/services/seo/profile';
import { EditButton, useProjectField } from './ProjectKnowledge';

export type SeoProfileDraft = {
  clientType: SeoClientType | '';
  goals: SeoGoal[];
  industry: string;
  offering: string;
  audience: string;
  locations: string;
  language: string;
  tone: string;
  competitors: string;
  website: string;
  publishTarget: string;
  guidelines: string;
};

const draftOf = (p: SeoProfile | null): SeoProfileDraft => ({
  clientType: p?.clientType ?? '',
  goals: p?.goals ?? [],
  industry: p?.industry ?? '',
  offering: p?.offering ?? '',
  audience: p?.audience ?? '',
  locations: (p?.locations ?? []).join(', '),
  language: p?.language ?? '',
  tone: p?.tone ?? '',
  competitors: (p?.competitors ?? []).join(', '),
  website: p?.website ?? '',
  publishTarget: p?.publishTarget ?? '',
  guidelines: (p?.guidelines ?? []).map(g => `${g.label} | ${g.href}`).join('\n'),
});

const list = (v: string) => v.split(/[,\n]/).map(s => s.trim()).filter(Boolean);

/**
 * The profile a draft saves as. Evidence is kept only for the fields the
 * person left as they were: a value they typed is theirs, not "read off the
 * home page". Pure.
 * @param d - The form.
 * @param was - The profile before.
 */
export function profileFromDraft(d: SeoProfileDraft, was: SeoProfile | null): SeoProfile {
  const guidelines: GuidelineLink[] = d.guidelines.split('\n').map((l) => {
    const [label, ...rest] = l.split('|');
    return { label: (label ?? '').trim(), href: rest.join('|').trim() };
  }).filter(g => g.label && g.href);
  const next: SeoProfile = {
    ...(d.clientType ? { clientType: d.clientType } : {}),
    goals: d.goals,
    industry: d.industry,
    offering: d.offering,
    audience: d.audience,
    locations: list(d.locations),
    language: d.language,
    tone: d.tone,
    competitors: list(d.competitors),
    website: d.website,
    publishTarget: d.publishTarget,
    guidelines,
  };
  const before = draftOf(was);
  const after = draftOf(next);
  const evidence = Object.fromEntries(Object.entries(was?.evidence ?? {}).filter(([k]) => JSON.stringify(before[k as keyof SeoProfileDraft]) === JSON.stringify(after[k as keyof SeoProfileDraft])));
  return { ...next, ...(Object.keys(evidence).length ? { evidence } : {}) };
}

/**
 * The SEO profile section.
 * @param props
 * @param props.projectId - The project.
 * @param props.profile - Its saved profile, if any.
 * @param props.preparedDraft - Sourced preparation, separate from the approved profile.
 * @param props.targets - Its publish targets, in words.
 */
export function ProjectSeoProfile({ projectId, profile, targets, preparedDraft = null }: { projectId: number; profile: SeoProfile | null; preparedDraft?: SeoProfile | null; targets: Array<{ id: string; line: string }> }) {
  const field = useProjectField(projectId);
  const [reviewingDraft, setReviewingDraft] = useState(false);
  const [d, setD] = useState<SeoProfileDraft>(() => draftOf(profile));
  const set = <K extends keyof SeoProfileDraft>(k: K, v: SeoProfileDraft[K]) => setD(prev => ({ ...prev, [k]: v }));
  const edit = (draft = false) => {
    setReviewingDraft(draft);
    setD(draftOf(draft ? preparedDraft : profile));
    field.setEditing(true);
  };
  const cancel = () => {
    setD(draftOf(profile));
    field.setEditing(false);
  };
  const lineOf = (id: string) => targets.find(t => t.id === id)?.line ?? null;
  const facts = profile ? profileFacts(profile, lineOf).filter(f => f.key !== 'guidelines') : [];
  const pr = seoPriorities(profile ?? undefined);
  const priorities = pr.lines;
  // The agency's playbooks the profile puts first for this client, each opening where it is edited.
  const playbooks = profile ? playbookLinks(pr.playbooks) : [];
  const input = 'h-8 w-full rounded-md border border-border bg-background px-2 text-sm focus:border-foreground/30 focus:outline-none';
  const text = (k: Exclude<keyof SeoProfileDraft, 'goals' | 'clientType'>, label: string, placeholder = '') => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {k === 'offering' || k === 'guidelines'
        ? <textarea value={d[k]} onChange={e => set(k, e.target.value)} placeholder={placeholder} aria-label={label} className={`${input} h-auto min-h-16 py-1.5 ${k === 'guidelines' ? 'font-mono text-[12px]' : ''}`} />
        : <input type="text" value={d[k]} onChange={e => set(k, e.target.value)} placeholder={placeholder} aria-label={label} className={input} />}
    </label>
  );
  const save = () => field.save({ seoProfile: profileFromDraft(d, reviewingDraft ? preparedDraft : profile) });
  return (
    <Section id="seo-profile" eyebrow="SEO profile" action={field.editing ? null : <EditButton label="Edit SEO profile" onClick={() => edit()} />} data-testid="project-seo-profile">
      {preparedDraft && !field.editing && (
        <div className="mb-4 rounded-lg border border-border bg-muted/20 p-3" data-testid="seo-prepared-draft">
          <p className="text-sm">A sourced draft is ready to review. It has not replaced the approved profile.</p>
          <button type="button" onClick={() => edit(true)} className="mt-2 text-sm font-medium underline underline-offset-4">Review prepared draft</button>
        </div>
      )}
      {field.editing
        ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Client type
                  <select value={d.clientType} onChange={e => set('clientType', e.target.value as SeoProfileDraft['clientType'])} aria-label="Client type" className={input}>
                    <option value="">Not set</option>
                    {SEO_CLIENT_TYPES.map(t => <option key={t} value={t}>{CLIENT_TYPE_LABEL[t]}</option>)}
                  </select>
                </label>
                {text('industry', 'Industry', 'Home services (HVAC)')}
              </div>
              <fieldset className="flex flex-col gap-1.5" aria-label="Goals, most important first">
                <legend className="mb-1 text-xs text-muted-foreground">Goals, most important first</legend>
                <ol className="flex flex-col gap-1" data-testid="seo-profile-goals">
                  {d.goals.map((g, i) => (
                    <li key={g} className="flex items-center gap-2 text-sm">
                      <span className="w-4 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                      <span className="flex-1">{GOAL_LABEL[g]}</span>
                      {i > 0 && (
                        <button type="button" aria-label={`Move ${GOAL_LABEL[g]} up`} onClick={() => set('goals', [...d.goals.slice(0, i - 1), g, d.goals[i - 1]!, ...d.goals.slice(i + 1)])} className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground">
                          <ArrowUp className="size-3.5" aria-hidden />
                        </button>
                      )}
                      <button type="button" aria-label={`Remove ${GOAL_LABEL[g]}`} onClick={() => set('goals', d.goals.filter(x => x !== g))} className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground">
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-1.5">
                  {SEO_GOALS.filter(g => !d.goals.includes(g)).map(g => (
                    <button key={g} type="button" onClick={() => set('goals', [...d.goals, g])} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground">
                      {`+ ${GOAL_LABEL[g]}`}
                    </button>
                  ))}
                </div>
              </fieldset>
              {text('offering', 'Offering', 'What they sell, in a line')}
              <div className="grid gap-3 sm:grid-cols-2">
                {text('audience', 'Audience', 'Who buys it')}
                {text('locations', 'Locations', 'Cities or service areas, comma-separated')}
                {text('language', 'Language', 'en-US')}
                {text('tone', 'Tone', 'plain, warm, direct')}
                {text('competitors', 'Competitors', 'Domains, comma-separated')}
                {text('website', 'Website', 'https://')}
              </div>
              {targets.length > 0 && (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Publishes to
                  <select value={d.publishTarget} onChange={e => set('publishTarget', e.target.value)} aria-label="Publishes to" className={input}>
                    <option value="">Not set</option>
                    {targets.map(t => <option key={t.id} value={t.id}>{t.line}</option>)}
                  </select>
                </label>
              )}
              {text('guidelines', 'Guidelines: one link a line, label | link', 'Brand guide | /dashboard/artifacts/12')}
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <button type="submit" disabled={field.busy} className={buttonVariants({ size: 'sm' })}>{field.busy ? 'Saving…' : 'Save'}</button>
                <button type="button" onClick={cancel} disabled={field.busy} className="inline-flex h-7 items-center rounded-md px-2 text-xs hover:bg-surface-hover">Cancel</button>
              </div>
            </form>
          )
        : !profile || facts.length === 0
            ? <p className="text-sm text-muted-foreground">No SEO profile yet. Onboarding drafts one from the client's site for you to save; you can set it here. The client type and goals decide what the SEO team works on first.</p>
            : (
                <div className="space-y-3">
                  <FactList
                    layout="column"
                    facts={[
                      ...facts.map(f => ({ key: f.key, label: f.label, value: f.value, ...(f.key === 'website' ? { href: f.value } : {}) })),
                      (profile.guidelines ?? []).length
                        ? {
                            key: 'guidelines',
                            label: 'Guidelines',
                            value: (
                              <span className="flex flex-wrap gap-x-3">
                                {profile.guidelines!.map(g => <a key={g.href} href={g.href} className="underline decoration-border underline-offset-2 hover:decoration-foreground">{g.label}</a>)}
                              </span>
                            ),
                          }
                        : null,
                    ]}
                  />
                  {priorities.length > 0 && (
                    <div data-testid="seo-profile-priorities">
                      <h4 className="mb-1 text-xs font-medium text-muted-foreground">What comes first</h4>
                      <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
                        {priorities.map(l => <li key={l}>{l}</li>)}
                      </ol>
                    </div>
                  )}
                  {playbooks.length > 0 && (
                    <div data-testid="seo-profile-playbooks">
                      <h4 className="mb-1 text-xs font-medium text-muted-foreground">Playbooks we lead with</h4>
                      <p className="flex flex-wrap gap-x-3 text-sm">
                        {playbooks.map(l => <Link key={l.slug} href={l.href} className="underline decoration-border underline-offset-2 hover:decoration-foreground">{l.label}</Link>)}
                      </p>
                    </div>
                  )}
                  {profile.savedAt && <p className="text-xs text-muted-foreground">{`Saved ${profile.savedAt.slice(0, 10)}${evidenceLine(profile)}`}</p>}
                </div>
              )}
      {field.error && <p className="mt-2 text-xs text-destructive">{field.error}</p>}
    </Section>
  );
}

/**
 * Where the values still as read came from, in one line.
 * @param p - The profile.
 */
function evidenceLine(p: SeoProfile): string {
  const read = SEO_PROFILE_FIELDS.filter((k: SeoProfileField) => p.evidence?.[k]).map(k => `${k === 'clientType' ? 'client type' : k}: ${p.evidence![k]}`);
  return read.length ? ` · as drafted: ${read.join('; ')}` : '';
}
