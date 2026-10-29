import type { Metadata } from 'next';
import type { RunSummary } from '@/features/dashboard/inbox/RunDecision';
import type { SheetExtras } from '@/services/inbox/sheetExtras';
import type { InboxSort } from '@/services/InboxService';
import { and, eq } from 'drizzle-orm';
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
import { ResultLinks } from '@/features/review/ResultLinks';
import { ReviewHeader } from '@/features/review/ReviewHeader';
import { ReviewSurface } from '@/features/review/ReviewSurface';
import { doneSummary } from '@/libs/actions/doneSummary';
import { resultLinks } from '@/libs/actions/resultLinks';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { recordLinker } from '@/libs/workspace/recordHref';
import { actionRunSchema } from '@/models/Schema';
import { scoreFor } from '@/services/alignment/AlignmentService';
import { getAsk } from '@/services/AskService';
import { recordRef } from '@/services/chat/recordContext';
import { loadAnswerListeners } from '@/services/inbox/answerListeners';
import { loadAskEvidence } from '@/services/inbox/askEvidence';
import { describeActionRun } from '@/services/inbox/describeActionRun';
import { parseInboxRef } from '@/services/inbox/inboxRef';
import { loadPendingAction } from '@/services/inbox/pendingAction';
import { askGroupHref } from '@/services/inbox/recordKey';
import { decidersNamed, loadSheetExtras } from '@/services/inbox/sheetExtras';
import { INBOX_SORTS, kindForAsk, listProposalQueue } from '@/services/InboxService';
import { getCandidate } from '@/services/LearningCandidateService';
import { getMissionRun } from '@/services/MissionService';
import { recordLinksForOrg } from '@/services/objects/recordHref';
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

/**
 * The tab and the shell's breadcrumb name the item ("Draft a reply to Dana
 * Reyes"), never the ref ("Proposal 9265"): the top bar reads its last crumb
 * from the page title, and without one it humanised the URL segment.
 * @param props - The route's params.
 * @param props.params - The inbox ref.
 */
export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const { orgId } = await auth();
  const ref = parseInboxRef(id);
  if (!orgId || !ref) {
    return {};
  }
  if (ref.kind === 'ask') {
    const ask = await getAsk(orgId, ref.id).catch(() => null);
    return ask ? { title: ask.title } : {};
  }
  if (ref.kind === 'proposal') {
    const [row] = await db
      .select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, input: actionRunSchema.input, proposal: actionRunSchema.proposal, invokedBy: actionRunSchema.invokedBy })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, ref.id)))
      .limit(1)
      .catch(() => []);
    return row ? { title: describeActionRun({ ...row, proposal: row.proposal as Record<string, unknown> | null }).title } : {};
  }
  return {};
}

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
  const { orgId, userId } = await auth();
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
      // What each answer starts, so the rows say what Approve does instead
      // of "go ahead as proposed" on an ask that proposes nothing.
      const listeners = ask.status === 'open' ? (await loadAnswerListeners(orgId, [ask])).get(ask.id) : undefined;
      // Who the answer goes back to, and the draft it is about; who answered,
      // by name; and the email and records it is about, read whole.
      const [extras, deciders, evidence] = await Promise.all([
        ask.status === 'open' ? loadSheetExtras(orgId, [ask]) : Promise.resolve(new Map<number, SheetExtras>()),
        decidersNamed([ask]),
        ask.status === 'open' ? loadAskEvidence(orgId, ask, { userId: userId ?? null }).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      return (
        <div className="mx-auto w-full max-w-3xl">
          {ask.status === 'open'
            ? <AskSheet asks={[toSheetAsk(ask, await scoreFor({ orgId, subjectKey: ask.kind, agentSlug: ask.agentSlug }), listeners, extras.get(ask.id), evidence)]} kind={kind} />
            : (
                <>
                  <ReviewHeader crumbs={decisionCrumbs(kind, ask.title)} title={ask.title} system="Answered" status={ask.status} proposedBy={ask.agentSlug ? `asked by ${ask.agentSlug}` : null} />
                  <div className="mt-4">
                    <AskReceipt ask={ask} decidedByName={ask.decidedBy ? deciders.get(ask.decidedBy) ?? null : null} />
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
      const run = await loadPendingAction(orgId, ref.id, { userId });
      if (!run) {
        notFound();
      }
      // A released hand-off (`awaiting_execution`) is decided but not done, so
      // it keeps the decision screen: the bar reads Mark done.
      if (run.status !== 'pending' && run.status !== 'failed' && run.status !== 'awaiting_execution') {
        // A finished hand-off keeps its card, read-only: the lifecycle under
        // Run details says who approved it, who marked it done and where the
        // result is, which a one-line receipt cannot.
        if (run.card?.handoff) {
          const object = run.card.object;
          return (
            <div className="min-w-0 flex-1">
              <ReviewSurface
                run={{ ...run, card: run.card }}
                crumbs={decisionCrumbs('proposal', object?.title ?? run.card.title, object?.section)}
                decidable={false}
                defaultTab="evidence"
              />
            </div>
          );
        }
        // Decided: the receipt, not the decision — who decided, what it did,
        // and a link to each thing it made (the same links the chat card's
        // settled state draws: `libs/actions/resultLinks`).
        const desc = describeAction(run);
        const runShape = { actionId: run.actionId, input: (run.input ?? {}) as Record<string, unknown>, result: (run.result ?? null) as Record<string, unknown> | null };
        const did = run.status === 'done' ? doneSummary(runShape) : null;
        const recordLinks = run.status === 'done' ? await recordLinksForOrg(orgId) : null;
        const made = recordLinks ? resultLinks(runShape, recordLinker(recordLinks), recordLinks.codes, { openLabel: run.card?.outbound?.openLabel }) : [];
        const by = run.decidedBy ? run.people?.[run.decidedBy] ?? null : null;
        // A send says it was sent (or drafted), not just "Approved".
        const mode = (run.result as { mode?: unknown } | null)?.mode;
        const verdict = run.status === 'rejected' ? 'Declined' : run.status === 'done' && mode === 'sent' ? 'Sent' : run.status === 'done' && mode === 'draft' ? 'Draft created' : 'Approved';
        const receipt = (
          <>
            <p className="text-sm text-muted-foreground" data-testid="proposal-receipt">
              {verdict}
              {by ? ` by ${by}` : ''}
              {' · '}
              {agoLabel(new Date(run.decidedAt ?? run.executedAt ?? run.createdAt))}
              {did ? ` — ${did}` : ''}
              {' · '}
              <Link href="/dashboard/inbox?tab=decided" className="underline-offset-2 hover:underline">All decided</Link>
            </p>
            <ResultLinks links={made} className="mt-2 text-sm" />
          </>
        );
        // A decided card keeps what was decided, read-only: the message as it
        // went (to, subject, body, attachments) or the change as it was made.
        // A one-line receipt left a sent email with nothing on it to show what
        // went (finance demo, 2026-10-20).
        if (run.card) {
          return (
            <div className="min-w-0 flex-1">
              <ReviewSurface
                run={{ ...run, card: run.card }}
                crumbs={decisionCrumbs('proposal', run.card.subject?.name ?? desc.title)}
                decidable={false}
                beforeTabs={<div className="py-3">{receipt}</div>}
              />
            </div>
          );
        }
        return (
          <div className="mx-auto w-full max-w-3xl">
            <ReviewHeader crumbs={decisionCrumbs('proposal', desc.title)} title={desc.title} system={desc.system} status={run.status} proposedBy={run.invokedBy} confidence={run.proposal?.confidence} alignment={run.alignment} />
            <div className="mt-4">{receipt}</div>
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
            changeKind: candidate.changeKind,
            replacesKeys: candidate.replacesKeys,
            evidence: candidate.evidence,
          }}
        />
      );
    }

    default:
      notFound();
  }
}
