import { headers } from 'next/headers';
import Link from 'next/link';
import { listDocs } from '@/libs/docs';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

/**
 * Docs 404 — suggests the 5 closest public docs by Levenshtein
 * distance on the path. Helps when someone hits a stale URL.
 *
 * Headers are read to grab the requested path; if unavailable (older
 * Next runtime) we fall back to a generic "browse the index" CTA.
 * @param a
 * @param b
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }
  const m: number[][] = Array.from({ length: a.length + 1 }, () => Array.from<number>({ length: b.length + 1 }).fill(0));
  for (let i = 0; i <= a.length; i++) {
    m[i]![0] = i;
  }
  for (let j = 0; j <= b.length; j++) {
    m[0]![j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i]![j] = Math.min(
        m[i - 1]![j]! + 1,
        m[i]![j - 1]! + 1,
        m[i - 1]![j - 1]! + cost,
      );
    }
  }
  return m[a.length]![b.length]!;
}

export default async function DocsNotFound() {
  const h = await headers();
  // Next.js puts the original request path on x-invoke-path / referer.
  const path = h.get('x-invoke-path') ?? h.get('referer') ?? '';
  const requested = path.split('/docs/').pop() ?? '';

  const entries = listDocs({ publicOnly: true });
  const ranked = requested
    ? entries
        .map(e => ({ entry: e, dist: levenshtein(e.slug, requested) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 5)
        .map(r => r.entry)
    : entries.slice(0, 5);

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-2xl px-6 py-20">
        <div className="text-xs tracking-wide text-muted-foreground uppercase">404</div>
        <h1 className="mt-2 font-display text-3xl">Page not found</h1>
        <p className="mt-3 text-muted-foreground">
          {requested
            ? (
                <>
                  We couldn't find
                  <code className="rounded bg-muted px-1 py-0.5">{requested}</code>
                  . Try one of these instead:
                </>
              )
            : 'Try one of these:'}
        </p>
        <ul className="mt-6 space-y-2">
          {ranked.map(e => (
            <li key={e.path}>
              <Link
                href={e.slug === '' ? '/docs' : `/docs/${e.slug}`}
                className="block rounded-md border border-border px-4 py-3 transition hover:border-primary"
              >
                <div className="font-display">{e.title}</div>
                {e.description && (
                  <div className="mt-0.5 text-sm text-muted-foreground">{e.description}</div>
                )}
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/docs" className="mt-8 inline-block text-sm text-primary hover:underline">
          ← Browse all docs
        </Link>
      </main>
      <Footer />
    </>
  );
}
