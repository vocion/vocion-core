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

const undoAction = vi.fn(async (_input: { id: number }) => ({ ok: true, status: 'undone' }));
vi.mock('@/libs/Orpc', () => ({
  client: { review: { undoAction: (input: { id: number }) => undoAction(input) } },
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
    const report = assembleReleaseReport(ROW, { linked: LINKED, artifacts: [{ id: 1254, title: 'Uploads · desktop · after', kind: 'link', role: 'qa-screenshot', url: 'https://files.example/qa/uploads-after.png', md: null }], now: NOW, timeZone: 'UTC' });
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

  it('shows each criterion with its proof under the summary line, and notes written for a person', async () => {
    const shot = 'https://files.example/qa/relay/resume-banner-desktop-after.png';
    const contract = ['A banner reads "Resuming upload" while it picks up.', 'A dropped upload resumes from the last acknowledged chunk.'];
    const linked: ReleaseLinked = {
      records: new Map([
        [41, { id: 41, type: 'request', title: 'Uploads that survive a bad connection', meta: { acceptance: contract.map(statement => ({ statement })) } }],
        [52, { id: 52, type: 'engineering_task', title: 'Resumable uploads', meta: { requestId: 41, prUrl: 'https://github.example/northwind/relay/pull/96', acceptanceContract: contract, verdict: { value: 'approve', criteria: [
          { criterion: contract[0], status: 'proven', evidence: `Screenshot shows the banner. ${shot}` },
          { criterion: contract[1], status: 'proven', evidence: 'Named test \'resume: acknowledged chunk\' passed. https://app.example/dashboard/artifacts/1302' },
        ] } } }],
      ]),
      products: new Map([['relay', 'Relay']]),
    };
    const artifacts = [
      { id: 1298, title: 'Resume banner · desktop · before', kind: 'markdown', role: 'qa-screenshot', url: null, md: 'Nothing to compare' },
      { id: 1299, title: 'Resume banner · desktop · after', kind: 'link', role: 'qa-screenshot', url: `${shot}?sig=a`, md: null },
      { id: 1302, title: 'Named tests, run 77', kind: 'markdown', role: 'qa-test-run', url: null, md: `# Named tests\n\n## Passed: ${contract[1]}\n\n\`-t "resume: acknowledged chunk"\`\n` },
    ];
    const row = { ...ROW, meta: { ...ROW.meta, verificationArtifactIds: [1298, 1299, 1302], notes: '- Upload a large file on a phone and have it resume.\n- Internal: the worker reports skipped tests as skipped.', notesSource: 'agent' } };
    const report = assembleReleaseReport(row, { linked, artifacts, now: NOW, timeZone: 'UTC' });
    const screen = await render(<ReleaseDetailView report={report} recordPage={DETAIL} backHref="/dashboard/p/releases" />);
    const root = screen.container;
    const verification = root.querySelector('[data-testid="release-check-feature-acceptance"]')!;

    expect(verification.textContent).toContain('QA approved, 2 of 2 criteria proven');

    const rows = [...verification.querySelectorAll('[data-testid="release-proof-row"]')];

    expect(rows.map(r => [r.getAttribute('data-state'), r.getAttribute('data-kind')])).toEqual([['passed', 'screenshot'], ['passed', 'test']]);
    // The after shot, drawn, opening its artifact; the before one click away.
    expect(rows[0]!.querySelector('img')?.getAttribute('src')).toBe(`${shot}?sig=a`);
    expect(rows[0]!.querySelector('img')?.closest('a')?.getAttribute('href')).toBe('/dashboard/artifacts/1299');
    expect(rows[0]!.querySelector('a[href="/dashboard/artifacts/1298"]')?.textContent).toBe('Before: not captured');
    // The named test by name, opening the stored run at its section.
    expect(rows[1]!.querySelector('a')?.textContent).toBe('Named test “resume: acknowledged chunk” passed');
    expect(rows[1]!.querySelector('a')?.getAttribute('href')).toBe('/dashboard/artifacts/1302#passed-a-dropped-upload-resumes-from-the-last-acknowledged-chunk');

    // Notes for a person, not commit subjects.
    const notes = root.querySelector('[data-testid="release-notes"]')!;

    expect(notes.getAttribute('data-source')).toBe('agent');
    expect(notes.textContent).toContain('Upload a large file on a phone and have it resume.');
    expect(notes.textContent).not.toMatch(/logic:|\(#96\)/);
    // No native tooltips (the Tooltip component, never `title=`).
    expect(root.querySelector('[data-testid="release-proof"] [title]')).toBeNull();
  });

  it('holds on a phone without a sideways scroll', async () => {
    const report = assembleReleaseReport(ROW, { linked: LINKED, now: NOW, timeZone: 'UTC' });
    await render(<div style={{ width: 390 }}><ReleaseDetailView report={report} recordPage={DETAIL} backHref="/dashboard/p/releases" /></div>);

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  });

  describe('the announcement publishes in one press, with its picture', () => {
    const LIVE = { id: 1301, title: 'Resume banner · desktop · live', kind: 'file', role: 'live-screenshot', url: '/api/artifacts/1301', md: null };
    const approved = (extra: Record<string, unknown> = {}): PageRow => ({ ...ROW, meta: { ...ROW.meta, announcement: 'Uploads now pick up where they stopped.', notesSource: 'human', announcementImageArtifactId: 1301, ...extra } });

    it('leads with the live picture, and posts to Slack when the workspace has a connection', async () => {
      const report = assembleReleaseReport(approved(), { linked: LINKED, artifacts: [LIVE], now: NOW, timeZone: 'UTC', announceMode: 'slack' });
      const screen = await render(<ReleaseDetailView report={report} recordPage={DETAIL} backHref="/dashboard/p/releases" />);
      const section = screen.container.querySelector('[data-testid="release-announcement"]')!;

      // The picture comes before the words.
      expect(section.firstElementChild?.nextElementSibling?.querySelector('img')?.getAttribute('src')).toBe('/api/artifacts/1301');
      expect(section.querySelector('[data-testid="release-announce-publish"]')?.getAttribute('data-mode')).toBe('slack');
      expect(section.querySelector('[data-testid="release-announce-slack"]')?.textContent).toContain('Post to Slack');
      expect(section.querySelector('[data-testid="release-announce-copy"]')).toBeNull();
    });

    it('copies with the picture and offers it as a download when there is no Slack connection', async () => {
      const report = assembleReleaseReport(approved(), { linked: LINKED, artifacts: [LIVE], now: NOW, timeZone: 'UTC' });
      const screen = await render(<ReleaseDetailView report={report} recordPage={DETAIL} backHref="/dashboard/p/releases" />);
      const section = screen.container.querySelector('[data-testid="release-announcement"]')!;

      expect(section.querySelector('[data-testid="release-announce-copy"]')?.textContent).toContain('Copy with picture');
      expect(section.querySelector('[data-testid="release-announce-download"]')?.getAttribute('href')).toBe('/api/artifacts/1301');
      expect(section.querySelector('[data-testid="release-announce-download"]')?.getAttribute('download')).toBe('uploads-that-survive-a-bad-connection.png');
    });

    it('says why the last post failed, and offers Undo on a post a press made', async () => {
      const failed = assembleReleaseReport(approved({ announceFailure: { at: '2026-09-28T09:00:00Z', error: 'Slack refused the post: channel_not_found.' } }), { linked: LINKED, artifacts: [LIVE], now: NOW, timeZone: 'UTC', announceMode: 'slack' });
      const one = await render(<ReleaseDetailView report={failed} recordPage={DETAIL} backHref="/dashboard/p/releases" />);

      expect(one.container.querySelector('[data-testid="release-announcement-failure"]')?.textContent).toContain('channel_not_found');

      one.unmount();
      const published = assembleReleaseReport(approved({ announcedAt: '2026-09-28T10:00:00Z', announcedTo: { channels: ['Slack'], post: { surface: 'slack', channelId: 'C0NW', ts: null, fileIds: ['F1'], media: 'uploaded', runId: 88 } } }), { linked: LINKED, artifacts: [LIVE], now: NOW, timeZone: 'UTC', announceMode: 'slack' });
      const two = await render(<ReleaseDetailView report={published} recordPage={DETAIL} backHref="/dashboard/p/releases" />);

      expect(two.container.querySelector('[data-testid="release-announce-slack"]')).toBeNull();
      expect(two.container.textContent).toContain('Published Mon, Sep 28, 2026, 10:00 AM UTC to Slack');

      (two.container.querySelector('[data-testid="release-announce-undo"]') as HTMLButtonElement).click();

      await expect.poll(() => undoAction.mock.calls.length).toBe(1);

      expect(undoAction.mock.calls[0]![0]).toEqual({ id: 88 });
    });
  });
});
