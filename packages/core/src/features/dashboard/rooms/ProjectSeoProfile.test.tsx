import type { SeoProfile } from '@/services/seo/profile';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import '@/styles/global.css';

/**
 * The project page's SEO profile, in the browser: what it shows (the fields,
 * the guidelines as links, what comes first for this client), and an edit a
 * person makes in place — a client type, goals reordered — saved as the
 * profile, with evidence kept only for what they left alone. Fictional client.
 */

const refresh = vi.fn();
vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ refresh }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { ProjectSeoProfile, profileFromDraft } = await import('./ProjectSeoProfile');

const PROFILE: SeoProfile = {
  clientType: 'local_services',
  industry: 'Home services (HVAC)',
  goals: ['google_business_profile', 'organic_leads'],
  locations: ['Springfield', 'Shelbyville'],
  website: 'https://northwind-home.example',
  publishTarget: 'blog',
  guidelines: [{ label: 'Wiki', href: '/dashboard/projects/7#wiki' }],
  evidence: { clientType: 'the home page declares HVACBusiness schema', website: 'the project\'s domain' },
  savedAt: '2026-10-29T10:00:00.000Z',
};
const TARGETS = [{ id: 'blog', line: 'GitHub · northwind/site' }];

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe('the SEO profile on the project page', () => {
  it('shows the fields, the guidelines as links and what comes first', async () => {
    await render(<ProjectSeoProfile projectId={7} profile={PROFILE} targets={TARGETS} />);

    const section = page.getByTestId('project-seo-profile');

    await expect.element(section.getByText('Local services')).toBeInTheDocument();
    await expect.element(section.getByText('1. Google Business Profile  2. Organic leads')).toBeInTheDocument();
    await expect.element(section.getByText('GitHub · northwind/site')).toBeInTheDocument();
    await expect.element(section.getByRole('link', { name: 'Wiki' })).toHaveAttribute('href', '/dashboard/projects/7#wiki');
    await expect.element(page.getByTestId('seo-profile-priorities').getByText(/^Google Business Profile: /)).toBeInTheDocument();
    await expect.element(page.getByTestId('seo-profile-playbooks').getByRole('link', { name: 'Location pages without doorways' })).toHaveAttribute('href', '/dashboard/skills/location-pages-without-doorways');
  });

  it('asks for one when there is none', async () => {
    await render(<ProjectSeoProfile projectId={7} profile={null} targets={[]} />);

    await expect.element(page.getByText(/No SEO profile yet/)).toBeInTheDocument();
  });

  it('saves an edit made in place: a new client type and the goals reordered', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await render(<ProjectSeoProfile projectId={7} profile={PROFILE} targets={TARGETS} />);

    await page.getByRole('button', { name: 'Edit SEO profile' }).click();
    await page.getByRole('combobox', { name: 'Client type' }).selectOptions('b2b_saas');
    await page.getByRole('button', { name: 'Move Organic leads up' }).click();
    await page.getByRole('button', { name: '+ Named in AI answers' }).click();
    await userEvent.fill(page.getByRole('textbox', { name: 'Tone' }), 'plain, direct');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect.poll(() => fetchMock.mock.calls.length).toBe(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('/api/v1/projects/7');
    expect(init.method).toBe('PATCH');

    const sent = JSON.parse(String(init.body)).seoProfile as SeoProfile;

    expect(sent.clientType).toBe('b2b_saas');
    expect(sent.goals).toEqual(['organic_leads', 'google_business_profile', 'ai_answers']);
    expect(sent.tone).toBe('plain, direct');
    // The website was left alone, so where it was read stays; the client type was changed by hand.
    expect(sent.evidence).toEqual({ website: 'the project\'s domain' });
    await expect.poll(() => refresh.mock.calls.length).toBe(1);
  });

  it('reopens from the latest saved profile after a server refresh', async () => {
    const screen = await render(<ProjectSeoProfile projectId={7} profile={PROFILE} targets={TARGETS} />);
    await screen.rerender(<ProjectSeoProfile projectId={7} profile={{ ...PROFILE, tone: 'Newly saved voice' }} targets={TARGETS} />);
    await page.getByRole('button', { name: 'Edit SEO profile' }).click();

    await expect.element(page.getByRole('textbox', { name: 'Tone' })).toHaveValue('Newly saved voice');
  });

  it('keeps approved facts visible until a person explicitly reviews the prepared draft', async () => {
    await render(<ProjectSeoProfile projectId={7} profile={PROFILE} preparedDraft={{ ...PROFILE, industry: 'Proposed new industry' }} targets={TARGETS} />);

    await expect.element(page.getByText('Home services (HVAC)', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('Proposed new industry', { exact: true })).not.toBeInTheDocument();

    await page.getByRole('button', { name: 'Review prepared draft' }).click();

    await expect.element(page.getByRole('textbox', { name: 'Industry' })).toHaveValue('Proposed new industry');

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect.element(page.getByText('Home services (HVAC)', { exact: true })).toBeInTheDocument();
  });

  it('reads guideline lines as label | link', () => {
    const d = { clientType: '' as const, goals: [], industry: '', offering: '', audience: '', locations: 'A, B', language: '', tone: '', competitors: '', website: '', publishTarget: '', guidelines: 'Brand guide | /dashboard/artifacts/12\nno link here' };

    expect(profileFromDraft(d, null)).toMatchObject({ locations: ['A', 'B'], guidelines: [{ label: 'Brand guide', href: '/dashboard/artifacts/12' }] });
  });
});
