import type { PageRow } from '@/libs/workspace/pageFields';
import type { ReleaseLinked } from '@/libs/workspace/releaseFeed';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { ANNOUNCEMENT_PLACEHOLDER } from '@/libs/workspace/releaseFeed';
import { assembleReleaseReport } from '@/services/factory/releaseReport';
import { ReleaseDetailView } from './ReleaseDetailView';
import '@/styles/global.css';

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard/p/releases/197',
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

/**
 * The release page, drawn: its sections in the order a product owner asks
 * them, the way back to Releases rather than to Objects, and the placeholder
 * never on the page. Fictional fixtures (Relay, a Northwind product).
 */

const NOW = new Date('2026-09-28T12:00:00Z');

const LINKED: ReleaseLinked = {
  records: new Map([
    [41, { id: 41, type: 'request', title: 'Uploads that survive a bad connection', meta: { outcome: 'Upload a large file on a phone and have it resume.' } }],
    [52, { id: 52, type: 'engineering_task', title: 'Resumable uploads', meta: { requestId: 41, prUrl: 'https://github.example/northwind/relay/pull/96', verdict: { value: 'approve', proven: 8, total: 8 } } }],
  ]),
  products: new Map([['relay', 'Relay']]),
};

const ROW: PageRow = {
  id: 197,
  title: 'relay 930a23f6ebbd',
  status: 'active',
  createdAt: NOW,
  meta: {
    product: 'relay',
    surfaces: ['api', 'web'],
    version: '930a23f6ebbd',
    url: 'https://relay.example',
    releasedAt: '2026-09-28T08:12:46Z',
    healthAfter: 'ok',
    healthCheckedAt: '2026-09-28T08:12:46Z',
    commits: ['930a23f logic: Uploads that survive a bad connection (#96)', 'afae194 fix(worker): a skipped test (#95)'],
    prUrls: ['https://github.example/northwind/relay/pull/96'],
    taskIds: [52],
    evidence: [{ taskId: 52, requestId: 41, prUrl: 'https://github.example/northwind/relay/pull/96', verdict: 'approve, 8 of 8 proven' }],
    verificationArtifactIds: [1254],
    announcement: ANNOUNCEMENT_PLACEHOLDER,
  },
};

const DETAIL = { kind: 'release' as const, actions: { draft: { label: 'Draft announcement', prompt: 'Draft it.' } } };

describe('the release page, drawn', () => {
  it('reads in the order a product owner asks, with the technical record folded last', async () => {
    const report = assembleReleaseReport(ROW, { linked: LINKED, artifacts: [{ id: 1254, title: 'Uploads · desktop · after', kind: 'link', role: 'qa-screenshot' }], now: NOW, timeZone: 'UTC' });
    const screen = await render(<ReleaseDetailView report={report} recordPage={DETAIL} backHref="/dashboard/p/releases" />);
    const root = screen.container;

    expect(root.querySelector('h1')?.textContent).toBe('Uploads that survive a bad connection');

    const eyebrows = [...root.querySelectorAll('[data-pattern="section"] h3')].map(h => h.textContent);

    expect(eyebrows).toEqual(['Release summary', 'What changed', 'Verification', 'Announcement', 'Included work', 'Activity', 'Technical details']);

    const text = root.textContent ?? '';

    expect(text).toContain('Back to Releases');
    expect(text).not.toContain('Back to Objects');
    expect(text).not.toContain('Release · active');
    expect(text).not.toContain('Other fields');
    expect(text).not.toContain(ANNOUNCEMENT_PLACEHOLDER);
    // The announcement's one move for its state.
    expect(root.querySelector('[data-testid="release-announcement"]')?.getAttribute('data-state')).toBe('not-prepared');
    expect(text).toContain('Draft announcement');
    // Evidence is a labelled link, and it is one click away rather than open.
    expect((root.querySelector('[data-testid="release-technical"]') as HTMLDetailsElement).open).toBe(false);
    expect(root.querySelector('a[href="/dashboard/artifacts/1254"]')?.textContent).toBe('QA screenshot: Uploads · desktop · after');
  });

  it('holds on a phone without a sideways scroll', async () => {
    const report = assembleReleaseReport(ROW, { linked: LINKED, now: NOW, timeZone: 'UTC' });
    await render(<div style={{ width: 390 }}><ReleaseDetailView report={report} recordPage={DETAIL} backHref="/dashboard/p/releases" /></div>);

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  });
});
