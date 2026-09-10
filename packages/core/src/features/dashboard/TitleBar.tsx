export const TitleBar = (props: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /**
   * Page-level controls, aligned right on the title's row. For the one or two
   * things a page IS reached to do — not a toolbar. Omitted, the title renders
   * exactly as it always has.
   */
  actions?: React.ReactNode;
}) => (
  <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
      <div className="text-2xl font-bold">{props.title}</div>

      {props.description && (
        <div className="text-sm font-semibold text-muted-foreground">
          {props.description}
        </div>
      )}
    </div>

    {props.actions && <div className="flex shrink-0 items-center gap-2">{props.actions}</div>}
  </div>
);
