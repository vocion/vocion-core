import { Download, ExternalLink } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Column, DetailMeta, DetailPage, FactList, ListRow, ListRows, MetaChip, RightColumn, Section, StatusDot, Subline } from '@/components/patterns';
import { ARTIFACT_KIND_ICON, ARTIFACT_KIND_LABEL } from '@/features/dashboard/artifacts/kinds';
import { AskAboutThis } from '@/features/dashboard/context/AskAboutThis';
import { RecordContext } from '@/features/dashboard/context/RecordContext';
import { clerkAuth as auth } from '@/libs/Auth';
import { verificationChip } from '@/libs/documents/audit';
import { artifactHref } from '@/libs/tools/artifacts/url';
import { getDataRoomDetail, roomHref } from '@/services/DataRoomService';

/**
 * One data room — the README as a page: the status, the deliverables, the
 * cast, the sources by weight, the open items, and the documents written from
 * it. The rail opens beside it scoped to the room, so "draft the proposal"
 * means this room; "Download context" is the same bundle the agent reads.
 * @param props
 * @param props.params
 */
export default async function DataRoomPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  const roomId = Number(id);
  if (!orgId || !Number.isInteger(roomId) || roomId <= 0) {
    return notFound();
  }
  const room = await getDataRoomDetail(orgId, roomId);
  if (!room) {
    return notFound();
  }
  const m = room.meta;
  const record = { type: 'object' as const, id: String(room.id), label: room.title, href: roomHref(room.id) };
  const sources = [...(m.sources ?? [])].sort((a, b) => b.rating - a.rating || (b.date ?? '').localeCompare(a.date ?? ''));
  const open = room.items.filter(i => i.status === 'open');
  const done = room.items.filter(i => i.status !== 'open');
  const documents = room.artifacts.filter(a => a.kind === 'document' || a.kind === 'file');
  // Decision logs only: a pasted transcript is also a markdown artifact on
  // the room, but it is a source, listed above with its weight.
  const logs = room.artifacts.filter(a => a.kind === 'markdown' && (a.recordRole ?? '').startsWith('decision-log'));
  const stars = (n: number) => '⭐'.repeat(Math.max(1, Math.min(3, n)));
  const artifactOpen = (a: { id: number; conversationId: number | null }) => (a.conversationId ? `/dashboard/chat/${a.conversationId}?artifact=${a.id}` : `/dashboard/artifacts/${a.id}`);

  return (
    <>
      <RecordContext record={record} />
      <DetailPage
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Data rooms', href: '/dashboard/rooms' }, { label: room.title }]}
        title={room.title}
        subtitle={[m.client, m.codename ? `codename ${m.codename}` : null].filter(Boolean).join(' · ') || undefined}
        meta={(
          <DetailMeta items={[
            <MetaChip key="kind">Data room</MetaChip>,
            <StatusDot key="state" tone={room.status === 'closed' ? 'neutral' : 'pass'} label={room.status === 'closed' ? 'Closed' : (m.stage ?? 'Active')} />,
            m.statusAt ? `status as of ${m.statusAt.slice(0, 10)}` : null,
            `${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`,
            open.length ? `${open.length} open` : null,
            m.deal?.url ? <MetaChip key="deal" href={m.deal.url}>{`${m.deal.system ?? 'CRM'} deal${m.deal.amount ? ` · $${m.deal.amount.toLocaleString('en-US')}` : ''}`}</MetaChip> : null,
          ]}
          />
        )}
        actions={(
          <div className="flex items-center gap-2">
            <a href={`/api/v1/rooms/${room.id}/export`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-surface-hover" data-room-export>
              <Download className="size-3.5" aria-hidden />
              Download context
            </a>
            <AskAboutThis record={record} label="Draft a document" prompt="Draft the proposal for this engagement from its data room." agentSlug="proposal-writer" />
          </div>
        )}
        aside={(
          <RightColumn>
            <Section eyebrow="Cast" tone="quiet">
              {m.cast?.length
                ? <FactList layout="column" facts={m.cast.map(p => ({ key: `${p.name}-${p.email ?? ''}`, label: p.name, value: [p.role, p.email, p.side].filter(Boolean).join(' · ') }))} />
                : <p className="text-sm text-muted-foreground">Nobody on the cast yet.</p>}
            </Section>
            <Section eyebrow="Matching" tone="quiet">
              <FactList
                layout="column"
                facts={[
                  { label: 'Domains', value: (m.domains ?? []).join(', ') || 'none — add one so transcripts file here on their own' },
                  (m.aliases ?? []).length ? { label: 'Aliases', value: m.aliases!.join(', ') } : null,
                ]}
              />
            </Section>
          </RightColumn>
        )}
        data-testid="data-room-page"
      >
        <Section eyebrow="Status">
          {m.status
            ? <p className="text-[15px] leading-7 text-foreground">{m.status}</p>
            : <p className="text-sm text-muted-foreground">No status yet. The agent writes one when something happens; a person can ask for it.</p>}
        </Section>

        {(m.deliverables?.length ?? 0) > 0 && (
          <Section eyebrow="Deliverables">
            <FactList facts={m.deliverables!.map(d => ({ key: d.title, label: d.date ?? '', value: `${d.title}${d.status ? ` — ${d.status}` : ''}`, ...(d.artifactId ? { href: `/dashboard/artifacts/${d.artifactId}` } : {}) }))} />
          </Section>
        )}

        <Section eyebrow="Sources" data-testid="room-sources">
          {sources.length === 0
            ? <p className="text-sm text-muted-foreground">Nothing filed yet. A transcript, a thread or an attachment lands here with its weight and where it came from.</p>
            : (
                <ListRows>
                  {sources.map(s => (
                    <ListRow
                      key={`${s.documentId ?? ''}-${s.artifactId ?? ''}-${s.title}`}
                      title={s.title}
                      subline={<Subline segments={[s.kind, s.channel ? `via ${s.channel}` : null, `filed ${s.retrievedAt.slice(0, 10)}`, s.note]} />}
                      columns={<Column kind="date">{s.date ?? ''}</Column>}
                      chip={stars(s.rating)}
                      {...(s.artifactId ? { href: `/dashboard/artifacts/${s.artifactId}` } : s.documentId ? { href: `/dashboard/search/${s.documentId}` } : {})}
                    />
                  ))}
                </ListRows>
              )}
        </Section>

        <Section eyebrow="Open items" data-testid="room-open-items">
          {open.length === 0 && done.length === 0
            ? <p className="text-sm text-muted-foreground">Nothing open.</p>
            : (
                <ol className="space-y-1.5 text-sm">
                  {open.map((i, n) => (
                    <li key={i.id} className="flex items-baseline gap-2">
                      <span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">
                        {n + 1}
                        .
                      </span>
                      {i.risk === 'high' && <span aria-label="urgent">🔴</span>}
                      <a href={`/dashboard/inbox/${i.id}`} className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground">{i.title}</a>
                    </li>
                  ))}
                  {done.map(i => (
                    <li key={i.id} className="flex items-baseline gap-2 text-muted-foreground">
                      <span className="w-5 shrink-0" />
                      <s>{i.title}</s>
                      <span className="text-xs">{i.status}</span>
                    </li>
                  ))}
                </ol>
              )}
        </Section>

        {logs.length > 0 && (
          <Section eyebrow="Decision logs">
            <ListRows>
              {logs.map(a => (
                <ListRow key={a.id} href={artifactOpen(a)} icon={ARTIFACT_KIND_ICON.markdown} title={a.title} subline={<Subline segments={[`v${a.currentVersion}`, a.updatedAt?.toISOString().slice(0, 10)]} />} />
              ))}
            </ListRows>
          </Section>
        )}

        <Section eyebrow="Documents" data-testid="room-documents">
          {documents.length === 0
            ? <p className="text-sm text-muted-foreground">No document written from this room yet.</p>
            : (
                <ListRows>
                  {documents.map((a) => {
                    const spec = a.spec as { sheets?: number; playbook?: string; verification?: Parameters<typeof verificationChip>[0] };
                    const kind = a.kind as keyof typeof ARTIFACT_KIND_ICON;
                    const Icon = ARTIFACT_KIND_ICON[kind] ?? ARTIFACT_KIND_ICON.file;
                    return (
                      <ListRow
                        key={a.id}
                        href={artifactOpen(a)}
                        icon={Icon}
                        title={a.title}
                        subline={<Subline segments={[ARTIFACT_KIND_LABEL[kind] ?? a.kind, spec.playbook, a.kind === 'document' ? verificationChip(spec.verification, spec.sheets) : null, `v${a.currentVersion}`]} />}
                        chip={a.kind === 'document' ? (spec.verification?.ok ? 'Verified' : spec.verification ? 'Issues' : 'Unverified') : 'File'}
                        actions={a.url
                          ? (
                              <a href={artifactHref(a.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                                <ExternalLink className="size-3" aria-hidden />
                                Open
                              </a>
                            )
                          : undefined}
                      />
                    );
                  })}
                </ListRows>
              )}
        </Section>
      </DetailPage>
    </>
  );
}
