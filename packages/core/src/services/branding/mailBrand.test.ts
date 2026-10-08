import { describe, expect, it, vi } from 'vitest';

/**
 * Mail in the Org's brand: a header with its logo over the mail and its name
 * on the deployment's sender — and a mail with no brand goes out as written.
 */

const brands = new Map<string, unknown>();
vi.mock('./OrgBrandService', () => ({
  getOrgBrand: vi.fn(async (accountId: string) => brands.get(accountId) ?? null),
  accountOfWorkspace: vi.fn(async (orgId: string) => (orgId === 'proj-nw' ? 'acct-nw' : null)),
  installAccountId: vi.fn(async () => 'acct-nw'),
}));

const { applyMailBrand, mailHeaderHtml, withSenderName } = await import('./mailBrand');
const { withFields } = await import('@/libs/branding/orgBrand');

const NORTHWIND = withFields(null, { name: 'Northwind', accent: '#0E8C7F', headingFont: null, senderName: 'Northwind Ops', logos: { wordmark: '/api/media/brand/acct-nw/logo-0123456789abcdef.svg' } });
const MAIL = { to: 'ana@northwind.example', subject: 'Your daily report', html: '<p>Hello</p>' };

describe('withSenderName', () => {
  it('puts the brand\'s name on the configured address, and nothing else', () => {
    expect(withSenderName('Vocion <reports@agents.example>', 'Northwind Ops')).toBe('Northwind Ops <reports@agents.example>');
    expect(withSenderName('reports@agents.example', 'Northwind')).toBe('Northwind <reports@agents.example>');
    expect(withSenderName('Vocion <reports@agents.example>', 'Evil <x@y>\r\nBcc: z')).toBe('Evil x@yBcc: z <reports@agents.example>');
  });
});

describe('the header', () => {
  it('is the logo at the server\'s address, as a PNG (mail clients do not draw SVG), over the accent', () => {
    const html = mailHeaderHtml(NORTHWIND, 'https://agents.example');

    expect(html).toContain('src="https://agents.example/api/media/brand/acct-nw/logo-0123456789abcdef.svg?format=png"');
    expect(html).toContain('alt="Northwind"');
    expect(html).toContain('border-bottom:3px solid #0e8c7f');
  });

  it('is the name in text when the server has no public address', () => {
    expect(mailHeaderHtml(NORTHWIND, '')).toContain('>Northwind</span>');
  });
});

describe('applyMailBrand', () => {
  it('brands a workspace\'s mail: header first, the brand\'s name on the deployment\'s sender', async () => {
    brands.set('acct-nw', NORTHWIND);
    const out = await applyMailBrand(MAIL, { orgId: 'proj-nw' }, 'Vocion <reports@agents.example>');

    expect(out.html).toMatch(/^<div data-org-brand-header[^>]*>.*<\/div><p>Hello<\/p>$/);
    expect(out.from).toBe('Northwind Ops <reports@agents.example>');
  });

  it('a workspace\'s own mailbox keeps its own name', async () => {
    brands.set('acct-nw', NORTHWIND);
    const out = await applyMailBrand({ ...MAIL, from: 'Northwind Support <support@agents.example>' }, { orgId: 'proj-nw' }, 'Vocion <reports@agents.example>');

    expect(out.from).toBe('Northwind Support <support@agents.example>');
  });

  it('an Org with no brand: the mail goes out exactly as written', async () => {
    brands.clear();

    expect(await applyMailBrand(MAIL, 'install', 'Vocion <reports@agents.example>')).toEqual(MAIL);
    expect(await applyMailBrand(MAIL, { orgId: 'proj-unknown' }, 'Vocion <reports@agents.example>')).toEqual(MAIL);
  });
});
