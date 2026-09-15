/**
 * A titled section on a dashboard page. Airy pass (B-034b §2): not a card —
 * a heading, a one-line description and the content, separated from the
 * previous section by a hairline and 32px of air.
 *
 * The heading and description are capped at `max-w-3xl` on purpose: a line of
 * prose that runs the full width of a wide monitor is genuinely harder to read.
 * The content below them defaults to the same cap, which suits a form, but a
 * table with more than a handful of columns needs the whole width — otherwise
 * it scrolls sideways inside a mostly empty page. `fullWidthContent` is for those.
 * @param props
 * @param props.title
 * @param props.description
 * @param props.fullWidthContent
 * @param props.children
 */
export const DashboardSection = (props: {
  title: string;
  description: string;
  /**
   * Let the content use the full width instead of the reading-width cap.
   * Set it for wide tables; leave it off for forms and prose.
   */
  fullWidthContent?: boolean;
  children: React.ReactNode;
}) => (
  <section className="border-t border-border/70 pt-8 first:border-0 first:pt-0 [&+&]:mt-8">
    <div className="max-w-3xl">
      <h2 className="text-[15px] font-semibold">{props.title}</h2>

      <div className="mt-1 mb-5 text-[13px] text-muted-foreground">
        {props.description}
      </div>

      {!props.fullWidthContent && props.children}
    </div>

    {props.fullWidthContent && props.children}
  </section>
);
