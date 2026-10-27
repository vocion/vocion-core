/**
 * THE PRACTICE SITE: a supplier portal with no API, served inside the
 * browser itself, so a browser run can be shown and tested end to end on any
 * installation without reaching anyone's real system.
 *
 * Fernhill Supply's portal is the shape of the work browser runs are for: a
 * sign-in, a cookie banner in the way, an invoice list with a filter, an
 * invoice page, and a payment-details form whose Save changes the vendor's
 * records — the step a run stops on for the person's approval.
 *
 * It never touches the network. The browser's request guard answers every
 * request to `PRACTICE_ORIGIN` from here (`browserEngine.ts`), so the site
 * exists only inside a browser run's own context; its "server" is the page's
 * localStorage, which is why a second run in the same browser is still
 * signed in. Fictional data, fixed, so a test can assert on it.
 */

import { PRACTICE_BLOG_ORIGIN, practiceBlogResponse } from './practiceBlog';
import { PRACTICE_CONSOLE_ORIGIN, practiceConsoleResponse } from './practiceConsole';

export const PRACTICE_ORIGIN = 'https://portal.fernhill-supply.test';

/** The practice site's sign-in. Shown in the example task; it opens nothing real. */
const PRACTICE_PASSWORD = 'fernhill-demo';

type Invoice = { no: string; date: string; due: string; amount: number; status: 'Open' | 'Past due' | 'Paid'; po: string; lines: Array<[string, number, number]> };

/** The invoices the portal shows, fixed. */
export const PRACTICE_INVOICES: Invoice[] = [
  { no: 'FS-10482', date: '2026-07-14', due: '2026-08-13', amount: 18_420.00, status: 'Paid', po: 'PO-2207', lines: [['Pallet racking, 12 bays', 12, 1_285], ['Install labor (hours)', 18, 166.67]] },
  { no: 'FS-10517', date: '2026-08-02', due: '2026-09-01', amount: 6_212.50, status: 'Paid', po: 'PO-2231', lines: [['Shrink wrap, 80g (cases)', 50, 74.25], ['Corner boards (boxes)', 25, 99.5]] },
  { no: 'FS-10563', date: '2026-08-21', due: '2026-09-20', amount: 9_874.00, status: 'Past due', po: 'PO-2254', lines: [['Forklift battery service', 2, 2_437], ['Charger replacement', 1, 5_000]] },
  { no: 'FS-10598', date: '2026-09-09', due: '2026-10-09', amount: 3_150.75, status: 'Past due', po: 'PO-2270', lines: [['Safety vests, hi-vis (dozen)', 15, 89.05], ['Floor tape, 3in (rolls)', 60, 30.25]] },
  { no: 'FS-10611', date: '2026-09-18', due: '2026-10-18', amount: 12_600.00, status: 'Paid', po: 'PO-2281', lines: [['Dock leveler, 7x8', 1, 12_600]] },
  { no: 'FS-10644', date: '2026-10-01', due: '2026-10-31', amount: 4_488.20, status: 'Open', po: 'PO-2298', lines: [['Stretch film, machine grade', 40, 82.2], ['Pallet jack wheels (sets)', 12, 99.95]] },
  { no: 'FS-10659', date: '2026-10-07', due: '2026-11-06', amount: 21_900.00, status: 'Open', po: 'PO-2304', lines: [['Mezzanine decking (sq ft)', 1_200, 18.25]] },
  { no: 'FS-10673', date: '2026-10-15', due: '2026-11-14', amount: 1_276.40, status: 'Open', po: 'PO-2311', lines: [['Label printer ribbons', 40, 31.91]] },
];

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fernhill Supply · Supplier Portal</title>
<style>
*{box-sizing:border-box}body{margin:0;font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2733;background:#eef1f4}
header{background:#123b5d;color:#fff;display:flex;align-items:center;gap:28px;padding:0 28px;height:56px}
header b{font-size:16px;letter-spacing:.3px}header nav{display:flex;gap:18px}header a{color:#cfe1f1;text-decoration:none}header a.on{color:#fff;font-weight:600}
header .who{margin-left:auto;font-size:13px;color:#cfe1f1}
main{max-width:1040px;margin:28px auto;padding:0 24px}
.card{background:#fff;border:1px solid #d7dde3;border-radius:8px;padding:24px;margin-bottom:20px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 12px}.muted{color:#64748b}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #e5e9ee}th{font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:#64748b}
td.num,th.num{text-align:right}.pill{font-size:12px;padding:2px 8px;border-radius:10px;font-weight:600}
.Open{background:#e0efff;color:#13508c}.Past{background:#fde2e1;color:#a1261d}.Paid{background:#e2f4e8;color:#1f6b3a}
label{display:block;font-weight:600;margin:12px 0 4px}input,select{font:inherit;padding:8px 10px;border:1px solid #b8c2cc;border-radius:6px;width:100%}
.row{display:flex;gap:12px}.row>*{flex:1}
button{font:inherit;font-weight:600;padding:9px 18px;border-radius:6px;border:1px solid #123b5d;background:#123b5d;color:#fff;cursor:pointer}
button.ghost{background:#fff;color:#123b5d}.bar{display:flex;gap:12px;align-items:end;margin-bottom:12px}.bar>div{flex:1}
.err{background:#fde2e1;color:#a1261d;padding:10px 12px;border-radius:6px;margin-top:12px}
.ok{background:#e2f4e8;color:#1f6b3a;padding:12px 14px;border-radius:6px;margin-bottom:16px}
.login{max-width:400px;margin:80px auto}
#cookies{position:fixed;left:0;right:0;bottom:0;background:#1d2733;color:#fff;padding:16px 28px;display:flex;gap:16px;align-items:center}
#cookies p{margin:0;flex:1}
</style></head><body><div id="app"></div>
<script>
const INVOICES = __INVOICES__;
const PASSWORD = __PASSWORD__;
const S = { get: k => JSON.parse(localStorage.getItem('fs.' + k) || 'null'), set: (k, v) => localStorage.setItem('fs.' + k, JSON.stringify(v)) };
const money = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const path = location.pathname.replace(/\/+$/, '') || '/';
const app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function shell(on, body) {
  const u = S.get('user');
  return '<header><b>Fernhill Supply</b><nav>'
    + '<a href="/invoices" class="' + (on === 'inv' ? 'on' : '') + '">Invoices</a>'
    + '<a href="/account/payment" class="' + (on === 'pay' ? 'on' : '') + '">Payment details</a>'
    + '<a href="/support">Support</a></nav><span class="who">' + esc(u ? u.email : '') + ' · <a href="/logout">Sign out</a></span></header><main>' + body + '</main>';
}
function cookieBanner() {
  if (S.get('cookies')) return;
  const d = document.createElement('div');
  d.id = 'cookies';
  d.innerHTML = '<p>We use cookies to keep you signed in and to improve the portal.</p><button class="ghost" id="ck-x">Reject optional</button><button id="ck-ok">Accept all</button>';
  document.body.appendChild(d);
  const close = () => { S.set('cookies', true); d.remove(); };
  d.querySelector('#ck-ok').onclick = close; d.querySelector('#ck-x').onclick = close;
}
function login(msg) {
  app.innerHTML = '<div class="login card"><h1>Supplier Portal</h1><p class="muted">Sign in to view invoices and manage payment details.</p>'
    + '<form id="f"><label for="em">Email</label><input id="em" type="email" autocomplete="username">'
    + '<label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password">'
    + '<div style="margin-top:18px"><button type="submit">Sign in</button></div>' + (msg ? '<div class="err" role="alert">' + esc(msg) + '</div>' : '') + '</form></div>';
  document.getElementById('f').onsubmit = e => {
    e.preventDefault();
    const em = document.getElementById('em').value.trim();
    if (!em.includes('@') || document.getElementById('pw').value !== PASSWORD) return login('That email and password do not match our records.');
    S.set('user', { email: em });
    location.href = '/invoices';
  };
  cookieBanner();
}
function invoices() {
  const q = new URLSearchParams(location.search);
  const st = q.get('status') || 'All';
  const rows = INVOICES.filter(i => st === 'All' || i.status === st);
  const open = INVOICES.filter(i => i.status !== 'Paid').reduce((a, i) => a + i.amount, 0);
  app.innerHTML = shell('inv', '<div class="card"><h1>Invoices</h1><p class="muted">Account LRK-2291 · Outstanding balance <b>' + money(open) + '</b></p></div>'
    + '<div class="card"><form class="bar" id="flt"><div><label for="st">Status</label><select id="st" name="status">'
    + ['All', 'Open', 'Past due', 'Paid'].map(s => '<option' + (s === st ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div><button type="submit" class="ghost">Filter</button></form>'
    + '<table><thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>PO</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>'
    + rows.map(i => '<tr><td><a href="/invoices/' + i.no + '">' + i.no + '</a></td><td>' + i.date + '</td><td>' + i.due + '</td><td>' + i.po + '</td><td class="num">' + money(i.amount) + '</td><td><span class="pill ' + i.status.split(' ')[0] + '">' + i.status + '</span></td></tr>').join('')
    + '</tbody></table><p class="muted">' + rows.length + ' of ' + INVOICES.length + ' invoices</p></div>');
  document.getElementById('flt').onsubmit = e => { e.preventDefault(); location.href = '/invoices?status=' + encodeURIComponent(document.getElementById('st').value); };
  cookieBanner();
}
function invoice(no) {
  const i = INVOICES.find(x => x.no === no);
  if (!i) { app.innerHTML = shell('inv', '<div class="card"><h1>Invoice not found</h1></div>'); return; }
  app.innerHTML = shell('inv', '<div class="card"><p><a href="/invoices">← All invoices</a></p><h1>Invoice ' + i.no + ' <span class="pill ' + i.status.split(' ')[0] + '">' + i.status + '</span></h1>'
    + '<p class="muted">Issued ' + i.date + ' · Due ' + i.due + ' · ' + i.po + ' · Net 30</p>'
    + '<table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr></thead><tbody>'
    + i.lines.map(l => '<tr><td>' + esc(l[0]) + '</td><td class="num">' + l[1].toLocaleString() + '</td><td class="num">' + money(l[2]) + '</td><td class="num">' + money(l[1] * l[2]) + '</td></tr>').join('')
    + '<tr><td colspan="3"><b>Total</b></td><td class="num"><b>' + money(i.amount) + '</b></td></tr></tbody></table></div>');
  cookieBanner();
}
function payment() {
  const a = S.get('remit') || { line1: '1200 Oak Avenue', line2: '', city: 'Oakland', state: 'CA', zip: '94607' };
  // Said once, on the page the save landed on: a later visit shows the form, not an old confirmation.
  const saved = S.get('saved');
  S.set('saved', null);
  app.innerHTML = shell('pay', (saved ? '<div class="ok" role="status">Saved. Your change reference is <b>' + saved + '</b>. Fernhill will use this address from the next statement.</div>' : '')
    + '<div class="card"><h1>Payment details</h1><p class="muted">Where Fernhill sends statements and where your remittances are recorded from.</p>'
    + '<form id="f"><h2 style="margin-top:16px">Remit-to address</h2>'
    + '<label for="l1">Address line 1</label><input id="l1" value="' + esc(a.line1) + '">'
    + '<label for="l2">Address line 2</label><input id="l2" value="' + esc(a.line2) + '">'
    + '<div class="row"><div><label for="ci">City</label><input id="ci" value="' + esc(a.city) + '"></div><div><label for="sa">State</label><input id="sa" value="' + esc(a.state) + '"></div><div><label for="zi">ZIP</label><input id="zi" value="' + esc(a.zip) + '"></div></div>'
    + '<label>Bank account on file</label><p class="muted" style="margin:0">Checking ending 4417 · change by calling Fernhill AR</p>'
    + '<div style="margin-top:20px;display:flex;gap:12px"><button type="submit">Save changes</button><a href="/invoices" style="align-self:center">Cancel</a></div></form></div>');
  document.getElementById('f').onsubmit = e => {
    e.preventDefault();
    const v = id => document.getElementById(id).value.trim();
    S.set('remit', { line1: v('l1'), line2: v('l2'), city: v('ci'), state: v('sa'), zip: v('zi') });
    S.set('saved', 'FS-CHG-' + (4800 + Math.floor(Math.random() * 199)));
    location.reload();
  };
  cookieBanner();
}
if (path === '/logout') { S.set('user', null); location.href = '/login'; }
else if (!S.get('user') || path === '/login' || path === '/') login();
else if (path === '/invoices') invoices();
else if (path.startsWith('/invoices/')) invoice(decodeURIComponent(path.slice(10)));
else if (path === '/account/payment') payment();
else app.innerHTML = shell('', '<div class="card"><h1>Support</h1><p>Call Fernhill AR at (510) 555-0142, weekdays 8–5 Pacific.</p></div>');
</script></body></html>`;

/**
 * What the practice site answers for this address, or null when it is not the practice site.
 * Every path is the one page, which draws itself from the path. The second practice site,
 * the Lumen Awareness campaign console, answers through here too (`practiceConsole.ts`), and so does
 * the third, Northwind Outfitters' blog editor (`practiceBlog.ts`).
 * @param url - The request's address.
 */
export function practiceResponse(url: string): { status: number; contentType: string; body: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin === PRACTICE_CONSOLE_ORIGIN) {
    return practiceConsoleResponse(url);
  }
  if (u.origin === PRACTICE_BLOG_ORIGIN) {
    return practiceBlogResponse(url);
  }
  if (u.origin !== PRACTICE_ORIGIN) {
    return null;
  }
  if (u.pathname === '/favicon.ico') {
    return { status: 404, contentType: 'text/plain', body: '' };
  }
  const body = PAGE.replace('__INVOICES__', JSON.stringify(PRACTICE_INVOICES)).replace('__PASSWORD__', JSON.stringify(PRACTICE_PASSWORD));
  return { status: 200, contentType: 'text/html; charset=utf-8', body };
}

/** The example the pane and the docs offer: the whole shape of a browser run in one task. */
export const PRACTICE_EXAMPLE = {
  task: 'Sign in to Fernhill Supply\'s supplier portal. List every invoice that is open or past due, with its number, date, due date, PO and amount. Then change our remit-to address to the new one and save it.',
  startUrl: `${PRACTICE_ORIGIN}/login`,
  inputs: { email: 'ap@larkfield.example', password: PRACTICE_PASSWORD, new_address: '500 Market Street, Suite 300, San Francisco, CA 94105' },
  secretInputs: ['password'],
  outputs: [
    { name: 'unpaid_invoices', description: 'Each open or past-due invoice: number, date, due date, PO, amount, status' },
    { name: 'total_unpaid', description: 'The sum of those invoices, in dollars' },
    { name: 'change_reference', description: 'The reference Fernhill gave for the address change' },
  ],
} as const;
