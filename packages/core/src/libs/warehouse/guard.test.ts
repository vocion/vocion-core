/**
 * The warehouse guard's vendor-neutral half: the allowlist judged against the
 * objects an engine reported, the caps on what comes back, and the subquery
 * a statement is compiled as. Schemas and tables are invented.
 */
import { describe, expect, it } from 'vitest';
import { assertSchemaAllowed, asSubquery, capRows, limitsFrom, qualifySchemas, refuseOutsideAllowlist, runnableSql, schemaAllowed, WarehouseRefusal } from './guard';

describe('the allowlist', () => {
  const allowed = qualifySchemas(['MARTS', 'finance.reporting', ' marts '], 'ANALYTICS');

  it('qualifies a bare entry with the default namespace, keeps a qualified one, and drops duplicates', () => {
    expect(allowed).toEqual(['ANALYTICS.MARTS', 'finance.reporting', 'ANALYTICS.marts']);
    expect(qualifySchemas(['sales'], null)).toEqual(['sales']);
  });

  it('compares schema names unquoted and case-folded, as warehouses fold unquoted identifiers', () => {
    expect(schemaAllowed('analytics.marts', allowed)).toBe(true);
    expect(schemaAllowed('"ANALYTICS"."MARTS"', allowed)).toBe(true);
    expect(schemaAllowed('`finance`.`reporting`', allowed)).toBe(true);
    expect(schemaAllowed('ANALYTICS.HR', allowed)).toBe(false);
  });

  it('refuses a browse outside the allowlist with a sentence naming what is allowed', () => {
    expect(() => assertSchemaAllowed('ANALYTICS.HR', allowed, 'Snowflake')).toThrow(WarehouseRefusal);
    expect(() => assertSchemaAllowed('ANALYTICS.HR', allowed, 'Snowflake')).toThrow(/not one of the schemas this Snowflake source allows \(ANALYTICS\.MARTS/);
    expect(() => assertSchemaAllowed('ANALYTICS.MARTS', allowed, 'Snowflake')).not.toThrow();
  });

  it('refuses a statement that reads anything outside it, naming every object, and lets the rest through', () => {
    expect(() => refuseOutsideAllowlist({
      vendor: 'Snowflake',
      allowed,
      referenced: [{ schema: 'ANALYTICS.MARTS', name: 'ORDERS' }, { schema: 'ANALYTICS.HR', name: 'SALARIES' }, { schema: 'ANALYTICS.HR', name: 'SALARIES' }],
    })).toThrow(/reads ANALYTICS\.HR\.SALARIES, outside the schemas.*It was not run/);
    expect(() => refuseOutsideAllowlist({ vendor: 'Snowflake', allowed, referenced: [{ schema: 'ANALYTICS.MARTS', name: 'ORDERS' }] })).not.toThrow();
    expect(() => refuseOutsideAllowlist({ vendor: 'Snowflake', allowed, referenced: [] })).not.toThrow();
  });
});

describe('the statement', () => {
  it('compiles as a subquery, so the engine\'s own grammar refuses anything but a query', () => {
    expect(asSubquery('SELECT 1;  ')).toBe('SELECT * FROM (\nSELECT 1\n) AS vocion_query');
    // A trailing comment cannot swallow the closing parenthesis.
    expect(asSubquery('SELECT 1 -- total')).toBe('SELECT * FROM (\nSELECT 1 -- total\n) AS vocion_query');
  });

  it('runs as written, with only a trailing semicolon taken off', () => {
    expect(runnableSql('  SELECT region, SUM(amount) FROM marts.orders GROUP BY 1 ORDER BY 2 DESC;;\n')).toBe('SELECT region, SUM(amount) FROM marts.orders GROUP BY 1 ORDER BY 2 DESC');
    // A second statement is left for the driver to refuse.
    expect(runnableSql('SELECT 1; DROP TABLE marts.orders')).toBe('SELECT 1; DROP TABLE marts.orders');
  });
});

describe('the caps', () => {
  const rows = [['Northwind', 120], ['Acme', 80], ['Contoso Supply', 45]];

  it('cuts at the row cap and says so', () => {
    expect(capRows(rows, { maxRows: 2, maxResultBytes: 10_000 })).toEqual({ rows: rows.slice(0, 2), truncated: 'rows' });
  });

  it('cuts at the byte cap, counting each row as the JSON it is sent as', () => {
    const size = JSON.stringify(rows[0]).length + 1;

    expect(capRows(rows, { maxRows: 100, maxResultBytes: size })).toEqual({ rows: rows.slice(0, 1), truncated: 'bytes' });
  });

  it('keeps every row under both caps', () => {
    expect(capRows(rows, { maxRows: 3, maxResultBytes: 10_000 })).toEqual({ rows, truncated: null });
  });

  it('reads the source\'s limits, kilobytes to bytes, with defaults for what it leaves out', () => {
    expect(limitsFrom({ maxRows: 50, maxResultKb: 100, timeoutSeconds: 30 })).toEqual({ maxRows: 50, maxResultBytes: 100_000, timeoutSeconds: 30 });
    expect(limitsFrom({})).toEqual({ maxRows: 1000, maxResultBytes: 2_000_000, timeoutSeconds: 60 });
  });
});
