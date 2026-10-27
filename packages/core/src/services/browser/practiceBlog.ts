/**
 * THE PRACTICE BLOG EDITOR: a third practice site, shaped like a hosted site
 * builder's blog editor (Squarespace 7.1's, in outline), served inside the
 * browser itself like Fernhill's portal (`practiceSite.ts`), so the Squarespace
 * publish run (`services/publish/squarespaceTask.ts`) can be shown and tested
 * end to end without anyone's real site or login.
 *
 * Northwind Outfitters' site, fictional: a sign-in at `/config`, a "What's
 * new" dialog in the way, a Pages panel with the blog (Journal), its post list
 * with one published post, an Add blog post button, and the post editor as
 * 7.1 draws it: a top bar of PUBLISH, Save and Exit with the post's name and
 * status, a title and a body that are rich-text areas named only by their
 * placeholders ("Enter a post title…", "Write here..."), the body taking pasted
 * formatted text, and Blog Post Settings (Content: Excerpt, Post URL; SEO: SEO
 * title, SEO description; SAVE). A post goes live only with PUBLISH. Its "server" is the page's localStorage, so a
 * second run in the same browser is still signed in and sees the draft the
 * first one saved; the public blog at `/journal` lists only published posts.
 */

export const PRACTICE_BLOG_ORIGIN = 'https://site.northwind-outfitters.test';

/** The editor's sign-in. It opens nothing real. */
export const PRACTICE_BLOG_SIGN_IN = { email: 'editor@northwind-outfitters.example', password: 'northwind-demo' } as const;

/** The blog's path on the practice site. */
export const PRACTICE_BLOG_PATH = '/journal';

const SEED_POSTS = [
  { id: 'p1', title: 'Layering for Shoulder Season', slug: 'layering-for-shoulder-season', status: 'Published', body: '<h2>Three layers</h2><p>A base, a mid and a shell.</p>', excerpt: 'Three layers, and when to shed each one.', seoTitle: '', seoDescription: '' },
];

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Northwind Outfitters · Editor</title>
<style>
*{box-sizing:border-box}body{margin:0;font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;background:#f5f5f3}
.tag{position:fixed;right:12px;bottom:12px;font-size:11px;background:#111;color:#fff;padding:3px 8px;border-radius:4px}
.wrap{display:flex;min-height:100vh}.panel{width:300px;background:#fff;border-right:1px solid #ddd;padding:18px}.main{flex:1;padding:28px}
h1{font-size:20px;margin:0 0 12px}h2{font-size:15px;margin:16px 0 8px}ul{list-style:none;padding:0;margin:0}li{padding:8px 0;border-bottom:1px solid #eee;display:flex;justify-content:space-between;gap:8px}
label{display:block;font-weight:600;margin:12px 0 4px}input,textarea,select{font:inherit;padding:8px;border:1px solid #bbb;border-radius:4px;width:100%}textarea{min-height:160px}
button{font:inherit;padding:7px 14px;border-radius:4px;border:1px solid #111;background:#111;color:#fff;cursor:pointer}button.ghost{background:#fff;color:#111}
.login{max-width:380px;margin:90px auto;background:#fff;padding:28px;border:1px solid #ddd;border-radius:6px}
.err{color:#a1261d;margin-top:10px}.muted{color:#666}.pill{font-size:11px;padding:1px 7px;border-radius:9px;background:#eee}
.dialog{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center}.dialog>div{background:#fff;padding:22px;border-radius:6px;width:520px;max-width:95vw}
.tabs{display:flex;gap:8px;margin-bottom:8px}.tabs button{background:#fff;color:#111}.tabs button[aria-selected=true]{background:#111;color:#fff}
.block{border:1px dashed #bbb;padding:10px;margin:8px 0;white-space:pre-wrap;background:#fff}.bar{display:flex;gap:10px;align-items:end;margin-top:18px}.bar>div{width:200px}
</style></head><body><div id="app"></div><div class="tag">Practice site · fictional data</div>
<script>
const SIGN_IN = __SIGN_IN__;
const SEED = __SEED__;
const S = { get: k => JSON.parse(localStorage.getItem('nw.' + k) || 'null'), set: (k, v) => localStorage.setItem('nw.' + k, JSON.stringify(v)) };
const posts = () => S.get('posts') || SEED;
const savePosts = p => S.set('posts', p);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const app = document.getElementById('app');
const path = location.pathname.replace(/\/+$/, '') || '/';
function login(msg) {
  app.innerHTML = '<div class="login"><h1>Log in to Squarespace (practice)</h1><form id="f"><label for="em">Email</label><input id="em" type="email" autocomplete="username"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password"><div style="margin-top:16px"><button type="submit">Log In</button></div>' + (msg ? '<div class="err" role="alert">' + esc(msg) + '</div>' : '') + '</form></div>';
  document.getElementById('f').onsubmit = e => {
    e.preventDefault();
    if (document.getElementById('em').value.trim() !== SIGN_IN.email || document.getElementById('pw').value !== SIGN_IN.password) return login('Your email or password is incorrect.');
    S.set('user', true);
    location.href = '/config/pages';
  };
}
function whatsNew() {
  if (S.get('seenNew')) return;
  const d = document.createElement('div'); d.className = 'dialog'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', "What's new");
  d.innerHTML = "<div><h1>What's new</h1><p>Blog posts can now be scheduled.</p><button id='nx'>Close</button></div>";
  document.body.appendChild(d);
  d.querySelector('#nx').onclick = () => { S.set('seenNew', true); d.remove(); };
}
function pages() {
  app.innerHTML = '<div class="wrap"><nav class="panel" aria-label="Pages"><h1>Pages</h1><h2>Main navigation</h2><ul>'
    + '<li><a href="/config/pages">Home</a></li><li><a href="/config/pages">Shop</a></li><li><a href="/config/pages/journal">Journal</a><span class="pill">Blog</span></li></ul></nav><main class="main"><p class="muted">Pick a page to edit.</p></main></div>';
  whatsNew();
}
function blog() {
  const list = posts();
  app.innerHTML = '<div class="wrap"><nav class="panel" aria-label="Journal"><p><a href="/config/pages">← Pages</a></p><h1>Journal</h1><button id="add">Add blog post</button><ul style="margin-top:12px">'
    + list.map(p => '<li><a href="/config/pages/journal/' + p.id + '">' + esc(p.title || 'Untitled') + '</a><span class="pill">' + p.status + '</span></li>').join('') + '</ul></nav><main class="main"><p class="muted">Pick a post, or add one.</p></main></div>';
  document.getElementById('add').onclick = () => { const id = 'p' + Date.now(); savePosts([...posts(), { id, title: '', slug: '', status: 'Draft', body: '', excerpt: '', seoTitle: '', seoDescription: '' }]); location.href = '/config/pages/journal/' + id; };
  whatsNew();
}
function editor(id) {
  const all = posts(); const p = all.find(x => x.id === id);
  if (!p) { app.innerHTML = '<p>No such post.</p>'; return; }
  const draft = Object.assign({}, p);
  const draw = () => {
    app.innerHTML = '<div class="bar" style="margin:0;padding:10px 18px;background:#fff;border-bottom:1px solid #ddd;align-items:center">'
      + '<button id="pub">PUBLISH</button><button class="ghost" id="save">Save</button><a href="/config/pages/journal">Exit</a>'
      + '<button class="ghost" id="st" style="margin:0 auto">' + esc(p.title || 'No Title') + ' · Post · ' + esc(p.status) + '</button></div>'
      + '<main class="main" style="max-width:760px;margin:0 auto">'
      + '<div id="ti" contenteditable="true" data-placeholder="Enter a post title…" style="font-size:34px;font-weight:700;min-height:44px;outline:1px dashed #ccc">' + esc(draft.title) + '</div>'
      + '<div id="bd" contenteditable="true" data-placeholder="Write here..." style="min-height:160px;margin-top:18px;outline:1px dashed #ccc">' + draft.body + '</div>'
      + '<p id="msg" role="status" class="muted"></p></main>';
    const ti = document.getElementById('ti'); const bd = document.getElementById('bd');
    ti.oninput = () => { draft.title = ti.innerText.trim(); };
    bd.oninput = () => { draft.body = bd.innerHTML; };
    // A paste of formatted text keeps its headings and lists, as the real editor's does.
    bd.addEventListener('paste', e => { const html = e.clipboardData && e.clipboardData.getData('text/html'); if (html) { e.preventDefault(); bd.innerHTML = html; draft.body = html; } });
    document.getElementById('st').onclick = settings;
    document.getElementById('save').onclick = () => persist(draft.status);
    document.getElementById('pub').onclick = () => persist('Published');
  };
  const persist = status => {
    draft.status = status;
    savePosts(posts().map(x => x.id === id ? Object.assign({}, draft) : x));
    Object.assign(p, draft);
    draw();
    document.getElementById('msg').textContent = status === 'Published' ? 'Published.' : 'Saved as ' + status + '.';
  };
  const settings = () => {
    const d = document.createElement('div'); d.className = 'dialog'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Blog Post Settings');
    const tab = t => {
      d.innerHTML = '<div><button id="dn">SAVE</button><h1>Blog Post Settings</h1><div class="tabs" role="tablist"><button role="tab" id="tc" aria-selected="' + (t === 'c') + '">Content</button><button role="tab" id="ts" aria-selected="' + (t === 's') + '">SEO</button></div>'
        + (t === 'c' ? '<label for="ex">Excerpt</label><textarea id="ex">' + esc(draft.excerpt) + '</textarea><label for="pu">Post URL</label><input id="pu" value="' + esc(draft.slug ? '/journal/' + draft.slug : '') + '">'
          : '<label for="sti">SEO title</label><input id="sti" value="' + esc(draft.seoTitle) + '"><label for="sde">SEO description</label><textarea id="sde">' + esc(draft.seoDescription) + '</textarea>')
        + '</div>';
      const keep = () => { if (t === 'c') { draft.slug = d.querySelector('#pu').value.trim().split('/').filter(Boolean).pop() || ''; draft.excerpt = d.querySelector('#ex').value; } else { draft.seoTitle = d.querySelector('#sti').value; draft.seoDescription = d.querySelector('#sde').value; } };
      d.querySelector('#tc').onclick = () => { keep(); tab('c'); }; d.querySelector('#ts').onclick = () => { keep(); tab('s'); };
      d.querySelector('#dn').onclick = () => { keep(); d.remove(); };
    };
    document.body.appendChild(d); tab('c');
  };
  draw();
}
function publicBlog() {
  const live = posts().filter(p => p.status === 'Published');
  const slug = decodeURIComponent(path.slice('/journal/'.length));
  const one = path.startsWith('/journal/') ? live.find(p => p.slug === slug) : null;
  app.innerHTML = '<main class="main"><h1>' + (one ? esc(one.title) : 'Journal') + '</h1>' + (one ? '<div class="block">' + one.body + '</div>' : '<ul>' + live.map(p => '<li><a href="/journal/' + esc(p.slug) + '">' + esc(p.title) + '</a></li>').join('') + '</ul>') + '</main>';
}
if (path === '/journal' || path.startsWith('/journal/')) publicBlog();
else if (!S.get('user') || path === '/config' || path === '/login') { if (S.get('user') && path === '/config') location.href = '/config/pages'; else login(); }
else if (path === '/config/pages') pages();
else if (path === '/config/pages/journal') blog();
else if (path.startsWith('/config/pages/journal/')) editor(decodeURIComponent(path.slice('/config/pages/journal/'.length)));
else app.innerHTML = '<main class="main"><h1>Northwind Outfitters</h1><p>Gear for every season.</p></main>';
</script></body></html>`;

/**
 * What the practice blog answers for this address, or null when it is not the practice blog.
 * @param url - The request's address.
 */
export function practiceBlogResponse(url: string): { status: number; contentType: string; body: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== PRACTICE_BLOG_ORIGIN) {
    return null;
  }
  if (u.pathname === '/favicon.ico') {
    return { status: 404, contentType: 'text/plain', body: '' };
  }
  const body = PAGE.replace('__SIGN_IN__', JSON.stringify(PRACTICE_BLOG_SIGN_IN)).replace('__SEED__', JSON.stringify(SEED_POSTS));
  return { status: 200, contentType: 'text/html; charset=utf-8', body };
}
