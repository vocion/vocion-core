'use client';

import type { ApiReferenceDocument, OperationGroup, SpecOperation, SpecParameter, SpecResponse } from './apiReferenceModel';
import { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { filterOperations, flattenOperations, groupByTag } from './apiReferenceModel';

/**
 * The API reference: every `/api/v1` endpoint, grouped by area, searchable,
 * each one opening to its parameters, body fields and responses.
 *
 * Disclosure is the native `<details>` element rather than state, so the
 * keyboard, find-in-page and "open all" in the browser all work without this
 * component knowing about any of them.
 *
 * The document it renders is generated from the route handlers, so this page
 * gains an endpoint when the API does — there is no list here to update.
 * @param props
 * @param props.document - The generated OpenAPI document.
 * @param props.origin - The public origin, for the example calls. May be blank.
 */
export function ApiReference(props: { document: ApiReferenceDocument; origin: string }) {
  const [query, setQuery] = useState('');
  const operations = useMemo(() => flattenOperations(props.document), [props.document]);
  const groups = useMemo(() => groupByTag(filterOperations(operations, query)), [operations, query]);
  const shown = groups.reduce((total, group) => total + group.operations.length, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search endpoints — try “post reviews”, “approve” or “409”"
          aria-label="Search endpoints"
          className="h-9 w-full max-w-sm rounded-lg border border-border/70 bg-background px-3 text-[13px] outline-none focus:border-foreground/30"
        />
        <p className="text-[13px] text-muted-foreground" data-testid="endpoint-count" aria-live="polite">
          {shown === operations.length
            ? `${operations.length} endpoints`
            : `${shown} of ${operations.length} endpoints`}
        </p>
      </div>

      {shown === 0 && (
        <p className="mt-6 text-[13px] text-muted-foreground">
          Nothing matches “
          {query}
          ”. Try a path fragment (
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">worker-runs</code>
          ) or a method.
        </p>
      )}

      <div className="mt-6 space-y-8">
        {groups.map(group => <EndpointGroup key={group.tag} group={group} origin={props.origin} />)}
      </div>
    </div>
  );
}

/**
 * One area of the API — everything under `/api/v1/<tag>`.
 * @param props
 * @param props.group
 * @param props.origin
 */
function EndpointGroup(props: { group: OperationGroup; origin: string }) {
  return (
    <section>
      <h3 className="text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">
        {props.group.tag}
      </h3>
      <ul className="mt-2 divide-y divide-border/70 border-y border-border/70">
        {props.group.operations.map(operation => (
          <li key={operation.operationId}>
            <Endpoint operation={operation} origin={props.origin} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One endpoint: the summary line always, the detail when it is opened.
 * @param props
 * @param props.operation
 * @param props.origin
 */
function Endpoint(props: { operation: SpecOperation; origin: string }) {
  const { operation } = props;
  return (
    <details className="group" id={operation.operationId}>
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 py-3 hover:bg-surface-hover">
        <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${methodClasses(operation.method)}`}>
          {operation.method}
        </span>
        <code className="font-mono text-[13px] break-all">{operation.path}</code>
        <span className="text-[13px] text-muted-foreground">{operation.summary}</span>
      </summary>

      <div className="space-y-5 pt-1 pb-5 pl-1">
        {operation.description !== '' && (
          <div className="max-w-3xl space-y-3 text-[13px] leading-relaxed text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_li]:ml-4 [&_li]:list-disc [&_strong]:text-foreground">
            <Markdown remarkPlugins={[remarkGfm]}>{operation.description}</Markdown>
          </div>
        )}

        {operation.capabilities.length > 0 && (
          <p className="text-[13px]" data-testid={`capabilities-${operation.operationId}`}>
            <span className="text-muted-foreground">Requires capability: </span>
            {operation.capabilities.map(capability => (
              <code key={capability} className="mr-1 rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{capability}</code>
            ))}
          </p>
        )}

        {operation.parameters.length > 0 && (
          <ParameterTable parameters={operation.parameters} />
        )}

        {operation.takesBody && (
          <div>
            <h4 className="mb-2 text-[13px] font-semibold">Request body</h4>
            {operation.bodyFields.length > 0
              ? (
                  <p className="text-[13px] text-muted-foreground">
                    A JSON object. Fields read:
                    {' '}
                    {operation.bodyFields.map(field => (
                      <code key={field} className="mr-1 rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{field}</code>
                    ))}
                  </p>
                )
              : (
                  <p className="text-[13px] text-muted-foreground">
                    A JSON object; this endpoint reads its fields dynamically, so the prose above is the contract.
                  </p>
                )}
          </div>
        )}

        <ResponseList responses={operation.responses} />

        <div>
          <h4 className="mb-2 text-[13px] font-semibold">Example</h4>
          <pre className="overflow-x-auto rounded-lg bg-muted/60 px-4 py-3 font-mono text-[12px] leading-relaxed" data-testid={`example-${operation.operationId}`}>
            {exampleCall(operation, props.origin)}
          </pre>
        </div>
      </div>
    </details>
  );
}

/**
 * The path and query parameters an endpoint takes.
 * @param props
 * @param props.parameters
 */
function ParameterTable(props: { parameters: SpecParameter[] }) {
  return (
    <div>
      <h4 className="mb-2 text-[13px] font-semibold">Parameters</h4>
      <table className="w-full max-w-3xl text-left text-[13px]">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 pr-4 font-medium">Name</th>
            <th className="py-1 pr-4 font-medium">In</th>
            <th className="py-1 font-medium">Description</th>
          </tr>
        </thead>
        <tbody className="align-top">
          {props.parameters.map(parameter => (
            <tr key={`${parameter.in}-${parameter.name}`} className="border-t border-border/70">
              <td className="py-1.5 pr-4">
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{parameter.name}</code>
                {parameter.required && <span className="ml-1 text-[11px] text-muted-foreground">required</span>}
              </td>
              <td className="py-1.5 pr-4 text-muted-foreground">{parameter.in}</td>
              <td className="py-1.5 text-muted-foreground">{parameter.description ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The statuses an endpoint can answer with.
 * @param props
 * @param props.responses
 */
function ResponseList(props: { responses: SpecResponse[] }) {
  return (
    <div>
      <h4 className="mb-2 text-[13px] font-semibold">Responses</h4>
      <ul className="max-w-3xl space-y-1 text-[13px]">
        {props.responses.map(response => (
          <li key={response.status} className="flex gap-3">
            <code className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[12px] ${Number(response.status) >= 400 ? 'bg-destructive/10 text-destructive' : 'bg-muted'}`}>
              {response.status}
            </code>
            <span className="text-muted-foreground">{response.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A copy-pasteable call for an endpoint.
 *
 * The path template keeps its `{id}` placeholders — filling them with a
 * plausible-looking number would be a value the reader might not notice they
 * were about to send.
 * @param operation - The endpoint.
 * @param origin - The public origin, blank when it could not be determined.
 */
export function exampleCall(operation: SpecOperation, origin: string): string {
  const url = `${origin}${operation.path}`;
  const lines = [`curl -X ${operation.method} '${url}' \\`, `  -H 'Authorization: Bearer vcn_live_…'`];
  if (operation.takesBody) {
    lines[1] = `${lines[1]} \\`;
    lines.push(`  -H 'Content-Type: application/json' \\`, `  -d '${exampleBody(operation.bodyFields)}'`);
  }
  return lines.join('\n');
}

/**
 * An example body naming the fields the endpoint reads.
 * @param bodyFields
 */
function exampleBody(bodyFields: string[]): string {
  if (bodyFields.length === 0) {
    return '{}';
  }
  return `{ ${bodyFields.map(field => `"${field}": …`).join(', ')} }`;
}

/**
 * The colour a method is shown in — read at a glance, not decoration.
 * @param method
 */
function methodClasses(method: string): string {
  const byMethod: Record<string, string> = {
    GET: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    POST: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    PATCH: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    PUT: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    DELETE: 'bg-destructive/10 text-destructive',
  };
  return byMethod[method] ?? 'bg-muted';
}
