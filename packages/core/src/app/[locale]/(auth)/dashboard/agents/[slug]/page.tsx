import { ArrowLeft, ArrowUpRight, CornerUpLeft, ScrollText } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createElement } from 'react';
import { PrimitiveFiles } from '@/features/dashboard/PrimitiveFiles';
import { RailGroup } from '@/features/dashboard/RailGroup';
import { agentAccent as accent } from '@/libs/agentAccents';
import { agentIcon } from '@/libs/agentIcons';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getWorkspaceDirtyState } from '@/libs/workspace/dirty';
import { readPrimitiveFiles } from '@/libs/workspace/reader';
import { getAgent, listAgents } from '@/services/AgentService';
import { listSkills } from '@/services/SkillService';

/**
 * Agent profile — one readable page per teammate. A clean hero, then a
 * content-first body: a flat, shaded left rail carries the agent's makeup
 * (skills it can run, sources it reads, configuration) as plain grouped lists
 * — deliberately NOT cards — while the main column carries the specialized
 * agents that report to it and the (demoted) system prompt.
 */

/**
 * Title-case a source slug for display (`hubspot` → `Hubspot`).
 * @param slug
 */
function titleCase(slug: string): string {
  return slug.split(/[-_\s]+/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

type SkillRow = Awaited<ReturnType<typeof listSkills>>[number];

/**
 * Per-category presentation for a skill: a short label + whether it is an
 * approval-gated write.
 * @param category
 */
function skillCategory(category: string | null): { label: string; gated: boolean } {
  switch (category) {
    case 'mutation':
      return { label: 'Drafts · needs approval', gated: true };
    case 'composite':
      return { label: 'Workflow', gated: false };
    default:
      return { label: 'Reads', gated: false };
  }
}

export default async function AgentDetailPage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  if (!orgId) {
    return notFound();
  }
  const agent = await getAgent(orgId, slug);
  if (!agent) {
    return notFound();
  }

  const allAgents = await listAgents(orgId);
  const specialists = allAgents.filter(a => a.parentAgentSlug === slug);
  const parent = agent.parentAgentSlug
    ? allAgents.find(a => a.slug === agent.parentAgentSlug) ?? null
    : null;
  const isLead = !agent.parentAgentSlug;

  const allSkills = await listSkills(orgId);
  const skillBySlug = new Map<string, SkillRow>(allSkills.map(s => [s.slug, s]));
  const skillSlugs = agent.skillSlugs ?? [];
  const wiredSkills = skillSlugs.map(s => ({ slug: s, skill: skillBySlug.get(s) ?? null }));
  const sources = agent.connectorSources ?? [];
  const objectTypes = agent.objectTypeSlugs ?? [];

  const sourceFiles = readPrimitiveFiles('agent', slug);
  const dirtyState = getWorkspaceDirtyState();
  const a = accent(agent.accent);

  return (
    <>
      <div className="mb-5">
        <Link
          href="/dashboard/agents"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to Agents
        </Link>
      </div>

      {/* ── Hero — a single clean header, no nested boxes ─────────────── */}
      <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-start sm:gap-5">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: a.tint, color: a.ink }}
        >
          {createElement(agentIcon(agent.icon, { primary: isLead }), { 'className': 'size-7', 'aria-hidden': true })}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight">{agent.name}</h1>
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
              style={{ background: a.tint, color: a.ink }}
            >
              {isLead ? 'Lead' : 'Specialist'}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {agent.eyebrow && (
              <span className="font-mono text-[11px] tracking-wide text-muted-foreground">{agent.eyebrow}</span>
            )}
            <span className="font-mono text-[11px] text-muted-foreground/70">{agent.slug}</span>
            {parent && (
              <Link
                href={`/dashboard/agents/${parent.slug}`}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
              >
                <CornerUpLeft className="size-3" />
                Reports to
                {' '}
                {parent.name}
              </Link>
            )}
          </div>

          {agent.description && (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{agent.description}</p>
          )}
        </div>
      </header>

      {/* ── Body: flat left rail (makeup) + main column (people) ─────── */}
      <div className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* Left rail — flat grouped metadata, no cards. main-first on mobile. */}
        <aside className="order-2 flex flex-col gap-5 rounded-xl border border-border/60 bg-muted/40 p-5 lg:sticky lg:top-6 lg:order-1 lg:self-start">
          <RailGroup label="Skills">
            {wiredSkills.length === 0
              ? <p className="text-xs text-muted-foreground">None wired.</p>
              : (
                  <ul className="flex flex-col gap-3">
                    {wiredSkills.map(({ slug: skillSlug, skill }) => {
                      const cat = skillCategory(skill?.category ?? null);
                      return (
                        <li key={skillSlug}>
                          <Link href={`/dashboard/skills/${skillSlug}`} className="group block">
                            <div className="flex items-center gap-2">
                              <span
                                className="size-1.5 shrink-0 rounded-full"
                                style={{ background: cat.gated ? 'var(--brand-amber)' : 'var(--brand-teal)' }}
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground group-hover:text-primary">
                                {skill?.name ?? skillSlug}
                              </span>
                            </div>
                            <div className={`mt-0.5 ml-3.5 text-[11px] ${cat.gated ? 'text-[var(--brand-amber-deep)]' : 'text-muted-foreground'}`}>
                              {cat.label}
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
          </RailGroup>

          {sources.length > 0 && (
            <RailGroup label="Integrations">
              <div className="flex flex-wrap gap-1.5">
                {sources.map(src => (
                  <span
                    key={src}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 py-1 text-xs font-medium text-foreground/80"
                  >
                    <span className="size-1.5 rounded-full" style={{ background: a.stripe }} aria-hidden />
                    {titleCase(src)}
                  </span>
                ))}
              </div>
            </RailGroup>
          )}

          <RailGroup label="Configuration">
            <dl className="flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Model</dt>
                <dd className="font-mono text-foreground/90">{agent.model ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Temperature</dt>
                <dd className="font-mono text-foreground/90">{agent.temperature ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Role</dt>
                <dd className="text-foreground/90">{isLead ? 'Lead' : 'Specialist'}</dd>
              </div>
              {objectTypes.length > 0 && (
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-muted-foreground">Object types</dt>
                  <dd className="text-right font-mono text-foreground/90">{objectTypes.join(', ')}</dd>
                </div>
              )}
            </dl>
          </RailGroup>
        </aside>

        {/* Main column — the people this agent works with + its prompt */}
        <div className="order-1 flex flex-col gap-8 lg:order-2">
          {specialists.length > 0 && (
            <section>
              <h2 className="mb-1 font-display text-base font-semibold">Agents</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Standalone agents that report to
                {' '}
                {agent.name}
                {' '}
                — each has its own prompt, skills, and chat.
              </p>
              <div className="divide-y divide-border/60 border-y border-border/60">
                {specialists.map((sp) => {
                  const spInk = accent(sp.accent).ink;
                  return (
                    <Link
                      key={sp.id}
                      href={`/dashboard/agents/${sp.slug}`}
                      className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-3.5 transition hover:bg-muted/30"
                    >
                      <span className="shrink-0" style={{ color: spInk }}>
                        {createElement(agentIcon(sp.icon), { 'className': 'size-5', 'aria-hidden': true })}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="truncate text-sm font-medium group-hover:text-primary">{sp.name}</span>
                        {sp.description && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{sp.description}</p>
                        )}
                      </div>
                      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/40 transition group-hover:text-primary" />
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 border-b border-border/60 pb-2.5 text-sm">
                <ScrollText className="size-4 text-muted-foreground" />
                <span className="font-display font-semibold">System prompt</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {agent.systemPrompt.length.toLocaleString()}
                  {' '}
                  chars
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground group-open:hidden">Show</span>
                <span className="ml-auto hidden text-[11px] text-muted-foreground group-open:inline">Hide</span>
              </summary>
              <pre className="mt-3 max-h-[36rem] overflow-auto rounded-lg bg-muted/30 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">{agent.systemPrompt}</pre>
            </details>
          </section>

          {sourceFiles && (
            <section>
              <h2 className="mb-3 font-display text-sm font-semibold">Source files</h2>
              <PrimitiveFiles
                files={sourceFiles.files}
                editInGitPath={sourceFiles.editInGitPath}
                dirty={dirtyState.dirty}
                dirtyFiles={dirtyState.changedFiles}
              />
            </section>
          )}
        </div>
      </div>
    </>
  );
}
