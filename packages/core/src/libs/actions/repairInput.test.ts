/**
 * A card's input is repaired when the repair has one right answer
 * (2026-09-29: "title: expected string, received undefined", "steps.0.url:
 * Invalid URL"), and left wrong otherwise. Every name is invented.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { repairActionInput, titleFromLabel } from './repairInput';

const BASE = 'https://agents.example.com';

describe('the title a label gives', () => {
  it('drops the verb the button starts with', () => {
    expect(titleFromLabel('File factory filing bug — plan writes to a pending review item')).toBe('Factory filing bug — plan writes to a pending review item');
    expect(titleFromLabel('File as a feature request: Reminders for unopened sends')).toBe('Reminders for unopened sends');
    expect(titleFromLabel('Open an ask: which region hosts exports')).toBe('Which region hosts exports');
  });

  it('keeps a label that starts with no filing verb', () => {
    expect(titleFromLabel('Reminders for unopened sends')).toBe('Reminders for unopened sends');
  });
});

describe('repairs with one right answer', () => {
  it('fills a missing title from the label', () => {
    const schema = z.object({ title: z.string().min(1).max(200), body: z.string().optional() });
    const out = repairActionInput(schema, { body: 'x' }, { label: 'File the plan bug', baseUrl: BASE });

    expect(out.input).toEqual({ body: 'x', title: 'Plan bug' });
    expect(out.repaired).toEqual(['title from the card\'s label']);
    expect(schema.safeParse(out.input).success).toBe(true);
  });

  it('makes a workspace path absolute where a URL is required, at any depth', () => {
    const schema = z.object({ kind: z.string(), steps: z.array(z.object({ say: z.string(), url: z.string().url() })) });
    const input = { kind: 'decline', steps: [{ say: 'Follow #233.', url: '/w/northwind/dashboard/p/feature/233' }] };
    const out = repairActionInput(schema, input, { label: 'Notify the requester', baseUrl: BASE });

    expect(out.input).toEqual({ kind: 'decline', steps: [{ say: 'Follow #233.', url: 'https://agents.example.com/w/northwind/dashboard/p/feature/233' }] });
    expect(input.steps[0]!.url).toBe('/w/northwind/dashboard/p/feature/233');
  });

  it('matches an enum value that differs only in case or separators', () => {
    const schema = z.object({ state: z.enum(['new', 'in_scope', 'out_of_scope']) });

    expect(repairActionInput(schema, { state: 'Out of scope' }, { label: 'x', baseUrl: BASE }).input).toEqual({ state: 'out_of_scope' });
  });

  it('cuts a title over its maximum, after filling it', () => {
    const schema = z.object({ title: z.string().max(20) });
    const out = repairActionInput(schema, {}, { label: 'File a very long title that runs well past the limit', baseUrl: BASE });

    expect(schema.safeParse(out.input).success).toBe(true);
    expect(String(out.input.title)).toMatch(/…$/);
  });
});

describe('what is not repaired', () => {
  it('leaves an enum value no allowed value matches, and a URL that is not a path', () => {
    const schema = z.object({ state: z.enum(['new', 'in_scope']), url: z.string().url() });
    const input = { state: 'duplicate', url: 'see the request' };
    const out = repairActionInput(schema, input, { label: 'x', baseUrl: BASE });

    expect(out.input).toBe(input);
    expect(out.repaired).toEqual([]);
  });

  it('never fills a field that is not title-like, and returns a valid input untouched', () => {
    const schema = z.object({ to: z.string() });

    expect(repairActionInput(schema, {}, { label: 'Email Dana', baseUrl: BASE }).repaired).toEqual([]);
    expect(repairActionInput(schema, { to: 'dana@northwind.example' }, { label: 'x', baseUrl: BASE }).repaired).toEqual([]);
  });
});
