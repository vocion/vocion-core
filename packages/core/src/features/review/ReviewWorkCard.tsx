'use client';

import type { WorkCardModel, WorkField } from './reviewSheetModel';
import { ArrowRight, FileText, Mail, Table2 } from 'lucide-react';
import { Surface, SurfaceSection } from '@/components/ui/surface';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/utils/Helpers';
import { AutoGrow } from './contentKinds';

/**
 * The work, first, and looking like the thing it is.
 *
 * Chris, 2026-09-19: *"actual work to approve is buried in the middle of
 * everything; no visual distinct design language to look like 'the thing' or
 * an email editor. (this should probably be the first)"* So the payload the
 * person is judging is the first thing on the screen and it is framed — the
 * ONE `Surface` on the page, with the chrome around it left flat. An email is
 * a composer with To / Subject / body; a CRM update is a field diff; anything
 * else is its own payload as labelled, editable rows.
 *
 * Editable in place, and the edited version is what runs: the sheet sends it
 * as `editedInput` on approve, which is the same edit-then-approve path the
 * focus screen has always used (`ReviewService.decide`, signal `edit`).
 *
 * The rendering is chosen by `workCardModel`, not here, so "which kinds get
 * which idiom" is a unit test rather than a screenshot.
 */

const ICON = { email: Mail, changes: Table2, fields: FileText } as const;

const FIELD = 'w-full rounded-md bg-transparent px-2 py-1.5 text-sm transition outline-none hover:bg-[var(--surface-hover,var(--muted))] focus:bg-[var(--surface-soft,var(--muted))]';

export type WorkCardEdits = {
  /** The reviewer's working copy, by payload key. Absent key = as proposed. */
  value: Record<string, string>;
  onEdit: (key: string, value: string) => void;
  disabled?: boolean;
};

/**
 * @param props
 * @param props.model - What this payload is, and how it reads.
 * @param props.edits - The working copy and its writer.
 */
export function ReviewWorkCard({ model, edits }: { model: WorkCardModel; edits: WorkCardEdits }) {
  const Icon = ICON[model.shape];
  const read = (key: string, proposed: string) => edits.value[key] ?? proposed;
  return (
    <Surface name="review-work" className="p-4 sm:p-5" data-testid="review-work-card">
      <SurfaceSection first>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <Icon className="size-3.5" aria-hidden />
            {model.heading}
          </span>
          <span className="text-[12px] text-muted-foreground">{model.consequence}</span>
        </div>

        {model.shape === 'email'
          ? (
              <div className="mt-3" data-testid="review-work-email">
                <dl className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 border-b border-rule pb-2 text-sm">
                  <dt className="text-[12px] text-muted-foreground">To</dt>
                  <dd>
                    <input aria-label="To" className={FIELD} value={read('to', model.to)} disabled={edits.disabled} onChange={e => edits.onEdit('to', e.target.value)} />
                  </dd>
                  {model.cc !== null && (
                    <>
                      <dt className="text-[12px] text-muted-foreground">Cc</dt>
                      <dd>
                        <input aria-label="Cc" className={FIELD} value={read('cc', model.cc)} disabled={edits.disabled} onChange={e => edits.onEdit('cc', e.target.value)} />
                      </dd>
                    </>
                  )}
                  <dt className="text-[12px] text-muted-foreground">Subject</dt>
                  <dd>
                    <input aria-label="Subject" className={cn(FIELD, 'font-medium')} value={read('subject', model.subject)} disabled={edits.disabled} onChange={e => edits.onEdit('subject', e.target.value)} />
                  </dd>
                </dl>
                {/* The same grow-to-fit field the review card's email pane
                    uses: an email is read at its own length, never through a
                    porthole with a scrollbar. */}
                <div data-testid="review-work-body">
                  <AutoGrow
                    label="Body"
                    className={cn(FIELD, 'mt-2 min-h-40 text-[15px] leading-relaxed')}
                    value={read('body', model.body)}
                    disabled={edits.disabled}
                    onChange={v => edits.onEdit('body', v)}
                  />
                </div>
              </div>
            )
          : (
              <ul className="mt-3 divide-y divide-rule" data-testid="review-work-fields">
                {model.fields.map(f => (
                  <FieldRow key={f.key} field={f} value={read(f.key, f.to)} disabled={edits.disabled} onEdit={v => edits.onEdit(f.key, v)} />
                ))}
                {model.fields.length === 0 && (
                  <li className="py-3 text-sm text-muted-foreground">This recommendation carries no readable payload. The run record has what was proposed.</li>
                )}
              </ul>
            )}
      </SurfaceSection>
    </Surface>
  );
}

/**
 * One field: what the record says today on the left of the arrow when the
 * proposer supplied it, and the proposed value — editable — on the right.
 * Never a bare value pretending to be a diff (principle 10).
 * @param props
 * @param props.field
 * @param props.value
 * @param props.disabled
 * @param props.onEdit
 */
function FieldRow({ field, value, disabled, onEdit }: { field: WorkField; value: string; disabled?: boolean; onEdit: (v: string) => void }) {
  return (
    <li className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-3">
      <span className="shrink-0 pt-1.5 text-[11px] font-medium text-muted-foreground sm:w-32">{field.label}</span>
      <span className="flex min-w-0 flex-1 items-start gap-2">
        {field.from !== undefined && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* `shrink-0` so a short prior value shows in full: the input
                    beside it is what gives way, never the evidence. */}
                <span className="max-w-[45%] shrink-0 truncate pt-1.5 text-sm text-muted-foreground line-through">{field.from}</span>
              </TooltipTrigger>
              <TooltipContent>{`Today: ${field.from}`}</TooltipContent>
            </Tooltip>
            <ArrowRight className="mt-2 size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
          </>
        )}
        <span className="min-w-0 flex-1">
          {field.multiline
            ? <AutoGrow label={field.label} className={cn(FIELD, 'min-h-16 leading-relaxed')} value={value} disabled={disabled} onChange={onEdit} />
            : <input aria-label={field.label} className={FIELD} value={value} disabled={disabled} onChange={e => onEdit(e.target.value)} />}
        </span>
      </span>
    </li>
  );
}
