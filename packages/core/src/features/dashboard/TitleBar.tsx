/**
 * Page title row. Display face, tight leading, optional description and an
 * optional right-aligned `actions` slot so pages stop hand-rolling the
 * flex-between wrapper. Sized to sit under the breadcrumb in the shell bar
 * rather than repeat it at hero scale.
 * @param props - Title bar props.
 * @param props.title - Page title.
 * @param props.description - One line under the title.
 * @param props.actions - Right-aligned controls (links, buttons).
 */
export const TitleBar = (props: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) => (
  <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
    <div className="min-w-0">
      <h1 className="font-display text-[22px] leading-tight font-semibold tracking-tight text-foreground">{props.title}</h1>
      {props.description && (
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {props.description}
        </p>
      )}
    </div>
    {props.actions && <div className="flex shrink-0 items-center gap-2 pt-0.5">{props.actions}</div>}
  </div>
);
