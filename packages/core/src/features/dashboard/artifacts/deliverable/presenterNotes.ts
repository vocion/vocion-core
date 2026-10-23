/**
 * Present mode's second window: the current slide's notes, the next slide,
 * and the counter, kept in step with the presenting window over a
 * `BroadcastChannel` named for the deck. The presenting window owns the
 * state and broadcasts it on every move; this window says hello when it
 * opens (so it is filled at once) and can move the deck itself (buttons,
 * arrow keys, space).
 *
 * The window is written by the presenter (`window.open` + `document.write`),
 * so it needs no route of its own; it is self-contained and dependency-free.
 */

export const presenterChannel = (artifactId: number) => `vocion-present:${artifactId}`;

/** What the presenter broadcasts. `next.html` is the next slide's page, for a live thumbnail when there is no screenshot. */
export type PresenterState = {
  type: 'state';
  n: number;
  total: number;
  label: string;
  notes: string;
  next: { n: number; label: string; image?: string; html?: string } | null;
  ended?: boolean;
};

export type PresenterMessage = PresenterState | { type: 'hello' } | { type: 'go'; to: 'next' | 'prev' };

export type PresenterNotesCopy = {
  title: string;
  heading: string;
  noNotes: string;
  next: string;
  end: string;
  previous: string;
  forward: string;
  waiting: string;
  ended: string;
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The notes window's whole document.
 * @param channel - `presenterChannel(id)`.
 * @param copy - Its words, already translated.
 */
export function presenterNotesHtml(channel: string, copy: PresenterNotesCopy): string {
  const c = JSON.stringify(copy).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(copy.title)}</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#111;color:#eee;display:grid;grid-template-columns:minmax(0,1fr) 340px;grid-template-rows:auto minmax(0,1fr);gap:16px;padding:16px}
header{grid-column:1/-1;display:flex;align-items:center;gap:12px}
h1{font-size:14px;font-weight:600;margin:0;color:#aaa;flex:1}
#count{font-variant-numeric:tabular-nums;font-size:20px;font-weight:600}
button{font:inherit;font-size:14px;background:#2a2a2a;color:#eee;border:1px solid #444;border-radius:6px;padding:6px 12px;cursor:pointer}
button:hover{background:#333}button:focus-visible{outline:2px solid #6aa0ff;outline-offset:2px}
#notes{overflow:auto;font-size:22px;line-height:1.5;white-space:pre-wrap;padding-right:8px}
#notes.empty{color:#888;font-style:italic}
aside h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#999;margin:0 0 8px}
#thumb{position:relative;width:340px;height:191px;background:#222;border:1px solid #444;border-radius:6px;overflow:hidden}
#thumb img{width:100%;height:100%;object-fit:contain;background:#fff}
#thumb iframe{position:absolute;left:0;top:0;width:1920px;height:1080px;border:0;transform:scale(${340 / 1920});transform-origin:top left;pointer-events:none;background:#fff}
#nextLabel{font-size:13px;color:#bbb;margin-top:6px}
</style></head>
<body>
<header><h1 id="h"></h1><span id="count" aria-live="polite"></span><button type="button" id="prev"></button><button type="button" id="fwd"></button></header>
<main id="notes" aria-live="polite"></main>
<aside><h2 id="nextH"></h2><div id="thumb"></div><div id="nextLabel"></div></aside>
<script>(function(){
var C=${c};var ch=new BroadcastChannel(${JSON.stringify(channel)});
var $=function(id){return document.getElementById(id);};
$('h').textContent=C.heading;$('prev').textContent=C.previous;$('fwd').textContent=C.forward;$('nextH').textContent=C.next;$('notes').textContent=C.waiting;
var shown=null;
function render(s){
 if(s.ended){$('notes').textContent=C.ended;$('notes').className='empty';return;}
 $('count').textContent=s.n+' / '+s.total;
 document.title=C.title+' · '+s.n+' / '+s.total;
 $('notes').textContent=s.notes||C.noNotes;$('notes').className=s.notes?'':'empty';
 var t=$('thumb');var key=s.next?(s.next.image||s.next.html||''):'';
 if(key!==shown){shown=key;t.textContent='';
  if(s.next&&s.next.image){var i=document.createElement('img');i.src=s.next.image;i.alt='';t.appendChild(i);}
  else if(s.next&&s.next.html){var f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts');f.setAttribute('title',C.next);f.srcdoc=s.next.html;t.appendChild(f);}}
 $('nextLabel').textContent=s.next?(s.next.n+'. '+(s.next.label||'')):C.end;
}
ch.onmessage=function(e){if(e.data&&e.data.type==='state')render(e.data);};
function go(to){ch.postMessage({type:'go',to:to});}
$('prev').onclick=function(){go('prev');};$('fwd').onclick=function(){go('next');};
document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='ArrowDown'||e.key===' '||e.key==='PageDown'){e.preventDefault();go('next');}else if(e.key==='ArrowLeft'||e.key==='ArrowUp'||e.key==='PageUp'){e.preventDefault();go('prev');}});
ch.postMessage({type:'hello'});
})();</script>
</body></html>`;
}
