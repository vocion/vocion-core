import type { InputField } from './inputFields';

/**
 * A tool's parameters as rows: the argument's name, what it takes, whether
 * it must be passed, and what it is for. One table for the six built-ins
 * (their hand-written params) and for every tool an agent holds (the JSON
 * Schema the model sees, reduced by `fieldsFromInputSchema`).
 * @param props
 * @param props.fields - The rows.
 */
export function ToolInputFields({ fields }: { fields: InputField[] }) {
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">This tool takes no parameters.</p>;
  }
  return (
    <div className="flex flex-col" data-testid="tool-input-fields">
      {fields.map(p => (
        <div key={p.name} className="flex items-start gap-3 border-b border-border py-2.5 last:border-0">
          <code className="shrink-0 rounded bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">{p.name}</code>
          <div className="min-w-0 flex-1 text-xs">
            <div>{p.description || <span className="text-muted-foreground">No description declared.</span>}</div>
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {p.type}
              {p.required && <span className="ml-1.5 font-sans">· required</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
