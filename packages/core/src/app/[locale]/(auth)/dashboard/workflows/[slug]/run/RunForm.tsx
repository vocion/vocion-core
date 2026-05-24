'use client';

import { Loader2, PlayCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/buttonVariants';

/**
 * Workflow runner form — minimal v0.4 floor. Renders a textarea per declared
 * input field (string properties only) and a Run button that POSTs to
 * `/api/v1/workflows/<slug>` and redirects to the run-detail page.
 *
 * v0.5 ceiling (deferred):
 *   - Sample-ticket picker dropdown from the demos' `sample-tickets/` content
 *   - Rich form widgets per JSON-schema type (booleans, numbers, enums)
 *   - Validation against the inputSchema before POST
 */

type InputSchemaShape = {
  type?: string;
  required?: string[];
  properties?: Record<string, { type?: string; description?: string; default?: unknown }>;
} | null | undefined;

type RunFormProps = {
  slug: string;
  inputSchema: InputSchemaShape;
};

export function RunForm({ slug, inputSchema }: RunFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (inputSchema?.properties) {
      for (const [k, prop] of Object.entries(inputSchema.properties)) {
        if (prop && typeof prop.default === 'string') {
          init[k] = prop.default;
        }
      }
    }
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = inputSchema?.properties ?? {};
  const required = new Set(inputSchema?.required ?? []);
  const stringFields = Object.entries(fields).filter(([, prop]) => !prop?.type || prop.type === 'string');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    // Only send fields the user actually filled, so optional fields stay
    // undefined (lets the workflow's own defaults apply).
    const input: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.trim().length > 0) {
        input[k] = v;
      }
    }
    try {
      const res = await fetch(`/api/v1/workflows/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, invokedBy: 'dashboard-runner' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`);
      }
      const summary = await res.json();
      router.push(`/dashboard/workflows/${slug}/runs/${summary.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  if (stringFields.length === 0) {
    return (
      <form onSubmit={onSubmit} className="rounded-lg border border-border bg-background p-6">
        <p className="mb-4 text-sm text-muted-foreground">
          This workflow takes no string inputs. Click
          {' '}
          <strong className="font-semibold text-foreground">Run</strong>
          {' '}
          to start a fresh run.
        </p>
        <SubmitButton submitting={submitting} />
        {error && <ErrorBanner message={error} />}
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border bg-background p-6">
      {stringFields.map(([key, prop]) => (
        <div key={key}>
          <label htmlFor={`run-${key}`} className="mb-1.5 block text-sm font-medium">
            {key}
            {required.has(key) && <span className="ml-1 text-red-500">*</span>}
          </label>
          {prop?.description && (
            <p className="mb-2 text-xs text-muted-foreground">{prop.description}</p>
          )}
          <textarea
            id={`run-${key}`}
            name={key}
            required={required.has(key)}
            value={values[key] ?? ''}
            onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
            rows={key.toLowerCase().includes('ticket') || key.toLowerCase().includes('body') ? 6 : 2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            placeholder={prop?.default && typeof prop.default === 'string' ? String(prop.default) : undefined}
          />
        </div>
      ))}
      <SubmitButton submitting={submitting} />
      {error && <ErrorBanner message={error} />}
    </form>
  );
}

function SubmitButton({ submitting }: { submitting: boolean }) {
  return (
    <button
      type="submit"
      disabled={submitting}
      className={buttonVariants()}
    >
      {submitting
        ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Starting…
            </>
          )
        : (
            <>
              <PlayCircle className="mr-2 size-4" />
              Run
            </>
          )}
    </button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">
      <strong className="font-semibold">Failed to start run:</strong>
      {' '}
      {message}
    </div>
  );
}
