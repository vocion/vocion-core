/**
 * The pure halves of list intake: what a type's schema offers the reader,
 * how a reader's answer is kept, and how two reads of one person fold.
 */
import { describe, expect, it } from 'vitest';
import { dedupeBatch, fold, identityKeys } from './dedupe';
import { coerceValue, intakeFields, intakeIdentity, intakeTitle } from './fields';
import { jsonOf, outcomeOf, readInstructions } from './read';

const SCHEMA = {
  'x-identity': { name: 'name', company: 'company' },
  'properties': {
    name: { type: 'string' },
    work_email: { type: 'string', format: 'email' },
    company: { type: 'string' },
    fit: { type: 'integer' },
    tier: { type: 'string', enum: ['hot', 'warm', 'skip'] },
    tags: { type: 'array', items: { type: 'string' } },
    address: { type: 'object', properties: { city: { type: 'string' } } },
  },
};

describe('a type, as the reader is told it', () => {
  it('offers its flat fields and leaves objects out', () => {
    expect(intakeFields(SCHEMA).map(f => f.name)).toEqual(['name', 'work_email', 'company', 'fit', 'tier', 'tags']);
  });

  it('identifies by what the type declares, the email by its format, and drops a name the type lacks', () => {
    expect(intakeIdentity(SCHEMA)).toEqual({ email: 'work_email', name: 'name', company: 'company' });
    expect(intakeIdentity(SCHEMA, { name: 'full_name' })).toEqual({ email: 'work_email', name: 'name', company: 'company' });
    expect(intakeIdentity({ properties: { a: { type: 'string' } } })).toEqual({});
  });

  it('keeps a value only in the shape the field wants', () => {
    const [, , , fit, tier, tags] = intakeFields(SCHEMA);

    expect(coerceValue(fit!, '42')).toBe(42);
    expect(coerceValue(fit!, 'about forty')).toBeUndefined();
    expect(coerceValue(tier!, 'HOT')).toBe('hot');
    expect(coerceValue(tier!, 'lukewarm')).toBeUndefined();
    expect(coerceValue(tags!, 'ops, fleet')).toEqual(['ops', 'fleet']);
  });

  it('titles a record by its name, else its first short text', () => {
    const fields = intakeFields(SCHEMA);
    const identity = intakeIdentity(SCHEMA);

    expect(intakeTitle({ name: 'Jamie Smith', company: 'Contoso Supply' }, identity, fields)).toBe('Jamie Smith');
    expect(intakeTitle({ company: 'Contoso Supply' }, identity, fields)).toBe('Contoso Supply');
    expect(intakeTitle({}, identity, fields)).toBeNull();
  });

  it('tells the reader the fields and the hint', () => {
    const text = readInstructions({ typeLabel: 'Lead', fields: intakeFields(SCHEMA), hint: 'badges from Northwind Expo 2026' });

    expect(text).toContain('- tier: one of hot | warm | skip');
    expect(text).toContain('badges from Northwind Expo 2026');
  });
});

describe('a reader\'s answer', () => {
  it('is found inside fences and a sentence', () => {
    expect(jsonOf('Here you go:\n```json\n{"readable": false, "records": []}\n```')).toEqual({ readable: false, records: [] });
  });

  it('keeps declared fields, the surer of two readings, and calls an empty read unreadable', () => {
    const fields = intakeFields(SCHEMA);
    const out = outcomeOf({ readable: true, records: [{ confidence: 0.9, fields: [
      { name: 'name', value: 'Dana Reyes', confidence: 0.6 },
      { name: 'name', value: 'Dana Reyes', confidence: 0.95, page: 2 },
      { name: 'shoe_size', value: '9', confidence: 1 },
    ] }] }, fields);

    expect(out).toEqual({ status: 'read', records: [{ confidence: 0.9, fields: { name: { value: 'Dana Reyes', confidence: 0.95, page: 2 } } }] });
    expect(outcomeOf({ readable: true, records: [] }, fields).status).toBe('unreadable');
  });
});

describe('the same person twice', () => {
  const identity = { email: 'email', name: 'name', company: 'company' };
  const draft = (key: string, fields: Record<string, [unknown, number]>, artifactId: number) => ({
    key,
    fields: Object.fromEntries(Object.entries(fields).map(([k, [value, confidence]]) => [k, { value, confidence, artifactId, file: `f${artifactId}` }])),
    confidence: 0.9,
    sources: [{ artifactId, file: `f${artifactId}` }],
    notes: [],
  });

  it('folds case, accents and punctuation', () => {
    expect(fold('  Dána  REYES. ')).toBe('dana reyes');
    expect(identityKeys({ email: 'Dana@Kestrel.example', name: 'Dana Reyes', company: 'Kestrel Capital' }, identity)).toEqual(['email:dana@kestrel.example', 'who:dana reyes|kestrel capital']);
  });

  it('merges by email, or by name with company, keeping the surer value and both files', () => {
    const out = dedupeBatch([
      draft('1:0', { name: ['Jamie Smith', 0.9], company: ['Contoso Supply', 0.9], email: ['jamie.smith@contoso.example', 0.7] }, 1),
      draft('2:0', { name: ['jamie smith', 0.95], company: ['CONTOSO SUPPLY', 0.9], email: ['jamie.smith@contoso.example', 0.99] }, 2),
      draft('3:0', { name: ['Jamie Smith', 0.9], company: ['Acme Retail', 0.9] }, 3),
    ], identity);

    expect(out.merged).toBe(1);
    expect(out.drafts).toHaveLength(2);
    expect(out.drafts[0]!.fields.email!.confidence).toBe(0.99);
    expect(out.drafts[0]!.sources.map(s => s.artifactId)).toEqual([1, 2]);
  });
});
