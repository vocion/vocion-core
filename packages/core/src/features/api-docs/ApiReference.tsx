'use client';

import dynamic from 'next/dynamic';
import 'swagger-ui-react/swagger-ui.css';

const SwaggerUI = dynamic(() => import('swagger-ui-react'), {
  ssr: false,
  loading: () => <p className="text-[13px] text-muted-foreground">Loading the reference…</p>,
});

/**
 * The methods "Try it out" is allowed to send.
 *
 * Read-only on purpose. The document's server is `/`, so an Execute runs
 * against this very deployment carrying the reader's own session cookie — and
 * a POST or DELETE fired from a page someone opened to *read* would be a real
 * write against real records. GET is safe to fire by accident; nothing else
 * here is.
 */
const SAFE_SUBMIT_METHODS = ['get'] as const;

/**
 * The API reference: the generated OpenAPI document rendered as Swagger UI.
 *
 * Swagger UI rather than something hand-built, because an integrator has
 * already used it somewhere else — the layout, the Authorize button and "Try
 * it out" are muscle memory, and the alternative was teaching a second set of
 * conventions for no gain.
 *
 * It renders only in the browser (`ssr: false`): Swagger UI reads `window` as
 * it mounts, so rendering it on the server throws.
 *
 * The document arrives by URL rather than as a prop. It is around 200 KB, and
 * handing it to a client component ships every byte twice — once in the HTML
 * and again in the hydration payload — on a page whose whole job is to fetch
 * it anyway. `/api/v1/openapi` takes the reader's session cookie, so the fetch
 * needs nothing extra.
 * @param props
 * @param props.documentUrl - Where the generated OpenAPI document is served.
 */
export function ApiReference(props: { documentUrl: string }) {
  return (
    <div className="api-reference">
      <SwaggerUI
        url={props.documentUrl}
        docExpansion="list"
        defaultModelsExpandDepth={-1}
        supportedSubmitMethods={[...SAFE_SUBMIT_METHODS]}
        tryItOutEnabled
      />
    </div>
  );
}
