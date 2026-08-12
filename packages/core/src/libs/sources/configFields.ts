/**
 * Field metadata describing a connector's `configSchema` to the UI, so the
 * Add-Source dialog can render the right inputs for whichever connector was
 * picked instead of one hardcoded url/crawl form for every connector.
 *
 * `buildConfigFromFields` is the single place that turns raw form input into
 * a `config_json` payload — both the dialog and its tests call it, so a
 * mismatch between what a field collects and what `configSchema` expects
 * fails a test instead of shipping.
 */

export type SourceConfigFieldType = 'text' | 'url' | 'number' | 'boolean' | 'select' | 'stringArray';

export type SourceConfigField = {
  /** Key in the connector's `configSchema` this field fills. */
  key: string;
  label: string;
  type: SourceConfigFieldType;
  /** No default in the schema — the form must collect a value. */
  required?: boolean;
  /** Mirrors the schema's `.default()`, shown pre-filled and editable. */
  default?: string | number | boolean | string[];
  /** For `type: 'select'`. */
  options?: string[];
  help?: string;
  placeholder?: string;
};

export type SourceFormValue = string | boolean | undefined;

/**
 * Build a connector's `config_json` from raw form values keyed by field.key.
 * Leaving an optional field blank omits the key so the connector's own zod
 * default applies — it does not send an empty string/0 that would override it.
 * @param fields - the connector's declared form fields
 * @param values - raw form input, keyed by field.key
 */
export function buildConfigFromFields(
  fields: SourceConfigField[],
  values: Record<string, SourceFormValue>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.key];
    if (field.type === 'boolean') {
      if (raw !== undefined) {
        result[field.key] = Boolean(raw);
      }
      continue;
    }
    if (raw === undefined || raw === '') {
      continue;
    }
    if (field.type === 'number') {
      const n = Number(raw);
      if (!Number.isNaN(n)) {
        result[field.key] = n;
      }
      continue;
    }
    if (field.type === 'stringArray') {
      const arr = String(raw).split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length > 0) {
        result[field.key] = arr;
      }
      continue;
    }
    result[field.key] = raw;
  }
  return result;
}

/**
 * Form-input default value for a field — arrays render as a comma-joined string.
 * @param field - the connector's declared form field
 */
export function fieldInputDefault(field: SourceConfigField): string | boolean {
  if (field.type === 'boolean') {
    return Boolean(field.default);
  }
  if (Array.isArray(field.default)) {
    return field.default.join(', ');
  }
  return field.default === undefined ? '' : String(field.default);
}
