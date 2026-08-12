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
import { buildConfigFromFields } from '@/libs/sources/configFields';

import { listConnectors } from '@/libs/sources/registry';

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
    it(`${connector.slug}: required-only submission parses against configSchema`, () => {
      const values: Record<string, SourceFormValue> = {};
      for (const field of connector.configFields ?? []) {
        if (field.required) {
          values[field.key] = sampleValue(field);
        }
      }
      const configJson = buildConfigFromFields(connector.configFields ?? [], values);

      expect(() => connector.configSchema.parse(configJson)).not.toThrow();
    });

    it(`${connector.slug}: fully-filled submission parses against configSchema`, () => {
      const values: Record<string, SourceFormValue> = {};
      for (const field of connector.configFields ?? []) {
        values[field.key] = sampleValue(field);
      }
      const configJson = buildConfigFromFields(connector.configFields ?? [], values);

      expect(() => connector.configSchema.parse(configJson)).not.toThrow();
    });
  }
});
