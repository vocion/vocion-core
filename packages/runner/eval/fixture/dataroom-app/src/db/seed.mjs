// The seed: one team library at Northwind, another org's library, and enough activity to see.
// Written against migration 3, so it also seeds a database being upgraded from there.
export const USERS = [
  { id: 'u_owner', email: 'olivia@northwind.example', name: 'Olivia Park', prefs: {} },
  { id: 'u_teammate', email: 'tom@northwind.example', name: 'Tom Reyes', prefs: {} },
  { id: 'u_other', email: 'ana@acme.example', name: 'Ana Silva', prefs: {} },
];

export function seed(db) {
  for (const u of USERS) {
    db.insert('users', u);
  }
  db.insert('libraries', { id: 'lib_team', name: 'Northwind Deals', createdAt: '2026-08-01T09:00:00.000Z' });
  db.insert('libraries', { id: 'lib_other', name: 'Acme Board', createdAt: '2026-08-02T09:00:00.000Z' });
  db.insert('memberships', { id: 'm1', libraryId: 'lib_team', userId: 'u_owner', role: 'owner' });
  db.insert('memberships', { id: 'm2', libraryId: 'lib_team', userId: 'u_teammate', role: 'editor' });
  db.insert('memberships', { id: 'm3', libraryId: 'lib_other', userId: 'u_other', role: 'owner' });
  const docs = [
    ['d1', 'Q3 Board Deck', 'application/pdf', 2400000, 18, '2026-09-30T09:00:00.000Z'],
    ['d2', 'Pricing Sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 48000, 1, '2026-10-01T08:00:00.000Z'],
    ['d3', 'Onboarding Guide', 'application/pdf', 980000, 12, '2026-09-12T15:30:00.000Z'],
    ['d4', 'Draft Contract', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 120000, 4, '2026-09-20T11:00:00.000Z'],
    ['d5', 'Product One-Pager', 'application/pdf', 310000, 1, '2026-09-28T10:00:00.000Z'],
  ];
  for (const [id, title, mimeType, sizeBytes, pageCount, uploadedAt] of docs) {
    db.insert('documents', { id, libraryId: 'lib_team', ownerId: 'u_owner', title, mimeType, sizeBytes, pageCount, uploadedAt });
  }
  db.insert('documents', { id: 'd6', libraryId: 'lib_other', ownerId: 'u_other', title: 'Private Notes', mimeType: 'application/pdf', sizeBytes: 52000, pageCount: 2, uploadedAt: '2026-09-29T10:00:00.000Z' });
  db.insert('links', { id: 'l1', docId: 'd1', recipientEmail: 'cfo@kestrel.example', createdBy: 'u_owner', createdAt: '2026-09-30T09:30:00.000Z' });
  db.insert('links', { id: 'l2', docId: 'd1', recipientEmail: 'board@kestrel.example', createdBy: 'u_owner', createdAt: '2026-09-30T09:35:00.000Z' });
  db.insert('links', { id: 'l3', docId: 'd3', recipientEmail: 'new.hire@northwind.example', createdBy: 'u_owner', createdAt: '2026-09-13T09:00:00.000Z' });
  db.insert('links', { id: 'l4', docId: 'd4', recipientEmail: 'legal@contoso.example', createdBy: 'u_owner', createdAt: '2026-09-20T12:00:00.000Z' });
  db.insert('links', { id: 'l5', docId: 'd6', recipientEmail: 'investor@contoso.example', createdBy: 'u_other', createdAt: '2026-09-29T11:00:00.000Z' });
  const views = [
    ['v1', 'l1', 'd1', 'cfo@kestrel.example', '2026-09-30T10:00:00.000Z', 'Mozilla/5.0 (Macintosh) Safari/605.1'],
    ['v2', 'l1', 'd1', 'cfo@kestrel.example', '2026-10-01T08:15:00.000Z', 'Mozilla/5.0 (Macintosh) Safari/605.1'],
    ['v3', 'l3', 'd3', 'new.hire@northwind.example', '2026-09-14T10:00:00.000Z', 'Mozilla/5.0 (Windows NT 10.0) Chrome/128.0'],
    ['v4', 'l3', 'd3', 'new.hire@northwind.example', '2026-09-20T16:45:00.000Z', 'Mozilla/5.0 (Windows NT 10.0) Chrome/128.0'],
    ['v5', 'l5', 'd6', 'investor@contoso.example', '2026-09-30T09:00:00.000Z', 'Mozilla/5.0 (X11; Linux) Firefox/131.0'],
  ];
  for (const [id, linkId, docId, viewerEmail, at, userAgent] of views) {
    db.insert('views', { id, linkId, docId, viewerEmail, userId: null, at, userAgent });
  }
  db.insert('audit', { id: 'a1', at: '2026-09-30T09:30:00.000Z', actorId: 'u_owner', action: 'link.created', targetId: 'l1', detail: { docId: 'd1', recipientEmail: 'cfo@kestrel.example' } });
  db.insert('audit', { id: 'a2', at: '2026-09-30T09:35:00.000Z', actorId: 'u_owner', action: 'link.created', targetId: 'l2', detail: { docId: 'd1', recipientEmail: 'board@kestrel.example' } });
  db.insert('outbox', { id: 'o1', type: 'reminder', to: 'legal@contoso.example', subject: 'Reminder: Olivia Park shared "Draft Contract" with you', body: 'x', at: '2026-09-23T12:00:00.000Z', key: 'reminder:l4:2026-09-23' });
}
