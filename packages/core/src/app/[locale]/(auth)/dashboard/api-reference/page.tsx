import type { Metadata } from 'next';
import type { ApiReferenceDocument } from '@/features/api-docs/apiReferenceModel';
import { headers } from 'next/headers';
import { ApiReference } from '@/features/api-docs/ApiReference';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { appBaseUrl } from '@/libs/links';
import generatedDocument from '@/libs/openapi/openapi.generated.json';
import { requireOrganization } from '@/utils/Auth';

/**
 * API reference — every `/api/v1` endpoint, from the generated OpenAPI
 * document.
 *
 * Signed-in only, like the rest of the dashboard: the document names no
 * records, but it does lay out this deployment's whole surface.
 *
 * The document is generated from the route handlers themselves
 * (`npm run openapi:generate`), so this page does not carry a list of
 * endpoints to keep in step — it gains one when the API does.
 */

export const metadata: Metadata = { title: 'API reference' };

/** The externally reachable origin, for the example calls: the configured app URL, else the request's own host. */
async function publicOrigin(): Promise<string> {
  const configured = appBaseUrl();
  if (configured) {
    return configured;
  }
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (!host) {
    return '';
  }
  const protocol = requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

export default async function ApiReferencePage() {
  await requireOrganization();
  const origin = await publicOrigin();
  const document = generatedDocument as unknown as ApiReferenceDocument;

  return (
    <>
      <TitleBar
        title="API reference"
        description={(
          <>
            Every endpoint under
            {' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">/api/v1</code>
            , generated from the code that serves them. Authenticate with a token from Developers, or read it as JSON at
            {' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">/api/v1/openapi</code>
            .
          </>
        )}
      />
      <ApiReference document={document} origin={origin} />
    </>
  );
}
