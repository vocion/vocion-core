import { and, eq } from 'drizzle-orm';
import { AlertTriangle, CheckCircle2, Database, FileText, Layers, Plug, Scale, Share2 } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { agentSchema, businessObjectSchema, businessObjectTypeSchema, skillSchema, workflowSchema } from '@/models/Schema';

/**
 * Context dashboard — cross-cutting overview of every authored primitive
 * for the current tenant. Surfaces counts today; future additions
 * (relationships, business rules, system-of-record policy, data-quality
 * findings) expand as new context shapes land.
 * @param props
 * @param props.params
 */
export default async function ContextPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  if (!orgId) {
    return (
      <>
        <TitleBar title="Context" description="The authored layer that grounds every AI output." />
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">Sign in to an organization to view the Context map.</div>
      </>
    );
  }

  const [objectTypes, objects, agents, skills, workflows] = await Promise.all([
    db.select().from(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, orgId)),
    db.select({ id: businessObjectSchema.id, typeId: businessObjectSchema.typeId }).from(businessObjectSchema).where(eq(businessObjectSchema.orgId, orgId)),
    db.select({ id: agentSchema.id, slug: agentSchema.slug, name: agentSchema.name, connectorSources: agentSchema.connectorSources }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.active, 'true'))),
    db.select({ id: skillSchema.id }).from(skillSchema).where(and(eq(skillSchema.orgId, orgId), eq(skillSchema.status, 'active'))),
    db.select({ id: workflowSchema.id }).from(workflowSchema).where(and(eq(workflowSchema.orgId, orgId), eq(workflowSchema.status, 'active'))),
  ]);

  const objectCountByType = new Map<number, number>();
  for (const o of objects) {
    objectCountByType.set(o.typeId, (objectCountByType.get(o.typeId) ?? 0) + 1);
  }

  const connectorSources = new Set<string>();
  for (const a of agents) {
    for (const src of (a.connectorSources ?? [])) {
      connectorSources.add(src);
    }
  }

  return (
    <>
      <TitleBar
        title="Context"
        description="The authored layer that grounds every AI output. Everything here lives in git as YAML + markdown."
      />

      {/* Top-level stats */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon={Plug} label="Sources" value={connectorSources.size} href="/dashboard/sources" />
        <Stat icon={FileText} label="Object types" value={objectTypes.length} href="/dashboard/objects" />
        <Stat icon={Database} label="Objects" value={objects.length} href="/dashboard/objects" />
        <Stat icon={Layers} label="Active agents" value={agents.length} href="/dashboard/agents" />
        <Stat icon={CheckCircle2} label="Active skills" value={skills.length} href="/dashboard/skills" />
        <Stat icon={Share2} label="Active workflows" value={workflows.length} href="/dashboard/workflows" />
      </div>

      {/* Object model */}
      <section className="mb-8 rounded-lg border border-border bg-background p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Object model</h2>
          <Link href="/dashboard/objects" className="text-sm text-muted-foreground hover:text-foreground">View all →</Link>
        </div>
        {objectTypes.length === 0
          ? (
              <p className="text-sm text-muted-foreground">
                No object types defined yet. Add them in
                <code>workspace/&lt;org&gt;/objects/</code>
                {' '}
                and run
                <code>npm run workspace:apply</code>
                .
              </p>
            )
          : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {objectTypes.map(t => (
                  <div key={t.id} className="rounded-md border border-border p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm font-medium">{t.label}</div>
                        <div className="font-mono text-xs text-muted-foreground">{t.slug}</div>
                      </div>
                      <Badge variant="secondary">{objectCountByType.get(t.id) ?? 0}</Badge>
                    </div>
                    {t.description && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t.description}</p>}
                  </div>
                ))}
              </div>
            )}
      </section>

      {/* Connected sources */}
      {connectorSources.size > 0 && (
        <section className="mb-8 rounded-lg border border-border bg-background p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Source systems</h2>
            <Link href="/dashboard/sources" className="text-sm text-muted-foreground hover:text-foreground">Manage →</Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {[...connectorSources].sort().map(src => (
              <Badge key={src} variant="outline" className="font-mono">{src}</Badge>
            ))}
          </div>
        </section>
      )}

      {/* Coming next — primitives not yet built */}
      <section className="rounded-lg border border-dashed border-border bg-muted/30 p-5">
        <h2 className="text-lg font-semibold">Coming next</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Primitives on the roadmap as new shapes of context land.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <UpcomingCard icon={Share2} title="Relationships" description="Object-to-object cardinality + sync direction, versioned alongside object types." />
          <UpcomingCard icon={Scale} title="Rules & constraints" description="Per-object-type business rules: lifecycle transitions, required fields, dedup logic." />
          <UpcomingCard icon={CheckCircle2} title="System-of-record" description="Per-field ownership + conflict-resolution policy across connected sources." />
          <UpcomingCard icon={AlertTriangle} title="Data quality" description="Runtime log of findings and unresolved decisions awaiting stakeholder input." />
        </div>
      </section>
    </>
  );
}

function Stat({ icon: Icon, label, value, href }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-md border border-border bg-background p-3 transition hover:border-foreground/20">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Link>
  );
}

function UpcomingCard({ icon: Icon, title, description }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string }) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4" />
        {title}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
