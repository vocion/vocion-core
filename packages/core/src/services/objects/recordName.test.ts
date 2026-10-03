import { describe, expect, it, vi } from 'vitest';
import { NAME_MAX, recordName, wantsName } from '@/libs/workspace/recordName';
import { nameOnRead, readRecordName } from './recordName';

/**
 * A record's ticket-sized name (Chris, 2026-10-03: "not a full request or
 * spec in the title"): read by a model with a typed `{ name }`, kept on
 * `metadata.name`, read before the title by every surface. The model is
 * scripted here. Fictional fixture (Northwind).
 */

const ASK = 'On the Northwind library list, let me sort the documents by name, upload date or last opened, newest first by default, and remember my choice next time I open the library';

/**
 * A model that answers through the tool with these arguments.
 * @param args - What the tool call carries.
 */
function scripted(args: unknown) {
  const invoke = vi.fn(async () => ({ tool_calls: [{ name: 'name_record', args }] }));
  return { model: { bindTools: vi.fn(() => ({ invoke })) } as never, invoke };
}

describe('reading a name', () => {
  it('returns the model\'s typed name', async () => {
    const { model, invoke } = scripted({ name: 'Sort the library by name, date or last opened' });

    expect(await readRecordName({ orgId: 'org_northwind', text: ASK, kind: 'request' }, model)).toBe('Sort the library by name, date or last opened');
    expect(JSON.stringify((invoke.mock.calls[0] as unknown[])[0])).toContain('newest first by default');
  });

  it('refuses a name longer than a name, and a read that fails, as null — never a cut title', async () => {
    expect(await readRecordName({ orgId: 'org_northwind', text: ASK }, scripted({ name: 'x'.repeat(NAME_MAX + 1) }).model)).toBeNull();
    expect(await readRecordName({ orgId: 'org_northwind', text: ASK }, scripted({}).model)).toBeNull();

    const broken = { bindTools: () => ({ invoke: async () => {
      throw new Error('model down');
    } }) } as never;

    expect(await readRecordName({ orgId: 'org_northwind', text: ASK }, broken)).toBeNull();
  });
});

describe('the name a surface shows', () => {
  it('is the stored name, else the title', () => {
    expect(recordName(ASK, { name: 'Sort the library' })).toBe('Sort the library');
    expect(recordName('Sort the library', {})).toBe('Sort the library');
    expect(recordName(ASK, { name: '   ' })).toBe(ASK);
    expect(wantsName(ASK, {})).toBe(true);
    expect(wantsName(ASK, { name: 'Sort the library' })).toBe(false);
    expect(wantsName('Sort the library', {})).toBe(false);
  });

  it('names a long title once, on read, and keeps it', async () => {
    const read = vi.fn(async () => 'Sort the library by name, date or last opened');
    const keep = vi.fn(async () => undefined);

    expect(await nameOnRead({ orgId: 'org_northwind', id: 402, title: ASK, meta: {} }, { read, keep })).toBe('Sort the library by name, date or last opened');
    expect(keep).toHaveBeenCalledWith('org_northwind', 402, 'Sort the library by name, date or last opened');

    // Already named, or short: no read.
    expect(await nameOnRead({ orgId: 'org_northwind', id: 402, title: ASK, meta: { name: 'Sort the library' } }, { read, keep })).toBe('Sort the library');
    expect(await nameOnRead({ orgId: 'org_northwind', id: 403, title: 'Sort the library', meta: {} }, { read, keep })).toBe('Sort the library');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('shows the title when the read fails, and does not pay for the same failure again for a while', async () => {
    const read = vi.fn(async () => null);
    const keep = vi.fn(async () => undefined);
    let now = 1_000_000;

    expect(await nameOnRead({ orgId: 'org_northwind', id: 404, title: ASK, meta: {} }, { read, keep, now: () => now })).toBe(ASK);
    expect(await nameOnRead({ orgId: 'org_northwind', id: 404, title: ASK, meta: {} }, { read, keep, now: () => now })).toBe(ASK);
    expect(read).toHaveBeenCalledTimes(1);

    now += 11 * 60_000;
    await nameOnRead({ orgId: 'org_northwind', id: 404, title: ASK, meta: {} }, { read, keep, now: () => now });

    expect(read).toHaveBeenCalledTimes(2);
    expect(keep).not.toHaveBeenCalled();
  });
});
