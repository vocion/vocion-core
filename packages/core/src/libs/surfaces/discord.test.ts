import { Buffer } from 'node:buffer';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { discordText, parseDiscord, verifyDiscord } from './discord';

/** Discord's /ask as a chat surface. Ids keep Discord's shape (snowflakes) but are fictional. */

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBLIC_HEX = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');

function signed(body: string, timestamp = '1760000000'): Headers {
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
  return new Headers({ 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp });
}

const ask = { type: 2, id: '1300000000000000001', guild_id: '1200000000000000001', channel_id: '1200000000000000002', member: { user: { id: '1100000000000000003', username: 'dana' } }, data: { name: 'ask', options: [{ name: 'question', value: 'What did Kestrel Capital ask for?' }] } };

describe('the Discord surface', () => {
  it('takes an interaction Discord signed with the application key, and refuses anything else', () => {
    const body = JSON.stringify(ask);

    expect(verifyDiscord(body, signed(body), PUBLIC_HEX)).toEqual({ ok: true });
    expect(verifyDiscord(`${body} `, signed(body), PUBLIC_HEX)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyDiscord(body, new Headers(), PUBLIC_HEX)).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verifyDiscord(body, signed(body), null)).toEqual({ ok: false, reason: 'missing_secret' });
  });

  it('answers Discord\'s endpoint check, and reads /ask as the person in that channel', () => {
    expect(parseDiscord({ type: 1 })).toEqual({ kind: 'challenge', challenge: 'pong' });
    expect(parseDiscord(ask)).toEqual({ kind: 'message', inbound: { surface: 'discord', teamId: ask.guild_id, channelId: ask.channel_id, threadRef: `1100000000000000003@${ask.guild_id}`, messageRef: ask.id, externalUserId: '1100000000000000003', text: 'What did Kestrel Capital ask for?', isDirect: false } });
  });

  it('ignores another command, a button, and an empty question', () => {
    expect(parseDiscord({ ...ask, data: { name: 'roll' } }).kind).toBe('ignore');
    expect(parseDiscord({ type: 3 }).kind).toBe('ignore');
    expect(parseDiscord({ ...ask, data: { name: 'ask', options: [{ name: 'question', value: '  ' }] } }).kind).toBe('ignore');
  });

  it('keeps a reply to one Discord message', () => {
    expect(discordText('x'.repeat(2500))).toHaveLength(2000);
  });
});
