import type { LinkMap } from '@/features/dashboard/pages/FieldValue';
import type { PageRow } from '@/libs/workspace/pageFields';
import type { RecordField, RecordSections } from '@/libs/workspace/records';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FieldValue } from '@/features/dashboard/pages/FieldValue';
import { resolveField } from '@/libs/workspace/pageFields';

/**
 * A record, rendered from what its type declares.
 *
 * Substantial prose on the left, short facts as a definition list on the
 * right, the record's neighbours as real links, and the moments and ids
 * last. Every value goes through the same {@link FieldValue} the list
 * archetype uses, so money is money and a badge is a badge wherever it is
 * read. A declared field with no value is not here; an undeclared value
 * the record carries is in the collapsed block at the bottom, because a
 * field nobody declared is still a field somebody wrote.
 */

/**
 * One prose field — the worker's summary, the objective, the requester's
 * own words — as readable text. Markdown, because agents write it.
 * @param root0 - Props.
 * @param root0.row - The record.
 * @param root0.field - The field.
 * @param root0.now - The instant a `relative` value is measured against.
 * @param root0.links - Resolved record references.
 */
function Prose({ row, field, now, links }: { row: PageRow; field: RecordField; now: number; links: LinkMap }) {
  const raw = resolveField(row, field.from ?? field.key);
  return (
    <section className="rounded-lg border border-border p-5">
      <h2 className="mb-3 text-sm font-semibold" title={field.hint}>{field.label ?? field.key}</h2>
      {field.format === 'text' && typeof raw === 'string'
        ? (
            <div className="prose prose-sm max-w-none text-foreground dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{raw}</ReactMarkdown>
            </div>
          )
        : <FieldValue row={row} field={field} now={now} links={links} />}
    </section>
  );
}

/**
 * The record's declared fields, laid out.
 * @param root0 - Props.
 * @param root0.row - The record, in the list archetype's row shape.
 * @param root0.sections - What the type's declaration sorted into place.
 * @param root0.now - The instant a `relative` value is measured against.
 * @param root0.links - Resolved record references.
 * @param root0.aside - Extra cards for the side column (system info).
 * @param root0.children - Extra cards for the primary column, above the prose.
 */
export function RecordBody({ row, sections, now, links, aside, children }: {
  row: PageRow;
  sections: RecordSections;
  now: number;
  links: LinkMap;
  aside?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { prose, facts, links: linkFields, timestamps, otherKeys } = sections;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-6 lg:col-span-2">
        {children}
        {prose.map(f => <Prose key={f.key} row={row} field={f} now={now} links={links} />)}

        {linkFields.length > 0 && (
          <section className="rounded-lg border border-border p-5">
            <h2 className="mb-3 text-sm font-semibold">Links</h2>
            <dl className="divide-y divide-border">
              {linkFields.map(f => (
                <div key={f.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                  <dt className="w-40 shrink-0 text-xs font-medium text-muted-foreground">{f.label ?? f.key}</dt>
                  <dd className="min-w-0 break-words">
                    <FieldValue row={row} field={f} now={now} links={links} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {otherKeys.length > 0 && (
          <details className="rounded-lg border border-dashed border-border p-5">
            <summary className="cursor-pointer text-sm font-semibold">
              Other fields
              <span className="ml-2 font-normal text-muted-foreground">
                {otherKeys.length}
                {' '}
                this type does not declare
              </span>
            </summary>
            <dl className="mt-3 divide-y divide-border">
              {otherKeys.map(k => (
                <div key={k} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                  <dt className="w-40 shrink-0 font-mono text-xs text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 font-mono text-xs break-words">
                    {typeof row.meta[k] === 'object' ? JSON.stringify(row.meta[k]) : String(row.meta[k])}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>

      <div className="min-w-0 space-y-6">
        {facts.map(group => (
          <section key={group.group} className="rounded-lg border border-border p-5">
            <h2 className="mb-2 text-sm font-semibold">{group.group}</h2>
            <dl className="divide-y divide-border">
              {group.fields.map(f => (
                <div key={f.key} className="py-2">
                  <dt className="text-xs font-medium text-muted-foreground" title={f.hint}>{f.label ?? f.key}</dt>
                  <dd className="mt-0.5 min-w-0 text-sm break-words">
                    <FieldValue row={row} field={f} now={now} links={links} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        {timestamps.length > 0 && (
          <section className="rounded-lg border border-border p-5">
            <h2 className="mb-2 text-sm font-semibold">When</h2>
            <dl className="divide-y divide-border">
              {timestamps.map(f => (
                <div key={f.key} className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-xs font-medium text-muted-foreground">{f.label ?? f.key}</dt>
                  <dd className="text-sm"><FieldValue row={row} field={f} now={now} links={links} /></dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {aside}
      </div>
    </div>
  );
}
