import { auth } from '@clerk/nextjs/server';
import {
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  Database,
  ExternalLink,
  Eye,
  FileText,
  GitBranch,
  Mail,
  PenTool,
  Search,
  Shield,
  Video,
  Zap,
} from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { getAgentConfig } from '@/services/AgentConfigService';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type TaskStatus = 'done' | 'in_progress' | 'not_started';

type SprintTask = {
  label: string;
  status: TaskStatus;
  note?: string;
};

/* ------------------------------------------------------------------ */
/* Sprint roadmap                                                      */
/* ------------------------------------------------------------------ */

const sprints: Array<{
  id: number;
  name: string;
  weeks: string;
  status: 'in_progress' | 'not_started';
  milestone: string;
  tasks: SprintTask[];
}> = [
  {
    id: 1,
    name: 'Model & Visibility',
    weeks: '1-2',
    status: 'in_progress' as const,
    milestone: 'Ziggy can see and answer questions about any deal.',
    tasks: [
      { label: 'Connect HubSpot', status: 'done', note: '1,494 docs' },
      { label: 'Connect Gmail', status: 'done', note: '9,740+ docs' },
      { label: 'Connect Zoom (custom connector + LLM enrichment)', status: 'done', note: '1,589 docs' },
      { label: 'Connect Google Drive', status: 'done', note: '75K+ docs' },
      { label: 'Business object model (types, objects, document links)', status: 'done' },
      { label: 'Agent table + Ziggy config in DB', status: 'done' },
      { label: 'Zoom call_type enrichment with few-shot classification', status: 'in_progress', note: 'Re-indexing with v3 prompt' },
      { label: 'Langfuse tracing on Chat + skill runs', status: 'done' },
      { label: 'Domains page — hierarchy explorer', status: 'done' },
      { label: 'Object type config (classification, source relevance, few-shots)', status: 'done' },
    ],
  },
  {
    id: 2,
    name: 'Assisted Drafting',
    weeks: '3-4',
    status: 'in_progress' as const,
    milestone: 'Find a discovery call, summarize it, draft a capabilities follow-up. Chris reviews and approves.',
    tasks: [
      { label: 'Discovery Summary skill (prompt in DB, Langfuse traced)', status: 'done', note: 'v2 with product/features/tech' },
      { label: 'Draft Follow-up Email skill', status: 'done', note: 'Prompt seeded' },
      { label: 'CC agent endpoint (tool-calling, streaming, Langfuse)', status: 'done', note: 'gpt-5.4' },
      { label: 'Skill execution engine (run → trace → result)', status: 'done' },
      { label: 'Recency decay + source weighting in search', status: 'done', note: '0.98^days, Zoom 1.5x' },
      { label: 'Smart source filtering (calls → Zoom)', status: 'done' },
      { label: 'Citation badges with hover popovers', status: 'done' },
      { label: 'Approval UI (review/edit/approve draft)', status: 'done' },
      { label: 'Few-shot examples for agent + classification', status: 'done' },
      { label: '10 skills (2 active, 8 planned)', status: 'done' },
      { label: 'Workflows page stubbed (6 workflows)', status: 'done' },
      { label: 'Eval suite stubbed (4 test cases)', status: 'done' },
    ],
  },
  {
    id: 3,
    name: 'Proposal Ops',
    weeks: '5-6',
    status: 'not_started' as const,
    milestone: 'End-to-end proposal flow from discovery to delivery.',
    tasks: [
      { label: 'Proposal brief skill', status: 'not_started' },
      { label: 'Deck generation (Google Slides or Gamma)', status: 'not_started' },
      { label: 'Proposal workflow (LangGraph multi-step)', status: 'not_started' },
      { label: 'HubSpot stage sync', status: 'not_started' },
      { label: 'Calendly integration', status: 'not_started' },
    ],
  },
  {
    id: 4,
    name: 'Inbox & Follow-up',
    weeks: '7-8',
    status: 'not_started' as const,
    milestone: 'Ziggy monitors the pipeline daily and surfaces what needs attention.',
    tasks: [
      { label: 'Daily inbox scan (Temporal scheduled)', status: 'not_started' },
      { label: 'Inbox triage + response drafter', status: 'not_started' },
      { label: 'Aging pipeline review', status: 'not_started' },
      { label: 'Pipeline health dashboard', status: 'not_started' },
    ],
  },
  {
    id: 5,
    name: 'NDA + Autonomy',
    weeks: '9-10',
    status: 'not_started' as const,
    milestone: 'Ziggy operates semi-autonomously within defined policy boundaries.',
    tasks: [
      { label: 'DocuSign NDA workflow', status: 'not_started' },
      { label: 'Policy engine (auto-run vs require approval)', status: 'not_started' },
      { label: 'Eval dashboard + feedback loop', status: 'not_started' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Funnel stages                                                       */
/* ------------------------------------------------------------------ */

const funnelStages = [
  { name: 'Lead', color: 'bg-gray-400' },
  { name: 'Contact', color: 'bg-blue-400' },
  { name: 'Discovery', color: 'bg-indigo-400' },
  { name: 'NDA', color: 'bg-purple-400' },
  { name: 'Proposal', color: 'bg-amber-400' },
  { name: 'Negotiation', color: 'bg-orange-400' },
  { name: 'Closed', color: 'bg-green-500' },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const SectionHeading = (props: { title: string; description?: string; badge?: string }) => (
  <div className="mt-8 mb-4 flex items-center gap-3 first:mt-0">
    <div>
      <div className="text-lg font-semibold">{props.title}</div>
      {props.description && <div className="text-sm text-muted-foreground">{props.description}</div>}
    </div>
    {props.badge && <Badge variant="outline" className="shrink-0">{props.badge}</Badge>}
  </div>
);

const StatusDot = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    live: 'bg-green-500',
    ready: 'bg-blue-500',
    planned: 'bg-muted-foreground/30',
    done: 'bg-green-500',
    in_progress: 'bg-primary',
    not_started: 'bg-muted-foreground/30',
  };
  return <div className={`size-2 rounded-full ${colors[status] ?? 'bg-gray-400'}`} />;
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const connectorMeta: Record<string, { label: string; icon: any }> = {
  hubspot: { label: 'HubSpot', icon: Zap },
  gmail: { label: 'Gmail', icon: Mail },
  zoom: { label: 'Zoom', icon: Video },
  google_drive: { label: 'Google Drive', icon: FileText },
  calendly: { label: 'Calendly', icon: Calendar },
  docusign: { label: 'DocuSign', icon: Shield },
};

export default async function ZiggyPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const config = orgId ? await getAgentConfig(orgId, 'ziggy') : null;

  const totalTasks = sprints.reduce((sum, s) => sum + s.tasks.length, 0);
  const doneTasks = sprints.reduce((sum, s) => sum + s.tasks.filter(t => t.status === 'done').length, 0);
  const overallPct = Math.round((doneTasks / totalTasks) * 100);

  return (
    <>
      {/* ---- Header ---- */}
      <div className="flex items-start justify-between">
        <TitleBar
          title={(
            <span className="flex items-center gap-2">
              <Bot className="size-6" />
              Ziggy
            </span>
          )}
          description="Sales operations agent for MetaCTO. First packaged agent on the CoreContext platform."
        />
        <div className="flex items-center gap-2">
          <Badge variant="outline">Case Study</Badge>
          <Badge className="bg-primary/10 text-primary">
            {overallPct}
            % complete
          </Badge>
        </div>
      </div>

      {/* ================================================================ */}
      {/* WHAT IS ZIGGY                                                    */}
      {/* ================================================================ */}

      <SectionHeading title="What Is Ziggy?" badge="Agent" />
      <div className="rounded-lg border border-border p-5">
        <div className="text-sm leading-relaxed text-muted-foreground">
          An agent in CoreContext is a
          {' '}
          <strong className="text-foreground">packaged configuration</strong>
          {' '}
          — a system prompt, scoped connectors, skills, business objects, and approval rules stored in the database. Not a deployed service, not a fine-tuned model, not code. Change behavior by editing config, not deploying.
        </div>
        {config
          ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md bg-muted/50 p-3 text-center">
                  <div className="text-lg font-bold">{config.agent.model}</div>
                  <div className="text-[11px] text-muted-foreground">Model</div>
                </div>
                <div className="rounded-md bg-muted/50 p-3 text-center">
                  <div className="text-lg font-bold">{config.skills.filter(s => s.assignedToAgent).length}</div>
                  <div className="text-[11px] text-muted-foreground">Skills</div>
                </div>
                <div className="rounded-md bg-muted/50 p-3 text-center">
                  <div className="text-lg font-bold">{config.connectorSources.length}</div>
                  <div className="text-[11px] text-muted-foreground">Connectors</div>
                </div>
                <div className="rounded-md bg-muted/50 p-3 text-center">
                  <div className="text-lg font-bold">{config.objectTypes.filter(t => t.assignedToAgent).length}</div>
                  <div className="text-[11px] text-muted-foreground">Object Types</div>
                </div>
              </div>
            )
          : (
              <div className="mt-4 rounded-md bg-muted/50 p-4 text-center text-sm text-muted-foreground">
                Agent not configured. Sign in and run the seed script.
              </div>
            )}
      </div>

      {/* ================================================================ */}
      {/* AGENT CONFIGURATION (live from DB)                               */}
      {/* ================================================================ */}

      {config && (
        <>
          <SectionHeading title="Agent Configuration" description="Live from database — edit config to change behavior" badge="DB" />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Connectors */}
            <div className="rounded-lg border border-border p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Search className="size-4" />
                Connectors
                <Badge variant="outline" className="ml-auto text-[9px]">{config.connectorSources.length}</Badge>
              </div>
              <div className="space-y-2">
                {config.connectorSources.map((src) => {
                  const meta = connectorMeta[src] ?? { label: src, icon: Zap };
                  const Icon = meta.icon;
                  return (
                    <div key={src} className="flex items-center gap-2 text-sm">
                      <StatusDot status="live" />
                      <Icon className="size-3.5 stroke-muted-foreground" />
                      <span className="font-medium">{meta.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Skills */}
            <div className="rounded-lg border border-border p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Zap className="size-4" />
                Skills
                <Badge variant="outline" className="ml-auto text-[9px]">{config.skills.length}</Badge>
              </div>
              <div className="space-y-2">
                {config.skills.map((s) => {
                  const isActive = s.status === 'active';
                  return (
                    <div key={s.slug} className={`flex items-center gap-2 text-sm ${!isActive ? 'opacity-50' : ''}`}>
                      <StatusDot status={isActive ? 'live' : 'not_started'} />
                      <span className={isActive ? 'font-medium' : 'text-muted-foreground'}>{s.name}</span>
                      <div className="ml-auto flex gap-1">
                        {s.requiresApproval === 'true'
                          ? <Badge variant="outline" className="text-[9px] text-amber-600">HITL</Badge>
                          : <Badge variant="outline" className="text-[9px] text-green-600">auto</Badge>}
                        {!isActive && <Badge variant="outline" className="text-[9px]">planned</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Objects */}
            <div className="rounded-lg border border-border p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Database className="size-4" />
                Business Objects
                <Badge variant="outline" className="ml-auto text-[9px]">{config.objectTypes.length}</Badge>
              </div>
              <div className="space-y-3">
                {config.objectTypes.map((o) => {
                  const hasData = o.count > 0;
                  const relevance = (o.sourceRelevance ?? {}) as Record<string, number>;
                  const topSources = Object.entries(relevance)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 3);
                  return (
                    <div key={o.slug} className={`${!hasData ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-2 text-sm">
                        <StatusDot status={hasData ? 'live' : 'not_started'} />
                        <span className={hasData ? 'font-medium' : 'text-muted-foreground'}>{o.label}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {o.count}
                        </span>
                      </div>
                      {topSources.length > 0 && (
                        <div className="mt-0.5 ml-5 flex gap-1">
                          {topSources.map(([src, w]) => (
                            <span key={src} className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                              {src}
                              {' '}
                              {w}
                              x
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Approval policy */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Shield className="size-4 stroke-amber-600" />
                Requires Approval
              </div>
              <div className="space-y-1">
                {((config.approvalPolicy.always_approve ?? []) as string[]).map(a => (
                  <div key={a} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="size-1.5 rounded-full bg-amber-500" />
                    {a}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="size-4 stroke-green-600" />
                Auto-Run
              </div>
              <div className="space-y-1">
                {((config.approvalPolicy.auto_run ?? []) as string[]).map(a => (
                  <div key={a} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="size-1.5 rounded-full bg-green-500" />
                    {a}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Search Tuning */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-4">
              <div className="mb-3 text-sm font-semibold">Search Tuning</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Recency decay</span>
                  <code className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                    {config.searchConfig.recencyDecay ?? 'none'}
                  </code>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {config.searchConfig.recencyDecay
                    ? `Score × ${config.searchConfig.recencyDecay}^days — 7-day doc = ${(config.searchConfig.recencyDecay ** 7 * 100).toFixed(0)}%, 30-day = ${(config.searchConfig.recencyDecay ** 30 * 100).toFixed(0)}%`
                    : 'No recency weighting'}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Max results</span>
                  <span>{config.searchConfig.maxResults ?? 10}</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="mb-3 text-sm font-semibold">Source Weights</div>
              {config.searchConfig.sourceWeights
                ? (
                    <div className="space-y-1.5">
                      {Object.entries(config.searchConfig.sourceWeights)
                        .sort(([, a], [, b]) => (b as number) - (a as number))
                        .map(([source, weight]) => {
                          const w = weight as number;
                          return (
                            <div key={source} className="flex items-center gap-2 text-sm">
                              <div className="h-1.5 rounded-full bg-primary" style={{ width: `${w * 40}px` }} />
                              <span className="font-medium">{source}</span>
                              <span className="ml-auto text-xs text-muted-foreground">
                                {w}
                                x
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  )
                : (
                    <div className="text-xs text-muted-foreground">No source weighting configured</div>
                  )}
            </div>
          </div>

          {/* Few-shot Examples */}
          {config.fewShotExamples.length > 0 && (
            <div className="mt-4 rounded-lg border border-border p-4">
              <div className="mb-3 text-sm font-semibold">
                Few-Shot Examples
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {config.fewShotExamples.length}
                  {' '}
                  examples
                </span>
              </div>
              <div className="space-y-3">
                {config.fewShotExamples.map((ex, i) => (
                  <div key={i} className="rounded-md bg-muted/30 p-3">
                    <div className="text-xs font-medium text-muted-foreground">User:</div>
                    <div className="text-sm">{ex.input}</div>
                    <div className="mt-2 text-xs font-medium text-muted-foreground">Expected response:</div>
                    <div className="max-h-24 overflow-y-auto text-xs text-muted-foreground">
                      {ex.output.slice(0, 300)}
                      {ex.output.length > 300 ? '...' : ''}
                    </div>
                    {ex.label && (
                      <div className="mt-1 text-[10px] text-green-600">{ex.label}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* System prompt preview */}
          <div className="mt-4 rounded-lg border border-border p-4">
            <div className="mb-2 text-sm font-semibold">System Prompt</div>
            <div className="max-h-32 overflow-y-auto rounded-md bg-muted/50 p-3 font-mono text-xs text-muted-foreground">
              {config.agent.systemPrompt.slice(0, 600)}
              {config.agent.systemPrompt.length > 600 ? '...' : ''}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {config.agent.systemPrompt.length}
              {' '}
              chars · temperature
              {' '}
              {config.agent.temperature}
              {' '}
              · Langfuse project:
              {' '}
              {config.agent.langfuseProjectId ?? 'default'}
            </div>
          </div>
        </>
      )}

      {/* ================================================================ */}
      {/* HOW IT WORKS                                                     */}
      {/* ================================================================ */}

      <SectionHeading title="How Ziggy Works" description="CoreContext owns the agent loop. Onyx is a retrieval tool." badge="Architecture" />
      <div className="rounded-lg border border-border p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { label: 'User message', style: 'bg-muted' },
            { label: 'CC Agent', style: 'bg-primary/10 font-semibold text-primary' },
            { label: 'search_onyx()', style: 'bg-blue-50 text-blue-700' },
            { label: 'run_skill()', style: 'bg-purple-50 text-purple-700' },
            { label: 'create_object()', style: 'bg-green-50 text-green-700' },
            { label: 'HITL: approve?', style: 'bg-amber-50 font-semibold text-amber-700' },
            { label: 'Response', style: 'bg-muted' },
          ].map((step, i) => (
            <div key={step.label} className="flex items-center gap-1.5">
              <span className={`rounded-md px-2.5 py-1 text-xs ${step.style}`}>{step.label}</span>
              {i < 6 && <ArrowRight className="size-3 stroke-muted-foreground/50" />}
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          Every step traced in Langfuse. The agent decides which tools to call based on the user&apos;s message and Ziggy&apos;s system prompt.
        </div>
      </div>

      {/* ================================================================ */}
      {/* SALES FUNNEL                                                     */}
      {/* ================================================================ */}

      <SectionHeading title="Sales Funnel" description="HubSpot pipeline stages Ziggy manages" />
      <div className="flex items-center gap-1 overflow-x-auto">
        {funnelStages.map((stage, i) => (
          <div key={stage.name} className="flex items-center gap-1">
            <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <div className={`size-2.5 rounded-full ${stage.color}`} />
              <span className="text-sm font-medium whitespace-nowrap">{stage.name}</span>
            </div>
            {i < funnelStages.length - 1 && <ArrowRight className="size-3.5 shrink-0 stroke-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* ================================================================ */}
      {/* SPRINT ROADMAP                                                   */}
      {/* ================================================================ */}

      <SectionHeading title="Sprint Roadmap" description={`${doneTasks}/${totalTasks} tasks complete across 5 sprints`} />
      <div className="space-y-4">
        {sprints.map((sprint) => {
          const done = sprint.tasks.filter(t => t.status === 'done').length;
          const total = sprint.tasks.length;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const isActive = sprint.status === 'in_progress';

          return (
            <div key={sprint.id} className={`rounded-lg border p-4 ${isActive ? 'border-primary/40 bg-primary/[0.02]' : 'border-border'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex size-8 items-center justify-center rounded-full text-sm font-bold ${isActive ? 'bg-primary/10 text-primary' : 'bg-muted'}`}>
                    {sprint.id}
                  </div>
                  <div>
                    <div className="font-semibold">{sprint.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Weeks
                      {' '}
                      {sprint.weeks}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isActive && (
                    <span className="text-xs text-muted-foreground">
                      {done}
                      /
                      {total}
                    </span>
                  )}
                  {isActive
                    ? <Badge className="bg-primary/10 text-primary">In Progress</Badge>
                    : (
                        <Badge variant="outline">
                          <Clock className="mr-1 size-3" />
                          Not Started
                        </Badge>
                      )}
                </div>
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                <strong>Milestone:</strong>
                {' '}
                {sprint.milestone}
              </div>
              {isActive && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}
              <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {sprint.tasks.map(task => (
                  <div key={task.label} className="flex items-start gap-2 text-sm">
                    {task.status === 'done'
                      ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 stroke-green-600" />
                      : task.status === 'in_progress'
                        ? <Clock className="mt-0.5 size-3.5 shrink-0 stroke-primary" />
                        : <Circle className="mt-0.5 size-3.5 shrink-0 stroke-muted-foreground/50" />}
                    <span className={task.status === 'done' ? 'text-foreground' : 'text-muted-foreground'}>
                      {task.label}
                      {task.note
                        ? (
                            <span className="ml-1 text-[11px] text-muted-foreground/70">
                              —
                              {task.note}
                            </span>
                          )
                        : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ================================================================ */}
      {/* OBSERVABILITY                                                    */}
      {/* ================================================================ */}

      <SectionHeading title="Observability" description="Every agent action is traced and measurable" badge="Langfuse" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Eye className="size-4" />
            Traces
          </div>
          <div className="text-sm text-muted-foreground">Every Chat message and skill run creates a Langfuse trace with input, output, latency, model, and document sources.</div>
        </div>
        <div className="rounded-lg border border-border p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <PenTool className="size-4" />
            Prompts
          </div>
          <div className="text-sm text-muted-foreground">Skill prompts are versioned in the DB. Langfuse tracks which version produced which output for A/B testing.</div>
        </div>
        <div className="rounded-lg border border-border p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <GitBranch className="size-4" />
            Evals
          </div>
          <div className="text-sm text-muted-foreground">Gold-standard test cases validate agent quality. Run evals after prompt changes to catch regressions.</div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* EVALS — quality validation                                       */}
      {/* ================================================================ */}

      <SectionHeading title="Eval Suite" description="Gold-standard test cases to validate agent quality after changes" badge="Control Layer" />
      <div className="space-y-2">
        {[
          {
            input: 'What discovery calls did I have this week?',
            expectedBehavior: 'Returns recent Zoom calls classified as discovery, includes Dr. K / Unmuted call, cites sources by number',
            checks: ['Searches Zoom source', 'Finds calls from this week', 'Classifies intro calls as discovery', 'No raw URLs'],
            status: 'draft',
          },
          {
            input: 'Summarize the Kevin/Kristen discovery call',
            expectedBehavior: 'Runs discovery_summary skill, returns structured summary with prospect, pain points, budget, timeline, next steps',
            checks: ['Calls run_discovery_summary skill', 'Includes prospect name', 'Includes budget signals', 'Includes next steps'],
            status: 'draft',
          },
          {
            input: 'Draft a follow-up email for the Dr. K call',
            expectedBehavior: 'Runs draft_followup_email skill, produces email in Chris voice, references specific topics from call, requires approval',
            checks: ['Calls run_draft_followup_email', 'References Unmuted project', 'Professional tone', 'Status: PENDING APPROVAL'],
            status: 'draft',
          },
          {
            input: 'What deals are in my pipeline?',
            expectedBehavior: 'Searches HubSpot for deals, returns structured list with stages and values',
            checks: ['Searches hubspot source', 'Returns deal names + stages', 'Sorted by stage or value'],
            status: 'draft',
          },
        ].map((tc, i) => (
          <div key={i} className="rounded-lg border border-border p-4 opacity-70">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                &quot;
                {tc.input}
                &quot;
              </div>
              <Badge variant="outline" className="text-[9px]">{tc.status}</Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{tc.expectedBehavior}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tc.checks.map(check => (
                <span key={check} className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  {check}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
        Evals will run automatically after prompt or config changes. Results tracked in Langfuse.
      </div>

      {/* ================================================================ */}
      {/* BUSINESS CONTEXT — the intelligence layer                        */}
      {/* ================================================================ */}

      <SectionHeading title="Business Context" description="Domain knowledge that makes Ziggy smart about MetaCTO sales" badge="Context Engineering" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 text-sm font-semibold">What is a Discovery Call?</div>
          <div className="text-xs text-muted-foreground">
            Configured in: Agent system prompt + Zoom enrichment prompt
          </div>
          <div className="mt-2 space-y-1.5 text-sm">
            <div className="flex items-start gap-2">
              <div className="mt-1 size-1.5 shrink-0 rounded-full bg-green-500" />
              <span>Any first meeting with a prospect or potential client</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="mt-1 size-1.5 shrink-0 rounded-full bg-green-500" />
              <span>Includes calls titled &quot;intro call&quot;, &quot;30 min intro&quot;, &quot;MetaCTO &lt;&gt; [Name]&quot;</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="mt-1 size-1.5 shrink-0 rounded-full bg-green-500" />
              <span>Classified by transcript content: project needs, budget, timeline, goals</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="mt-1 size-1.5 shrink-0 rounded-full bg-green-500" />
              <span>NOT classified by title alone — content drives classification</span>
            </div>
          </div>
          <div className="mt-3 rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
            <strong>Enrichment pipeline:</strong>
            {' '}
            Zoom transcript → GPT-5.4-mini → call_type, summary, prospect, budget, timeline → searchable metadata in Vespa
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 text-sm font-semibold">Enrichment Fields</div>
          <div className="text-xs text-muted-foreground">
            Added to every Zoom recording at ingest time
          </div>
          <div className="mt-2 space-y-1">
            {[
              { field: 'call_type', desc: 'discovery / kickoff / check-in / internal / demo / interview / other' },
              { field: 'summary', desc: '2-3 sentence overview of the call' },
              { field: 'prospect_name', desc: 'Name of the prospect (if discovery)' },
              { field: 'prospect_company', desc: 'Company or project name' },
              { field: 'topics', desc: 'Key topic tags (searchable)' },
              { field: 'budget_signals', desc: 'Budget mentions or pricing expectations' },
              { field: 'timeline', desc: 'Start date, deadlines, milestones' },
              { field: 'next_steps', desc: 'Action items from the call' },
              { field: 'attendees', desc: 'Speaker names from transcript' },
            ].map(f => (
              <div key={f.field} className="flex items-start gap-2 text-sm">
                <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-primary">{f.field}</code>
                <span className="text-xs text-muted-foreground">{f.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-4">
          <div className="mb-2 text-sm font-semibold">Search Strategy</div>
          <div className="text-xs text-muted-foreground">How Ziggy finds relevant docs</div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">1</span>
              <span className="text-xs">Specific query (e.g. &quot;discovery calls this week&quot;)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">2</span>
              <span className="text-xs">Broad query (e.g. &quot;MetaCTO intro call March 2026&quot;)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">3</span>
              <span className="text-xs">Metadata query (e.g. &quot;call_type discovery prospect&quot;)</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="mb-2 text-sm font-semibold">Quality Levers</div>
          <div className="text-xs text-muted-foreground">What we can tune for better results</div>
          <div className="mt-2 space-y-1">
            {[
              'Enrichment prompt (classification accuracy)',
              'Agent system prompt (search strategy)',
              'Recency weighting (Onyx boost/filter)',
              'Few-shot examples in prompts',
              'Multi-query search patterns',
              'Business object definitions',
            ].map(item => (
              <div key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="size-1.5 rounded-full bg-muted-foreground/40" />
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="mb-2 text-sm font-semibold">Observability</div>
          <div className="text-xs text-muted-foreground">How we measure quality</div>
          <div className="mt-2 space-y-1">
            {[
              'Langfuse traces on every Chat query',
              'Langfuse traces on every skill run',
              'Enrichment model + timestamp in doc_metadata',
              'Classification accuracy via eval sets (planned)',
              'User feedback on responses (planned)',
              'Citation accuracy tracking (planned)',
            ].map(item => (
              <div key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="size-1.5 rounded-full bg-muted-foreground/40" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* NEXT MILESTONE                                                   */}
      {/* ================================================================ */}

      <div className="mt-8 rounded-lg border border-primary/30 bg-primary/[0.02] p-6">
        <div className="flex items-center gap-2">
          <ArrowRight className="size-5 stroke-primary" />
          <div className="text-sm font-semibold">Next Milestone</div>
          <Badge className="bg-primary/10 text-primary">Sprint 2</Badge>
        </div>
        <div className="mt-2 text-sm text-muted-foreground">
          <strong>The demo:</strong>
          {' '}
          &quot;I had a discovery call this morning&quot; → Ziggy finds the transcript → summarizes it → drafts a capabilities follow-up email → Chris reviews and approves.
        </div>
        <div className="mt-3 space-y-1">
          {[
            'Build CC agent endpoint (LLM with tools: search_onyx + run_skill + create_object)',
            'Skill execution engine with Langfuse tracing',
            'Approval UI for reviewing/editing drafts before send',
            'Agent picker in Chat (select Ziggy vs default)',
          ].map(item => (
            <div key={item} className="flex items-center gap-2 text-sm">
              <div className="size-1.5 rounded-full bg-primary" />
              {item}
            </div>
          ))}
        </div>
      </div>

      {/* ================================================================ */}
      {/* LINKS                                                            */}
      {/* ================================================================ */}

      <div className="mt-6 flex flex-wrap gap-3">
        <a href="http://localhost:3200" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50">
          <Eye className="size-3.5" />
          Langfuse Dashboard
          <ExternalLink className="size-3 stroke-muted-foreground" />
        </a>
        <a href="http://localhost:3100" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50">
          <Search className="size-3.5" />
          Onyx Admin
          <ExternalLink className="size-3 stroke-muted-foreground" />
        </a>
        <a href="http://localhost:5555" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50">
          <GitBranch className="size-3.5" />
          Flower (Celery)
          <ExternalLink className="size-3 stroke-muted-foreground" />
        </a>
      </div>
    </>
  );
}
