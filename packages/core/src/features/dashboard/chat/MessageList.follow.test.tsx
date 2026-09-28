import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import messages from '@/locales/en.json';
import '@/styles/global.css';

/**
 * A pinned transcript follows its bottom whatever made it grow. On
 * 2026-09-25 (prod, iPhone width) a card landed, loaded its status after it
 * mounted, and stayed half under the composer: only a change in `messages`
 * could scroll the view. Fixtures are fictional.
 */

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/chat',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));

const { MessageList } = await import('./MessageList');

/** A block that is short when it mounts and tall a moment later — a card whose status arrived. */
function GrowsLater() {
  const [tall, setTall] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTall(true), 150);
    return () => clearTimeout(t);
  }, []);
  return <div data-testid="grows" style={{ height: tall ? 900 : 40 }}>Approve the Kestrel upload fix</div>;
}

describe('the transcript follows its bottom', () => {
  it('keeps a pinned view at the bottom when content grows without a new message', async () => {
    const { container } = await render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <div style={{ height: 400, display: 'flex', flexDirection: 'column' }}>
          <MessageList messages={[]} agentName="Squatch Factory" blocks={[{ key: 'card', afterIndex: 0, node: <GrowsLater /> }]} />
        </div>
      </NextIntlClientProvider>,
    );
    const scroller = container.querySelector('.overflow-y-auto') as HTMLDivElement;

    await expect.poll(() => (container.querySelector('[data-testid="grows"]') as HTMLElement | null)?.offsetHeight).toBe(900);
    await expect.poll(() => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight).toBeLessThan(2);
  });
});
