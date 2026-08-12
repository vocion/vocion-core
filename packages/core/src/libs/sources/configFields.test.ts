/**
 * Guards the exact bug from vocion-core#52: a connector's `configFields`
 * drifting from its `configSchema` so the Add-Source dialog either discards
 * what the user typed or hard-fails server-side validation. For every
 * registered connector, run its declared fields through the same
 * `buildConfigFromFields` transform the dialog uses and assert the result
 * still parses.
 */

import type { SourceConfigField, SourceFormValue } from '@/libs/sources/configFields';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildConfigFromFields, fieldInputDefault } from '@/libs/sources/configFields';

import { listConnectors } from '@/libs/sources/registry';
import { UI_FIELDS } from '@/libs/sources/uiFields';

/**
 * A schema-valid sample value for a field, used to fill required fields.
 * @param field - the connector's declared form field
 */
function sampleValue(field: SourceConfigField): SourceFormValue {
  switch (field.type) {
    case 'url':
      return 'https://example.com';
    case 'number':
      return '7';
    case 'boolean':
      return true;
    case 'select':
      return field.options?.[0] ?? 'test';
    case 'stringArray':
      return 'sample-a, sample-b';
    default:
      return 'sample-text';
  }
}

describe('connector configFields', () => {
  // `web` keeps its own bespoke urls/crawl UI in AddSourceDialog (a nested
  // `crawl` object doesn't fit this flat field model) — its configFields
  // entry exists only for documentation, not for this generic round trip.
  const genericConnectors = listConnectors().filter(c => c.slug !== 'web');

  for (const connector of genericConnectors) {
    const fields = UI_FIELDS[connector.slug]?.configFields ?? [];

    it(`${connector.slug}: required-only submission parses against configSchema`, () => {
      const values: Record<string, SourceFormValue> = {};
      for (const field of fields) {
        if (field.required) {
          values[field.key] = sampleValue(field);
        }
      }
      const configJson = buildConfigFromFields(fields, values);

      expect(() => connector.configSchema.parse(configJson)).not.toThrow();
    });

    it(`${connector.slug}: fully-filled submission parses against configSchema`, () => {
      const values: Record<string, SourceFormValue> = {};
      for (const field of fields) {
        values[field.key] = sampleValue(field);
      }
      const configJson = buildConfigFromFields(fields, values);

      expect(() => connector.configSchema.parse(configJson)).not.toThrow();
    });

    // The two tests above use a synthetic sampleValue() for every field — they
    // never actually exercise a field's own declared `default`. A default that
    // doesn't match its own field (a `select` default absent from `options`, a
    // `number` default outside the schema's .min()/.max()) would ship
    // invisibly: fieldInputDefault() is exactly what the dialog pre-fills the
    // form with on open. Required fields still get a sample value here — an
    // unfilled required field is expected to be blank; that's not what this
    // test is checking.
    it(`${connector.slug}: fieldInputDefault for every optional field parses against configSchema`, () => {
      const values: Record<string, SourceFormValue> = {};
      for (const field of fields) {
        values[field.key] = field.required ? sampleValue(field) : fieldInputDefault(field);
      }
      const configJson = buildConfigFromFields(fields, values);
      const result = connector.configSchema.safeParse(configJson);

      expect(result.success, !result.success ? result.error.message : undefined).toBe(true);
    });

    // Catches the field-drift class this whole file guards against a step earlier:
    // a stale/renamed configFields.key that configSchema no longer has at all,
    // before it ever gets the chance to fail (or worse, silently pass) a round trip.
    it(`${connector.slug}: every configFields key exists on configSchema`, () => {
      if (!(connector.configSchema instanceof z.ZodObject)) {
        return;
      }
      const schemaKeys = new Set(Object.keys(connector.configSchema.shape));
      for (const field of fields) {
        expect(schemaKeys.has(field.key), `"${field.key}" is not a key of ${connector.slug}'s configSchema`).toBe(true);
      }
    });
  }
});

describe('buildConfigFromFields edge cases', () => {
  it('omits a required text field left whitespace-only, instead of sending a blank string', () => {
    const fields: SourceConfigField[] = [{ key: 'channel', label: 'Channel ID', type: 'text', required: true }];

    expect(buildConfigFromFields(fields, { channel: '   ' })).toEqual({});
  });

  it('trims a valid text value rather than storing the surrounding whitespace', () => {
    const fields: SourceConfigField[] = [{ key: 'channel', label: 'Channel ID', type: 'text', required: true }];

    expect(buildConfigFromFields(fields, { channel: '  C0123ABCD  ' })).toEqual({ channel: 'C0123ABCD' });
  });

  it('omits a required stringArray field that collapses to empty after trimming (e.g. a bare comma)', () => {
    const fields: SourceConfigField[] = [{ key: 'projectKeys', label: 'Project keys', type: 'stringArray', required: true }];

    expect(buildConfigFromFields(fields, { projectKeys: ' , ' })).toEqual({});
  });

  it('omits a whitespace-only number field instead of coercing it to 0', () => {
    const fields: SourceConfigField[] = [{ key: 'pastDays', label: 'Days back', type: 'number' }];

    expect(buildConfigFromFields(fields, { pastDays: '   ' })).toEqual({});
  });

  it('includes an explicit false for a boolean field — false is a real value, not "unset"', () => {
    const fields: SourceConfigField[] = [{ key: 'includeDescription', label: 'Include issue description', type: 'boolean' }];

    expect(buildConfigFromFields(fields, { includeDescription: false })).toEqual({ includeDescription: false });
  });

  it('drops a stray empty item out of a stringArray while keeping the real ones (trailing comma)', () => {
    const fields: SourceConfigField[] = [{ key: 'users', label: 'Users', type: 'stringArray' }];

    expect(buildConfigFromFields(fields, { users: 'a@x.com, b@x.com, ' })).toEqual({ users: ['a@x.com', 'b@x.com'] });
  });

  // Every number field currently in UI_FIELDS (doneWindowDays, pastDays x3,
  // futureDays) backs a schema `.int().positive()` — but the field only
  // declares a `default`, nothing marking its lower bound. A user typing 0,
  // a negative number, or a decimal sails through buildConfigFromFields
  // untouched and only fails once addSource() runs the real configSchema
  // server-side, surfacing a raw ZodError dump instead of a client-side
  // validation message.
  it('clamps a number field below its declared min instead of sending an out-of-range value', () => {
    const fields: SourceConfigField[] = [{ key: 'pastDays', label: 'Days back', type: 'number', min: 1 }];

    expect(buildConfigFromFields(fields, { pastDays: '0' })).toEqual({ pastDays: 1 });
    expect(buildConfigFromFields(fields, { pastDays: '-5' })).toEqual({ pastDays: 1 });
  });

  it('rounds a decimal number field to the nearest integer — every declared number field is int-only', () => {
    const fields: SourceConfigField[] = [{ key: 'pastDays', label: 'Days back', type: 'number', min: 1 }];

    expect(buildConfigFromFields(fields, { pastDays: '3.7' })).toEqual({ pastDays: 4 });
  });
});

describe('every declared number field enforces its schema\'s real lower bound', () => {
  for (const connector of listConnectors()) {
    const fields = UI_FIELDS[connector.slug]?.configFields ?? [];
    for (const field of fields.filter(f => f.type === 'number')) {
      it(`${connector.slug}.${field.key}: typing 0 or a negative number still parses against configSchema`, () => {
        const values: Record<string, SourceFormValue> = { [field.key]: '-5' };
        for (const other of fields) {
          if (other.required && other.key !== field.key) {
            values[other.key] = sampleValue(other);
          }
        }
        const configJson = buildConfigFromFields(fields, values);
        const result = connector.configSchema.safeParse(configJson);

        expect(result.success, !result.success ? result.error.message : undefined).toBe(true);
      });
    }
  }
});

describe('fieldInputDefault', () => {
  it('falls back to the first option for a select field with no declared default', () => {
    const field: SourceConfigField = { key: 'format', label: 'Format', type: 'select', options: ['auto', 'jsonl', 'csv'] };

    expect(fieldInputDefault(field)).toBe('auto');
  });

  it('returns an explicit boolean default as a real boolean, not the string "false"', () => {
    const field: SourceConfigField = { key: 'includeDescription', label: 'Include issue description', type: 'boolean', default: false };

    expect(fieldInputDefault(field)).toBe(false);
  });

  it('joins an array default into a comma-separated string for the input', () => {
    const field: SourceConfigField = { key: 'extensions', label: 'File extensions', type: 'stringArray', default: ['.md', '.txt'] };

    expect(fieldInputDefault(field)).toBe('.md, .txt');
  });
});
