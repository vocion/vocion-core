import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

import en from '@/locales/en.json';
import '@/styles/global.css';

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/chat',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { HitlGate } = await import('./HitlGate');
const { MessageList } = await import('./MessageList');

/**
 * WHERE the approval gate is drawn.
 *
 * It used to render between the transcript and the composer — a strip pinned
 * to the bottom of the pane, detached from the turn that raised it. Chris,
 * 2026-09-24: *"refactor those to show inline instead of sticky to the compose
 * bar"*. It is now a transcript block, so this measures the two things that
 * makes true: it scrolls with the conversation, and it takes the message
 * column's own width rather than centring itself a second time.
 * @param ui - The tree under test.
 */
function wrap(ui: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>;
}

const MESSAGES = [
  { role: 'user' as const, content: 'Rename the product.' },
  { role: 'assistant' as const, content: 'That touches billing copy. Approve?' },
];

const GATE = { name: 'rename_product', question: 'Rename the product everywhere a customer sees it?' };

/**
 * The transcript, with the gate passed as a block pinned past the last message.
 */
async function draw() {
  return render(wrap(
    <div style={{ height: '600px', display: 'flex', flexDirection: 'column' }}>
      <MessageList
        messages={MESSAGES}
        agentName="Squatch Factory"
        blocks={[{
          key: 'hitl-gate',
          afterIndex: MESSAGES.length,
          node: <HitlGate gate={GATE} onApprove={() => {}} onReject={() => {}} />,
        }]}
      />
    </div>,
  ));
}

describe('the approval gate, in the transcript', () => {
  it('scrolls with the conversation instead of sitting outside it', async () => {
    await page.viewport(900, 600);
    await draw();

    const gate = document.querySelector('[data-testid="hitl-gate"]')!;
    // The transcript is the scrolling element; a gate pinned above the
    // composer was a SIBLING of it and stayed put while the reason for the
    // question scrolled away.
    const scroller = [...document.querySelectorAll('div')]
      .find(el => getComputedStyle(el).overflowY === 'auto');

    expect(gate).not.toBeNull();
    expect(scroller).toBeDefined();
    expect(scroller!.contains(gate)).toBe(true);
  });

  it('takes the message column width, and does not centre itself again', async () => {
    await page.viewport(900, 600);
    await draw();

    const gate = document.querySelector('[data-testid="hitl-gate"]') as HTMLElement;
    const column = gate.parentElement!.parentElement!;
    // The CARD, not the wrapper. The old `mx-auto max-w-3xl px-6` left the
    // wrapper exactly as wide as the column it was already inside — so a
    // wrapper-width assertion passes either way — and inset the card by 24px
    // a side, which is the part a reader actually sees as misaligned.
    const card = gate.firstElementChild as HTMLElement;

    expect(Math.round(card.getBoundingClientRect().width))
      .toBe(Math.round(column.getBoundingClientRect().width));
  });

  it('comes after the turn that raised it', async () => {
    await page.viewport(900, 600);
    await draw();

    const gate = document.querySelector('[data-testid="hitl-gate"]')!;
    const answer = [...document.querySelectorAll('*')]
      .reverse()
      .find(el => el.textContent?.trim() === 'That touches billing copy. Approve?')!;

    expect(answer.compareDocumentPosition(gate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
