import { eq } from 'drizzle-orm';
import { ArrowRight, ScrollText, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { agentSchema, playbookSchema } from '@/models/Schema';
import { skillUsageCounts } from '@/services/ActivityService';

/**
 * Skills — the one catalog of what agents know how to do. A skill is a
 * SKILL.md folder the agent reads on demand; a playbook is attached
 * context that travels with a skill or an agent. Each row shows its
 * provenance: base (the core pack's version), override (the workspace
 * replaced the base), or workspace (workspace-only).
 */

function OriginBadge({ origin }: { origin: string }) {
  if (origin === 'core') {
    return <Badge variant="secondary" className="text-[10px]">base</Badge>;
  }
  if (origin === 'override') {
    return <Badge variant="default" className="text-[10px]">override</Badge>;
  }
  return <Badge variant="outline" className="text-[10px]">workspace</Badge>;
}

type RowData = {
  slug: string;
  name: string;
  description: string;
  kind: string;
  origin: string;
};

function Row({ r, uses, mountedBy }: { r: RowData; uses: number; mountedBy: string[] }) {
  return (
    <Link
      href={`/dashboard/skills/${r.slug}`}
      className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-0 hover:bg-muted/40"
    >
      {r.kind === 'skill' ? <Zap className="size-4 shrink-0 text-muted-foreground" /> : <ScrollText className="size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{r.name}</span>
          <OriginBadge origin={r.origin} />
        </span>
        <span className="block truncate text-xs text-muted-foreground">{r.description}</span>
      </span>
      {uses > 0 && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {uses}
          {' '}
          use
          {uses === 1 ? '' : 's'}
        </span>
      )}
      <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:block">
        {mountedBy.join(', ') || 'unmounted'}
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export default async function SkillsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }

  const [rows, agents, usage] = await Promise.all([
    db
      .select({
        id: playbookSchema.id,
        slug: playbookSchema.slug,
        name: playbookSchema.name,
        description: playbookSchema.description,
        kind: playbookSchema.kind,
        origin: playbookSchema.origin,
        attachedPlaybooks: playbookSchema.attachedPlaybooks,
        version: playbookSchema.version,
        updatedAt: playbookSchema.updatedAt,
      })
      .from(playbookSchema)
      .where(eq(playbookSchema.orgId, orgId))
      .orderBy(playbookSchema.name),
    db
      .select({ slug: agentSchema.slug, skillSlugs: agentSchema.skillSlugs, playbookSlugs: agentSchema.playbookSlugs })
      .from(agentSchema)
      .where(eq(agentSchema.orgId, orgId)),
    skillUsageCounts(orgId),
  ]);

  const skills = rows.filter(r => r.kind === 'skill');
  const playbooks = rows.filter(r => r.kind === 'playbook');

  // A playbook mounts where an agent names it OR where a mounted skill
  // attaches it — the column shows both routes.
  const attachedVia = new Map<string, Set<string>>();
  for (const skill of skills) {
    for (const pb of skill.attachedPlaybooks ?? []) {
      const owners = agents.filter(a => (a.skillSlugs ?? []).includes(skill.slug)).map(a => a.slug);
      const set = attachedVia.get(pb) ?? new Set<string>();
      owners.forEach(o => set.add(o));
      attachedVia.set(pb, set);
    }
  }
  const mountedBy = (slug: string, kind: string): string[] => {
    const direct = agents
      .filter(a => (kind === 'skill' ? (a.skillSlugs ?? []).includes(slug) : (a.playbookSlugs ?? []).includes(slug)))
      .map(a => a.slug);
    const viaSkills = kind === 'playbook' ? [...(attachedVia.get(slug) ?? [])] : [];
    return [...new Set([...direct, ...viaSkills])].sort();
  };

  return (
    <>
      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Zap className="size-5" />
            </div>
            <span>Skills</span>
          </div>
        )}
        description="What the team knows how to do. A skill mounts for the agents that name it and is read when the model judges it relevant; a playbook is context attached to a skill or an agent by name. Base rows ship with the platform; the workspace can override any of them by slug."
      />

      {rows.length === 0
        ? (
            <EmptyState
              icon={Zap}
              title="No skills yet"
              description="Author skills under workspace/<org>/skills/<slug>/SKILL.md (playbooks under playbooks/), or activate base ones via workspace.yaml, then run workspace:apply."
            />
          )
        : (
            <div className="space-y-8">
              <section>
                <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                  Skills ·
                  {' '}
                  {skills.length}
                </h2>
                <div className="overflow-hidden rounded-lg border border-border bg-background">
                  {skills.map(r => <Row key={r.slug} r={r} uses={usage[r.slug] ?? 0} mountedBy={mountedBy(r.slug, r.kind)} />)}
                </div>
              </section>
              {playbooks.length > 0 && (
                <section>
                  <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                    Playbooks ·
                    {' '}
                    {playbooks.length}
                  </h2>
                  <div className="overflow-hidden rounded-lg border border-border bg-background">
                    {playbooks.map(r => <Row key={r.slug} r={r} uses={usage[r.slug] ?? 0} mountedBy={mountedBy(r.slug, r.kind)} />)}
                  </div>
                </section>
              )}
            </div>
          )}
    </>
  );
}
