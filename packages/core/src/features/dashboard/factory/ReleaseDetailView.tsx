import type { DotTone } from '@/components/patterns';
import type { PagePrompt } from '@/features/dashboard/pages/PagePrompts';
import type { PageRecordPage } from '@/libs/workspace/pageFields';
import type { Tone } from '@/libs/workspace/releaseFeed';
import type { ReleaseCheck, ReleaseLink, ReleaseProofGroup, ReleaseProofRow, ReleaseReport } from '@/services/factory/releaseReport';
import { DetailMeta, DetailPage, FactList, Section, StatusDot } from '@/components/patterns';
import { AskAboutThis } from '@/features/dashboard/context/AskAboutThis';
import { RecordContext } from '@/features/dashboard/context/RecordContext';
import { PagePrompts } from '@/features/dashboard/pages/PagePrompts';
import { Link } from '@/libs/I18nNavigation';

/**
 * One release's page, drawn — `/dashboard/p/releases/<id>`.
 *
 * The Detail pattern (`components/patterns/DetailPage`), one column, the
 * sections in the order a product owner asks them: what shipped, what
 * changed, did it verify, who hears about it, what work it carried, what
 * happened to it, and then the technical record, folded, one click away.
 * Everything here is a function of the assembled report
 * (`services/factory/releaseReport.ts`); nothing is decided in the drawing.
 */

const DOT: Record<Tone, DotTone> = { ok: 'pass', warn: 'amber', bad: 'fail', muted: 'neutral' };

function Line({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) {
    return <>{children}</>;
  }
  return href.startsWith('/')
    ? <Link href={href} className="underline decoration-border underline-offset-2 hover:decoration-foreground">{children}</Link>
    : <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-2 hover:decoration-foreground">{children}</a>;
}

function Checks({ heading, checks }: { heading: string; checks: ReleaseCheck[] }) {
  return (
    <div className="py-2" data-testid={`release-check-${heading.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
      <h4 className="text-[13px] font-medium text-foreground">{heading}</h4>
      <ul className="mt-1 space-y-1.5">
        {checks.map(c => (
          <li key={c.key} className="text-sm">
            <StatusDot tone={DOT[c.tone]} label={<Line href={c.href}>{c.line}</Line>} />
            <div className="ml-3 text-[12px] text-muted-foreground">
              {[c.title !== heading ? c.title : null, c.at].filter(Boolean).join(' · ')}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATE_WORD = { passed: 'Passed', failed: 'Failed', unverified: 'Unverified' } as const;

/**
 * One criterion and its proof: the after shot as a thumbnail that opens the
 * artifact, the before shot one click away; a named test by name, linking the
 * stored run at its section.
 * @param props
 * @param props.row - The criterion.
 */
function ProofRow({ row }: { row: ReleaseProofRow }) {
  return (
    <li className="flex items-start gap-3 py-2" data-testid="release-proof-row" data-state={row.state} data-kind={row.kind ?? 'none'}>
      <span className="w-[5.5rem] shrink-0 pt-px text-[12px]">
        <StatusDot tone={DOT[row.tone]} label={<span className={row.state === 'unverified' ? 'text-muted-foreground' : 'text-foreground'}>{STATE_WORD[row.state]}</span>} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-relaxed break-words text-foreground">{row.statement}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
          <span className="break-words"><Line href={row.href}>{row.line}</Line></span>
          {row.before && <Line href={row.before.href}>{row.before.label}</Line>}
        </p>
      </div>
      {row.imageUrl && row.href && (
        <Line href={row.href}>
          <img src={row.imageUrl} alt={`After: ${row.statement}`} loading="lazy" className="block h-14 w-24 shrink-0 rounded-md border border-border object-cover object-top" />
        </Line>
      )}
    </li>
  );
}

function Proof({ group }: { group: ReleaseProofGroup }) {
  return (
    <div className="mt-1" data-testid="release-proof">
      <ul className="divide-y divide-rule">
        {group.acceptance.map(r => <ProofRow key={r.key} row={r} />)}
      </ul>
      {group.risks.length > 0 && (
        <>
          <h5 className="mt-3 text-[12px] text-muted-foreground">Plan risks</h5>
          <ul className="divide-y divide-rule" data-testid="release-proof-risks">
            {group.risks.map(r => <ProofRow key={r.key} row={r} />)}
          </ul>
        </>
      )}
    </div>
  );
}

function Links({ items }: { items: ReleaseLink[] }) {
  return (
    <ul className="space-y-1 text-[13px]">
      {items.map(i => (
        <li key={i.key} className="break-words">
          {i.href ? <Line href={i.href}>{i.label}</Line> : <span className="text-muted-foreground">{i.label}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * @param props - The page.
 * @param props.report - The assembled release.
 * @param props.recordPage - The page's `recordPage` block: the announcement's asks, in the workspace's words.
 * @param props.backHref - The Releases list.
 */
export function ReleaseDetailView({ report, recordPage, backHref }: { report: ReleaseReport; recordPage?: PageRecordPage; backHref: string }) {
  const a = report.announcement;
  const ask: PagePrompt | undefined = a.action && !a.blocked ? recordPage?.actions[a.action] : undefined;
  return (
    <DetailPage
      data-testid="release-detail"
      crumbs={[{ label: 'Releases', href: backHref }, { label: report.title }]}
      title={report.title}
      subtitle={[report.subtitle, report.releasedAt].filter(Boolean).join(' · ')}
      actions={(
        <>
          <Link href={backHref} className="whitespace-nowrap hover:text-foreground">Back to Releases</Link>
          {/* Declares the release, so select-to-ask (the shell's) quotes it and offers Change. */}
          <RecordContext record={{ type: 'object', id: String(report.id), label: report.title, href: `${backHref}/${report.id}` }} />
          <AskAboutThis
            record={{ type: 'object', id: String(report.id), label: report.title, href: `${backHref}/${report.id}` }}
            label="Ask about this release"
            agentSlug="product-manager"
          />
        </>
      )}
      meta={(
        <DetailMeta
          items={[
            <StatusDot key="deploy" tone={DOT[report.status.deploy.tone]} label={report.status.deploy.line} />,
            <StatusDot key="verify" tone={DOT[report.status.verification.tone]} label={report.status.verification.line} />,
            <span key="announce">{`Announcement: ${a.label.toLowerCase()}`}</span>,
          ]}
        />
      )}
    >
      <Section eyebrow="Release summary">
        <p className="max-w-3xl text-[15px] leading-relaxed text-foreground">{report.summary}</p>
        {report.attention.length > 0 && (
          <ul className="mt-3 space-y-1" data-testid="release-attention">
            {report.attention.map(line => (
              <li key={line}><StatusDot tone="amber" label={line} /></li>
            ))}
          </ul>
        )}
      </Section>

      <Section eyebrow="What changed">
        {report.notes.source !== 'features'
          ? (
              <div data-testid="release-notes" data-source={report.notes.source}>
                <ul className="list-disc space-y-1 pl-5 text-[15px]">
                  {report.notes.lines.map(line => <li key={line} className={line.startsWith('Internal:') ? 'text-muted-foreground' : undefined}>{line}</li>)}
                </ul>
                <p className="mt-2 text-[12px] text-muted-foreground">{report.notes.source === 'human' ? 'Release notes, written by a person.' : 'Release notes, drafted by the product manager.'}</p>
              </div>
            )
          : report.changes.length === 0
            ? <p className="text-muted-foreground">The deploy recorded no changes.</p>
            : (
                <ul className="divide-y divide-rule">
                  {report.changes.map(c => (
                    <li key={c.key} className="py-2.5">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{c.label}</span>
                        <span className={c.label === 'Internal' || c.label === 'Reverted' ? 'text-muted-foreground' : 'font-medium'}>
                          <Line href={c.href}>{c.title}</Line>
                        </span>
                      </div>
                      {c.detail && <p className="mt-0.5 text-[13px] text-muted-foreground">{c.detail}</p>}
                    </li>
                  ))}
                </ul>
              )}
      </Section>

      <Section eyebrow="Verification">
        {report.verification.acceptance.length > 0 && (
          <div className="py-2" data-testid="release-check-feature-acceptance">
            <h4 className="text-[13px] font-medium text-foreground">Feature acceptance</h4>
            {report.verification.acceptance.map(c => (
              <div key={c.key} className="mt-1.5">
                <div className="text-sm"><StatusDot tone={DOT[c.tone]} label={<Line href={c.href}>{c.line}</Line>} /></div>
                <div className="ml-3 text-[12px] text-muted-foreground">{[c.title, c.at].filter(Boolean).join(' · ')}</div>
                {c.proof && <Proof group={c.proof} />}
              </div>
            ))}
          </div>
        )}
        <Checks heading="Post-deploy check" checks={[report.verification.deployCheck]} />
        <Checks heading="Product impact" checks={report.verification.impact} />
      </Section>

      <Section eyebrow="Announcement">
        <div data-testid="release-announcement" data-state={a.state}>
          <StatusDot tone={a.state === 'published' ? 'pass' : a.state === 'not-prepared' ? 'amber' : 'neutral'} label={a.label} />
          {a.text && <blockquote className="mt-2 max-w-3xl border-l-2 border-rule pl-3 text-[15px] leading-relaxed">{a.text}</blockquote>}
          {a.publishedLine && <p className="mt-2 text-[13px] text-muted-foreground">{a.publishedLine}</p>}
          {a.reason && <p className="mt-2 text-[13px] text-muted-foreground">{a.reason}</p>}
          {a.state === 'not-prepared' && <p className="mt-2 text-[13px] text-muted-foreground">Nothing has been written for the people who use it yet.</p>}
          {a.requesters && <p className="mt-2 text-[13px] text-muted-foreground">{a.requesters}</p>}
          {a.blocked && <p className="mt-2 text-[13px] text-[var(--brand-fail)]">{a.blocked}</p>}
          {ask && <div className="mt-3"><PagePrompts prompts={[ask]} page={report.title} record={{ type: 'object', id: String(report.id), label: report.title, href: `${backHref}/${report.id}` }} /></div>}
        </div>
      </Section>

      <Section eyebrow="Included work">
        {report.included.length === 0
          ? <p className="text-muted-foreground">No factory feature is linked to this release.</p>
          : (
              <ul className="space-y-2">
                {report.included.map(w => (
                  <li key={w.key}>
                    <Link href={w.href} className="font-medium underline decoration-border underline-offset-2 hover:decoration-foreground">{w.title}</Link>
                    <p className="text-[13px] text-muted-foreground">{w.detail}</p>
                  </li>
                ))}
              </ul>
            )}
      </Section>

      <Section eyebrow="Activity">
        {report.activity.length === 0
          ? <p className="text-muted-foreground">Nothing is recorded against this release.</p>
          : (
              <ol className="space-y-1.5">
                {report.activity.map(e => (
                  <li key={e.key} className="grid grid-cols-1 gap-x-3 text-[13px] @md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
                    <time dateTime={e.at.toISOString()} className="text-muted-foreground tabular-nums">{e.when}</time>
                    <span><Line href={e.href}>{e.line}</Line></span>
                  </li>
                ))}
              </ol>
            )}
      </Section>

      <Section eyebrow="Technical details">
        <details data-testid="release-technical">
          <summary className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground">Surfaces, pull requests, commits, evidence and record ids</summary>
          <div className="mt-3 space-y-5">
            <FactList
              facts={report.technical.facts.map(f => ({
                key: f.label,
                label: f.label,
                value: f.mono ? <span className="font-mono text-[12px] break-all">{f.value}</span> : f.value,
                href: f.href,
              }))}
            />
            {report.technical.pullRequests.length > 0 && (
              <div>
                <h4 className="mb-1 text-[12px] text-muted-foreground">Pull requests</h4>
                <Links items={report.technical.pullRequests} />
              </div>
            )}
            {report.technical.commits.length > 0 && (
              <div>
                <h4 className="mb-1 text-[12px] text-muted-foreground">Commits</h4>
                <ul className="space-y-1 text-[13px]">
                  {report.technical.commits.map(c => (
                    <li key={c.key} className="flex flex-wrap gap-x-2">
                      {c.sha && <span className="font-mono text-[12px] text-muted-foreground">{c.sha}</span>}
                      <span className="min-w-0 break-words">{c.subject}</span>
                      <span className="text-[11px] tracking-wide text-muted-foreground uppercase">{c.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.technical.evidence.length > 0 && (
              <div>
                <h4 className="mb-1 text-[12px] text-muted-foreground">Evidence</h4>
                <Links items={report.technical.evidence} />
              </div>
            )}
            <div>
              <h4 className="mb-1 text-[12px] text-muted-foreground">Records</h4>
              <Links items={report.technical.records} />
            </div>
          </div>
        </details>
      </Section>
    </DetailPage>
  );
}
