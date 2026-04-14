export const TitleBar = (props: {
  title: React.ReactNode;
  description?: React.ReactNode;
}) => (
  <div className="mb-5">
    <div className="text-2xl font-bold">{props.title}</div>

    {props.description && (
      <div className="text-sm font-semibold text-muted-foreground">
        {props.description}
      </div>
    )}
  </div>
);
