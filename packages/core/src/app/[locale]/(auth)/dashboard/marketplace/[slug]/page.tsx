import type { Metadata } from 'next';
import type { CatalogEntry } from '@/services/CatalogService';
import { ArrowLeft, ScrollText, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createElement } from 'react';
import { HireButton } from '@/features/dashboard/marketplace/HireButton';
import { RailGroup } from '@/features/dashboard/RailGroup';
import { agentAccent as accent } from '@/libs/agentAccents';
import { agentIcon } from '@/libs/agentIcons';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getCatalogEntry, listUnhired, readCatalogSkill } from '@/services/CatalogService';

/**
 * A catalog entry's profile — what you read before hiring.
 *
 * Deliberately the same template as the agent profile
 * (`/dashboard/agents/[slug]`): hero, left metadata rail, main column, the
 * system prompt in a collapsible. An agent should not change shape the
 * moment it is hired, and two detail pages for one noun is the defect the
 * manifesto names. The differences are only what genuinely does not exist
 * yet — no memory panel, no work, no team, because none of those are true
 * of an agent nobody has hired.
 */

/**
 * Human label for a connector category slug: `project-tracker` → `Project tracker`.
 * @param slug
 */
function titleCase(slug: string): string {
  const spaced = slug.replace(/[-_]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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

  return <CatalogEntryScreen entry={entry} skills={skills} hired={hired} />;
}

/**
 * Sync wrapper so the body stays a plain server component.
 * @param root0 - Props.
 * @param root0.entry - The catalog entry.
 * @param root0.skills - Resolved skill bodies, in the entry's declared order.
 * @param root0.hired - Whether this workspace already has the agent.
 */
function CatalogEntryScreen({ entry, skills, hired }: {
  entry: CatalogEntry;
  skills: Array<{ slug: string; body: string }>;
  hired: boolean;
}) {
  const a = accent(entry.accent);

  return (
    <>
      <div className="mb-6">
        <Link
          href="/dashboard/marketplace"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to Marketplace
        </Link>
      </div>

      {/* ── Hero — same single clean header as the agent profile ───────── */}
      <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-start sm:gap-5">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: a.tint, color: a.ink }}
        >
          {createElement(agentIcon(entry.icon, { primary: true }), { 'className': 'size-7', 'aria-hidden': true })}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight">{entry.name}</h1>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground/80">
              Catalog
            </span>
            <span className="ml-auto">
              <HireButton slug={entry.slug} name={entry.name} hired={hired} />
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {entry.teamName && (
              <span className="font-mono text-[11px] tracking-wide text-muted-foreground">{entry.teamName}</span>
            )}
            <span className="font-mono text-[11px] text-muted-foreground/70">{entry.slug}</span>
          </div>

          {entry.description && (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{entry.description}</p>
          )}
        </div>
      </header>

      {/* ── Body: flat left rail + main column ─────────────────────────── */}
      <div className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="order-2 flex flex-col gap-5 lg:sticky lg:top-24 lg:order-1 lg:self-start lg:border-r lg:border-border/70 lg:pr-6">
          {entry.teamName && (
            <RailGroup label="Team">
              <div className="flex items-center gap-2">
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: a.stripe }} aria-hidden />
                <span className="text-sm font-medium text-foreground">{entry.teamName}</span>
              </div>
              {/* Hiring brings the team with it, so say so before somebody
                  wonders where the new team on their org chart came from. */}
              <p className="mt-1.5 text-[11px] text-muted-foreground">Created on your org chart when you hire this agent.</p>
            </RailGroup>
          )}

          <RailGroup label="Skills">
            {skills.length === 0
              ? <p className="text-xs text-muted-foreground">None declared.</p>
              : (
                  <ul className="flex flex-col gap-3">
                    {skills.map(skill => (
                      <li key={skill.slug}>
                        <a href={`#skill-${skill.slug}`} className="group block">
                          <div className="flex items-center gap-2">
                            <span
                              className="size-1.5 shrink-0 rounded-full"
                              style={{ background: 'var(--brand-teal)' }}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground group-hover:text-primary">
                              {titleCase(skill.slug)}
                            </span>
                          </div>
                          <div className="mt-0.5 ml-3.5 font-mono text-[11px] text-muted-foreground">
                            {skill.slug}
                          </div>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
          </RailGroup>

          {/* Integrations — CATEGORIES, never vendors, so this reads "Ledger"
              rather than naming somebody's product. Required ones carry the
              accent dot; optional ones are outlined. */}
          <RailGroup label="Integrations">
            {entry.requires.length === 0 && entry.optional.length === 0
              ? <p className="text-xs text-muted-foreground">None — works from files you upload.</p>
              : (
                  <div className="flex flex-wrap gap-1.5">
                    {entry.requires.map(src => (
                      <span
                        key={src}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 py-1 text-xs font-medium text-foreground/80"
                      >
                        <span className="size-1.5 rounded-full" style={{ background: a.stripe }} aria-hidden />
                        {titleCase(src)}
                      </span>
                    ))}
                    {entry.optional.map(src => (
                      <span
                        key={src}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs text-muted-foreground"
                      >
                        {titleCase(src)}
                      </span>
                    ))}
                  </div>
                )}
          </RailGroup>

          <RailGroup label="Configuration">
            <dl className="flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Skills</dt>
                <dd className="font-mono text-foreground/90">{skills.length}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Required</dt>
                <dd className="font-mono text-foreground/90">{entry.requires.length === 0 ? 'none' : entry.requires.map(titleCase).join(', ')}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">Nothing connected</dt>
                <dd className="text-right text-foreground/90">Runs on uploads</dd>
              </div>
            </dl>
          </RailGroup>
        </aside>

        <div className="order-1 flex flex-col gap-8 lg:order-2">
          {/* System prompt — same collapsible as the agent profile, so the
              page a person reads before hiring and the page they read after
              are the same page. */}
          <section>
            <details className="group" open>
              <summary className="flex cursor-pointer list-none items-center gap-2.5 border-b border-border/60 pb-2.5 text-sm">
                <ScrollText className="size-4 text-muted-foreground" />
                <span className="font-display font-semibold">System prompt</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {entry.systemPrompt.length.toLocaleString()}
                  {' '}
                  chars
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground group-open:hidden">Show</span>
                <span className="ml-auto hidden text-[11px] text-muted-foreground group-open:inline">Hide</span>
              </summary>
              <pre className="mt-3 max-h-[36rem] overflow-auto rounded-lg bg-muted/30 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">{entry.systemPrompt}</pre>
            </details>
          </section>

          {skills.length > 0 && (
            <section>
              <h2 className="mb-1 font-display text-base font-semibold">Skills</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                What
                {' '}
                {entry.name}
                {' '}
                can do — each one a set of instructions it reads on demand. A skill an
                implementation tunes is tuned in a playbook, never here.
              </p>
              <div className="flex flex-col gap-3">
                {skills.map(skill => (
                  <details key={skill.slug} id={`skill-${skill.slug}`} className="group scroll-mt-24">
                    <summary className="flex cursor-pointer list-none items-center gap-2.5 border-b border-border/60 pb-2.5 text-sm">
                      <Zap className="size-4 text-muted-foreground" />
                      <span className="font-display font-semibold">{titleCase(skill.slug)}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{skill.slug}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground group-open:hidden">Show</span>
                      <span className="ml-auto hidden text-[11px] text-muted-foreground group-open:inline">Hide</span>
                    </summary>
                    <div className="mt-3 max-w-2xl text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                      {skill.body}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
