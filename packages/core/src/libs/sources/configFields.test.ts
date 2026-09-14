import type { ConfigField, ConfigFieldValue } from '@/libs/sources/configFields';
/**
 * The add-source form and the connector schemas have to keep agreeing.
 *
 * `configFields.ts` describes the inputs a person fills in; each connector's
 * `configSchema` decides what the server will accept. Nothing in the type
 * system ties the two together, so a renamed schema field would silently leave
 * the form asking for a key the connector no longer reads — the exact failure
 * this whole module exists to end. These tests close that gap by running every
 * connector's declared fields through its real schema.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildConfigFromFields,
  CONFIG_FIELDS,
  configFieldsFor,
  describeMissingFields,
  fieldValuesFromConfig,
  initialFieldValues,
  splitListInput,
} from '@/libs/sources/configFields';
import { getConnector, listConnectors } from '@/libs/sources/registry';

/** Connectors whose forms are hand-written because a field list cannot express them. */
const HAND_WRITTEN_FORM_SLUGS = ['web', 'strapi'];

/**
 * A value a person plausibly types into this field, used to prove the form's
 * output survives the connector's schema.
 * @param field - The field being filled in.
 */
function sampleValueFor(field: ConfigField): ConfigFieldValue {
  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }
  switch (field.type) {
    case 'url':
      return 'https://example.test/api';
    case 'number':
      return field.min ?? 1;
    case 'boolean':
      return true;
    case 'stringArray':
      return ['sample-entry'];
    case 'select':
      return field.options?.[0]?.value ?? '';
    case 'text':
    default:
      return 'sample-value';
  }
}

/**
 * Every field filled in, so the built config exercises the whole schema rather
 * than only its required half.
 * @param fields - The fields on one connector's form.
 */
function fullyFilledValues(fields: ConfigField[]): Record<string, ConfigFieldValue> {
  const values: Record<string, ConfigFieldValue> = {};
  for (const field of fields) {
    values[field.key] = sampleValueFor(field);
  }
  return values;
}

/**
 * The top-level keys a connector's schema declares, or null when the schema is
 * not a plain object (a `.refine()`d schema, say).
 * @param schema - The connector's config schema.
 */
function topLevelSchemaKeys(schema: z.ZodTypeAny): string[] | null {
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape as Record<string, unknown>);
  }
  return null;
}

describe('connector coverage', () => {
  it('declares fields for every connector without a hand-written form', () => {
    const needingFields = listConnectors()
      .map(connector => connector.slug)
      .filter(slug => !HAND_WRITTEN_FORM_SLUGS.includes(slug))
      .sort();

    expect(Object.keys(CONFIG_FIELDS).sort()).toEqual(needingFields);
  });

  it('keys every entry by a slug the registry actually knows', () => {
    for (const slug of Object.keys(CONFIG_FIELDS)) {
      expect(getConnector(slug), `no connector registered for slug "${slug}"`).toBeDefined();
    }
  });

  it('leaves the hand-written forms out of the table', () => {
    for (const slug of HAND_WRITTEN_FORM_SLUGS) {
      expect(configFieldsFor(slug)).toEqual([]);
    }
  });
});

describe.each(Object.keys(CONFIG_FIELDS))('%s form', (slug) => {
  const fields = CONFIG_FIELDS[slug]!;
  const schema = getConnector(slug)!.configSchema;

  it('asks only for keys the connector schema declares', () => {
    const declared = topLevelSchemaKeys(schema);

    expect(declared, `${slug} has a non-object config schema`).not.toBeNull();

    for (const field of fields) {
      const topLevelKey = field.key.split('.')[0]!;

      expect(declared, `${slug}.${field.key} is not in the connector schema`).toContain(topLevelKey);
    }
  });

  it('produces a config the connector schema accepts when every field is filled in', () => {
    const { config, missingLabels } = buildConfigFromFields(fields, fullyFilledValues(fields));

    expect(missingLabels).toEqual([]);

    const parsed = schema.safeParse(config);

    expect(parsed.success ? null : z.prettifyError(parsed.error)).toBeNull();
  });

  it('produces a config the connector schema accepts when only required fields are filled in', () => {
    const values = initialFieldValues(fields);
    for (const field of fields) {
      if (field.required === true) {
        values[field.key] = sampleValueFor(field);
      }
    }
    const { config, missingLabels } = buildConfigFromFields(fields, values);

    expect(missingLabels).toEqual([]);

    const parsed = schema.safeParse(config);

    expect(parsed.success ? null : z.prettifyError(parsed.error)).toBeNull();
  });

  it('names every required field when nothing is filled in', () => {
    const requiredLabels = fields.filter(field => field.required === true).map(field => field.label);
    const { missingLabels } = buildConfigFromFields(fields, initialFieldValues(fields));

    expect(missingLabels).toEqual(requiredLabels);
  });

  it('gives every field a unique key and a label', () => {
    const keys = fields.map(field => field.key);

    expect(new Set(keys).size).toBe(keys.length);

    for (const field of fields) {
      expect(field.label.trim()).not.toBe('');
    }
  });

  it('offers choices on every select field and nowhere else', () => {
    for (const field of fields) {
      if (field.type === 'select') {
        expect(field.options?.length ?? 0).toBeGreaterThan(0);
      } else {
        expect(field.options).toBeUndefined();
      }
    }
  });

  it('starts each field on a value its own type can hold', () => {
    const values = initialFieldValues(fields);
    for (const field of fields) {
      const value = values[field.key];
      if (field.type === 'boolean') {
        expect(typeof value).toBe('boolean');
      } else if (field.type === 'stringArray') {
        expect(Array.isArray(value)).toBe(true);
      } else if (field.type === 'number') {
        expect(['number', 'string']).toContain(typeof value);
      } else {
        expect(typeof value).toBe('string');
      }
    }
  });
});

describe('buildConfigFromFields', () => {
  it('drops a blank optional field rather than sending an empty string', () => {
    const fields: ConfigField[] = [{ key: 'region', label: 'AWS region', type: 'text' }];
    const { config, missingLabels } = buildConfigFromFields(fields, { region: '   ' });

    expect(config).toEqual({});
    expect(missingLabels).toEqual([]);
  });

  it('treats a box holding only spaces as blank on a required field', () => {
    const fields: ConfigField[] = [{ key: 'bucket', label: 'Bucket name', type: 'text', required: true }];
    const { config, missingLabels } = buildConfigFromFields(fields, { bucket: '  \t ' });

    expect(config).toEqual({});
    expect(missingLabels).toEqual(['Bucket name']);
  });

  it('counts an unticked required checkbox as answered', () => {
    const fields: ConfigField[] = [{ key: 'includeDescription', label: 'Include description', type: 'boolean', required: true }];
    const { config, missingLabels } = buildConfigFromFields(fields, { includeDescription: false });

    expect(config).toEqual({ includeDescription: false });
    expect(missingLabels).toEqual([]);
  });

  it('does not count a required list that came out empty as answered', () => {
    const fields: ConfigField[] = [{ key: 'projectKeys', label: 'Project keys', type: 'stringArray', required: true }];
    const { config, missingLabels } = buildConfigFromFields(fields, { projectKeys: ' , , ' });

    expect(config).toEqual({});
    expect(missingLabels).toEqual(['Project keys']);
  });

  it('splits a list on commas and newlines and drops the blanks', () => {
    const fields: ConfigField[] = [{ key: 'extensions', label: 'File extensions', type: 'stringArray' }];
    const { config } = buildConfigFromFields(fields, { extensions: '.md,\n .txt , ,' });

    expect(config).toEqual({ extensions: ['.md', '.txt'] });
  });

  it('pulls a number back inside the bounds the field declares', () => {
    const fields: ConfigField[] = [{ key: 'maxObjects', label: 'Maximum objects', type: 'number', min: 1, max: 20000 }];

    expect(buildConfigFromFields(fields, { maxObjects: '0' }).config).toEqual({ maxObjects: 1 });
    expect(buildConfigFromFields(fields, { maxObjects: '-5' }).config).toEqual({ maxObjects: 1 });
    expect(buildConfigFromFields(fields, { maxObjects: '99999' }).config).toEqual({ maxObjects: 20000 });
  });

  it('rounds a typed-in decimal to a whole number', () => {
    const fields: ConfigField[] = [{ key: 'pastDays', label: 'Past days', type: 'number', min: 1 }];

    expect(buildConfigFromFields(fields, { pastDays: '2.6' }).config).toEqual({ pastDays: 3 });
  });

  it('drops a number field that holds nothing usable', () => {
    const fields: ConfigField[] = [{ key: 'limit', label: 'Row limit', type: 'number' }];

    expect(buildConfigFromFields(fields, { limit: '' }).config).toEqual({});
    expect(buildConfigFromFields(fields, { limit: 'abc' }).config).toEqual({});
  });

  it('nests a dotted key into the object the schema expects', () => {
    const fields: ConfigField[] = [
      { key: 'csvOptions.delimiter', label: 'Separator', type: 'text' },
      { key: 'csvOptions.header', label: 'Has header row', type: 'boolean' },
    ];
    const { config } = buildConfigFromFields(fields, { 'csvOptions.delimiter': ';', 'csvOptions.header': true });

    expect(config).toEqual({ csvOptions: { delimiter: ';', header: true } });
  });

  it('lists missing required fields in the order the form shows them', () => {
    const fields: ConfigField[] = [
      { key: 'baseUrl', label: 'Site URL', type: 'url', required: true },
      { key: 'projectKeys', label: 'Project keys', type: 'stringArray', required: true },
    ];
    const { missingLabels } = buildConfigFromFields(fields, {});

    expect(missingLabels).toEqual(['Site URL', 'Project keys']);
  });
});

describe('fieldValuesFromConfig', () => {
  const fields: ConfigField[] = [
    { key: 'baseUrl', label: 'Site URL', type: 'url', required: true },
    { key: 'doneWindowDays', label: 'Done window', type: 'number', defaultValue: 90 },
    { key: 'includeDescription', label: 'Include description', type: 'boolean', defaultValue: true },
    { key: 'projectKeys', label: 'Project keys', type: 'stringArray', required: true },
    { key: 'csvOptions.delimiter', label: 'Separator', type: 'text', defaultValue: ',' },
  ];

  it('shows what is saved rather than the defaults', () => {
    const values = fieldValuesFromConfig(fields, {
      baseUrl: 'https://acme.atlassian.net',
      doneWindowDays: 30,
      includeDescription: false,
      projectKeys: ['ENG', 'OPS'],
      csvOptions: { delimiter: ';' },
    });

    expect(values).toEqual({
      'baseUrl': 'https://acme.atlassian.net',
      'doneWindowDays': 30,
      'includeDescription': false,
      'projectKeys': ['ENG', 'OPS'],
      'csvOptions.delimiter': ';',
    });
  });

  it('falls back to the default for anything the saved config does not mention', () => {
    const values = fieldValuesFromConfig(fields, { baseUrl: 'https://acme.atlassian.net' });

    expect(values.doneWindowDays).toBe(90);
    expect(values.includeDescription).toBe(true);
    expect(values.projectKeys).toEqual([]);
  });

  it('survives a saved config holding keys the form does not render', () => {
    const values = fieldValuesFromConfig(fields, { baseUrl: 'https://acme.atlassian.net', _connector: 'jira' });

    expect(values._connector).toBeUndefined();
  });

  it('round-trips through buildConfigFromFields without changing anything', () => {
    const saved = {
      baseUrl: 'https://acme.atlassian.net',
      doneWindowDays: 30,
      includeDescription: false,
      projectKeys: ['ENG'],
      csvOptions: { delimiter: ';' },
    };
    const { config } = buildConfigFromFields(fields, fieldValuesFromConfig(fields, saved));

    expect(config).toEqual(saved);
  });
});

describe('splitListInput', () => {
  it('leaves an array of entries alone apart from trimming', () => {
    expect(splitListInput([' ENG ', 'OPS', ' '])).toEqual(['ENG', 'OPS']);
  });

  it('returns nothing for input holding no entries', () => {
    expect(splitListInput(undefined)).toEqual([]);
    expect(splitListInput('')).toEqual([]);
    expect(splitListInput('  ,  ')).toEqual([]);
  });
});

describe('describeMissingFields', () => {
  it('says nothing when the form is complete', () => {
    expect(describeMissingFields([])).toBeNull();
  });

  it('names a single missing field', () => {
    expect(describeMissingFields(['Site URL'])).toBe('a site url');
  });

  it('leaves the article off a field that asks for several', () => {
    expect(describeMissingFields(['Project keys'])).toBe('project keys');
  });

  it('uses "an" before a label starting with a vowel', () => {
    expect(describeMissingFields(['AWS region'])).toBe('an aws region');
  });

  it('keeps the article on a singular label ending in a double s', () => {
    expect(describeMissingFields(['Email address'])).toBe('an email address');
    expect(describeMissingFields(['Business'])).toBe('a business');
  });

  it('joins several missing fields into one sentence', () => {
    expect(describeMissingFields(['Site URL', 'Project keys'])).toBe('a site url and project keys');
    expect(describeMissingFields(['Bucket name', 'Key prefix', 'AWS region']))
      .toBe('a bucket name, a key prefix and an aws region');
  });

  it('reads as English for every required field in the table', () => {
    // The wording is assembled from labels, so a new connector's label can
    // break it without anyone reading the sentence it lands in.
    for (const [slug, fields] of Object.entries(CONFIG_FIELDS)) {
      const required = fields.filter(field => field.required === true).map(field => field.label);
      if (required.length === 0) {
        continue;
      }
      const sentence = describeMissingFields(required)!;

      expect(sentence, `${slug} reads badly`).not.toMatch(/\ba [a-z]+s\b/);
      expect(sentence, `${slug} reads badly`).not.toMatch(/\ba [aeiou]/);
    }
  });
});

describe('a dotted key that would reach a prototype', () => {
  it('is refused rather than written', () => {
    const fields: ConfigField[] = [{ key: '__proto__.polluted', label: 'Bad', type: 'text' }];
    const { config } = buildConfigFromFields(fields, { '__proto__.polluted': 'yes' });

    expect(config).toEqual({});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('reads nothing back through one either', () => {
    const fields: ConfigField[] = [{ key: 'constructor.name', label: 'Bad', type: 'text' }];

    expect(fieldValuesFromConfig(fields, {})['constructor.name']).toBe('');
  });
});

/**
 * The update path replaces the whole config blob, so anything this form leaves
 * out of what it builds is deleted from the source. A config can hold settings
 * the form has no input for — `s3.pathFields` and `file-import.fieldMapping`
 * come from the workspace manifest — and an admin opening the source and
 * pressing Save must not wipe them.
 */
describe('settings the form has no input for', () => {
  const fields: ConfigField[] = [
    { key: 'bucket', label: 'Bucket name', type: 'text', required: true },
    { key: 'prefix', label: 'Key prefix', type: 'text' },
  ];

  it('carries an unrendered setting through an edit', () => {
    const saved = { bucket: 'acme-assets', prefix: 'templates/', pathFields: { campaign: 0 } };
    const { config } = buildConfigFromFields(fields, fieldValuesFromConfig(fields, saved), saved);

    expect(config).toEqual(saved);
  });

  it('still lets the form overwrite a setting it does render', () => {
    const saved = { bucket: 'old-bucket', pathFields: { campaign: 0 } };
    const { config } = buildConfigFromFields(fields, { bucket: 'new-bucket' }, saved);

    expect(config).toEqual({ bucket: 'new-bucket', pathFields: { campaign: 0 } });
  });

  it('drops a rendered field cleared to blank rather than restoring the saved value', () => {
    // Clearing an optional box means "use the connector's default", which only
    // works if the key is absent. Carrying the old value back would make the
    // box impossible to empty.
    const saved = { bucket: 'acme-assets', prefix: 'templates/' };
    const { config } = buildConfigFromFields(fields, { bucket: 'acme-assets', prefix: '' }, saved);

    expect(config).toEqual({ bucket: 'acme-assets' });
  });

  it('keeps a nested setting whose parent key the form partly renders out of the way', () => {
    // `csvOptions.delimiter` is rendered, so the whole `csvOptions` object is
    // the form's to rebuild — carrying the saved one through would fight it.
    const nested: ConfigField[] = [
      { key: 'path', label: 'File path', type: 'text', required: true },
      { key: 'csvOptions.delimiter', label: 'Separator', type: 'text' },
    ];
    const saved = { path: 'data.csv', csvOptions: { delimiter: ',' }, fieldMapping: { title: 'name' } };
    const { config } = buildConfigFromFields(nested, { 'path': 'data.csv', 'csvOptions.delimiter': ';' }, saved);

    expect(config).toEqual({ path: 'data.csv', csvOptions: { delimiter: ';' }, fieldMapping: { title: 'name' } });
  });

  it('adds nothing when there is no saved config, as when adding a source', () => {
    const { config } = buildConfigFromFields(fields, { bucket: 'acme-assets' });

    expect(config).toEqual({ bucket: 'acme-assets' });
  });
});
