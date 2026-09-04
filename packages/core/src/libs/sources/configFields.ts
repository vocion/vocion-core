/**
 * What the "Add source" form should ask for, connector by connector.
 *
 * Every connector validates its settings with a zod `configSchema`, but a zod
 * schema carries no wording: it knows a Jira source needs a `baseUrl`, not that
 * a person should be asked for "Site URL" with `https://acme.atlassian.net` as
 * the example. This file supplies that missing half — one entry per connector,
 * listing the inputs to render, in the order to render them.
 *
 * The two halves must agree. `configFields.test.ts` builds each connector's
 * form values from the defaults declared here and parses the result through the
 * connector's real `configSchema`, so a schema change that this file has not
 * caught up with fails the test suite rather than the user's submit button.
 *
 * Connectors absent from this table (`web`, `strapi`) have hand-written forms
 * in `SourcesPanel.tsx` because their settings need more than a list of inputs —
 * a crawl toggle that hides its own depth control, a live instance inspection.
 */

/** How one setting is typed in, which decides both the input and the parsing. */
export type ConfigFieldType = 'text' | 'url' | 'number' | 'boolean' | 'select' | 'stringArray';

/** One choice offered by a `select` field. */
export type ConfigFieldOption = {
  value: string;
  label: string;
};

/** The value a rendered input holds, before it becomes part of the config. */
export type ConfigFieldValue = string | number | boolean | string[];

/** One input on a connector's add-source form. */
export type ConfigField = {
  /**
   * Where the value lands in the config object. A dotted key nests it, so
   * `csvOptions.delimiter` becomes `{ csvOptions: { delimiter: … } }`.
   */
  key: string;
  /** Wording shown above the input. */
  label: string;
  type: ConfigFieldType;
  /**
   * Whether the form refuses to submit without it. Everything else may be left
   * blank, in which case the key is omitted entirely and the connector's own
   * schema default takes over — which is why a blank optional field must never
   * be sent as an empty string.
   */
  required?: boolean;
  /** A sentence under the input explaining what to put there. */
  help?: string;
  /** Greyed-out example text inside an empty input. */
  placeholder?: string;
  /** What the input starts on when adding a new source. */
  defaultValue?: ConfigFieldValue;
  /** The choices, for `select` fields only. */
  options?: ConfigFieldOption[];
  /** Lowest accepted value, for `number` fields only. */
  min?: number;
  /** Highest accepted value, for `number` fields only. */
  max?: number;
  /**
   * Whether the field hides behind "Advanced settings". Reserved for overrides
   * almost nobody needs — API base URLs pointed at a sandbox or an EU region —
   * so the form opens showing only the settings that matter.
   */
  advanced?: boolean;
};

/** The fields to render, keyed by connector slug exactly as the registry spells it. */
export const CONFIG_FIELDS: Record<string, ConfigField[]> = {
  'local-files': [
    {
      key: 'directory',
      label: 'Folder',
      type: 'text',
      required: true,
      placeholder: 'docs',
      help: 'Read every matching file in this folder. Relative paths start at the workspace folder.',
    },
    {
      key: 'extensions',
      label: 'File extensions',
      type: 'stringArray',
      defaultValue: ['.md', '.txt'],
      help: 'Only files ending in one of these are read. Separate with commas.',
    },
  ],

  'file-import': [
    {
      key: 'path',
      label: 'File path',
      type: 'text',
      required: true,
      placeholder: 'data/records.csv',
      help: 'The file to import. Relative paths start at the workspace folder.',
    },
    {
      key: 'format',
      label: 'Format',
      type: 'select',
      defaultValue: 'auto',
      options: [
        { value: 'auto', label: 'Detect from the file extension' },
        { value: 'jsonl', label: 'JSON Lines (.jsonl / .ndjson)' },
        { value: 'csv', label: 'CSV' },
        { value: 'json', label: 'JSON' },
      ],
    },
    {
      key: 'csvOptions.delimiter',
      label: 'CSV column separator',
      type: 'text',
      advanced: true,
      defaultValue: ',',
      help: 'Change this for files that separate columns with a semicolon or a tab.',
    },
    {
      key: 'csvOptions.header',
      label: 'First CSV row holds column names',
      type: 'boolean',
      advanced: true,
      defaultValue: true,
    },
  ],

  'hubspot': [
    {
      key: 'objectType',
      label: 'Records to sync',
      type: 'select',
      defaultValue: 'contacts',
      options: [
        { value: 'contacts', label: 'Contacts' },
        { value: 'deals', label: 'Deals' },
        { value: 'companies', label: 'Companies' },
      ],
    },
    {
      key: 'properties',
      label: 'Properties to fetch',
      type: 'stringArray',
      help: 'Leave blank to fetch the standard set for the chosen record type. Separate with commas — a property name cannot itself contain one.',
      placeholder: 'firstname, lastname, email',
    },
    {
      key: 'portalId',
      label: 'HubSpot account ID',
      type: 'text',
      help: 'Optional. Supplying it turns record references into links back into HubSpot.',
    },
    {
      key: 'baseUrl',
      label: 'API base URL',
      type: 'url',
      advanced: true,
      defaultValue: 'https://api.hubapi.com',
      help: 'Change only for an EU-hosted account or a test environment.',
    },
  ],

  'jira': [
    {
      key: 'baseUrl',
      label: 'Site URL',
      type: 'url',
      required: true,
      placeholder: 'https://acme.atlassian.net',
    },
    {
      key: 'projectKeys',
      label: 'Project keys',
      type: 'stringArray',
      required: true,
      placeholder: 'ENG, OPS',
      help: 'Only these projects sync. Separate with commas — a key cannot itself contain one.',
    },
    {
      key: 'doneWindowDays',
      label: 'Keep finished issues for (days)',
      type: 'number',
      defaultValue: 90,
      min: 1,
      help: 'Finished issues older than this stop being indexed.',
    },
    {
      key: 'includeDescription',
      label: 'Include the issue description',
      type: 'boolean',
      defaultValue: true,
    },
    {
      key: 'notDoneStatuses',
      label: 'Statuses that do not mean finished',
      type: 'stringArray',
      placeholder: 'Won’t Do',
      help: 'Jira counts these as done. Listing one here keeps its issues treated as open. Separate with commas — a status name containing a comma cannot be entered here.',
    },
  ],

  'google-ads': [
    {
      key: 'customerId',
      label: 'Customer ID',
      type: 'text',
      required: true,
      placeholder: '1234567890',
      help: 'The account whose campaigns sync. Digits only, no dashes.',
    },
    {
      key: 'loginCustomerId',
      label: 'Manager account ID',
      type: 'text',
      placeholder: '9876543210',
      help: 'Only needed when the login reaches the account through a manager (MCC) account.',
    },
    {
      key: 'baseUrl',
      label: 'API base URL',
      type: 'url',
      advanced: true,
      defaultValue: 'https://googleads.googleapis.com/v17',
    },
  ],

  'ga4': [
    {
      key: 'propertyId',
      label: 'Property ID',
      type: 'text',
      required: true,
      placeholder: '123456789',
      help: 'Analytics → Admin → Property Settings.',
    },
    {
      key: 'dimensions',
      label: 'Dimensions',
      type: 'stringArray',
      defaultValue: ['date', 'landingPagePlusQueryString'],
      help: 'How rows are broken down. Separate with commas.',
    },
    {
      key: 'metrics',
      label: 'Metrics',
      type: 'stringArray',
      defaultValue: ['sessions', 'conversions', 'bounceRate'],
      help: 'What is measured for each row. Separate with commas.',
    },
    {
      key: 'limit',
      label: 'Maximum rows per run',
      type: 'number',
      defaultValue: 10000,
      min: 1,
      max: 100000,
    },
    {
      key: 'baseUrl',
      label: 'API base URL',
      type: 'url',
      advanced: true,
      defaultValue: 'https://analyticsdata.googleapis.com/v1beta',
    },
  ],

  'gmail': [
    {
      key: 'query',
      label: 'Gmail search',
      type: 'text',
      defaultValue: 'in:inbox',
      placeholder: 'in:inbox',
      help: 'Same search wording the Gmail search box takes, e.g. from:client.com.',
    },
    {
      key: 'baseUrl',
      label: 'API base URL',
      type: 'url',
      advanced: true,
      defaultValue: 'https://gmail.googleapis.com/gmail/v1',
    },
  ],

  'google-calendar': [
    {
      key: 'calendarId',
      label: 'Calendar',
      type: 'text',
      defaultValue: 'primary',
      help: '"primary" for the signed-in account’s own calendar, or a calendar address.',
    },
    {
      key: 'pastDays',
      label: 'Index events from the past (days)',
      type: 'number',
      defaultValue: 30,
      min: 1,
    },
    {
      key: 'futureDays',
      label: 'Index events ahead (days)',
      type: 'number',
      defaultValue: 60,
      min: 1,
    },
    {
      key: 'baseUrl',
      label: 'API base URL',
      type: 'url',
      advanced: true,
      defaultValue: 'https://www.googleapis.com/calendar/v3',
    },
  ],

  'granola': [
    {
      key: 'pastDays',
      label: 'Index notes from the past (days)',
      type: 'number',
      defaultValue: 60,
      min: 1,
    },
    {
      key: 'baseUrl',
      label: 'API base URL',
      type: 'url',
      advanced: true,
      defaultValue: 'https://public-api.granola.ai/v1',
    },
  ],

  'slack': [
    {
      key: 'channel',
      label: 'Channel ID',
      type: 'text',
      required: true,
      placeholder: 'C0123ABCD',
      help: 'In Slack, open the channel → View channel details → the ID at the bottom.',
    },
    {
      key: 'baseUrl',
      label: 'API base URL',
      type: 'url',
      advanced: true,
      defaultValue: 'https://slack.com/api',
    },
  ],

  'drive': [
    {
      key: 'query',
      label: 'Drive search',
      type: 'text',
      defaultValue: 'trashed = false',
      help: 'Google Drive query wording. Use "<folder id>" in parents to sync one folder.',
    },
    {
      key: 'baseUrl',
      label: 'API base URL',
      type: 'url',
      advanced: true,
      defaultValue: 'https://www.googleapis.com/drive/v3',
    },
  ],

  'zoom': [
    {
      key: 'pastDays',
      label: 'Index recordings from the past (days)',
      type: 'number',
      defaultValue: 30,
      min: 1,
    },
    {
      key: 'users',
      label: 'Limit to these people',
      type: 'stringArray',
      placeholder: 'alex@acme.com, sam@acme.com',
      help: 'Email addresses, separated by commas. Leave blank to cover everyone on the account.',
    },
    {
      key: 'apiBaseUrl',
      label: 'API base URL',
      type: 'url',
      advanced: true,
      defaultValue: 'https://api.zoom.us/v2',
    },
    {
      key: 'authBaseUrl',
      label: 'Sign-in base URL',
      type: 'url',
      advanced: true,
      defaultValue: 'https://zoom.us',
    },
  ],

  's3': [
    {
      key: 'bucket',
      label: 'Bucket name',
      type: 'text',
      required: true,
      placeholder: 'acme-marketing-assets',
    },
    {
      key: 'prefix',
      label: 'Key prefix',
      type: 'text',
      placeholder: 'templates/',
      help: 'Read only objects under this path. Leave blank for the whole bucket.',
    },
    {
      key: 'region',
      label: 'AWS region',
      type: 'text',
      placeholder: 'us-east-1',
      help: 'Leave blank to use the region the server is configured with.',
    },
    {
      key: 'extensions',
      label: 'Object extensions',
      type: 'stringArray',
      defaultValue: ['.jpg', '.jpeg', '.png', '.webp'],
      help: 'Only objects ending in one of these are read. Separate with commas.',
    },
    {
      key: 'maxObjects',
      label: 'Maximum objects per run',
      type: 'number',
      defaultValue: 5000,
      min: 1,
      max: 20000,
    },
    {
      key: 'filenamePattern',
      label: 'Filename pattern',
      type: 'text',
      advanced: true,
      placeholder: '(?<campaign>[^-]+)-(?<size>\\d+x\\d+)',
      help: 'A regular expression with named groups. Each group becomes metadata on the document.',
    },
  ],
};

/**
 * The fields to render for a connector, or an empty list when the connector
 * has a hand-written form instead.
 * @param slug - Connector slug, as the registry spells it.
 */
export function configFieldsFor(slug: string): ConfigField[] {
  return CONFIG_FIELDS[slug] ?? [];
}

/**
 * What every field on a connector's form starts on, ready to be held as form
 * state. Fields with no declared default start blank, which reads as "leave it
 * out and let the connector decide".
 * @param fields - The fields being rendered.
 */
export function initialFieldValues(fields: ConfigField[]): Record<string, ConfigFieldValue> {
  const values: Record<string, ConfigFieldValue> = {};
  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      values[field.key] = field.defaultValue;
      continue;
    }
    if (field.type === 'boolean') {
      values[field.key] = false;
      continue;
    }
    if (field.type === 'stringArray') {
      values[field.key] = [];
      continue;
    }
    values[field.key] = '';
  }
  return values;
}

/**
 * Fill a form from a source that already exists, so editing shows what is
 * currently saved rather than the connector's defaults. Anything the saved
 * config does not mention falls back to the default the add form would show.
 * @param fields - The fields being rendered.
 * @param savedConfig - The source's stored config, which may hold extra keys.
 */
export function fieldValuesFromConfig(
  fields: ConfigField[],
  savedConfig: Record<string, unknown>,
): Record<string, ConfigFieldValue> {
  const values = initialFieldValues(fields);
  for (const field of fields) {
    const saved = readNestedValue(savedConfig, field.key);
    if (saved === undefined || saved === null) {
      continue;
    }
    if (field.type === 'boolean') {
      values[field.key] = Boolean(saved);
    } else if (field.type === 'number') {
      values[field.key] = Number(saved);
    } else if (field.type === 'stringArray') {
      values[field.key] = Array.isArray(saved) ? saved.map(entry => String(entry)) : [String(saved)];
    } else {
      values[field.key] = String(saved);
    }
  }
  return values;
}

/** What building a config out of typed-in values produced. */
export type BuiltConfig = {
  /** The config object to send, holding only fields that were actually filled in. */
  config: Record<string, unknown>;
  /** Labels of required fields left blank. Empty means the form may submit. */
  missingLabels: string[];
};

/**
 * Turn what was typed into the config object the connector's schema expects.
 *
 * A field left blank is dropped rather than sent as an empty string, so the
 * connector's own default applies. Three cases have bitten this before and are
 * handled deliberately: a required checkbox is satisfied by being unticked (an
 * explicit "no" is an answer), a required list is not satisfied by a list that
 * came out empty, and a box holding only spaces counts as blank.
 *
 * Settings the form has no input for survive an edit untouched. A source's
 * config can hold more than this form asks about — `s3.pathFields` and
 * `file-import.fieldMapping` are set from the workspace manifest and have no
 * input yet — and the update replaces the whole config blob, so anything left
 * out here would be silently deleted the first time somebody opened the source
 * and pressed Save.
 * @param fields - The fields that were rendered.
 * @param values - What was typed into them, keyed the same way.
 * @param savedConfig - The source's stored config when editing, empty when adding.
 */
export function buildConfigFromFields(
  fields: ConfigField[],
  values: Record<string, ConfigFieldValue | undefined>,
  savedConfig: Record<string, unknown> = {},
): BuiltConfig {
  const config = keysTheFormDoesNotRender(fields, savedConfig);
  const missingLabels: string[] = [];

  for (const field of fields) {
    const supplied = normalizeFieldValue(field, values[field.key]);
    if (supplied === undefined) {
      if (field.required === true) {
        missingLabels.push(field.label);
      }
      continue;
    }
    writeNestedValue(config, field.key, supplied);
  }

  return { config, missingLabels };
}

/**
 * The saved settings this form has no input for, which an edit must carry
 * through rather than drop. A field the form renders is left out, because the
 * form's own value — including a blank one meaning "use the default" — is the
 * answer for it.
 * @param fields - The fields the form renders.
 * @param savedConfig - The source's stored config.
 */
function keysTheFormDoesNotRender(
  fields: ConfigField[],
  savedConfig: Record<string, unknown>,
): Record<string, unknown> {
  const renderedKeys = new Set(fields.map(field => field.key.split('.')[0]));
  const carriedThrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(savedConfig)) {
    if (!renderedKeys.has(key)) {
      carriedThrough[key] = value;
    }
  }
  return carriedThrough;
}

/**
 * One typed-in value as the config should carry it, or `undefined` when the
 * field was left blank.
 * @param field - The field being read.
 * @param raw - What the input currently holds.
 */
function normalizeFieldValue(field: ConfigField, raw: ConfigFieldValue | undefined): ConfigFieldValue | undefined {
  if (field.type === 'boolean') {
    // A checkbox is never blank: unticked is a real answer, not a missing one.
    return raw === undefined ? undefined : Boolean(raw);
  }

  if (field.type === 'number') {
    const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? '').trim());
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return clampToWholeNumber(parsed, field.min, field.max);
  }

  if (field.type === 'stringArray') {
    const entries = splitListInput(raw);
    return entries.length > 0 ? entries : undefined;
  }

  const text = String(raw ?? '').trim();
  return text === '' ? undefined : text;
}

/**
 * A list field's entries. The input accepts commas or newlines between them,
 * and blank entries — a trailing comma, a stray blank line — are dropped.
 * @param raw - What the input currently holds, already an array or still text.
 */
export function splitListInput(raw: ConfigFieldValue | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\n,]/);
  const entries: string[] = [];
  for (const part of parts) {
    const trimmed = String(part).trim();
    if (trimmed !== '') {
      entries.push(trimmed);
    }
  }
  return entries;
}

/**
 * A number brought inside the field's declared bounds and rounded to a whole
 * number, because every number a connector schema accepts is an integer.
 * Without this, 0 or 2.5 passed the form and failed server-side validation.
 * @param value - The number as typed.
 * @param min - Lowest accepted value, if the field declares one.
 * @param max - Highest accepted value, if the field declares one.
 */
function clampToWholeNumber(value: number, min?: number, max?: number): number {
  let bounded = Math.round(value);
  if (min !== undefined && bounded < min) {
    bounded = min;
  }
  if (max !== undefined && bounded > max) {
    bounded = max;
  }
  return bounded;
}

/** Path segments that would reach an object's prototype rather than its own data. */
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Read a possibly-dotted key out of a saved config.
 * @param source - The config object to read from.
 * @param dottedKey - The field key, e.g. `csvOptions.delimiter`.
 */
function readNestedValue(source: Record<string, unknown>, dottedKey: string): unknown {
  let cursor: unknown = source;
  for (const segment of dottedKey.split('.')) {
    if (typeof cursor !== 'object' || cursor === null || UNSAFE_PATH_SEGMENTS.has(segment)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Write a possibly-dotted key into a config being built, creating the
 * intermediate objects a nested key needs.
 * @param target - The config object being built.
 * @param dottedKey - The field key, e.g. `csvOptions.delimiter`.
 * @param value - The value to store.
 */
function writeNestedValue(target: Record<string, unknown>, dottedKey: string, value: ConfigFieldValue): void {
  const segments = dottedKey.split('.');
  const lastSegment = segments.pop();
  if (lastSegment === undefined) {
    return;
  }
  // Every key here comes from this file's own table today, so none of these can
  // appear. Refused anyway, because the cost is one check and the failure — a
  // write onto Object.prototype — would be silent and process-wide.
  if (UNSAFE_PATH_SEGMENTS.has(lastSegment) || segments.some(segment => UNSAFE_PATH_SEGMENTS.has(segment))) {
    return;
  }
  let cursor = target;
  for (const segment of segments) {
    const existing = cursor[segment];
    if (typeof existing !== 'object' || existing === null) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[lastSegment] = value;
}

/**
 * The sentence the dialog shows in place of an enabled submit button, naming
 * what still has to be filled in.
 * @param missingLabels - Labels of the required fields left blank.
 */
export function describeMissingFields(missingLabels: string[]): string | null {
  if (missingLabels.length === 0) {
    return null;
  }
  const named = missingLabels.map(label => withArticle(label.toLowerCase()));
  if (named.length === 1) {
    return named[0]!;
  }
  const last = named[named.length - 1];
  return `${named.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * A field name with the right article in front, or none where an article would
 * read wrongly. "Project keys" asks for several, so "a project keys" is not
 * English; "an AWS region" needs "an" rather than "a".
 * @param name - The field's label, already lowercased.
 */
function withArticle(name: string): string {
  if (name.endsWith('s') && !name.endsWith('ss')) {
    return name;
  }
  return /^[aeiou]/.test(name) ? `an ${name}` : `a ${name}`;
}
