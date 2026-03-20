import { auth } from '@clerk/nextjs/server';
import {
  Bot,
  ChevronRight,
  Database,
  FileText,
  Layers,
  Mail,
  Plug,
  Shield,
  Video,
  Zap,
} from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { Link } from '@/libs/I18nNavigation';
import { getAgentConfig } from '@/services/AgentConfigService';

const sourceIcons: Record<string, React.ReactNode> = {
  zoom: <Video className="size-3.5" />,
  hubspot: <Zap className="size-3.5" />,
  gmail: <Mail className="size-3.5" />,
  google_drive: <FileText className="size-3.5" />,
};

const sourceColors: Record<string, string> = {
  zoom: '#2D8CFF',
  hubspot: '#FF7A59',
  gmail: '#EA4335',
  google_drive: '#4285F4',
};

export default async function DomainsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  // Load Ziggy's config to populate the Sales domain
  const config = orgId ? await getAgentConfig(orgId, 'ziggy') : null;

  // Build the Sales domain from Ziggy's configuration
  const salesDomain = config
    ? {
        name: 'Sales',
        description: 'Revenue, pipeline, discovery calls, proposals, and deal management',
        color: '#3B82F6',
        agents: [{ name: 'Ziggy', slug: 'ziggy', status: 'active' }],
        connectors: config.connectorSources,
        objectTypes: config.objectTypes,
        skills: config.skills.filter(s => s.assignedToAgent),
        businessRules: config.objectTypes
          .filter(t => t.classificationPrompt)
          .map(t => ({ objectType: t.label, prompt: t.classificationPrompt as string })),
      }
    : null;

  // Stubbed domains
  const otherDomains = [
    { name: 'Support', description: 'Customer support, tickets, and knowledge base', color: '#10B981', status: 'planned' },
    { name: 'Product', description: 'Roadmap, features, specs, and project tracking', color: '#8B5CF6', status: 'planned' },
    { name: 'Engineering', description: 'Code, deploys, incidents, and documentation', color: '#F59E0B', status: 'planned' },
  ];

  return (
    <>
      <TitleBar
        title="Knowledge Domains"
        description="Organize your context by business domain — each domain groups connectors, objects, skills, and business rules"
      />

      {/* Active domain: Sales */}
      {salesDomain && (
        <div className="mb-8">
          <div className="mb-4 text-sm font-semibold">Active Domains</div>
          <div className="rounded-lg border-2 border-blue-200 bg-blue-50/20 p-5 dark:border-blue-900 dark:bg-blue-950/10">
            {/* Domain header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg" style={{ backgroundColor: `${salesDomain.color}15` }}>
                  <Layers className="size-5" style={{ color: salesDomain.color }} />
                </div>
                <div>
                  <div className="text-lg font-semibold">{salesDomain.name}</div>
                  <div className="text-sm text-muted-foreground">{salesDomain.description}</div>
                </div>
              </div>
              <Badge className="bg-blue-100 text-blue-800">Active</Badge>
            </div>

            {/* Domain contents — 4 column grid */}
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Connectors */}
              <div className="rounded-lg border border-border bg-background p-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Plug className="size-3" />
                  CONNECTORS
                </div>
                <div className="space-y-1.5">
                  {salesDomain.connectors.map(src => (
                    <Link
                      key={src}
                      href="/dashboard/connectors"
                      className="flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted"
                    >
                      <span className="size-2 rounded-full" style={{ backgroundColor: sourceColors[src] ?? '#888' }} />
                      {sourceIcons[src]}
                      <span className="font-medium">{src}</span>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Objects */}
              <div className="rounded-lg border border-border bg-background p-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Database className="size-3" />
                  BUSINESS OBJECTS
                </div>
                <div className="space-y-1.5">
                  {salesDomain.objectTypes.map(t => (
                    <Link
                      key={t.slug}
                      href="/dashboard/objects"
                      className={`flex items-center justify-between rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted ${t.count === 0 ? 'opacity-50' : ''}`}
                    >
                      <span className={t.count > 0 ? 'font-medium' : 'text-muted-foreground'}>{t.label}</span>
                      <span className="text-xs text-muted-foreground">{t.count}</span>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Skills */}
              <div className="rounded-lg border border-border bg-background p-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Zap className="size-3" />
                  SKILLS
                </div>
                <div className="space-y-1.5">
                  {salesDomain.skills.map(s => (
                    <Link
                      key={s.slug}
                      href={`/dashboard/skills/${s.slug}`}
                      className={`flex items-center justify-between rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted ${s.status !== 'active' ? 'opacity-50' : ''}`}
                    >
                      <span className={s.status === 'active' ? 'font-medium' : 'text-muted-foreground'}>{s.name}</span>
                      {s.requiresApproval === 'true'
                        ? <span className="text-[9px] text-amber-600">HITL</span>
                        : <span className="text-[9px] text-green-600">auto</span>}
                    </Link>
                  ))}
                </div>
              </div>

              {/* Agents + Rules */}
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Bot className="size-3" />
                    AGENTS
                  </div>
                  {salesDomain.agents.map(a => (
                    <Link
                      key={a.slug}
                      href="/dashboard/ziggy"
                      className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium transition-colors hover:bg-muted"
                    >
                      <Bot className="size-3.5" />
                      {a.name}
                      <ChevronRight className="ml-auto size-3 text-muted-foreground" />
                    </Link>
                  ))}
                </div>

                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Shield className="size-3" />
                    BUSINESS RULES
                  </div>
                  {salesDomain.businessRules.length > 0
                    ? salesDomain.businessRules.map(r => (
                        <div key={r.objectType} className="rounded-md px-2 py-1 text-sm">
                          <div className="font-medium">{r.objectType}</div>
                          <div className="line-clamp-2 text-[11px] text-muted-foreground">
                            {r.prompt.slice(0, 100)}
                            ...
                          </div>
                        </div>
                      ))
                    : <div className="text-xs text-muted-foreground">No classification rules defined</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Planned domains */}
      <div>
        <div className="mb-4 text-sm font-semibold text-muted-foreground">Planned Domains</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {otherDomains.map(d => (
            <div key={d.name} className="rounded-lg border border-border p-4 opacity-50">
              <div className="flex items-center gap-2">
                <div className="size-3 rounded-full" style={{ backgroundColor: d.color }} />
                <div className="font-semibold">{d.name}</div>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{d.description}</div>
              <Badge variant="outline" className="mt-2 text-[9px]">Planned</Badge>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
