/**
 * propose_action accepts what the model plainly meant, and names exactly what
 * is missing when it cannot. The payloads are the production shapes of
 * 2026-09-16…28, rewritten onto the fixture cast.
 */
import { describe, expect, it } from 'vitest';
import { explainProposeActionMiss, normalizeProposeActionArgs, proposeActionArgsSchema, readJsonObjectString } from './proposeActionArgs';

const ENVELOPE = {
  confidence: 0.8,
  rationale: 'Northwind asked for it on the call.',
  suggested_decision: 'approve',
  suggested_decision_reason: 'Asked for by the customer twice this month.',
};

const PAYLOAD = { objectType: 'request', title: 'Export the viewer list', fields: { product: 'send', kind: 'feature' } };

describe('readJsonObjectString', () => {
  it('parses a whole object', () => {
    expect(readJsonObjectString(JSON.stringify(PAYLOAD))).toEqual({ ok: true, value: PAYLOAD, repaired: false });
  });

  it('closes an object the model left one brace short (tool_call 12421)', () => {
    const short = '{"objectType": "deals", "objectId": "000001", "properties": {"hs_note_body": "Kestrel asked for a revised scope."}';

    expect(readJsonObjectString(short)).toEqual({
      ok: true,
      repaired: true,
      value: { objectType: 'deals', objectId: '000001', properties: { hs_note_body: 'Kestrel asked for a revised scope.' } },
    });
  });

  it('reports a string that stops mid-value as cut, never repairs it', () => {
    const cut = `${JSON.stringify(PAYLOAD).slice(0, -2)},"extractionNotes":"Filed from chat, 2026-`;
    const read = readJsonObjectString(cut);

    expect(read.ok).toBe(false);
    expect(read).toMatchObject({ cut: true, length: cut.length });
  });

  it('reports a string that stops after a key or a comma as cut', () => {
    expect(readJsonObjectString('{"objectType":"request",')).toMatchObject({ ok: false, cut: true });
    expect(readJsonObjectString('{"objectType":')).toMatchObject({ ok: false, cut: true });
  });

  it('refuses what is not an object at all', () => {
    expect(readJsonObjectString('file the request')).toMatchObject({ ok: false, cut: false });
    expect(readJsonObjectString('[1,2]')).toMatchObject({ ok: false, cut: false });
  });
});

describe('normalizeProposeActionArgs', () => {
  it('parses an action_input sent as a JSON string, and the schema then accepts the call', () => {
    const sent = { action_id: 'objects.propose_candidate', action_input: JSON.stringify(PAYLOAD), ...ENVELOPE };
    const args = normalizeProposeActionArgs(sent);

    expect((args as { action_input: unknown }).action_input).toEqual(PAYLOAD);
    expect(proposeActionArgsSchema.safeParse(sent).success).toBe(false);
    expect(proposeActionArgsSchema.safeParse(args).success).toBe(true);
  });

  it('hoists the envelope the model nested inside action_input, and takes the envelope-only keys out of the payload', () => {
    const sent = { action_id: 'objects.propose_candidate', action_input: JSON.stringify({ ...PAYLOAD, ...ENVELOPE }) };
    const args = normalizeProposeActionArgs(sent) as Record<string, unknown>;

    expect(proposeActionArgsSchema.safeParse(args).success).toBe(true);
    expect(args).toMatchObject(ENVELOPE);
    // No action's input has these; they are the envelope's alone.
    expect(args.action_input).not.toHaveProperty('suggested_decision');
    expect(args.action_input).not.toHaveProperty('suggested_decision_reason');
    // Some actions' inputs do carry these (ask.file, the manual hand-off), so they stay.
    expect(args.action_input).toHaveProperty('confidence', 0.8);
  });

  it('never overwrites an envelope field the model did send beside the payload', () => {
    const args = normalizeProposeActionArgs({ action_id: 'x', action_input: { ...PAYLOAD, confidence: 0.2 }, ...ENVELOPE }) as Record<string, unknown>;

    expect(args.confidence).toBe(0.8);
  });

  it('coerces a numeric-string confidence, and a percentage', () => {
    expect((normalizeProposeActionArgs({ ...ENVELOPE, confidence: '0.85' }) as { confidence: unknown }).confidence).toBe(0.85);
    expect((normalizeProposeActionArgs({ ...ENVELOPE, confidence: '85%' }) as { confidence: unknown }).confidence).toBe(0.85);
    expect((normalizeProposeActionArgs({ ...ENVELOPE, confidence: 'high' }) as { confidence: unknown }).confidence).toBe('high');
  });

  it('reads one evidence string as a list of one (tool_call 20789)', () => {
    expect((normalizeProposeActionArgs({ ...ENVELOPE, evidence: 'hubspot:contacts:000001 email log' }) as { evidence: unknown }).evidence).toEqual(['hubspot:contacts:000001 email log']);
  });

  it('leaves a cut string as it is, for the refusal to name', () => {
    const cut = '{"objectType":"request","title":"Export the viewer list","extractionNotes":"Filed from chat, 2026-';

    expect((normalizeProposeActionArgs({ action_id: 'objects.propose_candidate', action_input: cut }) as { action_input: unknown }).action_input).toBe(cut);
  });
});

describe('explainProposeActionMiss', () => {
  it('names the cut, its length, and the four missing fields — conversation 349\'s call', () => {
    const cut = `{"objectType":"request","title":"Export the viewer list","fields":{"body":"${'Founders copy the list by hand. '.repeat(48)}"},"extractionNotes":"Filed from chat, 2026-`;
    const said = explainProposeActionMiss({ action_id: 'objects.propose_candidate', action_input: cut });

    expect(cut.length).toBeGreaterThan(1_000);
    expect(said).toContain(`action_input was cut off after ${cut.length.toLocaleString('en-US')} characters`);
    expect(said).toContain('send it again, shorter, as an object, not a string');
    expect(said).toContain('confidence (a number 0–1), rationale, suggested_decision ("approve", "reject" or "snooze"), suggested_decision_reason are missing or wrong');
    expect(said).toContain('beside action_input, not inside it');
    expect(said).toMatch(/^Not recorded: [\s\S]*Nothing ran\. Fix that and call propose_action again\.$/);
  });

  it('names only what is missing when the payload itself was readable (tool_call 13096)', () => {
    const said = explainProposeActionMiss({ action_id: 'hubspot.update', action_input: '{"objectType":"deals","objectId":"000001","properties":{"hs_note_body":"Kestrel"}' });

    expect(said).not.toContain('cut off');
    expect(said).not.toContain('as an object, not a string');
    expect(said).toContain('— confidence (a number 0–1), rationale');
  });

  it('says nothing more specific for a call that is already whole', () => {
    expect(explainProposeActionMiss({ action_id: 'objects.propose_candidate', action_input: PAYLOAD, ...ENVELOPE })).toBeNull();
  });
});
