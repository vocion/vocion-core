/**
 * The brief's player, in a real browser: nothing at all when listening is
 * off, "on its way" while the audio is made (and it asks again), then
 * play/pause, a scrubber, the time and 1×/1.5×/2× on a native audio element.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

vi.mock('@/libs/Orpc', () => ({
  client: { briefings: { audio: vi.fn() } },
}));

const { client } = await import('@/libs/Orpc');
const { BriefAudioPlayer } = await import('./BriefAudioPlayer');

/**
 * A few seconds of silence as a WAV the browser can load and play.
 * @param seconds - How long.
 */
function silentWav(seconds: number): string {
  const rate = 8_000;
  const samples = rate * seconds;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, samples, true);
  new Uint8Array(buf, 44).fill(128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

const audio = vi.mocked(client.briefings.audio);

beforeEach(() => {
  audio.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the brief player', () => {
  it('draws nothing when listening is off or no voice is connected', async () => {
    audio.mockResolvedValue({ status: 'off', reason: 'No voice is connected for this Org.' });
    const screen = await render(<div data-testid="host"><BriefAudioPlayer briefingId={7} /></div>);

    await vi.waitFor(() => expect(audio).toHaveBeenCalledWith({ id: 7 }));

    expect(screen.getByTestId('host').element().textContent).toBe('');
  });

  it('says it is on its way, then becomes a player when the audio is ready', async () => {
    const src = silentWav(4);
    audio.mockResolvedValueOnce({ status: 'pending' }).mockResolvedValue({ status: 'ready', src, durationMs: 134_000, speed: 1, title: 'Your day — Fri, Oct 9' });
    const screen = await render(<BriefAudioPlayer briefingId={7} />);

    await expect.element(screen.getByText('Preparing your brief to listen to…')).toBeVisible();

    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Play', exact: true }).query()).not.toBeNull(), { timeout: 6_000 });

    expect(audio).toHaveBeenCalledTimes(2);
  });

  it('plays and pauses, scrubs, and changes speed 1× → 1.5× → 2× → 1×', async () => {
    const src = silentWav(6);
    audio.mockResolvedValue({ status: 'ready', src, durationMs: 6_000, speed: 1.5, title: 'Your day — Fri, Oct 9' });
    const screen = await render(<BriefAudioPlayer briefingId={7} />);
    const group = screen.getByRole('group', { name: 'Listen to this brief' });

    await expect.element(group).toBeVisible();

    const el = group.element().querySelector('audio')!;

    // The person's starting speed.
    await expect.element(screen.getByRole('button', { name: /Playback speed 1.5×/ })).toBeVisible();

    await vi.waitFor(() => expect(el.playbackRate).toBe(1.5));

    await expect.element(screen.getByTestId('brief-audio-time')).toHaveTextContent('0:00 / 0:06');

    await screen.getByRole('button', { name: /Playback speed/ }).click();

    expect(el.playbackRate).toBe(2);

    await screen.getByRole('button', { name: /Playback speed/ }).click();

    expect(el.playbackRate).toBe(1);

    await screen.getByRole('button', { name: /Playback speed/ }).click();

    expect(el.playbackRate).toBe(1.5);

    el.muted = true;
    await screen.getByRole('button', { name: 'Play', exact: true }).click();

    await expect.element(screen.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

    await screen.getByRole('button', { name: 'Pause', exact: true }).click();

    await expect.element(screen.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

    const seek = screen.getByRole('slider', { name: 'Seek' });
    await userEvent.fill(seek, '3');
    await vi.waitFor(() => expect(Math.round(el.currentTime)).toBe(3));

    await expect.element(screen.getByTestId('brief-audio-time')).toHaveTextContent('0:03 / 0:06');
    expect(el.getAttribute('playsinline')).not.toBeNull();
    expect(el.getAttribute('preload')).toBe('metadata');
  });

  it('opened from an email\'s Listen button, Play has focus', async () => {
    audio.mockResolvedValue({ status: 'ready', src: silentWav(2), durationMs: 2_000, speed: 1, title: 'Your day' });
    const screen = await render(<BriefAudioPlayer briefingId={7} focusPlay />);

    await expect.element(screen.getByRole('button', { name: 'Play', exact: true })).toHaveFocus();
  });

  it('says why when the audio could not be made', async () => {
    audio.mockResolvedValue({ status: 'failed', reason: 'The ElevenLabs account has no characters left this period.' });
    const screen = await render(<BriefAudioPlayer briefingId={7} />);

    await expect.element(screen.getByText(/no characters left/)).toBeVisible();
  });

  it('fits a phone', async () => {
    await page.viewport(390, 844);
    audio.mockResolvedValue({ status: 'ready', src: silentWav(2), durationMs: 134_000, speed: 1, title: 'Your day' });
    const screen = await render(<div style={{ width: 358 }}><BriefAudioPlayer briefingId={7} /></div>);
    const group = screen.getByRole('group', { name: 'Listen to this brief' });

    await expect.element(group).toBeVisible();
    expect(group.element().scrollWidth).toBeLessThanOrEqual(358);

    await page.viewport(1440, 900);
  });
});
