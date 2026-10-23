// The seed data. Every call returns a fresh copy, so a test can change it freely.

export const NOW = '2026-10-01T12:00:00.000Z';

const DATA = {
  now: NOW,
  users: [
    { id: 'u_owner', name: 'Owner', email: 'owner@northwind.example' },
    { id: 'u_teammate', name: 'Teammate', email: 'teammate@northwind.example' },
    { id: 'u_other', name: 'Other', email: 'other@acme.example' },
  ],
  libraries: [
    { id: 'lib_team', name: 'Northwind', members: ['u_owner', 'u_teammate'] },
    { id: 'lib_other', name: 'Acme', members: ['u_other'] },
  ],
  documents: [
    { id: 'd1', libraryId: 'lib_team', ownerId: 'u_owner', title: 'Q3 Board Deck', mimeType: 'application/pdf', sizeBytes: 2400000, pageCount: 18, uploadedAt: '2026-09-30T09:00:00.000Z' },
    { id: 'd2', libraryId: 'lib_team', ownerId: 'u_owner', title: 'Pricing Sheet', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: 48000, pageCount: 1, uploadedAt: '2026-10-01T08:00:00.000Z' },
    { id: 'd3', libraryId: 'lib_team', ownerId: 'u_owner', title: 'Onboarding Guide', mimeType: 'application/pdf', sizeBytes: 980000, pageCount: 12, uploadedAt: '2026-09-12T15:30:00.000Z' },
    { id: 'd4', libraryId: 'lib_team', ownerId: 'u_owner', title: 'Draft Contract', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 120000, pageCount: 4, uploadedAt: '2026-09-20T11:00:00.000Z' },
    { id: 'd5', libraryId: 'lib_team', ownerId: 'u_owner', title: 'Product One-Pager', mimeType: 'application/pdf', sizeBytes: 310000, pageCount: 1, uploadedAt: '2026-09-28T10:00:00.000Z' },
    { id: 'd6', libraryId: 'lib_other', ownerId: 'u_other', title: 'Private Notes', mimeType: 'application/pdf', sizeBytes: 52000, pageCount: 2, uploadedAt: '2026-09-29T10:00:00.000Z' },
  ],
  links: [
    { id: 'l1', docId: 'd1', recipientEmail: 'cfo@kestrel.example', createdBy: 'u_owner', createdAt: '2026-09-30T09:30:00.000Z' },
    { id: 'l2', docId: 'd1', recipientEmail: 'board@kestrel.example', createdBy: 'u_owner', createdAt: '2026-09-30T09:35:00.000Z' },
    { id: 'l3', docId: 'd3', recipientEmail: 'new.hire@northwind.example', createdBy: 'u_owner', createdAt: '2026-09-13T09:00:00.000Z' },
    { id: 'l4', docId: 'd4', recipientEmail: 'legal@contoso.example', createdBy: 'u_owner', createdAt: '2026-09-20T12:00:00.000Z' },
  ],
  // One row per open. viewerId is a user id for a signed-in person, or `v:<email>` for a visitor.
  views: [
    { docId: 'd1', linkId: null, viewerId: 'u_owner', at: '2026-09-30T10:00:00.000Z' },
    { docId: 'd1', linkId: 'l1', viewerId: 'v:cfo@kestrel.example', at: '2026-09-30T15:00:00.000Z' },
    { docId: 'd1', linkId: 'l1', viewerId: 'v:cfo@kestrel.example', at: '2026-10-01T09:00:00.000Z' },
    { docId: 'd1', linkId: 'l2', viewerId: 'v:board@kestrel.example', at: '2026-10-01T10:00:00.000Z' },
    { docId: 'd2', linkId: null, viewerId: 'u_teammate', at: '2026-10-01T09:30:00.000Z' },
    { docId: 'd3', linkId: 'l3', viewerId: 'v:new.hire@northwind.example', at: '2026-09-25T08:00:00.000Z' },
    { docId: 'd4', linkId: 'l4', viewerId: 'u_owner', at: '2026-09-21T09:00:00.000Z' },
  ],
};

export function seed() {
  return structuredClone(DATA);
}
