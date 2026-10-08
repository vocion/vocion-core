import type { OrgBrandFields, OrgBrandView } from '@/libs/branding/orgBrand';
import { previewViewOf } from '@/libs/branding/orgBrand';

/**
 * Northwind's brand for stories and browser tests — a fictional company from
 * the fixture cast (`libs/fixtures/realDataGuard.ts`), the same art as
 * `libs/branding/__fixtures__/northwind/brand/`, inlined as data URIs so a
 * story needs no server.
 */

const svg = (body: string, viewBox: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`)}`;
const N = '<rect width="64" height="64" rx="14" fill="#0E8C7F"/><path d="M18 46V18l28 28V18" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>';
const word = (fill: string) => `${N}<text x="78" y="44" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="700" fill="${fill}" letter-spacing="-0.5">Northwind</text>`;

export const NORTHWIND_FIELDS: OrgBrandFields = {
  name: 'Northwind',
  accent: '#0e8c7f',
  headingFont: 'Space Grotesk',
  senderName: 'Northwind Ops',
  logos: {
    wordmark: svg(word('#12355B'), '0 0 248 64'),
    wordmarkOnDark: svg(word('#F4EFE6'), '0 0 248 64'),
    mark: svg(N, '0 0 64 64'),
  },
  website: 'https://northwind.example',
};

export const NORTHWIND_VIEW: OrgBrandView = previewViewOf(NORTHWIND_FIELDS);
