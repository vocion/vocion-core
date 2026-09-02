/**
 * A flat metadata group in a detail page's left rail — an uppercase label
 * over content, separated from the previous group by a hairline. No
 * surrounding box. Shared by the agent profile and team detail pages so
 * their rails read as the same surface.
 * @param root0
 * @param root0.label
 * @param root0.children
 */
export function RailGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border/60 pt-5 first:border-0 first:pt-0">
      <div className="mb-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</div>
      {children}
    </div>
  );
}
