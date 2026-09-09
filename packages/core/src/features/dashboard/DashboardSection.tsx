/**
 * A titled section on a dashboard page.
 *
 * Sections are separated by a hairline, not boxed — a page is one surface
 * with rules across it, the way a settings page reads, rather than a stack
 * of cards each carrying its own frame. `framed` opts a section back into a
 * box for the rare case that needs to read as a distinct object (a preview,
 * a danger zone).
 *
 * The heading and description are capped at `max-w-3xl` on purpose: a line of
 * prose that runs the full width of a wide monitor is genuinely harder to read.
 * The content below them defaults to the same cap, which suits a form, but a
 * table with more than a handful of columns needs the whole width — otherwise it
 * scrolls sideways inside a mostly empty page. `fullWidthContent` is for those.
 * @param props - Section props.
 * @param props.title - Section heading.
 * @param props.description - One or two sentences under the heading.
 * @param props.fullWidthContent - Let the content use the full width instead of the reading-width cap.
 * @param props.framed - Render as a bordered box instead of a hairline-separated section.
 * @param props.children - Section body.
 */
export const DashboardSection = (props: {
  title: string;
  description: string;
  fullWidthContent?: boolean;
  framed?: boolean;
  children: React.ReactNode;
}) => (
  <section
    className={props.framed
      ? 'rounded-lg border border-border p-5'
      : 'border-t border-border/70 pt-6 pb-2 first:border-t-0 first:pt-0'}
  >
    <div className="max-w-3xl">
      <h2 className="font-display text-[15px] font-semibold tracking-tight text-foreground">{props.title}</h2>
      <p className="mt-0.5 mb-4 text-sm text-muted-foreground">
        {props.description}
      </p>
      {!props.fullWidthContent && props.children}
    </div>
    {props.fullWidthContent && props.children}
  </section>
);
