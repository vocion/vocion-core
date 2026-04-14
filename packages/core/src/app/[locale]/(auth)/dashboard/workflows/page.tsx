import {
  ArrowRight,
  Calendar,
  GitBranch,
  Inbox,
  Mail,
  Search,
  Shield,
  Zap,
} from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';

const workflows = [
  {
    name: 'Discovery Follow-up',
    trigger: 'After discovery call completed',
    triggerType: 'event',
    status: 'planned',
    sprint: 2,
    steps: [
      { label: 'Find transcript', tool: 'search_onyx', approval: false },
      { label: 'Generate summary', tool: 'discovery_summary', approval: false },
      { label: 'Draft follow-up email', tool: 'draft_followup_email', approval: true },
      { label: 'Send via Gmail', tool: 'gmail_send', approval: true },
      { label: 'Update HubSpot stage', tool: 'hubspot_update', approval: false },
    ],
    icon: Mail,
  },
  {
    name: 'Inbound Lead Triage',
    trigger: 'New lead arrives in HubSpot',
    triggerType: 'event',
    status: 'planned',
    sprint: 2,
    steps: [
      { label: 'Match HubSpot records', tool: 'hubspot_search', approval: false },
      { label: 'Enrich context', tool: 'search_onyx', approval: false },
      { label: 'Classify lead quality', tool: 'lead_classifier', approval: false },
      { label: 'Draft response', tool: 'draft_lead_response', approval: true },
      { label: 'Send via Gmail', tool: 'gmail_send', approval: true },
    ],
    icon: Inbox,
  },
  {
    name: 'Proposal Generation',
    trigger: 'Manual or after NDA signed',
    triggerType: 'manual',
    status: 'planned',
    sprint: 3,
    steps: [
      { label: 'Gather context', tool: 'search_onyx', approval: false },
      { label: 'Generate proposal brief', tool: 'draft_proposal_brief', approval: true },
      { label: 'Create deck', tool: 'slides_generate', approval: true },
      { label: 'Draft delivery email', tool: 'draft_followup_email', approval: true },
      { label: 'Send proposal', tool: 'gmail_send', approval: true },
    ],
    icon: Zap,
  },
  {
    name: 'Daily Inbox Scan',
    trigger: 'Scheduled — daily at 8am',
    triggerType: 'scheduled',
    status: 'planned',
    sprint: 4,
    steps: [
      { label: 'Scan Gmail inbox', tool: 'gmail_search', approval: false },
      { label: 'Classify threads', tool: 'inbox_triage', approval: false },
      { label: 'Draft responses', tool: 'draft_followup_email', approval: true },
      { label: 'Create escalations', tool: 'create_escalation', approval: false },
    ],
    icon: Search,
  },
  {
    name: 'Aging Pipeline Review',
    trigger: 'Scheduled — daily at 9am',
    triggerType: 'scheduled',
    status: 'planned',
    sprint: 4,
    steps: [
      { label: 'Query stale deals', tool: 'aging_pipeline', approval: false },
      { label: 'Generate recommendations', tool: 'followup_recommender', approval: false },
      { label: 'Draft follow-ups', tool: 'draft_followup_email', approval: true },
    ],
    icon: Calendar,
  },
  {
    name: 'NDA Workflow',
    trigger: 'Deal reaches NDA stage',
    triggerType: 'event',
    status: 'planned',
    sprint: 5,
    steps: [
      { label: 'Prepare DocuSign', tool: 'docusign_prepare', approval: true },
      { label: 'Send NDA', tool: 'docusign_send', approval: true },
      { label: 'Monitor completion', tool: 'docusign_monitor', approval: false },
      { label: 'Update HubSpot', tool: 'hubspot_update', approval: false },
    ],
    icon: Shield,
  },
];

const triggerBadges: Record<string, { label: string; style: string }> = {
  event: { label: 'Event', style: 'bg-blue-100 text-blue-800' },
  scheduled: { label: 'Scheduled', style: 'bg-purple-100 text-purple-800' },
  manual: { label: 'Manual', style: 'bg-gray-100 text-gray-800' },
};

export default async function WorkflowsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <TitleBar
        title="Workflows"
        description="Multi-step processes with triggers, skills, and approval gates"
      />

      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border p-3 text-center">
          <div className="text-xl font-bold">{workflows.length}</div>
          <div className="text-[11px] text-muted-foreground">Total Workflows</div>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <div className="text-xl font-bold text-muted-foreground">0</div>
          <div className="text-[11px] text-muted-foreground">Active</div>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <div className="text-xl font-bold">{workflows.reduce((sum, w) => sum + w.steps.filter(s => s.approval).length, 0)}</div>
          <div className="text-[11px] text-muted-foreground">HITL Gates</div>
        </div>
      </div>

      <div className="space-y-4">
        {workflows.map((wf) => {
          const trigger = triggerBadges[wf.triggerType] ?? triggerBadges.manual!;
          return (
            <div key={wf.name} className="rounded-lg border border-border p-5 opacity-70">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                    <wf.icon className="size-4 stroke-muted-foreground" />
                  </div>
                  <div>
                    <div className="font-semibold">{wf.name}</div>
                    <div className="text-xs text-muted-foreground">{wf.trigger}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${trigger.style}`}>{trigger.label}</span>
                  <Badge variant="outline" className="text-[9px]">
                    Sprint
                    {wf.sprint}
                  </Badge>
                  <Badge variant="outline" className="text-[9px]">Planned</Badge>
                </div>
              </div>

              {/* Steps flow */}
              <div className="mt-4 flex flex-wrap items-center gap-1">
                {wf.steps.map((step, i) => (
                  <div key={step.label} className="flex items-center gap-1">
                    <span className={`rounded-md px-2 py-0.5 text-[11px] ${step.approval ? 'bg-amber-500/10 font-semibold text-amber-700 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>
                      {step.approval && <Shield className="mr-1 inline size-2.5" />}
                      {step.label}
                    </span>
                    {i < wf.steps.length - 1 && <ArrowRight className="size-2.5 stroke-muted-foreground/50" />}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        <GitBranch className="mx-auto mb-2 size-8 stroke-muted-foreground/30" />
        Workflows will be powered by Temporal for durable execution with retries, scheduling, and long-running processes.
      </div>
    </>
  );
}
