import type { Metadata } from 'next';
import type { CatalogEntry } from '@/services/CatalogService';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createElement } from 'react';
import { HireButton } from '@/features/dashboard/marketplace/HireButton';
import { agentAccent } from '@/libs/agentAccents';
import { agentIcon } from '@/libs/agentIcons';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getCatalogEntry, listUnhired, readCatalogSkill } from '@/services/CatalogService';

/**
 * A catalog entry's profile — what you read before hiring.
 *
 * Everything the browse card deliberately leaves out lives here: the system
 * prompt in full, every skill with its own instructions, and what the agent
 * reaches for by connector category. Hiring is the one action on the page,
 * and it sits after the prompt rather than before it, so nobody hires
 * something they have not seen.
 */

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const entry = getCatalogEntry(slug);
  return { title: entry ? `${entry.name} · Marketplace` : 'Marketplace' };
}

export default async function CatalogEntryPage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const entry = getCatalogEntry(slug);
  if (!entry) {
    notFound();
  }

  const skills = entry.skills
    .map(s => readCatalogSkill(s))
    .filter((s): s is { slug: string; body: string } => s !== null);

  const hired = orgId ? !(await listUnhired(orgId)).some(e => e.slug === slug) : false;

  return <EntryScreen entry={entry} skills={skills} hired={hired} />;
}

/**
 * Sync wrapper so the body can use `useTranslations`.
 * @param root0
 * @param root0.entry - The catalog entry.
 * @param root0.skills - Resolved skill bodies, in the entry's declared order.
 * @param root0.hired - Whether this org already has the agent.
 */
function EntryScreen({ entry, skills, hired }: {
  entry: CatalogEntry;
  skills: Array<{ slug: string; body: string }>;
  hired: boolean;
}) {
  const t = useTranslations('Marketplace');
  const a = agentAccent(entry.accent);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/dashboard/marketplace"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {t('back')}
      </Link>

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start">
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-full text-background"
          style={{ background: a.stripe }}
        >
          {createElement(agentIcon(entry.icon, { primary: true }), { 'className': 'size-5', 'aria-hidden': true })}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">{entry.name}</h1>
          <p className="mt-1.5 max-w-prose text-[15px] leading-relaxed text-muted-foreground">
            {entry.description}
          </p>
          <div className="mt-4">
            <HireButton slug={entry.slug} name={entry.name} hired={hired} />
          </div>
        </div>
      </div>

      {/* What it reaches for — by category, never by vendor, so this page can
          say "needs a ledger" without naming somebody's product. */}
      <section className="mt-9">
        <h2 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {t('reaches_for')}
        </h2>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {entry.requires.length === 0 && entry.optional.length === 0 && (
            <span className="text-sm text-muted-foreground">{t('reaches_for_none')}</span>
          )}
          {entry.requires.map(c => (
            <span key={c} className="rounded-full bg-surface-soft px-2.5 py-0.5 text-xs font-medium text-foreground/80">
              {c}
            </span>
          ))}
          {entry.optional.map(c => (
            <span key={c} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
              {c}
            </span>
          ))}
        </div>
        <p className="mt-2.5 max-w-prose text-[13px] text-muted-foreground">{t('degrades_note')}</p>
      </section>

      {/* The system prompt, in full. The thing being hired. */}
      <section className="mt-9">
        <h2 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {t('how_it_works')}
        </h2>
        <div className="mt-2.5 rounded-xl border border-border/70 p-5">
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
            {entry.systemPrompt}
          </p>
        </div>
      </section>

      <section className="mt-9 mb-16">
        <h2 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {t('skill_count', { count: skills.length })}
        </h2>
        <div className="mt-2.5 divide-y divide-border/60 rounded-xl border border-border/70">
          {skills.map(skill => (
            <details key={skill.slug} className="group p-4 open:bg-surface-soft/40">
              <summary className="cursor-pointer list-none font-mono text-[13px] font-medium marker:hidden">
                <span className="text-muted-foreground transition-colors group-open:text-foreground">
                  {skill.slug}
                </span>
              </summary>
              <div className="mt-3 max-w-prose text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {skill.body}
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
