import type { OpeningHint } from '@/libs/chat/openingHints';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * The opening hint by the composer (founder, 2026-10-09): one quiet pill, three
 * at most, wrapping and never truncated; clicking starts the flow; × puts it away; "Why this?" on a long press.
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
  it('shows up to three pills, wrapping on a phone, never cut off, each a 44px target', async () => {
    await page.viewport(390, 844);
    const brief: OpeningHint = { key: 'briefing', type: 'next', label: 'What needs my attention today across Northwind and Kestrel? →', reason: 'A new briefing came in this week.', score: 95, action: { kind: 'send', prompt: 'Walk me through the latest briefing' } };
    await render(<OpeningHints hints={[reconnect, tour, brief]} onSend={vi.fn()} />);

    expect(page.getByTestId('opening-hint').elements()).toHaveLength(3);

    for (const label of page.getByTestId('opening-hint-label').elements()) {
      // Never clipped: the words take the lines they need.
      expect(label.scrollHeight).toBeLessThanOrEqual(label.clientHeight + 1);
      expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(390);
    }
    for (const button of page.getByTestId('opening-hint').elements().map(el => el.querySelector('button')!)) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }

    await page.viewport(1280, 800);
  });

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
