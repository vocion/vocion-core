/**
 * A titled card on a dashboard page.
 *
 * The heading and description are capped at `max-w-3xl` on purpose: a line of
 * prose that runs the full width of a wide monitor is genuinely harder to read.
 * The content below them defaults to the same cap, which suits a form, but a
 * table with more than a handful of columns needs the whole card — otherwise it
 * scrolls sideways inside a mostly empty page. `fullWidthContent` is for those.
 */
export const DashboardSection = (props: {
  title: string;
  description: string;
  /**
   * Let the content use the card's full width instead of the reading-width cap.
   * Set it for wide tables; leave it off for forms and prose.
   */
  fullWidthContent?: boolean;
  children: React.ReactNode;
}) => (
  <div className="rounded-md border border-border p-5">
    <div className="max-w-3xl">
      <div className="text-lg font-semibold">{props.title}</div>

      <div className="mb-4 text-sm font-medium text-muted-foreground">
        {props.description}
      </div>

      {!props.fullWidthContent && props.children}
    </div>

    {props.fullWidthContent && props.children}
  </div>
);
