import type { ProposalRowView, ReadingTone } from '@/services/proposals/board';
import type { Status } from '@/types/Status';
import { FilePlus2, FileText } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Column, ListEmpty, ListPage, ListRow, ListRows, Subline } from '@/components/patterns';
import { StatusPill } from '@/components/ui/status-pill';
import { AskAboutThis } from '@/features/dashboard/context/AskAboutThis';
import { PluginPanel } from '@/features/dashboard/plugins/PluginPanel';
import { clerkAuth as auth } from '@/libs/Auth';
import { loadProposalBoard, proposalRowView } from '@/services/proposals/board';
import { cn } from '@/utils/Helpers';

/** A tone is a brand semantic, and `StatusPill` is where those are drawn. */
const PILL: Record<ReadingTone, Status> = { pass: 'active', amber: 'pending', fail: 'failed', neutral: 'inactive' };

const INK: Record<ReadingTone, string> = {
  pass: 'text-[var(--brand-pass)]',
  amber: 'text-[var(--brand-borderline)]',
  fail: 'text-[var(--brand-fail)]',
  neutral: 'text-muted-foreground',
};

/**
 * One claim about the document, coloured by how strongly it is meant, so the
 * row's state is told apart before it is read (principle 10). An em dash where
 * there is no document: the claim is not "unverified", it is "there is
 * nothing to verify".
 * @param props - Props.
 * @param props.reading - The claim, or null when there is no document.
 * @param props.testId - What a test greps for.
 */
function ReadingText(props: { reading: ProposalRowView['verify']; testId: string }) {
  if (!props.reading) {
    return <span className="text-muted-foreground/60">—</span>;
  }
  return <span data-testid={props.testId} className={cn('truncate', INK[props.reading.tone])}>{props.reading.label}</span>;
}

/**
 * Proposals — the GTM app over data rooms and documents. **The document is
 * the subject of a row**: its title, its version, whether it is drafted or
 * sent, whether it render-verified and whether a sceptical buyer has read it,
 * and how long it has been sitting. The room is the context, in the subline,
 * and the whole row is still a door to it.
 *
 * Chris, 2026-09-19: *"this guy has a proposal, but it's not clear from the
 * proposal list"* — the row used to lead with the room name and a status
 * sentence that truncated, with the document reduced to one small column. A
 * row with nothing drafted reads differently on purpose: a different icon, an
 * amber chip that says so, empty columns, and the Draft action always visible
 * rather than revealed on hover.
 *
 * Optional surface at `/gtm/proposals`, linked where `workspace.yaml` lists
 * `surfaces: [proposals]` (`features/navigation/surfaces.ts`); the
 * `client-documents` template switches it on. Read model:
 * `services/proposals/board.ts`, where the whole matrix of states is tested.
 * @param props
 * @param props.params
 */
export default async function ProposalsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }
  const rows = await loadProposalBoard(orgId);
  const now = new Date().getTime();

  return (
    <ListPage
      title="Proposals"
      description="The document for every engagement at Proposal stage: what state it is in, whether it verified, whether a sceptical buyer has read it, and how long it has been sitting. A row opens the room it was written from."
    >
      <PluginPanel orgId={orgId} slug="proposals" />

      {rows.length === 0
        ? (
            <ListEmpty
              variant="page"
              icon={FileText}
              title="Nothing at Proposal stage"
              description="Open a data room for the engagement — ask in chat, or file a transcript and let it match — and set its stage to Proposal. It shows up here."
            />
          )
        : (
            <ListRows>
              {rows.map((r) => {
                const v = proposalRowView(r, now);
                const nothing = v.subject === 'none';
                return (
                  <ListRow
                    key={r.id}
                    href={r.href}
                    icon={nothing ? FilePlus2 : FileText}
                    title={v.title}
                    data-testid={`proposal-row-${r.id}`}
                    subline={<Subline separator="·" segments={v.subline} />}
                    columns={(
                      <>
                        <Column kind="status"><ReadingText reading={v.verify} testId="proposal-verify" /></Column>
                        <Column kind="status"><ReadingText reading={v.redTeam} testId="proposal-red-team" /></Column>
                        <Column kind="number">{v.openItems > 0 ? `${v.openItems} open` : '—'}</Column>
                        <Column kind="date">{v.age || '—'}</Column>
                      </>
                    )}
                    chip={<StatusPill status={PILL[v.state.tone]} label={v.state.label} size="sm" data-proposal-state={v.state.label} />}
                    actionsAlways={nothing}
                    actions={(
                      <AskAboutThis
                        record={r.record}
                        label={nothing ? 'Draft' : 'Revise'}
                        prompt={nothing ? 'Draft the proposal for this engagement from its data room.' : 'Revise the proposal for this engagement from its data room.'}
                        agentSlug="proposal-writer"
                      />
                    )}
                  />
                );
              })}
            </ListRows>
          )}
    </ListPage>
  );
}
