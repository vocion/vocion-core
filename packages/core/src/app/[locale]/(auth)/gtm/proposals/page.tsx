import { FileText, FolderOpen } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Column, ListEmpty, ListPage, ListRow, ListRows, Subline } from '@/components/patterns';
import { AskAboutThis } from '@/features/dashboard/context/AskAboutThis';
import { clerkAuth as auth } from '@/libs/Auth';
import { loadProposalBoard } from '@/services/proposals/board';

/**
 * Proposals — the GTM app over data rooms and documents: every engagement at
 * Proposal stage, where it stands and since when, the latest document with
 * its render-verify verdict, what is still open, and one Draft action that
 * hands the room to the Proposal Writer. A row is a door to the room; the
 * room is where the document is written from.
 *
 * Optional surface at `/gtm/proposals`, linked where `workspace.yaml` lists
 * `surfaces: [proposals]` (`features/navigation/surfaces.ts`); the
 * `client-documents` template switches it on. Read model:
 * `services/proposals/board.ts`.
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

  return (
    <ListPage
      title="Proposals"
      description="Every engagement at Proposal stage: where it stands, the latest document and whether it verified, what is still open — and Draft, which hands the room to the Proposal Writer."
    >
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
              {rows.map(r => (
                <ListRow
                  key={r.id}
                  href={r.href}
                  icon={FolderOpen}
                  title={r.title}
                  subline={(
                    <Subline segments={[
                      r.client,
                      r.statusAt ? `as of ${r.statusAt.slice(0, 10)}` : null,
                      r.status ? `${r.status.slice(0, 90)}${r.status.length > 90 ? '…' : ''}` : 'No status written yet',
                    ]}
                    />
                  )}
                  columns={(
                    <>
                      <Column kind="status">
                        {r.document
                          ? (
                              <a href={r.document.href} className="truncate text-xs text-muted-foreground hover:text-foreground" title={r.document.title} data-proposal-document>
                                {r.document.chip}
                              </a>
                            )
                          : <span className="text-xs text-muted-foreground">no document</span>}
                      </Column>
                      <Column kind="number">{r.openItems}</Column>
                    </>
                  )}
                  chip={r.stage === 'sent' ? 'Sent' : 'Drafting'}
                  actions={(
                    <AskAboutThis
                      record={r.record}
                      label="Draft"
                      prompt={r.document ? 'Revise the proposal for this engagement from its data room.' : 'Draft the proposal for this engagement from its data room.'}
                      agentSlug="proposal-writer"
                    />
                  )}
                />
              ))}
            </ListRows>
          )}
    </ListPage>
  );
}
