import type { OpeningHint } from '@/libs/chat/openingHints';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * The opening hint by the composer (founder, 2026-10-09): one quiet chip, two
 * at most; clicking starts the flow; × puts it away; "Why this?" on a long press.
 */

const hintEvent = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const push = vi.hoisted(() => vi.fn());
vi.mock('@/libs/Orpc', () => ({ client: { chat: { hintEvent } } }));
vi.mock('@/libs/I18nNavigation', () => ({ useRouter: () => ({ push }) }));

const { OpeningHints } = await import('./OpeningHints');

const reconnect: OpeningHint = { key: 'connector:crm', type: 'connector', label: 'Reconnect HubSpot — the Revenue lead couldn\'t read deals today →', reason: 'The HubSpot connection stopped working.', score: 106, action: { kind: 'open', href: '/dashboard/chat?objective=connect-systems&named=crm' } };
const tour: OpeningHint = { key: 'capability', type: 'capability', label: 'What can the team do? →', reason: 'A short tour.', score: 95, action: { kind: 'send', prompt: 'What can you do?' } };

beforeEach(() => {
  hintEvent.mockClear();
  push.mockClear();
});

describe('OpeningHints', () => {
  it('shows the ranked chips, records that they were shown, and a click starts the flow', async () => {
    const onSend = vi.fn();
    await render(<OpeningHints hints={[reconnect, tour]} onSend={onSend} />);

    expect(page.getByTestId('opening-hint').elements()).toHaveLength(2);

    await vi.waitFor(() => expect(hintEvent).toHaveBeenCalledWith({ event: 'shown', hints: [{ key: 'connector:crm', type: 'connector', score: 106, rank: 1 }, { key: 'capability', type: 'capability', score: 95, rank: 2 }] }));

    await page.getByRole('button', { name: /^What can the team do\?/ }).click();

    expect(onSend).toHaveBeenCalledWith('What can you do?');
    expect(hintEvent).toHaveBeenCalledWith({ event: 'clicked', hints: [{ key: 'capability', type: 'capability', score: 95, rank: 2 }] });

    await page.getByRole('button', { name: /^Reconnect HubSpot/ }).click();

    expect(push).toHaveBeenCalledWith('/dashboard/chat?objective=connect-systems&named=crm');
  });

  it('puts a hint away with ×, and says so', async () => {
    await render(<OpeningHints hints={[reconnect]} onSend={() => {}} />);
    await page.getByRole('button', { name: /Not now: Reconnect HubSpot/ }).click();

    expect(page.getByTestId('opening-hint').elements()).toHaveLength(0);
    expect(hintEvent).toHaveBeenCalledWith({ event: 'dismissed', hints: [{ key: 'connector:crm', type: 'connector', score: 106, rank: 1 }] });
  });

  it('shows "Why this?" on a long press, without starting the flow', async () => {
    const onSend = vi.fn();
    await render(<OpeningHints hints={[tour]} onSend={onSend} />);
    const chip = page.getByRole('button', { name: /^What can the team do\?/ }).element() as HTMLElement;
    chip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));

    await expect.element(page.getByTestId('opening-hint-why')).toHaveTextContent('Why this? A short tour.');

    chip.click();

    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows nothing with nothing to say', async () => {
    await render(<OpeningHints hints={[]} onSend={() => {}} />);

    expect(page.getByTestId('opening-hints').elements()).toHaveLength(0);
    expect(hintEvent).not.toHaveBeenCalled();
  });
});
