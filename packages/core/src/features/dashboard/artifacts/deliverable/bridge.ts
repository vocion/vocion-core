/**
 * The script a page frame carries, and the messages it speaks.
 *
 * The page renders in a sandboxed iframe with no `allow-same-origin`, so the
 * pane cannot reach into it; this small script is the whole conversation:
 *
 *   - It **stamps** every element under the page root (`data-vp`, its index
 *     in document order) BEFORE Vocion's element runtime runs, so a path is
 *     the same index the pane gets by parsing the stored HTML — the runtime's
 *     generated SVG and spans carry no stamp and are never editable.
 *   - It makes **leaf text elements** (only text inside, outside notes, SVG
 *     and Vocion's own elements) editable in place: click, or Enter/F2 on a
 *     focused one; Enter or leaving commits, Escape puts the words back. It
 *     posts `{path, before, after}`; the pane edits the text nodes of the
 *     stored HTML and writes the version. Markup is never sent back.
 *   - It posts a **selection** the same way `DocumentFrame` does, so
 *     select-to-talk (Ask / Change) works on every page.
 *   - It answers a tour's `vocion:scroll-to` and `vocion:document-scroll` by
 *     asking the pane to select that page, since only one page is in the frame.
 *   - It reports the page's **size**, so a sheet is scaled by its real height.
 *
 * ES5 and dependency-free: it runs inside the client's page.
 */

export const EDIT_MESSAGE = 'vocion:deliverable-edit';
export const SELECT_MESSAGE = 'vocion:deliverable-select';
export const SIZE_MESSAGE = 'vocion:deliverable-size';

export type EditMessage = { type: typeof EDIT_MESSAGE; frame: string; path: number; before: string; after: string };
export type SelectRequestMessage = { type: typeof SELECT_MESSAGE; frame: string; index?: number; to?: 'next' | 'prev' | 'top' | number };
export type SizeMessage = { type: typeof SIZE_MESSAGE; frame: string; w: number; h: number };

export type BridgeOptions = {
  /** Keeps two open frames apart. */
  frame: string;
  /** The page's root element: `.vocion-slide > section` or `.sheet`. */
  root: string;
  /** Text can be edited in place (false for an older version, a thumbnail, present mode). */
  editable: boolean;
  /** Post selections up for select-to-talk. */
  selection: boolean;
};

const STYLE = [
  '[data-vp-leaf]{cursor:text}',
  '[data-vp-leaf]:hover,[data-vp-leaf]:focus-visible{outline:4px dashed rgba(37,99,235,.75);outline-offset:4px}',
  '[data-vp-editing]{outline:4px solid #2563eb!important;outline-offset:4px;cursor:text}',
].join('');

function source(o: BridgeOptions): string {
  return `(function(){
var F=${JSON.stringify(o.frame)},ROOT=${JSON.stringify(o.root)},ED=${o.editable ? 'true' : 'false'},SEL=${o.selection ? 'true' : 'false'};
function post(m){m.frame=F;parent.postMessage(m,'*');}
var root=document.querySelector(ROOT),editing=null,before='';
function leaf(el){if(el.closest('aside,svg,x-icon,x-shape,x-connector,script,style,a'))return false;var c=el.childNodes;if(!c.length)return false;for(var i=0;i<c.length;i++){if(c[i].nodeType!==3)return false;}return /\\S/.test(el.textContent);}
if(root){var all=root.querySelectorAll('*');for(var i=0;i<all.length;i++){all[i].setAttribute('data-vp',String(i));if(ED&&leaf(all[i])){all[i].setAttribute('data-vp-leaf','');all[i].setAttribute('tabindex','0');}}}
if(ED){var st=document.createElement('style');st.textContent=${JSON.stringify(STYLE)};document.head.appendChild(st);}
function caret(x,y){try{var r=null;if(document.caretRangeFromPoint){r=document.caretRangeFromPoint(x,y);}else if(document.caretPositionFromPoint){var p=document.caretPositionFromPoint(x,y);if(p){r=document.createRange();r.setStart(p.offsetNode,p.offset);}}if(r){var s=getSelection();s.removeAllRanges();s.addRange(r);}}catch(e){}}
function start(el,x,y){editing=el;before=el.textContent;el.setAttribute('contenteditable','plaintext-only');if(el.contentEditable!=='plaintext-only'){el.setAttribute('contenteditable','true');}el.setAttribute('data-vp-editing','');el.focus();if(x!==undefined){caret(x,y);}}
function finish(commit){var el=editing;if(!el)return;editing=null;el.removeAttribute('contenteditable');el.removeAttribute('data-vp-editing');if(!commit){el.textContent=before;return;}var after=el.textContent;if(after!==before){post({type:${JSON.stringify(EDIT_MESSAGE)},path:Number(el.getAttribute('data-vp')),before:before,after:after});}}
document.addEventListener('click',function(e){if(!ED)return;var s=getSelection();if(s&&!s.isCollapsed&&!editing)return;var t=e.target&&e.target.closest?e.target.closest('[data-vp-leaf]'):null;if(!t||t===editing)return;if(editing)finish(true);start(t,e.clientX,e.clientY);});
document.addEventListener('keydown',function(e){if(editing){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();editing.blur();}else if(e.key==='Escape'){e.preventDefault();finish(false);}return;}var t=e.target;if(ED&&t&&t.hasAttribute&&t.hasAttribute('data-vp-leaf')&&(e.key==='Enter'||e.key==='F2')){e.preventDefault();start(t);}});
document.addEventListener('focusout',function(e){if(editing&&e.target===editing)finish(true);});
document.addEventListener('paste',function(e){if(!editing)return;e.preventDefault();var t=(e.clipboardData&&e.clipboardData.getData('text/plain'))||'';document.execCommand('insertText',false,t.replace(/\\s*\\n\\s*/g,' '));});
function selection(){if(!SEL||editing)return;var s=getSelection();var t=s?String(s).trim():'';var r=null;try{if(s&&s.rangeCount&&!s.isCollapsed){r=s.getRangeAt(0).getBoundingClientRect();}}catch(e){}parent.postMessage({type:'vocion:document-selection',frame:F,text:t.length>=4&&r?t:'',x:r?r.left+r.width/2:0,y:r?r.top:0},'*');}
document.addEventListener('mouseup',function(){setTimeout(selection,0);});
document.addEventListener('mousedown',function(){if(SEL)parent.postMessage({type:'vocion:document-selection',frame:F,text:'',x:0,y:0},'*');});
window.addEventListener('message',function(e){var d=e.data;if(!d||e.source!==parent)return;if(d.type==='vocion:scroll-to'){post({type:${JSON.stringify(SELECT_MESSAGE)},index:d.index|0});}else if(d.type==='vocion:document-scroll'&&(!d.frame||d.frame===F)){post({type:${JSON.stringify(SELECT_MESSAGE)},to:d.to});}});
function size(){var d=document.documentElement;post({type:${JSON.stringify(SIZE_MESSAGE)},w:d.scrollWidth,h:d.scrollHeight});}
window.addEventListener('load',size);window.addEventListener('resize',size);if(document.fonts&&document.fonts.ready){document.fonts.ready.then(size);}size();
})();`;
}

/**
 * The page with its bridge. On a deck page the bridge goes in just before
 * the runtime, so it stamps the author's elements before any are generated;
 * anywhere else, before `</body>`.
 * @param html - The page document (`pageDocument`).
 * @param opts - Which frame, which root, and what it may do.
 */
export function withPageBridge(html: string, opts: BridgeOptions): string {
  // `</script>` cannot occur in the source: the only strings it embeds are JSON-encoded options.
  const script = `<script data-vocion-bridge>${source(opts).replace(/<\/script/gi, '<\\/script')}</script>`;
  const runtime = html.indexOf('<script>window.__VOCION_ICONS');
  if (runtime !== -1) {
    return `${html.slice(0, runtime)}${script}${html.slice(runtime)}`;
  }
  const end = html.lastIndexOf('</body>');
  return end === -1 ? `${html}${script}` : `${html.slice(0, end)}${script}${html.slice(end)}`;
}
