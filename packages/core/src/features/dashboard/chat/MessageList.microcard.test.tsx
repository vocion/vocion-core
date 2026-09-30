import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import messages from '@/locales/en.json';

/**
 * A turn that filed or changed a record ends with ONE line per record — the
 * microcard — on the newest turn only, in place of that record's plain
 * follow chip (Chris, 2026-09-30). Fixtures are fictional.
 */

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/chat',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/libs/Orpc', () => ({ client: { preview: { status: async () => ({}) } } }));

const { MessageList } = await import('./MessageList');

const record = { id: 265, title: 'Fix the header overflow', href: '/dashboard/p/feature/265', filed: false, change: { fields: ['acceptance'], version: 3, historyRef: '265@3' }, hasStatus: false };
// The same record, also a follow chip off the update the turn made.
const runs = [{ type: 'tool' as const, name: 'update_object', input: { object_type: 'request', id: 265 }, output: 'request #265 "Fix the header overflow" updated: acceptance', state: 'done' as const }];

let threadRecords: unknown[] = [];
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  // The thread's records, and no live status (the record has none to read).
  fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => (String(url).includes('/records') ? { records: threadRecords } : {}) }) as Response);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

async function draw(msgs: Parameters<typeof MessageList>[0]['messages'], conversationId: number | null = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MessageList messages={msgs} agentName="Northwind Factory" conversationId={conversationId} />
    </NextIntlClientProvider>,
  );
}

describe('record microcards under the newest turn', () => {
  it('shows the record the thread filed on a later turn that filed nothing, and again after a reload (#269, "Stuck?")', async () => {
    threadRecords = [{ id: 269, title: 'Fix the header overflow', href: '/dashboard/p/feature/269', filed: true, change: null, hasStatus: false }];
    const transcript = [
      { role: 'user' as const, content: 'the header overflows on a phone' },
      { role: 'assistant' as const, content: 'Filed #269.' },
      { role: 'user' as const, content: 'Stuck?' },
      { role: 'assistant' as const, content: 'Planning is under way.' },
    ];
    const first = await draw(transcript, 812);

    await expect.poll(() => first.container.querySelector('[data-record-id="269"]')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/conversations/812/records', expect.objectContaining({ credentials: 'same-origin' }));
    // Only under the newest turn.
    expect(first.container.querySelectorAll('[data-testid="record-microcard"]')).toHaveLength(1);

    await first.unmount();
    // A reload: the same transcript from storage, no live events at all.
    const again = await draw(transcript, 812);

    await expect.poll(() => again.container.querySelector('[data-record-id="269"]')?.textContent).toContain('Fix the header overflow');

    threadRecords = [];
  });

  it('draws one microcard per record on the newest turn, in place of its follow chip', async () => {
    const { container } = await draw([
      { role: 'user', content: 'tighten the acceptance on #265' },
      { role: 'assistant', content: 'Changed the acceptance on #265.', runs, records: [record] },
    ]);

    await expect.poll(() => container.querySelectorAll('[data-testid="record-microcard"]').length).toBe(1);
    expect(container.querySelector('[data-testid="record-microcard-change"]')?.textContent).toContain('Changed acceptance · v3');
    expect(container.querySelector('[data-follow-chip="object:265"]')).toBeNull();
  });

  it('leaves an older turn with its plain chip and no microcard', async () => {
    const { container } = await draw([
      { role: 'user', content: 'tighten the acceptance on #265' },
      { role: 'assistant', content: 'Changed the acceptance on #265.', runs, records: [record] },
      { role: 'user', content: 'thanks' },
      { role: 'assistant', content: 'Anytime.' },
    ]);

    await expect.poll(() => container.querySelector('[data-follow-chip="object:265"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="record-microcard"]')).toHaveLength(0);
  });
});
