import type { RunSummary } from '@/features/dashboard/inbox/RunDecision';
import type { InboxSort } from '@/services/InboxService';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { CommentLayerProvider } from '@/features/comments/CommentLayer';
import { loadChatAgentContext } from '@/features/dashboard/chat/agentOptions';
import { ChatDock } from '@/features/dashboard/chat/ChatDock';
import { RecordContext } from '@/features/dashboard/context/RecordContext';
import { AskReceipt } from '@/features/dashboard/inbox/AskReceipt';
import { AskSheet } from '@/features/dashboard/inbox/AskSheet';
import { agoLabel, decisionCrumbs } from '@/features/dashboard/inbox/inboxMeta';
import { LearningDecision } from '@/features/dashboard/inbox/LearningDecision';
import { RunDecision } from '@/features/dashboard/inbox/RunDecision';
import { toSheetAsk } from '@/features/dashboard/inbox/toSheetAsk';
import { ReviewFocus } from '@/features/dashboard/ReviewFocus';
import { describeAction } from '@/features/review/describeAction';
import { ReviewHeader } from '@/features/review/ReviewHeader';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { scoreFor } from '@/services/alignment/AlignmentService';
import { getAsk } from '@/services/AskService';
import { recordRef } from '@/services/chat/recordContext';
import { parseInboxRef } from '@/services/inbox/inboxRef';
import { loadPendingAction } from '@/services/inbox/pendingAction';
import { askGroupHref } from '@/services/inbox/recordKey';
import { INBOX_SORTS, kindForAsk, listProposalQueue } from '@/services/InboxService';
import { getCandidate } from '@/services/LearningCandidateService';
import { getMissionRun } from '@/services/MissionService';
import { getWorkerRun } from '@/services/WorkerRunService';
import { getWorkflowRun } from '@/services/WorkflowService';

/**
 * One decision, whatever its kind. The `[id]` segment is an inbox ref
 * (`services/inbox/inboxRef`): a bare number is an ask, `proposal-123` an
 * agent-proposed action, `mission-5` / `workflow-3` / `worker-9` a stopped
 * run, `learning-7` a suggested rule. Each kind renders its own detail —
 * the rich proposal screen, the ask sheet, a compact run page, the rule
 * editor — under the same chrome: breadcrumb › kind › record, the meta row
 * with confidence and alignment, the sticky bar with the kind's verbs.
 *
 * The proposal screen's Up-next walks the inbox list under the filters in
 * the query string, so `j`/`k` from here move through exactly what the list
 * showed.
 */

export const dynamic = 'force-dynamic';

type Params = { q?: string; sort?: string; actionKind?: string; agents?: string; kind?: string };

function list(value: string | undefined): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * The list's filters, kept on every neighbour's URL.
 * @param sp
 */
function carried(sp: Params): string {
  const qs = new URLSearchParams();
  for (const k of ['q', 'sort', 'actionKind', 'agents'] as const) {
    if (sp[k]) {
      qs.set(k, sp[k]!);
    }
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export default async function InboxDetailPage(props: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<Params> }) {
  const { locale, id } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();
  const ref = parseInboxRef(id);
  if (!orgId || !ref) {
    notFound();
  }

  switch (ref.kind) {
    case 'ask': {
      const ask = await getAsk(orgId, ref.id);
      if (!ask) {
        notFound();
      }
      const kind = kindForAsk(ask.kind);
      return (
        <div className="mx-auto w-full max-w-3xl">
          {ask.status === 'open'
            ? <AskSheet asks={[toSheetAsk(ask, await scoreFor({ orgId, subjectKey: ask.kind, agentSlug: ask.agentSlug }))]} kind={kind} />
            : (
                <>
                  <ReviewHeader crumbs={decisionCrumbs(kind, ask.title)} title={ask.title} system="Answered" status={ask.status} proposedBy={ask.agentSlug ? `asked by ${ask.agentSlug}` : null} />
                  <div className="mt-4">
                    <AskReceipt ask={ask} />
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Filed
                    {' '}
                    {ask.createdAt.toLocaleString()}
                    {ask.createdBy ? ` by ${ask.createdBy}` : ''}
                    {ask.sourceRef ? ` · ${ask.sourceRef}` : ''}
                    {` · /api/v1/asks/${ask.id}`}
                  </p>
                </>
              )}
          {ask.groupKey && (
            <p className="mt-4 text-xs text-muted-foreground">
              Part of
              {' '}
              <Link href={askGroupHref(ask.groupKey)} className="underline-offset-2 hover:underline">{ask.groupTitle ?? 'a decision sheet'}</Link>
              .
            </p>
          )}
        </div>
      );
    }

    case 'proposal': {
      const run = await loadPendingAction(orgId, ref.id);
      if (!run) {
        notFound();
      }
      // A released hand-off (`awaiting_execution`) is decided but not done, so
      // it keeps the decision screen: the bar reads Mark done.
      if (run.status !== 'pending' && run.status !== 'failed' && run.status !== 'awaiting_execution') {
        // Decided: the receipt, not the decision.
        const desc = describeAction(run);
        return (
          <div className="mx-auto w-full max-w-3xl">
            <ReviewHeader crumbs={decisionCrumbs('proposal', run.card?.subject?.name ?? desc.title)} title={run.card?.title ?? desc.title} system={run.card?.system ?? desc.system} status={run.status} proposedBy={run.invokedBy} confidence={run.proposal?.confidence} alignment={run.alignment} />
            <p className="mt-4 text-sm text-muted-foreground">
              {run.status === 'rejected' ? 'Declined' : 'Approved'}
              {' · '}
              {agoLabel(new Date(run.createdAt))}
              {' · '}
              <Link href="/dashboard/inbox?tab=decided" className="underline-offset-2 hover:underline">All decided</Link>
            </p>
          </div>
        );
      }
      const sort = ((INBOX_SORTS as readonly string[]).includes(sp.sort ?? '') ? sp.sort : 'oldest') as InboxSort;
      const [queue, { agents }] = await Promise.all([
        listProposalQueue(orgId, { q: sp.q?.trim(), sort, actionKinds: list(sp.actionKind), agents: list(sp.agents) }),
        loadChatAgentContext(orgId),
      ]);
      const search = carried(sp);
      const record = recordRef('ask', run.id, describeAction(run).title);
      const path = `/dashboard/inbox/${id}`;
      // The same wiring the lead page has, and for the same two reasons. The
      // rail beside a decision could read the title and nothing else: with no
      // run in hand there was nothing for `@change` to rewrite ("I don't have
      // edit access to that review queue page"), and with no comment layer a
      // highlighted sentence raised no control. Chris, 2026-09-17: *"why can't
      // I edit with chat / when I highlight text why don't I get the
      // contextual chat tooltip?"* The shell's dock bails on this route
      // (`OWN_DOCK_ROUTES`), so this is the page's one surface.
      return (
        <CommentLayerProvider
          targetRef={`action_run:${run.id}`}
          record={record}
          // The sends are in view exactly when the card is, so that is when
          // the selection offers *Add change* and `(+)` offers `@change`.
          changeIntent={Boolean(run.card)}
        >
          {/* Declare the record so the conversation beside this page knows
              WHAT it is looking at (`pageShowsRecord`). */}
          <RecordContext record={record} />
          <div className="min-w-0 flex-1">
            <ReviewFocus run={run} queue={queue} search={search} listHref={`/dashboard/inbox?kind=proposal${search.replace(/^\?/, '&')}`} />
          </div>
          {agents.length > 0 && (
            <ChatDock
              agents={agents}
              scopeLabel="Everything"
              pageContext={{ path, title: describeAction(run).title, record }}
              defaultCollapsed
              // The decision waiting on this page, so `@change` rewrites the
              // sends in view rather than acknowledging the request.
              run={run.card ? { ...run, card: run.card } : null}
            />
          )}
        </CommentLayerProvider>
      );
    }

    case 'mission': {
      const run = await getMissionRun(ref.id, orgId);
      if (!run) {
        notFound();
      }
      const tasks = run.plan?.tasks ?? [];
      const summary: RunSummary = {
        kind: 'mission',
        id: run.id,
        title: run.title,
        status: run.status,
        reason: run.pauseReason ?? run.error ?? null,
        agentSlug: run.team.lead,
        openHref: `/dashboard/missions/runs/${run.id}`,
        openLabel: 'Open the mission run',
        facts: [
          { label: 'Tasks', value: `${tasks.filter(t => t.status === 'completed').length} of ${tasks.length} done` },
          { label: 'Awaiting approval', value: String(tasks.filter(t => t.status === 'awaiting_approval').length) },
          { label: 'Started', value: run.createdAt.toLocaleString() },
          ...(run.pausedAt ? [{ label: 'Paused', value: run.pausedAt.toLocaleString() }] : []),
        ],
        actionable: true,
      };
      return <RunDecision run={summary} />;
    }

    case 'workflow': {
      const run = await getWorkflowRun(ref.id, orgId);
      if (!run) {
        notFound();
      }
      const steps = Object.values(run.stepResults);
      const summary: RunSummary = {
        kind: 'workflow',
        id: run.id,
        title: `${run.workflowSlug} — run #${run.id}`,
        status: run.status,
        reason: run.pauseReason ?? run.error ?? null,
        agentSlug: null,
        openHref: `/dashboard/workflows/${encodeURIComponent(run.workflowSlug)}/runs/${run.id}`,
        openLabel: 'Open the workflow run',
        facts: [
          { label: 'Steps', value: `${steps.filter(s => s.status === 'completed').length} of ${steps.length} done` },
          { label: 'Current step', value: run.currentStep === null ? '—' : String(run.currentStep + 1) },
          { label: 'Started', value: run.createdAt.toLocaleString() },
        ],
        actionable: true,
      };
      return <RunDecision run={summary} />;
    }

    case 'worker': {
      const run = await getWorkerRun(orgId, ref.id);
      if (!run) {
        notFound();
      }
      const summary: RunSummary = {
        kind: 'worker',
        id: run.id,
        title: `${run.agentSlug} — worker run #${run.id}`,
        status: run.status,
        reason: run.error ?? run.summary ?? (run.status === 'lost' ? 'Lease lapsed without a heartbeat' : null),
        agentSlug: run.agentSlug,
        openHref: `/dashboard/agents/${encodeURIComponent(run.agentSlug)}`,
        openLabel: 'Open the agent',
        facts: [
          { label: 'Kind', value: run.kind },
          { label: 'Model', value: run.model ?? '—' },
          { label: 'Attempt', value: String(run.attempt) },
          { label: 'Spend', value: `$${(run.cents / 100).toFixed(2)} · ${run.tokens.toLocaleString()} tokens` },
          ...(run.heartbeatAt ? [{ label: 'Last heartbeat', value: run.heartbeatAt.toLocaleString() }] : []),
        ],
        actionable: false,
      };
      return <RunDecision run={summary} />;
    }

    case 'learning': {
      const candidate = await getCandidate(orgId, ref.id);
      if (!candidate) {
        notFound();
      }
      return (
        <LearningDecision
          candidate={{
            id: candidate.id,
            stepName: candidate.stepName,
            ruleText: candidate.ruleText,
            editedRuleText: candidate.editedRuleText,
            polarity: candidate.polarity,
            occurrenceCount: candidate.occurrenceCount,
            sourceFeedbackJobId: candidate.sourceFeedbackJobId,
            status: candidate.status,
            rejectedReason: candidate.rejectedReason,
            decidedBy: candidate.decidedBy,
            decidedAt: candidate.decidedAt?.toISOString() ?? null,
            createdAt: candidate.createdAt.toISOString(),
          }}
        />
      );
    }

    default:
      notFound();
  }
}
