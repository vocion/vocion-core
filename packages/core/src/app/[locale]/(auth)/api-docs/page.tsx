import type { Metadata } from 'next';
import { ApiReference } from '@/features/api-docs/ApiReference';
import { Link } from '@/libs/I18nNavigation';
import generatedDocument from '@/libs/openapi/openapi.generated.json';
import { requireOrganization } from '@/utils/Auth';

/**
 * The API reference, on a page of its own.
 *
 * Deliberately outside the dashboard shell: this is the page an integrator
 * keeps open in a second tab beside their editor, and the sidebar, breadcrumb
 * and workspace switcher are noise there. It is Swagger UI, full width, the
 * way it looks everywhere else — plus one line home.
 *
 * Still behind the login (`api-docs` is in the proxy's protected segments):
 * the document names no records, but it maps this deployment's whole surface.
 *
 * The document is generated from the route handlers themselves
 * (`npm run openapi:generate`), so there is no list here to keep in step — the
 * page gains an endpoint when the API does.
 */

export const metadata: Metadata = { title: 'API reference' };

export default async function ApiDocsPage() {
  await requireOrganization();

  return (
    <main className="min-h-dvh bg-white text-black">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-black/10 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Vocion API</h1>
          <p className="mt-0.5 text-[13px] text-black/60">
            Generated from the handlers that serve it. The raw document is at
            {' '}
            <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[12px]">/api/v1/openapi</code>
            .
          </p>
        </div>
        <Link href="/dashboard/developers" className="text-[13px] text-black/60 underline underline-offset-2 hover:text-black">
          Back to Vocion
        </Link>
      </header>
      <ApiReference document={generatedDocument} />
    </main>
  );
}
