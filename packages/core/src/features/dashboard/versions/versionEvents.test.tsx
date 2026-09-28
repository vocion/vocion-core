import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';

/**
 * A new version on the screen that shows it (backlog 035): the page or pane
 * showing a ref refetches when — and only when — a version of THAT ref is
 * written, the regions that changed are marked from the before/after, and
 * the mark fades, or is a still outline when the person asked for reduced
 * motion. Fixture data only.
 */

const refresh = vi.fn();
const get = vi.fn();

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh }),
  usePathname: () => '/dashboard/objects/41',
}));
vi.mock('@/libs/Orpc', () => ({ client: { preview: { get: (...args: unknown[]) => get(...args) } } }));

const { announceVersionWritten, changedSections, markChanged, MARK_MS, snapshotSections, versionMatches } = await import('./versionEvents');
const { VersionWatch } = await import('./VersionWatch');
const { PreviewPane } = await import('@/features/preview/PreviewPane');

beforeEach(() => {
  refresh.mockReset();
  get.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('which surfaces a version is for', () => {
  it('matches a record by id whether the page calls it object or request, an artifact by id or by its body', () => {
    const v = { ref: { type: 'object' as const, id: '41' }, artifactId: 7, from: 2, to: 3 };

    expect(versionMatches(v, [{ type: 'object', id: '41' }])).toBe(true);
    expect(versionMatches(v, [{ type: 'request', id: '41' }])).toBe(true);
    expect(versionMatches(v, [{ type: 'record_history', id: '41@2' }])).toBe(true);
    expect(versionMatches(v, [{ type: 'artifact', id: '7' }])).toBe(true);
    expect(versionMatches(v, [{ type: 'object', id: '42' }])).toBe(false);
    expect(versionMatches(v, [{ type: 'artifact', id: '8' }])).toBe(false);
  });
});

describe('a page refetches for its own ref only', () => {
  it('refreshes the server page on a version of its record, not on another record\'s', async () => {
    await render(<VersionWatch refs={[{ type: 'object', id: '41' }]} />);

    announceVersionWritten({ ref: { type: 'object', id: '42' }, from: 1, to: 2 });

    expect(refresh).not.toHaveBeenCalled();

    announceVersionWritten({ ref: { type: 'object', id: '41' }, from: 1, to: 2, fields: ['acceptance'] });

    await expect.poll(() => refresh.mock.calls.length).toBe(1);
  });

  it('the preview pane refetches its record in place and keeps it on screen meanwhile', async () => {
    get.mockResolvedValueOnce({ ref: { type: 'object', id: '41' }, title: 'Export the ledger as CSV', sourceLabel: 'Request', body: '- Existing exports keep working' });
    const screen = await render(<PreviewPane recordRef={{ type: 'object', id: '41' }} />);

    await expect.element(screen.getByText('Existing exports keep working')).toBeInTheDocument();

    get.mockResolvedValueOnce({ ref: { type: 'object', id: '41' }, title: 'Export the ledger as CSV', sourceLabel: 'Request', body: '- Existing PDF exports still download' });
    announceVersionWritten({ ref: { type: 'object', id: '99' }, from: 1, to: 2 });
    announceVersionWritten({ ref: { type: 'object', id: '41' }, from: 1, to: 2 });

    await expect.element(screen.getByText('Existing PDF exports still download')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    // The new line is the one marked.
    await expect.poll(() => document.querySelector('[data-version-changed]')?.textContent).toBe('Existing PDF exports still download');
  });
});

describe('marking what changed', () => {
  function page(acceptance: string, priority: string) {
    document.body.innerHTML = `
      <div id="root">
        <section data-record-field="story"><p>Every month end someone copies the ledger.</p></section>
        <section data-record-field="acceptance"><ul><li>${acceptance}</li></ul></section>
        <div data-version-section="priority">${priority}</div>
      </div>`;
    return document.getElementById('root')!;
  }

  it('marks the regions whose words changed, and the fields the write named', () => {
    const before = snapshotSections(page('Existing exports keep working', '70'));
    const root = page('Existing PDF exports still download', '70');

    expect(changedSections(root, before).map(el => el.dataset.recordField ?? el.dataset.versionSection)).toEqual(['acceptance']);
    expect(changedSections(root, before, ['priority']).map(el => el.dataset.recordField ?? el.dataset.versionSection)).toEqual(['acceptance', 'priority']);
  });

  it('marks the innermost region, not the page around it', () => {
    document.body.innerHTML = '<div id="root"><section id="report-story"><div data-record-field="acceptance"><p>old</p></div></section></div>';
    const before = snapshotSections(document.getElementById('root'));
    document.querySelector('[data-record-field] p')!.textContent = 'new';

    expect(changedSections(document.getElementById('root'), before).map(el => el.dataset.recordField)).toEqual(['acceptance']);
  });

  it('fades the mark and removes it after two seconds', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    markChanged([el], { reducedMotion: false });

    expect(el.dataset.versionChanged).toBe('fade');

    vi.advanceTimersByTime(MARK_MS);

    expect(el.dataset.versionChanged).toBeUndefined();
  });

  it('honours reduced motion: a still outline, from the media query, no fade', () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(q => ({ matches: q.includes('reduce'), media: q } as MediaQueryList));
    const el = document.createElement('div');
    document.body.append(el);
    markChanged([el]);

    expect(el.dataset.versionChanged).toBe('still');

    matchMedia.mockRestore();
  });
});
