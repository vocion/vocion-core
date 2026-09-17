'use client';

import dynamic from 'next/dynamic';
import 'swagger-ui-react/swagger-ui.css';

const SwaggerUI = dynamic(() => import('swagger-ui-react'), {
  ssr: false,
  loading: () => <p className="text-[13px] text-muted-foreground">Loading the reference…</p>,
});

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
 * "Try it out" calls this same deployment — the document's server is `/`, so
 * the request carries the reader's own session cookie and acts as them. A
 * tenant token can be pasted into Authorize instead.
 * @param props
 * @param props.document - The generated OpenAPI document.
 */
export function ApiReference(props: { document: object }) {
  return (
    <div className="api-reference">
      <SwaggerUI
        spec={props.document}
        docExpansion="list"
        defaultModelsExpandDepth={-1}
        tryItOutEnabled
      />
    </div>
  );
}
