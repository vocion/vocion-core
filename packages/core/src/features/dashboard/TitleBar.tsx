/**
 * Page title row. Airy pass (B-034b §2): one humanist sans at 20px/600 with
 * room beneath it; the description is 13px muted. Actions sit on the title's
 * row as ghost/outline pills — the one or two things a page IS reached to do.
 * A combined page (Teams & agents, Skills & tools) passes its tab strip as
 * `tabs`; it renders under the title, inside the same block of air.
 * @param props
 * @param props.title
 * @param props.description
 * @param props.actions
 * @param props.tabs
 */
export const TitleBar = (props: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /**
   * Page-level controls, aligned right on the title's row. For the one or two
   * things a page IS reached to do — not a toolbar. Omitted, the title renders
   * exactly as it always has.
   */
  actions?: React.ReactNode;
  /** A tab strip (see `PageTabs`) for a page that is several sections in one. */
  tabs?: React.ReactNode;
}) => (
  <div className="mb-6 sm:mb-8">
    {/* No wrap between the title and its actions: wrapped, the live pill
        landed alone under the description as a green dot with nothing to
        say (phone, 2026-09-24). The title column shrinks; the pill does not. */}
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight">{props.title}</h1>

        {props.description && (
          <div className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            {props.description}
          </div>
        )}
      </div>

      {props.actions && <div className="flex shrink-0 items-center gap-2">{props.actions}</div>}
    </div>

    {props.tabs && <div className="mt-5">{props.tabs}</div>}
  </div>
);
