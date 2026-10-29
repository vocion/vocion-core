import type { RoomDocument } from '@/services/DataRoomService';
import { Download, ExternalLink } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Column, DetailMeta, DetailPage, FactList, ListRow, ListRows, MetaChip, RightColumn, Section, StatusDot, Subline } from '@/components/patterns';
import { StatusPill } from '@/components/ui/status-pill';
import { ARTIFACT_KIND_ICON, ARTIFACT_KIND_LABEL } from '@/features/dashboard/artifacts/kinds';
import { AskAboutThis } from '@/features/dashboard/context/AskAboutThis';
import { RecordContext } from '@/features/dashboard/context/RecordContext';
import { ProjectInstructions, ProjectPublishing, ProjectWiki } from '@/features/dashboard/rooms/ProjectKnowledge';
import { UnfileSource } from '@/features/dashboard/rooms/UnfileSource';
import { clerkAuth as auth } from '@/libs/Auth';
import { deckVerificationChip } from '@/libs/decks/audit';
import { redTeamChip, verificationChip } from '@/libs/documents/audit';
import { listConnectors } from '@/libs/sources/registry';
import { artifactHref } from '@/libs/tools/artifacts/url';
import { cleanFontRoles } from '@/libs/tools/brand/fontNames';
import { groupRecordsByType } from '@/services/BusinessObjectService';
import { connectionsFor } from '@/services/connect/connectionScope';
import { getDataRoomDetail, projectHref, publishTargetLine, roomAnchor, roomDeliverables } from '@/services/DataRoomService';
import { recordLinkerForOrg } from '@/services/objects/recordHref';
import { enabledPluginsForOrg } from '@/services/PluginService';

/**
 * One project — the collection around one client or engagement, as a page.
 * A core workspace noun (renamed from "data room", 2026-10-27): it is the
 * client's home in every app of the workspace.
 *
 * Reading order is the client's home (the Projects spec, 2026-10-27): the
 * STATUS; the INSTRUCTIONS the agent reads before anything else (`rules`);
 * BRAND & GUIDELINES (the client's logo and mark, and the guideline documents
 * filed at ⭐⭐⭐); the WIKI (`notes`, the client wiki); the other SOURCES by
 * weight with who filed each and how (an automatic filing shows its score,
 * and Remove undoes it); the WORK — every record that belongs to the project
 * (`metadata.projectId`), grouped by type, and the documents and files written
 * from it; then the OPEN ITEMS, what is still only promised, the timeline,
 * the highlights and the decision logs. Nothing is collapsed on the way down.
 * Where its pages ship (`publishTargets`) and, with the SEO app on, how its
 * pages are released (`seoGate`) and how many new pages a month are proposed
 * (`seoCadence`) sit in the right column under "Publishing":
 * a person's settings, edited in place there and refused to any agent.
 *
 * The rail opens beside it scoped to the room; "Download context" is the same
 * bundle the agent reads (`renderDataRoom`), which keeps its own order — an
 * agent reads the rules before the material — but the same one truth: a
 * deliverable naming an artifact is that artifact's row there too.
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
  const anchor = roomAnchor(m);
  const record = { type: 'object' as const, id: String(room.id), label: room.title, href: projectHref(room.id), objectType: 'data_room' };
  // Its own connections — only this project's work and chats use them — and
  // how many the whole workspace lends it (`services/connect/connectionScope.ts`).
  const reachable = await connectionsFor(orgId, { projectId: room.id }, { includeDisabled: true });
  const ownConnections = reachable.filter(c => c.dataRoomId === room.id);
  const workspaceConnections = reachable.length - ownConnections.length;
  const connectorName = new Map(listConnectors().map(c => [c.slug, c.name]));
  const allSources = [...(m.sources ?? [])].sort((a, b) => b.rating - a.rating || (b.date ?? '').localeCompare(a.date ?? ''));
  // Brand & guidelines: the documents a writer must follow, filed at ⭐⭐⭐ —
  // an attachment or a note, never a call or a thread (those are Sources,
  // whatever their weight).
  const isGuideline = (s: { rating: number; kind: string }) => s.rating === 3 && (s.kind === 'attachment' || s.kind === 'note');
  const guidelines = allSources.filter(isGuideline);
  const sources = allSources.filter(s => !isGuideline(s));
  const brandImages = (['logo', 'mark'] as const).flatMap(slot => (m.brand?.[slot] ? [{ slot, image: m.brand[slot]! }] : []));
  // What was read off the client's site (brand_lookup with the project) and
  // how they write (the voice block), each fact with where it came from.
  const profile = m.brand?.profile;
  const pairs = (r: Record<string, string> | undefined) => Object.entries(r ?? {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ');
  const brandFacts = profile
    ? [
        profile.name ? { key: 'name', label: 'Name', value: profile.name } : null,
        pairs(profile.colors) ? { key: 'colours', label: 'Colours', value: pairs(profile.colors) } : null,
        // A profile read before build hashes were taken off still shows the brand's names.
        pairs(cleanFontRoles(profile.fonts)) ? { key: 'fonts', label: 'Fonts', value: pairs(cleanFontRoles(profile.fonts)) } : null,
        { key: 'read', label: 'Read from', value: `${profile.source} · ${profile.readAt.slice(0, 10)}`, href: profile.source },
      ]
    : [];
  const v = m.voice;
  const lines = (list: Array<{ text: string }> | undefined) => (list ?? []).map(l => l.text).join(' · ');
  const voiceFacts = v
    ? [
        v.pointOfView ? { key: 'pov', label: 'Point of view', value: v.pointOfView.text } : null,
        v.readingLevel ? { key: 'level', label: 'Reading level', value: v.readingLevel.text } : null,
        v.spelling ? { key: 'spelling', label: 'Spelling', value: v.spelling.text } : null,
        v.tone?.length ? { key: 'tone', label: 'Tone', value: lines(v.tone) } : null,
        v.bannedPhrases?.length ? { key: 'banned', label: 'Never use', value: lines(v.bannedPhrases) } : null,
        v.preferredCtas?.length ? { key: 'ctas', label: 'Calls to action', value: lines(v.preferredCtas) } : null,
        v.neverClaim?.length ? { key: 'claims', label: 'Never claim', value: lines(v.neverClaim) } : null,
      ].filter(f => f !== null)
    : [];
  const linkRecord = await recordLinkerForOrg(orgId);
  const workGroups = groupRecordsByType(room.work ?? []);
  const publishTargets = m.publishTargets ?? [];
  const seoOn = (await enabledPluginsForOrg(orgId).catch(() => [] as string[])).includes('seo');
  const open = room.items.filter(i => i.status === 'open');
  const done = room.items.filter(i => i.status !== 'open');
  // Deliverables and documents are one fact: a deliverable naming an artifact
  // renders AS that artifact's row; what is left over is a promise nobody has
  // produced (`roomDeliverables`).
  const { documents, promised } = roomDeliverables(room.artifacts, m.deliverables);
  const documentArtifacts = documents.map(d => d.artifact);
  // Decision logs only: a pasted transcript is also a markdown artifact on
  // the room, but it is a source, listed above with its weight.
  const logs = room.artifacts.filter(a => a.kind === 'markdown' && (a.recordRole ?? '').startsWith('decision-log'));
  const filedSources = room.artifacts.filter(a => (a.recordRole ?? '').startsWith('source:'));
  // Everything else anchored to the room — architecture notes, plans, updates,
  // reference tables — is a working file, grouped by the role's first word.
  const working = room.artifacts.filter(a => !documentArtifacts.includes(a) && !logs.includes(a) && !filedSources.includes(a));
  const milestones = [...(m.milestones ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const highlights = m.highlights ?? [];
  const stars = (n: number) => '⭐'.repeat(Math.max(1, Math.min(3, n)));
  const artifactOpen = (a: { id: number; conversationId: number | null }) => (a.conversationId ? `/dashboard/chat/${a.conversationId}?artifact=${a.id}` : `/dashboard/artifacts/${a.id}`);
  const filedHow = (s: { filedBy?: string; score?: number }) => (s.filedBy === 'auto' ? `filed automatically${s.score === undefined ? '' : ` · ${Math.round(s.score * 100)}%`}` : s.filedBy === 'human' ? 'filed by hand' : null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <RecordContext record={record} />
      <DetailPage
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Projects', href: '/dashboard/projects' }, { label: room.title }]}
        title={room.title}
        subtitle={[m.client, m.codename ? `codename ${m.codename}` : null].filter(Boolean).join(' · ') || undefined}
        meta={(
          <DetailMeta items={[
            <MetaChip key="kind">Project</MetaChip>,
            <StatusDot key="state" tone={room.status === 'closed' ? 'neutral' : 'pass'} label={room.status === 'closed' ? 'Closed' : (m.stage ?? 'Active')} />,
            m.statusAt ? `status as of ${m.statusAt.slice(0, 10)}` : null,
            `${allSources.length} ${allSources.length === 1 ? 'source' : 'sources'}`,
            open.length ? `${open.length} open` : null,
            anchor ? <MetaChip key="anchor" {...(anchor.url ? { href: anchor.url } : {})}>{`${anchor.system ?? ''} ${anchor.type}${anchor.amount ? ` · $${anchor.amount.toLocaleString('en-US')}` : ''}`.trim()}</MetaChip> : null,
          ]}
          />
        )}
        actions={(
          <div className="flex items-center gap-2">
            <a href={`/api/v1/projects/${room.id}/export`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-surface-hover" data-room-export>
              <Download className="size-3.5" aria-hidden />
              Download context
            </a>
            {/* A conversation scoped to the project: it uses this project's connections and names it in its header. */}
            <AskAboutThis record={record} label="Ask about this project" />
            <AskAboutThis record={record} label="Draft a document" prompt="Draft the proposal for this engagement from its project." agentSlug="proposal-writer" />
          </div>
        )}
        aside={(
          <RightColumn>
            <ProjectPublishing
              projectId={room.id}
              gate={m.seoGate ?? null}
              cadence={m.seoCadence ?? null}
              targets={publishTargets}
              lines={Object.fromEntries(publishTargets.map(t => [t.id, publishTargetLine(t)]))}
              showGate={seoOn}
              suggestion={m.publishTargetSuggestion ? { target: m.publishTargetSuggestion.target, replaces: m.publishTargetSuggestion.replaces, repo: m.publishTargetSuggestion.repo, read: m.publishTargetSuggestion.read, notes: m.publishTargetSuggestion.notes } : null}
            />
            <Section
              eyebrow="Connections"
              tone="quiet"
              action={<a href={`/dashboard/connectors?project=${room.id}`} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-testid="connect-for-project">Connect for this project</a>}
              data-testid="project-connections"
            >
              {ownConnections.length > 0 && (
                <ListRows>
                  {ownConnections.map((c) => {
                    const connector = String((c.configJson as { _connector?: unknown })._connector ?? c.kind);
                    return (
                      <ListRow
                        key={c.id}
                        href="/dashboard/connectors"
                        title={connectorName.get(connector) ?? connector}
                        subline={<Subline segments={[c.slug, c.enabled === 'true' ? null : 'paused']} />}
                      />
                    );
                  })}
                </ListRows>
              )}
              <p className="mt-1 text-sm text-muted-foreground">
                {ownConnections.length === 0
                  ? `None of its own. Its work uses the workspace's ${workspaceConnections} ${workspaceConnections === 1 ? 'connection' : 'connections'}; one connected here is used only for this project.`
                  : `Only this project's work and chats use ${ownConnections.length === 1 ? 'it' : 'these'}, beside the workspace's ${workspaceConnections}.`}
              </p>
            </Section>
            <Section eyebrow="Entity" tone="quiet">
              {anchor
                ? (
                    <FactList
                      layout="column"
                      facts={[
                        { label: 'Kind', value: anchor.type },
                        anchor.label ? { label: 'Name', value: anchor.label } : null,
                        anchor.system || anchor.id ? { label: 'Where', value: [anchor.system, anchor.id].filter(Boolean).join(' · '), ...(anchor.url ? { href: anchor.url } : {}) } : null,
                        anchor.amount ? { label: 'Amount', value: `$${anchor.amount.toLocaleString('en-US')}` } : null,
                      ]}
                    />
                  )
                : <p className="text-sm text-muted-foreground">Not anchored to a record yet. Ask the agent to link the deal or tracker project this is about.</p>}
            </Section>
            <Section eyebrow="Cast" tone="quiet">
              {m.cast?.length
                ? <FactList layout="column" facts={m.cast.map(p => ({ key: `${p.name}-${p.email ?? ''}`, label: p.name, value: [p.role, p.email, p.side].filter(Boolean).join(' · ') }))} />
                : <p className="text-sm text-muted-foreground">Nobody on the cast yet.</p>}
            </Section>
            <Section eyebrow="Collecting" tone="quiet">
              <FactList
                layout="column"
                facts={[
                  { label: 'Domains', value: (m.domains ?? []).join(', ') || 'none — add one so transcripts file here on their own' },
                  (m.aliases ?? []).length ? { label: 'Aliases', value: m.aliases!.join(', ') } : null,
                  { label: 'After a sync', value: m.autoFile === false ? 'files nothing here on its own' : 'files clear matches here, asks on plausible ones' },
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

        <ProjectInstructions projectId={room.id} rules={m.rules ?? []} />

        <Section eyebrow="Brand & guidelines" data-testid="project-brand">
          {brandImages.length === 0 && guidelines.length === 0 && brandFacts.length === 0 && voiceFacts.length === 0
            ? <p className="text-sm text-muted-foreground">No brand or guidelines yet. File the client's brand guide or style rules at ⭐⭐⭐ and they show here; the agent reads them before writing anything.</p>
            : (
                <>
                  {brandFacts.length > 0 && <div className="mb-3" data-testid="project-brand-profile"><FactList layout="column" facts={brandFacts} /></div>}
                  {voiceFacts.length > 0 && <div className="mb-3" data-testid="project-voice"><FactList layout="column" facts={voiceFacts} /></div>}
                  {brandImages.length > 0 && (
                    <div className="mb-3 flex flex-wrap items-center gap-4">
                      {brandImages.map(({ slot, image }) => (
                        // eslint-disable-next-line next/no-img-element -- a stored data URI, not a remote image to optimise
                        <img key={slot} src={image.dataUri} alt={`${m.client ?? room.title} ${slot}`} title={`${slot} · from ${image.source} on ${image.fetchedAt.slice(0, 10)}`} className="h-10 w-auto max-w-40 object-contain" />
                      ))}
                    </div>
                  )}
                  {guidelines.length > 0 && (
                    <ListRows>
                      {guidelines.map(s => (
                        <ListRow
                          key={`${s.documentId ?? ''}-${s.artifactId ?? ''}-${s.title}`}
                          title={s.title}
                          subline={<Subline segments={[s.kind, s.channel ? `via ${s.channel}` : null, filedHow(s) ?? `filed ${s.retrievedAt.slice(0, 10)}`, s.filedBy === 'auto' && s.evidence?.length ? s.evidence.join(', ') : null, s.note]} />}
                          columns={<Column kind="date">{s.date ?? ''}</Column>}
                          chip={stars(s.rating)}
                          actions={<UnfileSource roomId={room.id} documentId={s.documentId} artifactId={s.artifactId} title={s.title} />}
                          {...(s.artifactId ? { href: `/dashboard/artifacts/${s.artifactId}` } : s.documentId ? { href: `/dashboard/search/${s.documentId}` } : {})}
                        />
                      ))}
                    </ListRows>
                  )}
                </>
              )}
        </Section>

        <ProjectWiki projectId={room.id} notes={m.notes ?? ''} />

        <Section eyebrow="Sources" data-testid="room-sources">
          {sources.length === 0
            ? <p className="text-sm text-muted-foreground">Nothing filed yet. A transcript, a thread or an attachment lands here with its weight and where it came from, on its own after a sync when the match is clear.</p>
            : (
                <ListRows>
                  {sources.map(s => (
                    <ListRow
                      key={`${s.documentId ?? ''}-${s.artifactId ?? ''}-${s.title}`}
                      title={s.title}
                      subline={<Subline segments={[s.kind, s.channel ? `via ${s.channel}` : null, filedHow(s) ?? `filed ${s.retrievedAt.slice(0, 10)}`, s.filedBy === 'auto' && s.evidence?.length ? s.evidence.join(', ') : null, s.note]} />}
                      columns={<Column kind="date">{s.date ?? ''}</Column>}
                      chip={stars(s.rating)}
                      actions={<UnfileSource roomId={room.id} documentId={s.documentId} artifactId={s.artifactId} title={s.title} />}
                      {...(s.artifactId ? { href: `/dashboard/artifacts/${s.artifactId}` } : s.documentId ? { href: `/dashboard/search/${s.documentId}` } : {})}
                    />
                  ))}
                </ListRows>
              )}
        </Section>

        <Section eyebrow="Work" data-testid="project-work">
          {workGroups.length === 0 && documents.length === 0 && working.length === 0
            ? <p className="text-sm text-muted-foreground">Nothing written for this project yet. A record that names it (its `projectId`) and every document written from it lands here.</p>
            : (
                <div className="space-y-4">
                  {workGroups.map(g => (
                    <div key={g.label} data-testid="project-work-group">
                      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{g.label}</h3>
                      <ListRows>
                        {g.records.map(r => (
                          <ListRow key={r.id} href={linkRecord({ objectType: r.typeSlug, id: r.id })} title={r.title} subline={<Subline segments={[r.status, `updated ${r.updatedAt.toISOString().slice(0, 10)}`]} />} />
                        ))}
                      </ListRows>
                    </div>
                  ))}
                  {documents.length > 0 && (
                    <div data-testid="room-documents">
                      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Documents</h3>
                      <ListRows>
                        {documents.map(d => <DocumentRow key={d.artifact.id} doc={d} href={artifactOpen(d.artifact)} />)}
                      </ListRows>
                    </div>
                  )}
                  {working.length > 0 && (
                    <div data-testid="room-working-files">
                      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Working files</h3>
                      <ListRows>
                        {working.map((a) => {
                          const kind = a.kind as keyof typeof ARTIFACT_KIND_ICON;
                          const Icon = ARTIFACT_KIND_ICON[kind] ?? ARTIFACT_KIND_ICON.file;
                          const group = (a.recordRole ?? '').split(':')[0] || null;
                          return <ListRow key={a.id} href={artifactOpen(a)} icon={Icon} title={a.title} subline={<Subline segments={[group, ARTIFACT_KIND_LABEL[kind] ?? a.kind, `v${a.currentVersion}`, (a.updatedAt ?? a.createdAt)?.toISOString().slice(0, 10)]} />} />;
                        })}
                      </ListRows>
                    </div>
                  )}
                </div>
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

        {promised.length > 0 && (
          <Section eyebrow="Promised" data-testid="room-promised">
            <p className="mb-2 text-sm text-muted-foreground">Committed to, nobody has produced it yet. What exists is under Work.</p>
            <FactList facts={promised.map(d => ({ key: d.title, label: d.date ?? '', value: `${d.title}${d.status ? ` — ${d.status}` : ''}`, ...(d.artifactId ? { href: `/dashboard/artifacts/${d.artifactId}` } : {}) }))} />
          </Section>
        )}

        {milestones.length > 0 && (
          <Section eyebrow="Timeline" data-testid="room-timeline">
            <ol className="space-y-1.5 text-sm">
              {milestones.map(ms => (
                <li key={`${ms.date}-${ms.title}`} className={`flex items-baseline gap-3 ${ms.status === 'planned' && ms.date < today ? 'text-warn' : ms.status === 'planned' ? 'text-muted-foreground' : 'text-foreground'}`}>
                  <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">{ms.date}</span>
                  <span className="flex-1">
                    {ms.artifactId ? <a href={`/dashboard/artifacts/${ms.artifactId}`} className="underline decoration-border underline-offset-2 hover:decoration-foreground">{ms.title}</a> : ms.title}
                    {ms.note ? <span className="text-muted-foreground">{` — ${ms.note}`}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ms.status === 'done' ? 'done' : ms.date < today ? 'planned · overdue' : 'planned'}</span>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {highlights.length > 0 && (
          <Section eyebrow="Highlights" data-testid="room-highlights">
            <ul className="space-y-2 text-sm">
              {highlights.map(h => (
                <li key={`${h.kind}-${h.text.slice(0, 40)}`} className="flex gap-3">
                  <span className="w-20 shrink-0 text-xs tracking-wide text-muted-foreground uppercase">{h.kind}</span>
                  <span className="flex-1">
                    <span className={h.kind === 'quote' ? 'italic' : ''}>{h.kind === 'quote' ? `“${h.text}”` : h.text}</span>
                    {(h.who || h.date || h.source) && <span className="text-muted-foreground">{` — ${[h.who, h.date, h.source].filter(Boolean).join(', ')}`}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {logs.length > 0 && (
          <Section eyebrow="Decision logs">
            <ListRows>
              {logs.map(a => (
                <ListRow key={a.id} href={artifactOpen(a)} icon={ARTIFACT_KIND_ICON.markdown} title={a.title} subline={<Subline segments={[`v${a.currentVersion}`, a.updatedAt?.toISOString().slice(0, 10)]} />} />
              ))}
            </ListRows>
          </Section>
        )}

      </DetailPage>
    </>
  );
}

/**
 * One document the room produced. It carries the commitment the room listed
 * for it — the promised date and whether it has gone out — because a
 * deliverable naming an artifact is not a second thing, it is this thing's
 * promise (`roomDeliverables`). The row's chip is therefore where it STANDS
 * (Drafted · Sent · Signed); the render-verify verdict and the buyer read sit
 * in the subline with the sheet count, dated where the room dated them.
 * @param props
 * @param props.doc - The artifact with its commitment merged in.
 * @param props.href - Where the row opens.
 */
function DocumentRow({ doc, href }: { doc: RoomDocument; href: string }) {
  const a = doc.artifact;
  const spec = a.spec as { sheets?: number; order?: string[]; playbook?: string; verification?: Parameters<typeof verificationChip>[0]; redTeam?: Parameters<typeof redTeamChip>[0] };
  const deliverable = a.kind === 'document' || a.kind === 'deck';
  const kind = a.kind as keyof typeof ARTIFACT_KIND_ICON;
  const Icon = ARTIFACT_KIND_ICON[kind] ?? ARTIFACT_KIND_ICON.file;
  const state = doc.state.charAt(0).toUpperCase() + doc.state.slice(1);
  // The deliverable's own words survive when they say something the artifact's
  // title does not — "CV model + iPad checklist, 4-month scope" is scope, not
  // a duplicate title.
  const promise = doc.deliverable && doc.deliverable.title.trim() !== a.title.trim() ? doc.deliverable.title : null;
  return (
    <ListRow
      href={href}
      icon={Icon}
      title={a.title}
      subline={(
        <Subline
          separator="·"
          segments={[
            ARTIFACT_KIND_LABEL[kind] ?? a.kind,
            spec.playbook,
            `v${a.currentVersion}`,
            a.kind === 'document' ? verificationChip(spec.verification, spec.sheets) : null,
            a.kind === 'deck' ? deckVerificationChip(spec.verification as Parameters<typeof deckVerificationChip>[0], spec.order?.length) : null,
            deliverable ? redTeamChip(spec.redTeam) : null,
            promise,
            doc.date ? `dated ${doc.date}` : `updated ${(a.updatedAt ?? a.createdAt)?.toISOString().slice(0, 10)}`,
          ]}
        />
      )}
      chip={deliverable
        ? <StatusPill status={doc.state === 'drafted' ? 'inactive' : 'active'} label={state} size="sm" />
        : 'File'}
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
}
