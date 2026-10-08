'use client';

import type { ConfigField, ConfigFieldValue } from '@/libs/sources/configFields';

/**
 * The inputs a step asks for inline — a credential's fields from the platform
 * registry and a source's settings from `configFields.ts` — drawn from the
 * declarations, so any connector's form is this one.
 *
 * A secret is a password input that no browser fills or remembers, held only
 * in the walk-through's state until it is sent to the vault, and never shown
 * back.
 */

export type CredentialInput = { name: string; label: string; secret: boolean; optional: boolean; hint: string };

const INPUT = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[14px] outline-none focus:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/30';

/**
 * Credential fields.
 * @param props - The fields and their values.
 * @param props.fields - From the platform registry.
 * @param props.values - What is typed, by field name.
 * @param props.onChange - Set one value.
 * @param props.disabled - While saving.
 */
export function CredentialFields({ fields, values, onChange, disabled }: { fields: CredentialInput[]; values: Record<string, string>; onChange: (name: string, value: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5">
      {fields.map(f => (
        <label key={f.name} className="flex flex-col gap-1 text-[12.5px] font-medium text-foreground">
          <span>
            {f.label}
            {f.optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
          </span>
          <input
            type={f.secret ? 'password' : 'text'}
            name={`connect-${f.name}`}
            value={values[f.name] ?? ''}
            onChange={e => onChange(f.name, e.target.value)}
            disabled={disabled}
            autoComplete={f.secret ? 'new-password' : 'off'}
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-testid={`connect-field-${f.name}`}
            className={INPUT}
          />
        </label>
      ))}
    </div>
  );
}

/**
 * Source settings, from the connector's declared fields.
 * @param props - The fields and their values.
 * @param props.fields - From `configFields.ts`.
 * @param props.values - What is typed, by key.
 * @param props.onChange - Set one value.
 * @param props.disabled - While saving.
 */
export function ConfigFields({ fields, values, onChange, disabled }: { fields: ConfigField[]; values: Record<string, ConfigFieldValue>; onChange: (key: string, value: ConfigFieldValue) => void; disabled?: boolean }) {
  if (fields.length === 0) {
    return null;
  }
  return (
    <div className="mt-2.5 flex flex-col gap-2.5">
      {fields.map((f) => {
        const value = values[f.key];
        const id = `connect-config-${f.key}`;
        let input: React.ReactNode;
        if (f.type === 'boolean') {
          input = <input id={id} type="checkbox" checked={Boolean(value)} onChange={e => onChange(f.key, e.target.checked)} disabled={disabled} data-testid={id} />;
        } else if (f.type === 'select') {
          input = (
            <select id={id} value={String(value ?? '')} onChange={e => onChange(f.key, e.target.value)} disabled={disabled} data-testid={id} className={INPUT}>
              {(f.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          );
        } else {
          input = (
            <input
              id={id}
              type={f.type === 'number' ? 'number' : 'text'}
              value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
              placeholder={f.placeholder}
              onChange={e => onChange(f.key, e.target.value)}
              disabled={disabled}
              data-testid={id}
              className={INPUT}
            />
          );
        }
        return (
          <div key={f.key} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-[12.5px] font-medium text-foreground">{f.label}</label>
            {input}
            {f.help && <p className="text-[12px] text-muted-foreground">{f.help}</p>}
          </div>
        );
      })}
    </div>
  );
}
