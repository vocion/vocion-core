'use client';

import type { getAgentConfig } from '@/services/AgentConfigService';
import {
  ArrowRight,
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
import { Badge } from '@/components/ui/badge';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type AgentConfig = NonNullable<Awaited<ReturnType<typeof getAgentConfig>>>;

type TaskStatus = 'done' | 'in_progress' | 'not_started';
type SprintTask = { label: string; status: TaskStatus; note?: string };

/* ------------------------------------------------------------------ */
/* Sprint data                                                         */
/* ------------------------------------------------------------------ */

const sprints: Array<{
  id: number;
  name: string;
  weeks: string;
  status: 'done' | 'in_progress' | 'not_started';
  milestone: string;
  tasks: SprintTask[];
}> = [
  {
    id: 1,
    name: 'Model & Visibility',
    weeks: '1-2',
    status: 'done',
    milestone: 'Ziggy can see and answer questions about any deal.',
    tasks: [
      { label: 'Connect HubSpot', status: 'done', note: '1,494 docs' },
      { label: 'Connect Gmail', status: 'done', note: '9,740+ docs' },
      { label: 'Connect Zoom (custom connector + LLM enrichment)', status: 'done', note: '1,589 docs' },
      { label: 'Connect Google Drive', status: 'done', note: '75K+ docs' },
      { label: 'Business object model (types, objects, document links)', status: 'done' },
      { label: 'Agent table + Ziggy config in DB', status: 'done' },
      { label: 'Zoom call_type enrichment with few-shot classification', status: 'done', note: 'v3 prompt' },
      { label: 'Langfuse tracing on Chat + skill runs', status: 'done' },
      { label: 'Domains page — hierarchy explorer', status: 'done' },
      { label: 'Object type config (classification, source relevance, few-shots)', status: 'done' },
    ],
  },
  {
    id: 2,
    name: 'Assisted Drafting',
    weeks: '3-4',
    status: 'done',
    milestone: 'Find a discovery call, summarize it, draft a capabilities follow-up. Chris reviews and approves.',
    tasks: [
      { label: 'Discovery Summary skill (prompt in DB, Langfuse traced)', status: 'done', note: 'v2 with product/features/tech' },
      { label: 'Draft Follow-up Email skill', status: 'done', note: 'Chris voice, case study library' },
      { label: 'CC agent endpoint (tool-calling, streaming, Langfuse)', status: 'done', note: 'gpt-4o' },
      { label: 'Skill execution engine (run -> trace -> result)', status: 'done' },
      { label: 'Recency decay + source weighting in search', status: 'done', note: '0.98^days, Zoom 1.5x' },
      { label: 'Smart source filtering (calls -> Zoom)', status: 'done' },
      { label: 'Citation badges with hover popovers', status: 'done' },
      { label: 'EmailDraftCard with approve/edit/reject/copy/mailto', status: 'done' },
      { label: 'Few-shot examples for agent + classification', status: 'done' },
      { label: '10 skills (5 active, 8 planned)', status: 'done' },
      { label: 'Workflows page stubbed (6 workflows)', status: 'done' },
      { label: 'Eval suite stubbed (4 test cases)', status: 'done' },
    ],
  },
  {
    id: 3,
    name: 'Proposal Ops',
    weeks: '5-6',
    status: 'in_progress',
    milestone: 'End-to-end proposal flow from discovery to polished deck.',
    tasks: [
      { label: 'Draft MVP Proposal skill (12-section template, transcript-driven)', status: 'done', note: '8K token output' },
      { label: 'ProposalCard with max-height scroll, approve/edit/reject', status: 'done' },
      { label: 'DraftCard base component (shared by Email + Proposal)', status: 'done' },
      { label: 'Gamma API integration (presentation generation)', status: 'done', note: 'Send to Gamma button' },
      { label: 'Gamma RPC route with polling for completion URL', status: 'done' },
      { label: 'Context-aware suggested actions (proposal vs email)', status: 'done' },
      { label: 'Skill result persistence across stream finalization', status: 'done', note: 'Ref-based capture fix' },
      { label: 'Connectors page (live indexing status, Vespa chunks)', status: 'done' },
      { label: 'Per-connector indexing progress', status: 'done' },
      { label: 'HubSpot stage sync', status: 'not_started' },
      { label: 'Proposal workflow (LangGraph multi-step)', status: 'not_started' },
    ],
  },
  {
    id: 4,
    name: 'Inbox & Follow-up',
    weeks: '7-8',
    status: 'not_started',
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
    status: 'not_started',
    milestone: 'Ziggy operates semi-autonomously within defined policy boundaries.',
    tasks: [
      { label: 'DocuSign NDA workflow', status: 'not_started' },
      { label: 'Policy engine (auto-run vs require approval)', status: 'not_started' },
      { label: 'Eval dashboard + feedback loop', status: 'not_started' },
    ],
  },
];

const funnelStages = [
  { name: 'Lead', color: 'bg-gray-400' },
  { name: 'Contact', color: 'bg-blue-400' },
  { name: 'Discovery', color: 'bg-indigo-400' },
  { name: 'NDA', color: 'bg-purple-400' },
  { name: 'Proposal', color: 'bg-amber-400' },
  { name: 'Negotiation', color: 'bg-orange-400' },
  { name: 'Closed', color: 'bg-green-500' },
];

const connectorMeta: Record<string, { label: string; icon: typeof Zap }> = {
  hubspot: { label: 'HubSpot', icon: Zap },
  gmail: { label: 'Gmail', icon: Mail },
  zoom: { label: 'Zoom', icon: Video },
  google_drive: { label: 'Google Drive', icon: FileText },
  calendly: { label: 'Calendly', icon: Calendar },
  docusign: { label: 'DocuSign', icon: Shield },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const SectionHeading = (props: { title: string; description?: string; badge?: string }) => (
  <div className="mt-6 mb-3 flex items-center gap-3 first:mt-0">
    <div>
      <div className="text-base font-semibold">{props.title}</div>
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
/* Component                                                           */
/* ------------------------------------------------------------------ */

export const ZiggyTabs = ({ config }: { config: AgentConfig | null }) => {
  const totalTasks = sprints.reduce((sum, s) => sum + s.tasks.length, 0);
  const doneTasks = sprints.reduce((sum, s) => sum + s.tasks.filter(t => t.status === 'done').length, 0);
  const overallPct = Math.round((doneTasks / totalTasks) * 100);

  return (
    <Tabs defaultValue="overview" className="mt-4">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="config">Configuration</TabsTrigger>
        <TabsTrigger value="skills">Skills & Tools</TabsTrigger>
        <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
        <TabsTrigger value="context">Context</TabsTrigger>
        <TabsTrigger value="observability">Observability</TabsTrigger>
      </TabsList>

      {/* ============================================================ */}
      {/* OVERVIEW TAB                                                  */}
      {/* ============================================================ */}
      <TabsContent value="overview" className="space-y-4 pt-4">
        {/* Stats bar */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-lg border border-border p-3 text-center">
            <div className="text-2xl font-bold text-primary">
              {overallPct}
              %
            </div>
            <div className="text-[11px] text-muted-foreground">Overall Progress</div>
          </div>
          {config && (
            <>
              <div className="rounded-lg border border-border p-3 text-center">
                <div className="text-2xl font-bold">{config.agent.model}</div>
                <div className="text-[11px] text-muted-foreground">Model</div>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <div className="text-2xl font-bold">{config.skills.filter(s => s.assignedToAgent && s.status === 'active').length}</div>
                <div className="text-[11px] text-muted-foreground">Active Skills</div>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <div className="text-2xl font-bold">{config.connectorSources.length}</div>
                <div className="text-[11px] text-muted-foreground">Connectors</div>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <div className="text-2xl font-bold">{config.objectTypes.filter(t => t.assignedToAgent).length}</div>
                <div className="text-[11px] text-muted-foreground">Object Types</div>
              </div>
            </>
          )}
        </div>

        {/* What is Ziggy */}
        <div className="rounded-lg border border-border p-5">
          <div className="text-sm leading-relaxed text-muted-foreground">
            An agent in CoreContext is a
            {' '}
            <strong className="text-foreground">packaged configuration</strong>
            {' '}
            — a system prompt, scoped connectors, skills, business objects, and approval rules stored in the database. Not a deployed service, not a fine-tuned model, not code. Change behavior by editing config, not deploying.
          </div>
        </div>

        {/* Agent loop */}
        <SectionHeading title="Agent Loop" badge="Architecture" />
        <div className="rounded-lg border border-border p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { label: 'User message', style: 'bg-muted' },
              { label: 'CC Agent', style: 'bg-primary/10 font-semibold text-primary' },
              { label: 'search_onyx()', style: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300' },
              { label: 'run_skill()', style: 'bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300' },
              { label: 'HITL: approve?', style: 'bg-amber-50 font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' },
              { label: 'Response', style: 'bg-muted' },
            ].map((step, i) => (
              <div key={step.label} className="flex items-center gap-1.5">
                <span className={`rounded-md px-2.5 py-1 text-xs ${step.style}`}>{step.label}</span>
                {i < 5 && <ArrowRight className="size-3 stroke-muted-foreground/50" />}
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Every step traced in Langfuse. The agent decides which tools to call based on the user&apos;s message and Ziggy&apos;s system prompt.
          </div>
        </div>

        {/* Sales funnel */}
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

        {/* Quick links */}
        <div className="mt-4 flex flex-wrap gap-3">
          <a href="http://localhost:3200" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50">
            <Eye className="size-3.5" />
            Langfuse
            <ExternalLink className="size-3 stroke-muted-foreground" />
          </a>
          <a href="http://localhost:3100" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50">
            <Search className="size-3.5" />
            Onyx Admin
            <ExternalLink className="size-3 stroke-muted-foreground" />
          </a>
        </div>
      </TabsContent>

      {/* ============================================================ */}
      {/* CONFIGURATION TAB                                             */}
      {/* ============================================================ */}
      <TabsContent value="config" className="space-y-4 pt-4">
        {config
          ? (
              <>
                {/* Connectors / Skills / Objects grid */}
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
                      {config.skills.map(s => (
                        <div key={s.slug} className={`flex items-center gap-2 text-sm ${s.status !== 'active' ? 'opacity-50' : ''}`}>
                          <StatusDot status={s.status === 'active' ? 'live' : 'not_started'} />
                          <span className={s.status === 'active' ? 'font-medium' : 'text-muted-foreground'}>{s.name}</span>
                          <div className="ml-auto flex gap-1">
                            {s.requiresApproval === 'true'
                              ? <Badge variant="outline" className="text-[9px] text-amber-600">HITL</Badge>
                              : <Badge variant="outline" className="text-[9px] text-green-600">auto</Badge>}
                            {s.status !== 'active' && <Badge variant="outline" className="text-[9px]">planned</Badge>}
                          </div>
                        </div>
                      ))}
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
                        const relevance = (o.sourceRelevance ?? {}) as Record<string, number>;
                        const topSources = Object.entries(relevance).sort(([, a], [, b]) => b - a).slice(0, 3);
                        return (
                          <div key={o.slug} className={o.count === 0 ? 'opacity-50' : ''}>
                            <div className="flex items-center gap-2 text-sm">
                              <StatusDot status={o.count > 0 ? 'live' : 'not_started'} />
                              <span className={o.count > 0 ? 'font-medium' : 'text-muted-foreground'}>{o.label}</span>
                              <span className="ml-auto text-xs text-muted-foreground">{o.count}</span>
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

                {/* Approval + Search */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

                {/* Search tuning + Source weights */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-border p-4">
                    <div className="mb-3 text-sm font-semibold">Search Tuning</div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Recency decay</span>
                        <code className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{config.searchConfig.recencyDecay ?? 'none'}</code>
                      </div>
                      {config.searchConfig.recencyDecay && (
                        <div className="text-[10px] text-muted-foreground">
                          Score x
                          {' '}
                          {config.searchConfig.recencyDecay}
                          ^days — 7d =
                          {' '}
                          {(config.searchConfig.recencyDecay ** 7 * 100).toFixed(0)}
                          %, 30d =
                          {' '}
                          {(config.searchConfig.recencyDecay ** 30 * 100).toFixed(0)}
                          %
                        </div>
                      )}
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
                              .sort(([, a], [, b]) => b - a)
                              .map(([source, weight]) => (
                                <div key={source} className="flex items-center gap-2 text-sm">
                                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${weight * 40}px` }} />
                                  <span className="font-medium">{source}</span>
                                  <span className="ml-auto text-xs text-muted-foreground">
                                    {weight}
                                    x
                                  </span>
                                </div>
                              ))}
                          </div>
                        )
                      : <div className="text-xs text-muted-foreground">No source weighting configured</div>}
                  </div>
                </div>

                {/* System prompt */}
                <div className="rounded-lg border border-border p-4">
                  <div className="mb-2 text-sm font-semibold">System Prompt</div>
                  <div className="max-h-32 overflow-y-auto rounded-md bg-muted/50 p-3 font-mono text-xs text-muted-foreground">
                    {config.agent.systemPrompt.slice(0, 600)}
                    {config.agent.systemPrompt.length > 600 ? '...' : ''}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {config.agent.systemPrompt.length}
                    {' '}
                    chars · temperature
                    {config.agent.temperature}
                    {' '}
                    · Langfuse:
                    {config.agent.langfuseProjectId ?? 'default'}
                  </div>
                </div>

                {/* Few-shot examples */}
                {config.fewShotExamples.length > 0 && (
                  <div className="rounded-lg border border-border p-4">
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
                          <div className="mt-2 text-xs font-medium text-muted-foreground">Expected:</div>
                          <div className="max-h-24 overflow-y-auto text-xs text-muted-foreground">
                            {ex.output.slice(0, 300)}
                            {ex.output.length > 300 ? '...' : ''}
                          </div>
                          {ex.label && <div className="mt-1 text-[10px] text-green-600">{ex.label}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )
          : (
              <div className="rounded-md bg-muted/50 p-8 text-center text-sm text-muted-foreground">
                Agent not configured. Sign in and run the seed script.
              </div>
            )}
      </TabsContent>

      {/* ============================================================ */}
      {/* SKILLS & TOOLS TAB                                            */}
      {/* ============================================================ */}
      <TabsContent value="skills" className="space-y-4 pt-4">
        <SectionHeading title="Agent Tools" description="Tool functions available to the LLM during the agent loop" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { name: 'search_onyx', desc: 'Semantic search across all connected sources with smart filtering, recency decay, and source weighting', status: 'live', type: 'query' },
            { name: 'lookup_objects', desc: 'Browse structured business objects (discovery calls, deals, accounts) from the CoreContext database', status: 'live', type: 'query' },
            { name: 'run_discovery_summary', desc: 'Analyze Zoom transcript into structured summary with prospect, budget, timeline, and next steps', status: 'live', type: 'skill' },
            { name: 'run_draft_followup_email', desc: 'Draft capabilities follow-up email in Chris\'s voice with case study references. Requires approval.', status: 'live', type: 'skill' },
            { name: 'run_draft_mvp_proposal', desc: '12-section MVP proposal with transcript-driven customization. Requires approval. Send to Gamma for deck.', status: 'live', type: 'skill' },
            { name: 'find_related_conversations', desc: 'Multi-query search across Gmail, Slack, HubSpot for conversation threads related to a topic', status: 'live', type: 'query' },
            { name: 'search_everything', desc: 'Comprehensive cross-source search with multiple queries, returns grouped results by source', status: 'live', type: 'query' },
          ].map(tool => (
            <div key={tool.name} className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2">
                <StatusDot status={tool.status} />
                <code className="text-sm font-semibold">{tool.name}</code>
                <Badge variant="outline" className="ml-auto text-[9px]">{tool.type}</Badge>
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">{tool.desc}</div>
            </div>
          ))}
        </div>

        <SectionHeading title="Integrations" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { name: 'Onyx', desc: 'Self-hosted search engine. Vespa + OpenSearch. Indexes HubSpot, Gmail, Zoom, Drive.', url: 'http://localhost:3100' },
            { name: 'Gamma', desc: 'AI presentation generation. Converts proposal text into polished slide decks via API.', url: 'https://gamma.app' },
            { name: 'Langfuse', desc: 'LLM observability. Traces every agent call, skill run, and tool execution.', url: 'http://localhost:3200' },
          ].map(int => (
            <div key={int.name} className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{int.name}</span>
                <a href={int.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3.5 stroke-muted-foreground" />
                </a>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{int.desc}</div>
            </div>
          ))}
        </div>

        <SectionHeading title="UI Components" description="Cards and panels rendered in the Chat interface" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { name: 'DraftCard', desc: 'Shared base: status badges, markdown rendering, edit mode, approve/reject, copy' },
            { name: 'EmailDraftCard', desc: 'Email-specific: subject parsing, mailto link, "Send with email" button' },
            { name: 'ProposalCard', desc: 'Proposal-specific: scrollable body, "Send to Gamma" button, title generation' },
            { name: 'LiveThinking', desc: 'Real-time agent reasoning: steps, search queries, skill execution, elapsed timer' },
            { name: 'CitationBadge', desc: 'Inline source reference: click to preview, hover popover with metadata' },
            { name: 'ContextMenu', desc: 'Object-aware action menu: summarize, email, proposal, search from any detected entity' },
          ].map(c => (
            <div key={c.name} className="rounded-lg border border-border p-3">
              <code className="text-xs font-semibold">{c.name}</code>
              <div className="mt-1 text-xs text-muted-foreground">{c.desc}</div>
            </div>
          ))}
        </div>
      </TabsContent>

      {/* ============================================================ */}
      {/* ROADMAP TAB                                                   */}
      {/* ============================================================ */}
      <TabsContent value="roadmap" className="space-y-4 pt-4">
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">
            {doneTasks}
            /
            {totalTasks}
            {' '}
            tasks complete
          </div>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${overallPct}%` }} />
          </div>
          <Badge className="bg-primary/10 text-primary">
            {overallPct}
            %
          </Badge>
        </div>

        <div className="space-y-4">
          {sprints.map((sprint) => {
            const done = sprint.tasks.filter(t => t.status === 'done').length;
            const total = sprint.tasks.length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const isActive = sprint.status === 'in_progress';
            const isDone = sprint.status === 'done';

            return (
              <div key={sprint.id} className={`rounded-lg border p-4 ${isActive ? 'border-primary/40 bg-primary/[0.02]' : isDone ? 'border-green-200/50 bg-green-50/10 dark:border-green-900/30' : 'border-border'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex size-8 items-center justify-center rounded-full text-sm font-bold ${isDone ? 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' : isActive ? 'bg-primary/10 text-primary' : 'bg-muted'}`}>
                      {isDone ? <CheckCircle2 className="size-4" /> : sprint.id}
                    </div>
                    <div>
                      <div className="font-semibold">{sprint.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Weeks
                        {sprint.weeks}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {done}
                      /
                      {total}
                    </span>
                    {isDone
                      ? <Badge className="bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400">Complete</Badge>
                      : isActive
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
                {(isActive || isDone) && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full transition-all ${isDone ? 'bg-green-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
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
                        {task.note && (
                          <span className="ml-1 text-[11px] text-muted-foreground/70">
                            —
                            {task.note}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </TabsContent>

      {/* ============================================================ */}
      {/* CONTEXT TAB                                                   */}
      {/* ============================================================ */}
      <TabsContent value="context" className="space-y-4 pt-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 text-sm font-semibold">What is a Discovery Call?</div>
            <div className="mt-2 space-y-1.5 text-sm">
              {[
                'Any first meeting with a prospect or potential client',
                'Includes calls titled "intro call", "30 min intro", "MetaCTO <> [Name]"',
                'Classified by transcript content: project needs, budget, timeline, goals',
                'NOT classified by title alone — content drives classification',
              ].map(item => (
                <div key={item} className="flex items-start gap-2">
                  <div className="mt-1 size-1.5 shrink-0 rounded-full bg-green-500" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
              <strong>Pipeline:</strong>
              {' '}
              Zoom transcript → GPT-4o-mini → call_type, summary, prospect, budget, timeline → Vespa metadata
            </div>
          </div>

          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 text-sm font-semibold">Enrichment Fields</div>
            <div className="text-xs text-muted-foreground">Added to every Zoom recording at ingest</div>
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <div className="mb-2 text-sm font-semibold">Search Strategy</div>
            <div className="mt-2 space-y-1 text-sm">
              {['Specific query (e.g. "discovery calls this week")', 'Broad query (e.g. "MetaCTO intro call March 2026")', 'Metadata query (e.g. "call_type discovery prospect")'].map((item, i) => (
                <div key={item} className="flex items-center gap-2">
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">{i + 1}</span>
                  <span className="text-xs">{item}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="mb-2 text-sm font-semibold">Quality Levers</div>
            <div className="mt-2 space-y-1">
              {['Enrichment prompt (classification accuracy)', 'Agent system prompt (search strategy)', 'Recency weighting (Onyx boost/filter)', 'Few-shot examples in prompts', 'Multi-query search patterns', 'Business object definitions'].map(item => (
                <div key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="size-1.5 rounded-full bg-muted-foreground/40" />
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="mb-2 text-sm font-semibold">Observability</div>
            <div className="mt-2 space-y-1">
              {['Langfuse traces on every Chat query', 'Langfuse traces on every skill run', 'Enrichment model + timestamp in doc_metadata', 'Classification accuracy via eval sets (planned)', 'User feedback on responses (planned)', 'Citation accuracy tracking (planned)'].map(item => (
                <div key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="size-1.5 rounded-full bg-muted-foreground/40" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </TabsContent>

      {/* ============================================================ */}
      {/* OBSERVABILITY TAB                                             */}
      {/* ============================================================ */}
      <TabsContent value="observability" className="space-y-4 pt-4">
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

        <SectionHeading title="Eval Suite" badge="Control Layer" />
        <div className="space-y-2">
          {[
            { input: 'What discovery calls did I have this week?', expected: 'Returns recent Zoom calls classified as discovery', checks: ['Searches Zoom source', 'Finds calls from this week', 'Classifies intro calls as discovery', 'No raw URLs'] },
            { input: 'Summarize the Kevin/Kristen discovery call', expected: 'Runs discovery_summary skill, returns structured summary', checks: ['Calls run_discovery_summary', 'Includes prospect name', 'Includes budget signals', 'Includes next steps'] },
            { input: 'Draft a follow-up email for the Dr. K call', expected: 'Runs draft_followup_email, produces email in Chris voice', checks: ['Calls run_draft_followup_email', 'References Unmuted project', 'Professional tone', 'Status: PENDING APPROVAL'] },
            { input: 'Generate a proposal for Dr. K', expected: 'Runs draft_mvp_proposal, produces 12-section proposal', checks: ['Calls run_draft_mvp_proposal', 'ProposalCard rendered', 'Send to Gamma button', 'Scrollable body'] },
            { input: 'What deals are in my pipeline?', expected: 'Searches HubSpot for deals, returns structured list', checks: ['Searches hubspot source', 'Returns deal names + stages', 'Sorted by stage or value'] },
          ].map((tc, i) => (
            <div key={i} className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  &quot;
                  {tc.input}
                  &quot;
                </div>
                <Badge variant="outline" className="text-[9px]">draft</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{tc.expected}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {tc.checks.map(check => (
                  <span key={check} className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{check}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );
};
