import type { Metadata } from 'next';
import type { Capability, UseCase } from './data';
import { Star } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/libs/I18nNavigation';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';
import { CAPABILITY_LABELS, LEVEL_LABELS, USE_CASES } from './data';

export const metadata: Metadata = {
  title: 'Use cases — Vocion',
  description: '50 real business workflows that push Vocion across sources, review, plugins, interfaces, and audit. Built to hold up in production.',
};

type Filters = {
  level?: string;
  industry?: string;
  department?: string;
  capability?: string;
  featured?: string;
};

function matches(uc: UseCase, f: Filters): boolean {
  if (f.level && uc.level !== Number(f.level)) {
    return false;
  }
  if (f.industry && uc.industry !== f.industry) {
    return false;
  }
  if (f.department && uc.department !== f.department) {
    return false;
  }
  if (f.capability && !uc.capabilities.includes(f.capability as Capability)) {
    return false;
  }
  if (f.featured === '1' && !uc.featured) {
    return false;
  }
  return true;
}

function uniqueSorted<T>(xs: T[]): T[] {
  return [...new Set(xs)].sort();
}

function qs(base: Filters, override: Partial<Filters>): string {
  const merged: Filters = { ...base, ...override };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v && v.length > 0) {
      params.set(k, v);
    }
  }
  const s = params.toString();
  return s ? `/use-cases?${s}` : '/use-cases';
}

export default async function UseCasesPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Filters>;
}) {
  const { locale } = await props.params;
  const search = await props.searchParams;
  setRequestLocale(locale);

  const filters: Filters = {
    level: search.level,
    industry: search.industry,
    department: search.department,
    capability: search.capability,
    featured: search.featured,
  };

  const filtered = USE_CASES.filter(uc => matches(uc, filters));
  const industries = uniqueSorted(USE_CASES.map(u => u.industry));
  const departments = uniqueSorted(USE_CASES.map(u => u.department));
  const levels = [1, 2, 3, 4, 5] as const;
  const capabilities: Capability[] = ['typed_plugins', 'review_audit', 'multi_step', 'cross_interface'];

  const anyFilter = !!(filters.level || filters.industry || filters.department || filters.capability || filters.featured);

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <header className="mb-10 max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Use cases</h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Fifty workflows real teams run every week — across industries, departments, and complexity levels. Each one composes the same five resources: Sources, Objects, Skills, Workflows, Agents.
          </p>
          <p className="mt-3 text-sm text-muted-foreground/80">
            {USE_CASES.length}
            {' '}
            workflows ·
            {' '}
            {USE_CASES.filter(u => u.featured).length}
            {' '}
            featured as the recommended first builds
          </p>
        </header>

        <section className="mb-10 space-y-3 rounded-xl border border-border bg-muted/20 p-5">
          <FilterRow label="Complexity">
            <FilterPill href={qs(filters, { level: undefined })} active={!filters.level}>All levels</FilterPill>
            {levels.map(l => (
              <FilterPill key={l} href={qs(filters, { level: String(l) })} active={filters.level === String(l)}>{LEVEL_LABELS[l]}</FilterPill>
            ))}
          </FilterRow>

          <FilterRow label="Capability">
            <FilterPill href={qs(filters, { capability: undefined })} active={!filters.capability}>All capabilities</FilterPill>
            {capabilities.map(c => (
              <FilterPill key={c} href={qs(filters, { capability: c })} active={filters.capability === c}>{CAPABILITY_LABELS[c]}</FilterPill>
            ))}
          </FilterRow>

          <FilterRow label="Industry">
            <FilterPill href={qs(filters, { industry: undefined })} active={!filters.industry}>All industries</FilterPill>
            {industries.map(i => (
              <FilterPill key={i} href={qs(filters, { industry: i })} active={filters.industry === i}>{i}</FilterPill>
            ))}
          </FilterRow>

          <FilterRow label="Department">
            <FilterPill href={qs(filters, { department: undefined })} active={!filters.department}>All departments</FilterPill>
            {departments.map(d => (
              <FilterPill key={d} href={qs(filters, { department: d })} active={filters.department === d}>{d}</FilterPill>
            ))}
          </FilterRow>

          <FilterRow label="Highlight">
            <FilterPill href={qs(filters, { featured: filters.featured === '1' ? undefined : '1' })} active={filters.featured === '1'}>
              <Star className="mr-1 inline size-3" />
              First 12 recommended
            </FilterPill>
          </FilterRow>

          {anyFilter && (
            <div className="flex items-center gap-3 pt-2 text-xs text-muted-foreground">
              <span>
                Showing
                {' '}
                {filtered.length}
                {' '}
                of
                {' '}
                {USE_CASES.length}
              </span>
              <Link href="/use-cases" className="text-primary hover:underline">Clear filters</Link>
            </div>
          )}
        </section>

        {filtered.length === 0
          ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No workflows matching this combination of filters.
              </div>
            )
          : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map(uc => (
                  <article key={uc.id} className="flex flex-col rounded-xl border border-border bg-background p-5 transition hover:border-primary/30">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        #
                        {String(uc.id).padStart(2, '0')}
                      </span>
                      <Badge variant="outline" className="text-[10px]">{LEVEL_LABELS[uc.level]}</Badge>
                      {uc.featured && (
                        <Badge variant="default" className="text-[10px]">
                          <Star className="mr-0.5 size-2.5" />
                          Featured
                        </Badge>
                      )}
                    </div>

                    <h3 className="text-base leading-snug font-semibold">{uc.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{uc.summary}</p>

                    <dl className="mt-4 space-y-1.5 text-xs">
                      <Row label="Industry" value={uc.industry} />
                      <Row label="Dept" value={uc.department} />
                      <Row label="Sources" value={uc.sources.join(', ')} />
                      <Row label="Output" value={uc.output} />
                    </dl>

                    {uc.capabilities.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {uc.capabilities.map(c => (
                          <span key={c} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                            {CAPABILITY_LABELS[c]}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3 font-mono text-[10px] tracking-wider text-muted-foreground/70 uppercase">
                      <span>{uc.status}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
      </div>
      <Footer />
    </>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FilterPill({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
    >
      {children}
    </Link>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-14 shrink-0 font-mono text-muted-foreground">{label}</dt>
      <dd className="flex-1 text-muted-foreground">{value}</dd>
    </div>
  );
}
