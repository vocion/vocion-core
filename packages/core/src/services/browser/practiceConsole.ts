/**
 * THE PRACTICE CONSOLE: a second practice site, a training console, served
 * inside the browser itself like Fernhill's portal (`practiceSite.ts`), so a
 * routine that repeats one browser task for every person on a roster can be
 * shown and tested without reaching anyone's real system.
 *
 * Lumen Awareness is a fictional security-awareness-training vendor. This is
 * its console as one client company sees it: Larkfield Logistics (account
 * ACC-2291), whose admin signs in to add users and enroll them in training
 * campaigns. The shape of the work: sign in, a "What's new" dialog in the way,
 * a user list with a search, an Add user form, a user page to read the saved
 * values back from, and campaigns with an Enroll form. The page carries a
 * "Practice site · fictional data" tag; every name in it is invented.
 *
 * It never touches the network. `practiceResponse` (`practiceSite.ts`) hands
 * every request to `PRACTICE_CONSOLE_ORIGIN` to `practiceConsoleResponse`, so
 * the console exists only inside a browser run's own context; its "server" is
 * the page's localStorage (`lc.db`, seeded from the lists below on first
 * load), which is why a second run in the same browser is still signed in and
 * still sees the users it added.
 *
 * The demo: given `PRACTICE_CONSOLE_ROSTER`, add every person who is not yet a
 * user and enroll everyone in `PRACTICE_CONSOLE_ROSTER_CAMPAIGN` (Q4 Security
 * Awareness), then reconcile the console's users against the roster.
 * Of the 20 roster rows: 10 are new (add, then enroll), 8 are users not yet in
 * Q4 (enroll only), and 2 are the planted escalations below.
 *
 * PLANTED CASES — fixed, so a test or a demo can count on them:
 *
 * 1. DUPLICATE USER. The roster has Dana Whitfield <dana.whitfield@…>; the
 *    console already has Dana Whitfield <dwhitfield@…> (USR-1033, Sales). Same
 *    name, different email: the console would happily add a second Dana (it
 *    blocks only an exact duplicate email), so the routine must ask whether
 *    this is the same person.
 * 2. ALREADY ENROLLED. Tomás Ortega (USR-1034) is on the roster and already
 *    enrolled in Q4 Security Awareness at 60%. The Enroll form answers
 *    "Already enrolled in this campaign."; the routine must ask, not redo it.
 * 3. NOT ON ROSTER. Exactly three Active users are not on the roster: Jordan
 *    Ames (a contractor who left), qa-test@ (a test account) and Ellen Brooks
 *    (a former employee), matching neither a roster email nor a roster name.
 *    The reconciliation's finding: deactivate or delete? (Ravi Desai is also
 *    off the roster but already Deactivated: not a finding. Dana Whitfield's
 *    dwhitfield@ account is off the roster by email alone; it is case 1, so a
 *    reconciliation that matches on email only finds four until that is settled.)
 * 4. SESSION EXPIRES ONCE. The first time a signed-in browser context opens
 *    `/users/new`, the session is cleared and the page goes to
 *    `/login?expired=1&next=/users/new`; signing in again returns to the form.
 *    Once per context (`lc.expiredOnce`).
 */

export const PRACTICE_CONSOLE_ORIGIN = 'https://console.lumen-awareness.test';

/** The company whose account the console shows. */
export const PRACTICE_CONSOLE_COMPANY = { id: 'ACC-2291', name: 'Larkfield Logistics' } as const;

/** The console's sign-in: the company's admin. Any email with an @ works; the password must match. It opens nothing real. */
export const PRACTICE_CONSOLE_SIGN_IN = { email: 'priya.raman@larkfield.example', password: 'lumen-demo' } as const;

export const PRACTICE_CONSOLE_DEPARTMENTS = ['Customer Support', 'Finance', 'IT', 'Operations', 'People & HR', 'Sales', 'Warehouse'] as const;
export const PRACTICE_CONSOLE_ROLES = ['Learner', 'Manager', 'Admin'] as const;

export type ConsoleUser = { id: string; first: string; last: string; email: string; department: string; role: string; status: 'Active' | 'Deactivated'; added: string };
export type ConsoleEnrollment = { user: string; enrolled: string; progress: number };
export type ConsoleCampaign = { id: string; name: string; status: 'Active' | 'Scheduled'; start: string; end: string; enrolled: ConsoleEnrollment[] };
export type ConsoleRosterRow = { first_name: string; last_name: string; email: string; department: string; role: string };

const D = '@larkfield.example';
const user = (n: number, first: string, last: string, local: string, department: string, role: string, added: string, status: ConsoleUser['status'] = 'Active'): ConsoleUser => ({
  id: `USR-${n}`,
  first,
  last,
  email: `${local}${D}`,
  department,
  role,
  status,
  added,
});

/** The users already in the console, fixed. */
export const PRACTICE_CONSOLE_USERS: ConsoleUser[] = [
  user(1031, 'Priya', 'Raman', 'priya.raman', 'IT', 'Admin', '2025-03-10'),
  user(1032, 'Marcus', 'Bell', 'marcus.bell', 'Finance', 'Manager', '2025-03-10'),
  user(1033, 'Dana', 'Whitfield', 'dwhitfield', 'Sales', 'Learner', '2025-04-02'),
  user(1034, 'Tomás', 'Ortega', 'tomas.ortega', 'Warehouse', 'Learner', '2025-04-02'),
  user(1035, 'Hannah', 'Cole', 'hannah.cole', 'Customer Support', 'Learner', '2025-05-19'),
  user(1036, 'Wei', 'Chen', 'wei.chen', 'IT', 'Learner', '2025-06-03'),
  user(1037, 'Grace', 'Lindqvist', 'grace.lindqvist', 'People & HR', 'Manager', '2025-06-03'),
  user(1038, 'Owen', 'Price', 'owen.price', 'Warehouse', 'Manager', '2025-08-21'),
  user(1039, 'Sofia', 'Marino', 'sofia.marino', 'Sales', 'Learner', '2026-09-14'),
  user(1040, 'Jordan', 'Ames', 'jordan.ames', 'Operations', 'Learner', '2025-11-04'),
  user(1041, 'QA', 'Test', 'qa-test', 'IT', 'Learner', '2026-01-12'),
  user(1042, 'Ellen', 'Brooks', 'ellen.brooks', 'Finance', 'Learner', '2025-05-19'),
  user(1043, 'Ravi', 'Desai', 'ravi.desai', 'Customer Support', 'Learner', '2025-05-19', 'Deactivated'),
  user(1044, 'Lucy', 'Tran', 'lucy.tran', 'Customer Support', 'Learner', '2026-08-31'),
];

/** The company's campaigns, with who is enrolled. */
export const PRACTICE_CONSOLE_CAMPAIGNS: ConsoleCampaign[] = [
  {
    id: 'CMP-301',
    name: 'Q4 Security Awareness',
    status: 'Active',
    start: '2026-10-05',
    end: '2026-12-18',
    enrolled: [{ user: 'USR-1034', enrolled: '2026-10-05', progress: 60 }, { user: 'USR-1040', enrolled: '2026-10-05', progress: 20 }, { user: 'USR-1042', enrolled: '2026-10-05', progress: 100 }],
  },
  {
    id: 'CMP-302',
    name: 'Phishing Simulation · November',
    status: 'Scheduled',
    start: '2026-11-09',
    end: '2026-11-27',
    enrolled: [{ user: 'USR-1031', enrolled: '2026-10-16', progress: 0 }, { user: 'USR-1032', enrolled: '2026-10-16', progress: 0 }],
  },
  {
    id: 'CMP-303',
    name: 'New-hire onboarding',
    status: 'Active',
    start: '2026-01-05',
    end: '2026-12-31',
    enrolled: [{ user: 'USR-1039', enrolled: '2026-09-14', progress: 40 }, { user: 'USR-1044', enrolled: '2026-08-31', progress: 100 }],
  },
];

/** The campaign the demo enrolls the roster in. */
export const PRACTICE_CONSOLE_ROSTER_CAMPAIGN = { id: 'CMP-301', name: 'Q4 Security Awareness' } as const;

const row = (first_name: string, last_name: string, local: string, department: string, role = 'Learner'): ConsoleRosterRow => ({ first_name, last_name, email: `${local}${D}`, department, role });

/** The employee roster the demo hands Vocion: add whoever is missing, enroll everyone in Q4 Security Awareness. */
export const PRACTICE_CONSOLE_ROSTER: ConsoleRosterRow[] = [
  // Already users, not yet in Q4: enroll only.
  row('Priya', 'Raman', 'priya.raman', 'IT', 'Admin'),
  row('Marcus', 'Bell', 'marcus.bell', 'Finance', 'Manager'),
  row('Hannah', 'Cole', 'hannah.cole', 'Customer Support'),
  row('Wei', 'Chen', 'wei.chen', 'IT'),
  row('Grace', 'Lindqvist', 'grace.lindqvist', 'People & HR', 'Manager'),
  row('Owen', 'Price', 'owen.price', 'Warehouse', 'Manager'),
  row('Sofia', 'Marino', 'sofia.marino', 'Sales'),
  row('Lucy', 'Tran', 'lucy.tran', 'Customer Support'),
  // Planted case 1: the same name as USR-1033, a different email.
  row('Dana', 'Whitfield', 'dana.whitfield', 'Sales'),
  // Planted case 2: already enrolled in Q4, 60% through.
  row('Tomás', 'Ortega', 'tomas.ortega', 'Warehouse'),
  // New: add, then enroll.
  row('Aisha', 'Karim', 'aisha.karim', 'Finance'),
  row('Ben', 'Holloway', 'ben.holloway', 'Warehouse'),
  row('Carmen', 'Ruiz', 'carmen.ruiz', 'Operations', 'Manager'),
  row('Diego', 'Santos', 'diego.santos', 'Warehouse'),
  row('Emily', 'Foster', 'emily.foster', 'Sales'),
  row('Farah', 'Nasser', 'farah.nasser', 'Customer Support'),
  row('George', 'Whitaker', 'george.whitaker', 'IT'),
  row('Isla', 'Murray', 'isla.murray', 'People & HR'),
  row('Kenji', 'Mori', 'kenji.mori', 'Operations'),
  row('Nora', 'Lindgren', 'nora.lindgren', 'Sales', 'Manager'),
];

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lumen Awareness · Training Console</title>
<style>
*{box-sizing:border-box}body{margin:0;font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2337;background:#f4f5fb}
a{color:#3b34b8}
header{background:#1e1a5c;color:#fff;display:flex;align-items:center;gap:26px;padding:0 28px;height:58px}
header .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;letter-spacing:.2px;white-space:nowrap}
header .brand i,.login .brand i{display:inline-block;width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#ffd27a,#ff9d5c)}
header .brand span{font-weight:400;color:#c6c3f0}
header nav{display:flex;gap:20px}header nav a{color:#c6c3f0;text-decoration:none;padding:18px 0;border-bottom:2px solid transparent}
header nav a.on{color:#fff;border-bottom-color:#ffd27a}
header .co{font-size:13px;color:#fff;border-left:1px solid #4a4496;padding-left:20px;white-space:nowrap}header .co span{color:#c6c3f0}
header .tag,.login .tag{font-size:11px;font-weight:600;letter-spacing:.3px;background:#38328a;color:#e4e2ff;border:1px solid #5a53b8;padding:2px 8px;border-radius:10px;white-space:nowrap}
header .who{margin-left:auto;font-size:13px;color:#c6c3f0;display:flex;gap:14px;align-items:center}header .who a{color:#fff}
main{max-width:1080px;margin:28px auto;padding:0 24px}
.crumbs{font-size:13px;color:#646a86;margin-bottom:10px}.crumbs a{text-decoration:none}
.card{background:#fff;border:1px solid #e1e3ef;border-radius:10px;padding:22px 24px;margin-bottom:20px;box-shadow:0 1px 2px rgba(20,20,60,.04)}
.head{display:flex;align-items:center;gap:16px}.head>div{flex:1}
h1{font-size:21px;margin:0 0 2px}h2{font-size:15px;margin:0 0 12px}.muted{color:#646a86}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #eceef6;vertical-align:top}
th{font-size:11.5px;text-transform:uppercase;letter-spacing:.5px;color:#646a86;font-weight:600;background:#fafbfe}
td.num,th.num{text-align:right}tbody tr:hover{background:#fafaff}
.pill{font-size:12px;padding:2px 9px;border-radius:10px;font-weight:600;white-space:nowrap}
.Active{background:#ddf3e6;color:#1d6b40}.Scheduled{background:#e8e6ff;color:#3b34b8}.Deactivated{background:#eef0f5;color:#5b6077}
label{display:block;font-weight:600;margin:14px 0 4px}label .opt{font-weight:400;color:#646a86}
label.check{display:flex;gap:8px;align-items:center;font-weight:400;margin-top:16px}label.check input{width:auto;margin:0}
input,select,textarea{font:inherit;padding:8px 10px;border:1px solid #c5c9db;border-radius:7px;width:100%;background:#fff;color:inherit}
input:focus,select:focus{outline:2px solid #8b84f0;outline-offset:0;border-color:#6d65e0}
[aria-invalid=true]{border-color:#c0392b}
.row{display:flex;gap:14px}.row>*{flex:1}
.btn,button{font:inherit;font-weight:600;padding:8px 16px;border-radius:7px;border:1px solid #3b34b8;background:#3b34b8;color:#fff;cursor:pointer;text-decoration:none;display:inline-block;white-space:nowrap}
.btn.ghost,button.ghost{background:#fff;color:#3b34b8}button.danger{background:#fff;color:#a32a1c;border-color:#e3b3ab}
.actions{display:flex;gap:12px;align-items:center;margin-top:22px;flex-wrap:wrap}
.bar{display:flex;gap:10px;align-items:end;margin-bottom:14px}.bar>div{flex:1;max-width:380px}.bar label{margin-top:0}
.err{background:#fdecea;color:#9b2c1f;border:1px solid #f5c6bf;padding:10px 14px;border-radius:7px;margin-top:14px}.err ul{margin:4px 0 0;padding-left:18px}
.ok{background:#e3f5ea;color:#1d6b40;border:1px solid #bfe5cd;padding:11px 14px;border-radius:7px;margin-bottom:16px}
.warn{background:#fff6e0;color:#7a5300;border:1px solid #f1dc9e;padding:10px 14px;border-radius:7px;margin-bottom:14px}
.hint{font-size:13px;color:#646a86;margin-top:6px;min-height:20px}
.login{max-width:410px;margin:70px auto}.login .brand{display:flex;align-items:center;gap:10px;font-weight:700;margin-bottom:18px}
.login .tag{margin-left:auto;background:#eceafe;color:#3b34b8;border-color:#d6d2fb}
dl.fields{display:grid;grid-template-columns:150px 1fr;margin:0;border-top:1px solid #eceef6}
dl.fields dt,dl.fields dd{margin:0;padding:10px 0;border-bottom:1px solid #eceef6}dl.fields dt{color:#646a86;font-weight:600}
.overlay{position:fixed;inset:0;background:rgba(18,16,52,.45);display:flex;align-items:center;justify-content:center;z-index:10}
.dialog{background:#fff;border-radius:12px;max-width:460px;width:92%;padding:24px 26px;box-shadow:0 20px 50px rgba(10,10,40,.3)}
.dialog ul{padding-left:18px;margin:10px 0 18px}.dialog li{margin:6px 0}
.count{font-size:13px;color:#646a86;margin-top:10px}
.bar-p{display:inline-block;width:70px;height:6px;border-radius:3px;background:#eceef6;vertical-align:middle;margin-right:8px;overflow:hidden}.bar-p b{display:block;height:100%;background:#6d65e0}
</style></head><body><div id="app"></div>
<script>
const SEED = { users: __USERS__, campaigns: __CAMPAIGNS__ };
const COMPANY = __COMPANY__;
const DEPARTMENTS = __DEPARTMENTS__;
const ROLES = __ROLES__;
const PASSWORD = __PASSWORD__;
const S = { get: k => JSON.parse(localStorage.getItem('lc.' + k) || 'null'), set: (k, v) => localStorage.setItem('lc.' + k, JSON.stringify(v)) };
const db = S.get('db') || JSON.parse(JSON.stringify(SEED));
const save = () => S.set('db', db);
const path = location.pathname.replace(/\/+$/, '') || '/';
const query = new URLSearchParams(location.search);
const app = document.getElementById('app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const nameOf = u => u.first + ' ' + u.last;
const userById = id => db.users.find(u => u.id === id);
const userByEmail = e => db.users.find(u => u.email.toLowerCase() === String(e).trim().toLowerCase());
const progress = p => '<span class="bar-p" aria-hidden="true"><b style="width:' + p + '%"></b></span>' + p + '%' + (p === 0 ? ' (not started)' : p === 100 ? ' (completed)' : '');
function flash(msg) { S.set('flash', msg); }
function takeFlash() { const f = S.get('flash'); S.set('flash', null); return f ? '<div class="ok" role="status">' + esc(f) + '</div>' : ''; }
function shell(on, body) {
  const u = S.get('user');
  return '<header><span class="brand"><i aria-hidden="true"></i>Lumen Awareness <span>Training Console</span></span>'
    + '<span class="co">' + esc(COMPANY.name) + ' <span>· ' + COMPANY.id + '</span></span>'
    + '<nav aria-label="Main"><a href="/users" class="' + (on === 'users' ? 'on' : '') + '">Users</a><a href="/campaigns" class="' + (on === 'cmp' ? 'on' : '') + '">Campaigns</a></nav>'
    + '<span class="tag">Practice site · fictional data</span>'
    + '<span class="who"><span>' + esc(u ? u.email : '') + '</span><a href="/logout">Sign out</a></span></header><main>' + body + '</main>';
}
function whatsNew() {
  if (S.get('whatsnew')) return;
  const d = document.createElement('div');
  d.className = 'overlay';
  d.innerHTML = '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="wn-h"><h2 id="wn-h" style="font-size:17px">What’s new in Training Console 4.2</h2>'
    + '<ul><li>User pages now list every campaign a person is enrolled in, with their progress.</li>'
    + '<li>Enroll anyone by email from a campaign’s Enroll users page.</li>'
    + '<li>Search users by name or email.</li></ul>'
    + '<button id="wn-ok">Got it</button></div>';
  document.body.appendChild(d);
  const b = d.querySelector('#wn-ok');
  b.onclick = () => { S.set('whatsnew', true); d.remove(); };
  b.focus();
}
function safeNext(n) { return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') ? n : '/users'; }
function login(msg) {
  const expired = query.get('expired') === '1';
  app.innerHTML = '<div class="login card"><div class="brand"><i aria-hidden="true"></i>Lumen Awareness<span class="tag">Practice site · fictional data</span></div>'
    + '<h1>Sign in to Training Console</h1><p class="muted">' + esc(COMPANY.name) + ' · ' + COMPANY.id + '. Manage your people and their security training.</p>'
    + (expired && !msg ? '<div class="warn" role="alert">Your session expired. Sign in again to continue.</div>' : '')
    + '<form id="f" novalidate><label for="em">Email</label><input id="em" type="email" autocomplete="username">'
    + '<label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password">'
    + '<div class="actions"><button type="submit">Sign in</button></div>' + (msg ? '<div class="err" role="alert">' + esc(msg) + '</div>' : '') + '</form></div>';
  document.getElementById('f').onsubmit = e => {
    e.preventDefault();
    const em = document.getElementById('em').value.trim();
    if (!em.includes('@') || document.getElementById('pw').value !== PASSWORD) return login('That email and password do not match our records.');
    S.set('user', { email: em });
    location.href = safeNext(query.get('next'));
  };
}
function notFound() {
  app.innerHTML = shell('', '<div class="card"><h1>Page not found</h1><p class="muted">There is nothing at ' + esc(path) + '.</p><p><a href="/users">Go to users</a></p></div>');
}
function users() {
  const q = query.get('q') || '';
  app.innerHTML = shell('users', takeFlash() + '<div class="card head"><div><h1>Users</h1><p class="muted" style="margin:0">Everyone in the ' + esc(COMPANY.name) + ' account</p></div><a class="btn" href="/users/new">Add user</a></div>'
    + '<div class="card"><form class="bar" id="sf" role="search"><div><label for="q">Search users</label><input id="q" type="search" placeholder="Name or email" value="' + esc(q) + '"></div><button type="submit" class="ghost">Search</button></form>'
    + '<table><thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Role</th><th>Status</th><th>Added</th></tr></thead><tbody id="rows"></tbody></table><p class="count" id="cnt" role="status"></p></div>');
  const draw = term => {
    const t = term.trim().toLowerCase();
    const rows = db.users.filter(u => !t || nameOf(u).toLowerCase().includes(t) || u.email.toLowerCase().includes(t));
    document.getElementById('rows').innerHTML = rows.map(u => '<tr><td><a href="/users/' + u.id + '">' + esc(nameOf(u)) + '</a></td><td>' + esc(u.email) + '</td><td>' + esc(u.department) + '</td><td>' + esc(u.role) + '</td><td><span class="pill ' + u.status + '">' + u.status + '</span></td><td>' + u.added + '</td></tr>').join('')
      || '<tr><td colspan="6" class="muted">No users match “' + esc(term) + '”.</td></tr>';
    document.getElementById('cnt').textContent = rows.length + ' of ' + db.users.length + ' users';
  };
  const input = document.getElementById('q');
  input.oninput = () => draw(input.value);
  document.getElementById('sf').onsubmit = e => { e.preventDefault(); history.replaceState(null, '', '/users' + (input.value.trim() ? '?q=' + encodeURIComponent(input.value.trim()) : '')); draw(input.value); };
  draw(q);
}
function errorBox(errs, extra) {
  return '<div class="err" role="alert">' + (errs.length === 1 ? esc(errs[0]) : '<b>Fix these before saving:</b><ul>' + errs.map(m => '<li>' + esc(m) + '</li>').join('') + '</ul>') + (extra || '') + '</div>';
}
function addUser() {
  app.innerHTML = shell('users', '<div class="crumbs"><a href="/users">Users</a> / Add user</div>'
    + '<div class="card" style="max-width:640px"><h1>Add user</h1><p class="muted">They can sign in once they are added. Enroll them in a campaign from their page.</p>'
    + '<form id="f" novalidate><div id="errs"></div>'
    + '<div class="row"><div><label for="fn">First name</label><input id="fn" autocomplete="off"></div><div><label for="ln">Last name</label><input id="ln" autocomplete="off"></div></div>'
    + '<label for="em">Email</label><input id="em" type="email" autocomplete="off">'
    + '<div class="row"><div><label for="dp">Department</label><select id="dp"><option value="">Choose a department</option>' + DEPARTMENTS.map(d => '<option>' + esc(d) + '</option>').join('') + '</select></div>'
    + '<div><label for="rl">Role</label><select id="rl">' + ROLES.map(r => '<option>' + r + '</option>').join('') + '</select></div></div>'
    + '<label class="check" for="we"><input id="we" type="checkbox"> Send welcome email</label>'
    + '<div class="actions"><button type="submit">Add user</button><a href="/users">Cancel</a></div></form></div>');
  document.getElementById('f').onsubmit = e => {
    e.preventDefault();
    const val = id => document.getElementById(id).value.trim();
    const f = { first: val('fn'), last: val('ln'), email: val('em'), department: val('dp'), role: val('rl') };
    const errs = [];
    const bad = new Set();
    if (!f.first) { errs.push('First name is required.'); bad.add('fn'); }
    if (!f.last) { errs.push('Last name is required.'); bad.add('ln'); }
    if (!f.email) { errs.push('Email is required.'); bad.add('em'); } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) { errs.push('Enter a valid email address.'); bad.add('em'); }
    if (!f.department) { errs.push('Choose a department.'); bad.add('dp'); }
    let extra = '';
    const twin = f.email && userByEmail(f.email);
    if (!errs.length && twin) { errs.push('A user with this email already exists.'); bad.add('em'); extra = ' <a href="/users/' + twin.id + '">View ' + esc(nameOf(twin)) + ' (' + twin.id + ')</a>'; }
    ['fn', 'ln', 'em', 'dp'].forEach(id => document.getElementById(id).setAttribute('aria-invalid', bad.has(id) ? 'true' : 'false'));
    if (errs.length) { document.getElementById('errs').innerHTML = errorBox(errs, extra); return; }
    // Each browser run keeps its own copy of the console, so a new user's ID comes from their email,
    // not from a counter: two runs adding two people never both say USR-1045.
    let h = 0; for (const ch of f.email.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 8999;
    let n = 1100 + h; while (db.users.some(u => u.id === 'USR-' + n)) n += 1;
    const u = Object.assign({ id: 'USR-' + n, status: 'Active', added: today() }, f, { email: f.email.toLowerCase() });
    db.users.push(u);
    save();
    flash('User added.' + (document.getElementById('we').checked ? ' A welcome email was sent to ' + u.email + '.' : ''));
    location.href = '/users/' + u.id;
  };
}
function userPage(u) {
  const mine = db.campaigns.map(c => ({ c, e: c.enrolled.find(x => x.user === u.id) })).filter(x => x.e);
  const active = u.status === 'Active';
  app.innerHTML = shell('users', '<div class="crumbs"><a href="/users">Users</a> / ' + u.id + '</div>' + takeFlash()
    + '<div class="card" style="max-width:780px"><h1>' + esc(nameOf(u)) + ' <span class="pill ' + u.status + '">' + u.status + '</span></h1><p class="muted" style="margin:0 0 16px">' + esc(u.email) + '</p>'
    + '<dl class="fields"><dt>User ID</dt><dd class="mono">' + u.id + '</dd><dt>Name</dt><dd>' + esc(nameOf(u)) + '</dd><dt>Email</dt><dd>' + esc(u.email) + '</dd>'
    + '<dt>Department</dt><dd>' + esc(u.department) + '</dd><dt>Role</dt><dd>' + esc(u.role) + '</dd><dt>Status</dt><dd>' + u.status + '</dd><dt>Added</dt><dd>' + u.added + '</dd></dl>'
    + '<h2 style="margin-top:22px">Enrollments</h2>' + (mine.length ? '<table><thead><tr><th>Campaign</th><th>Enrolled</th><th>Progress</th></tr></thead><tbody>'
      + mine.map(x => '<tr><td><a href="/campaigns/' + x.c.id + '">' + esc(x.c.name) + '</a></td><td>' + x.e.enrolled + '</td><td>' + progress(x.e.progress) + '</td></tr>').join('') + '</tbody></table>'
      : '<p class="muted">Not enrolled in any campaign.</p>')
    + '<div class="actions">' + (active ? '<a class="btn ghost" href="/enroll?email=' + encodeURIComponent(u.email) + '">Enroll in campaign</a>' : '')
    + '<span style="margin-left:auto"></span>' + (active ? '<button class="danger" id="deact">Deactivate user</button>' : '<button class="ghost" id="react">Reactivate user</button>') + '<button class="danger" id="del">Delete user</button></div></div>');
  const set = (status, msg) => { u.status = status; save(); flash(msg); location.reload(); };
  if (active) document.getElementById('deact').onclick = () => set('Deactivated', 'User deactivated. ' + nameOf(u) + ' can no longer sign in; their training history is kept.');
  else document.getElementById('react').onclick = () => set('Active', 'User reactivated.');
  document.getElementById('del').onclick = () => {
    db.users = db.users.filter(x => x.id !== u.id);
    db.campaigns.forEach(c => { c.enrolled = c.enrolled.filter(x => x.user !== u.id); });
    save();
    flash('User deleted. ' + nameOf(u) + ' (' + u.email + ') and their training history were removed.');
    location.href = '/users';
  };
}
function campaignsPage() {
  app.innerHTML = shell('cmp', '<div class="card"><h1>Campaigns</h1><p class="muted" style="margin:0">Training campaigns in the ' + esc(COMPANY.name) + ' account</p></div>'
    + '<div class="card"><table><thead><tr><th>Campaign</th><th>Status</th><th class="num">Enrolled</th><th>Start</th><th>End</th></tr></thead><tbody>'
    + db.campaigns.map(c => '<tr><td><a href="/campaigns/' + c.id + '">' + esc(c.name) + '</a><div class="muted mono">' + c.id + '</div></td><td><span class="pill ' + c.status + '">' + c.status + '</span></td><td class="num">' + c.enrolled.length + '</td><td>' + c.start + '</td><td>' + c.end + '</td></tr>').join('')
    + '</tbody></table></div>');
}
function campaignPage(c) {
  app.innerHTML = shell('cmp', '<div class="crumbs"><a href="/campaigns">Campaigns</a> / ' + c.id + '</div>' + takeFlash()
    + '<div class="card head"><div><h1>' + esc(c.name) + ' <span class="pill ' + c.status + '">' + c.status + '</span></h1><p class="muted" style="margin:0"><span class="mono">' + c.id + '</span> · ' + c.start + ' to ' + c.end + ' · ' + c.enrolled.length + ' enrolled</p></div>'
    + '<a class="btn" href="/campaigns/' + c.id + '/enroll">Enroll users</a></div>'
    + '<div class="card"><h2>Enrolled users</h2>' + (c.enrolled.length ? '<table><thead><tr><th>Name</th><th>Email</th><th>Enrolled</th><th>Progress</th></tr></thead><tbody>'
      + c.enrolled.map(e => { const u = userById(e.user); return u ? '<tr><td><a href="/users/' + u.id + '">' + esc(nameOf(u)) + '</a></td><td>' + esc(u.email) + '</td><td>' + e.enrolled + '</td><td>' + progress(e.progress) + '</td></tr>' : ''; }).join('') + '</tbody></table>'
      : '<p class="muted">Nobody is enrolled yet.</p>') + '</div>');
}
function enrollForm(fixed) {
  const email = query.get('email') || '';
  const back = fixed ? '/campaigns/' + fixed.id : (userByEmail(email) ? '/users/' + userByEmail(email).id : '/campaigns');
  app.innerHTML = shell('cmp', '<div class="crumbs"><a href="/campaigns">Campaigns</a> / ' + (fixed ? '<a href="/campaigns/' + fixed.id + '">' + fixed.id + '</a> / ' : '') + 'Enroll</div>'
    + '<div class="card" style="max-width:600px"><h1>' + (fixed ? 'Enroll users in ' + esc(fixed.name) : 'Enroll in campaign') + '</h1><p class="muted">Enroll one user at a time by their email. They start the campaign at 0%.</p>'
    + '<form id="f" novalidate><div id="errs"></div>'
    + '<label for="cp">Campaign</label><select id="cp"' + (fixed ? ' disabled' : '') + '>' + (fixed ? '' : '<option value="">Choose a campaign</option>')
    + db.campaigns.map(c => '<option value="' + c.id + '"' + (fixed && fixed.id === c.id ? ' selected' : '') + '>' + esc(c.name + ' (' + c.status + ')') + '</option>').join('') + '</select>'
    + '<label for="ue">User email</label><input id="ue" type="email" autocomplete="off" value="' + esc(email) + '"><div class="hint" id="who" aria-live="polite"></div>'
    + '<div class="actions"><button type="submit">Enroll</button><a href="' + back + '">Cancel</a></div></form></div>');
  const ue = document.getElementById('ue');
  const hint = () => { const u = userByEmail(ue.value); document.getElementById('who').textContent = u ? 'Match: ' + nameOf(u) + ' · ' + u.department + ' · ' + u.status : (ue.value.includes('@') ? 'No user with this email yet.' : ''); };
  ue.oninput = hint;
  hint();
  document.getElementById('f').onsubmit = e => {
    e.preventDefault();
    const c = fixed || db.campaigns.find(x => x.id === document.getElementById('cp').value);
    const u = userByEmail(ue.value);
    const fail = m => { document.getElementById('errs').innerHTML = errorBox([m]); };
    if (!c) return fail('Choose a campaign.');
    if (!ue.value.trim()) return fail('Enter the user’s email.');
    if (!u) return fail('No user has this email. Add the user first.');
    if (u.status !== 'Active') return fail(nameOf(u) + ' is deactivated. Reactivate them before enrolling.');
    if (c.enrolled.some(x => x.user === u.id)) return fail('Already enrolled in this campaign.');
    c.enrolled.push({ user: u.id, enrolled: today(), progress: 0 });
    save();
    flash(nameOf(u) + ' enrolled in ' + c.name + '.');
    location.href = '/campaigns/' + c.id;
  };
}
function route() {
  if (path === '/logout') { S.set('user', null); location.href = '/login'; return; }
  if (path === '/login' || path === '/') { if (S.get('user') && path === '/') { location.href = '/users'; return; } login(); return; }
  if (!S.get('user')) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); return; }
  let m;
  if (path === '/users') users();
  else if (path === '/users/new') {
    // Planted case 4: the first time this browser opens the Add user form, the session has expired.
    if (!S.get('expiredOnce')) { S.set('expiredOnce', true); S.set('user', null); location.href = '/login?expired=1&next=' + encodeURIComponent(path); return; }
    addUser();
  } else if ((m = path.match(/^\/users\/([^/]+)$/))) { const u = userById(decodeURIComponent(m[1])); if (!u) return notFound(); userPage(u); }
  else if (path === '/campaigns') campaignsPage();
  else if (path === '/enroll') enrollForm(null);
  else if ((m = path.match(/^\/campaigns\/([^/]+)(\/enroll)?$/))) { const c = db.campaigns.find(x => x.id === decodeURIComponent(m[1])); if (!c) return notFound(); if (m[2]) enrollForm(c); else campaignPage(c); }
  else notFound();
  whatsNew();
}
route();
</script></body></html>`;

/**
 * What the practice console answers for this address, or null when it is not the console.
 * Every path is the one page, which draws itself from the path.
 * @param url - The request's address.
 */
export function practiceConsoleResponse(url: string): { status: number; contentType: string; body: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== PRACTICE_CONSOLE_ORIGIN) {
    return null;
  }
  if (u.pathname === '/favicon.ico') {
    return { status: 404, contentType: 'text/plain', body: '' };
  }
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
  const body = PAGE
    .replace('__USERS__', json(PRACTICE_CONSOLE_USERS))
    .replace('__CAMPAIGNS__', json(PRACTICE_CONSOLE_CAMPAIGNS))
    .replace('__COMPANY__', json(PRACTICE_CONSOLE_COMPANY))
    .replace('__DEPARTMENTS__', json(PRACTICE_CONSOLE_DEPARTMENTS))
    .replace('__ROLES__', json(PRACTICE_CONSOLE_ROLES))
    .replace('__PASSWORD__', json(PRACTICE_CONSOLE_SIGN_IN.password));
  return { status: 200, contentType: 'text/html; charset=utf-8', body };
}

/** One roster row as a single browser run: add the person, then enroll them. */
export const PRACTICE_CONSOLE_TASK_EXAMPLE = {
  task: 'Sign in to Larkfield Logistics\' Lumen Awareness training console. Add Aisha Karim (aisha.karim@larkfield.example, Finance, role Learner) as a user, without sending a welcome email; if a user with that email already exists, do not add another. Then enroll her in the Q4 Security Awareness campaign. Report her user ID and her enrollments as her user page shows them.',
  startUrl: `${PRACTICE_CONSOLE_ORIGIN}/login`,
  inputs: {
    email: PRACTICE_CONSOLE_SIGN_IN.email,
    password: PRACTICE_CONSOLE_SIGN_IN.password,
    first_name: 'Aisha',
    last_name: 'Karim',
    user_email: 'aisha.karim@larkfield.example',
    department: 'Finance',
    role: 'Learner',
    campaign: PRACTICE_CONSOLE_ROSTER_CAMPAIGN.name,
  },
  secretInputs: ['password'],
  outputs: [
    { name: 'user_id', description: 'The ID the console gave the new user, like USR-4821' },
    { name: 'enrollments', description: 'Each campaign on her user page, with its enrolled date and progress' },
  ],
} as const;
