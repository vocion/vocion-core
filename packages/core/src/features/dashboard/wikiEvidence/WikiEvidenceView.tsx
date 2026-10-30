import type { EvidenceOverview } from '@/libs/memory/evidence';
import { BookOpen, FileText, Link2 } from 'lucide-react';
import { ListEmpty, ListPage, ListRow, ListRows, Section, Stat, StatRow, Subline } from '@/components/patterns';
import { Badge } from '@/components/ui/badge';

/**
 * THE WIKI EVIDENCE PAGE (ADR 0012).
 *
 * One question a person has about the wiki: can I still trust what it says?
 * Each claim on a page rests on a source passage; the graph knows whether
 * that passage still says the same, was replaced by a newer document, or is
 * gone. This page leads with what needs a check, the old words beside the
 * current ones, then each page's count, then which sources replace which.
 * No action here: the fix is a wiki edit, by a person or the curator.
 */

type Props = {
  overview: EvidenceOverview;
  /** The wiki route, e.g. `/dashboard/p/wiki`; a page is `${wikiBase}/${slug}`. */
  wikiBase: string;
  /** Whether the `wiki-evidence` plugin is on here. */
  enabled: boolean;
};

const FRESHNESS_LABEL = { changed: 'Source changed', superseded: 'Replaced', gone: 'Source removed' } as const;

function SourceLink(props: { doc: { title: string; uri: string | null } | null }) {
  if (!props.doc) {
    return null;
  }
  return props.doc.uri
    ? <a href={props.doc.uri} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-2 hover:decoration-foreground">{props.doc.title}</a>
    : <span>{props.doc.title}</span>;
}

export function WikiEvidenceView({ overview, wikiBase, enabled }: Props) {
  const description = 'Each wiki claim, the source it rests on, and whether that source still says the same.';
  if (!enabled) {
    return (
      <ListPage title="Wiki evidence" description={description}>
        <ListEmpty
          icon={Link2}
          title="Wiki evidence is off"
          description="Add wiki-evidence to plugins in workspace.yaml to tie each wiki claim to its source."
        />
      </ListPage>
    );
  }
  const { totals, checks, pages, replaced } = overview;
  if (totals.claims === 0 && replaced.length === 0) {
    return (
      <ListPage title="Wiki evidence" description={description}>
        <ListEmpty
          icon={BookOpen}
          title="No cited claims yet"
          description="When an agent writes a wiki page, each claim carries the source passage it came from, and this page checks it."
        />
      </ListPage>
    );
  }
  return (
    <ListPage title="Wiki evidence" description={description}>
      <StatRow aria-label="Wiki evidence totals" className="mb-6">
        <Stat id="claims" label="Cited claims" value={totals.claims} note={`on ${pages.filter(p => p.claims > 0).length} of ${totals.pages} pages`} />
        <Stat id="holding" label="Still hold" value={totals.holding} />
        <Stat id="need-check" label="Need a check" value={<span className={totals.needCheck > 0 ? 'text-warn' : undefined}>{totals.needCheck}</span>} />
        <Stat id="sources" label="Sources cited" value={totals.sourcesCited} note={`${totals.sourceLinks} links between sources`} />
      </StatRow>

      <Section eyebrow="Needs a check" className="mb-8">
        {checks.length === 0
          ? <ListEmpty variant="inline" title="Every cited claim still matches its source." />
          : (
              <ListRows>
                {checks.map(c => (
                  <div key={c.ref} data-testid="evidence-check" className="flex flex-col gap-1.5 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <a href={`${wikiBase}/${c.slug}`} className="min-w-0 text-sm font-medium text-foreground hover:underline">{c.text}</a>
                      <Badge variant="outline" className="shrink-0 border-warn/40 text-warn">{FRESHNESS_LABEL[c.freshness]}</Badge>
                    </div>
                    <Subline
                      className="text-[13px] text-muted-foreground"
                      separator="·"
                      segments={[
                        c.pageTitle,
                        c.source && (
                          <span key={`${c.ref}-src`}>
                            Source:
                            {' '}
                            <SourceLink doc={c.source} />
                          </span>
                        ),
                        c.newer && (
                          <span key={`${c.ref}-new`}>
                            Now:
                            {' '}
                            <SourceLink doc={c.newer} />
                          </span>
                        ),
                      ]}
                    />
                    {c.freshness === 'changed' && (c.was || c.now) && (
                      <dl className="mt-1 grid gap-1 text-[13px] sm:grid-cols-[3.5rem_1fr]">
                        <dt className="text-muted-foreground">Was</dt>
                        <dd className="text-muted-foreground line-through decoration-muted-foreground/50">{c.was ?? '—'}</dd>
                        <dt className="text-muted-foreground">Now</dt>
                        <dd className="text-foreground">{c.now ?? 'No longer in the source.'}</dd>
                      </dl>
                    )}
                  </div>
                ))}
              </ListRows>
            )}
      </Section>

      <Section eyebrow="Pages" className="mb-8">
        <ListRows>
          {pages.map(p => (
            <ListRow
              key={p.slug}
              href={`${wikiBase}/${p.slug}`}
              icon={BookOpen}
              title={p.title}
              subline={p.claims === 0
                ? 'No cited claims'
                : (
                    <Subline
                      separator="·"
                      segments={[`${p.claims} cited ${p.claims === 1 ? 'claim' : 'claims'}`, p.needCheck > 0
                        ? (
                            <span key={`${p.slug}-n`} className="text-warn">
                              {p.needCheck}
                              {' '}
                              to check
                            </span>
                          )
                        : 'all hold']}
                    />
                  )}
            />
          ))}
        </ListRows>
      </Section>

      {replaced.length > 0 && (
        <Section eyebrow="Sources that replace or amend others">
          <ListRows>
            {replaced.map(r => (
              <div key={`${r.newer.id}-${r.older.id}`} className="flex items-start gap-3 py-3 text-sm">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="min-w-0">
                  <SourceLink doc={r.newer} />
                  <span className="text-muted-foreground">{r.edge === 'supersedes' ? ' replaces ' : ' amends '}</span>
                  <SourceLink doc={r.older} />
                </p>
              </div>
            ))}
          </ListRows>
        </Section>
      )}
    </ListPage>
  );
}
