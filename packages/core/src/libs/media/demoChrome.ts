/**
 * WHAT A DEMO LOOKS LIKE — the one chrome every recorded demo wears (Chris, 2026-10-04:
 * "show mouse and movement, focus area when talking, and click animation or ripple";
 * 2026-10-05, on the preview demo: "There's a lot on the screen and I have no idea what the
 * narrator wants me looking at … ANYTHING"). A headless recording shows no pointer, so the
 * demo draws its own: a cursor that glides to the target before each action, a ripple where
 * it clicks, a thin outline in the accent round the area a line is about, and a keycap for a
 * key press. Injected into a demo context only; a check tab records the page as it is.
 *
 * Two recorders use it: QA's live browser (`services/factory/liveBrowser.ts`) and the runner's
 * preview demo from the branch (`packages/runner/src/qa.mjs`), which fetches it from
 * `GET /api/demo-chrome` so there is one definition. The page API it installs is
 * `window.__vocionDemo`: `moveTo(x, y)`, `ripple(x, y)`, `spotlight(rect | null)`,
 * `keycap(label | null)`, `focusRect()`.
 */
import { accentRgba, DEMO_ACCENT } from '@/libs/media/narration';

/** How long the cursor takes to reach its target before a click, matching the CSS transition. */
export const CURSOR_GLIDE_MS = 520;

// WHERE TO LOOK, subtly (Chris, 2026-10-04: "I just want to know where I should be
// looking on the page while the agent is talking … same color as our avatar overlay.
// Be subtle."): the area a line is about gets a thin outline in the one accent and a
// faint glow — no page dim, and nothing is ever given focus. The ripple on a click and
// the ring round the bubble share the accent (`DEMO_ACCENT`).
export const DEMO_CHROME_SCRIPT = `(() => {
  if (window.__vocionDemo) return;
  const css = document.createElement('style');
  css.textContent = [
    '#vocion-demo-cursor{position:fixed;left:0;top:0;width:22px;height:30px;z-index:2147483646;pointer-events:none;transform:translate(-9999px,-9999px);transition:transform 480ms cubic-bezier(.2,.7,.2,1);filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}',
    '.vocion-demo-ripple{position:fixed;width:12px;height:12px;border-radius:50%;z-index:2147483645;pointer-events:none;border:3px solid ${DEMO_ACCENT};background:${accentRgba(0.18)};transform:translate(-50%,-50%) scale(1);opacity:.95;animation:vocion-ripple 560ms ease-out forwards}',
    '@keyframes vocion-ripple{to{transform:translate(-50%,-50%) scale(5);opacity:0}}',
    '#vocion-demo-spot{position:fixed;z-index:2147483644;pointer-events:none;border-radius:10px;border:2px solid ${accentRgba(0.85)};box-shadow:0 0 0 4px ${accentRgba(0.16)},0 0 22px ${accentRgba(0.28)};transition:all 260ms ease;opacity:0}',
    '#vocion-demo-key{position:fixed;left:50%;bottom:28px;z-index:2147483647;pointer-events:none;transform:translateX(-50%) scale(.9);opacity:0;transition:opacity 160ms ease,transform 160ms ease;font:600 22px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;color:#111;background:#fff;border:1px solid #cfd3da;border-bottom-width:4px;border-radius:10px;padding:12px 18px;min-width:22px;text-align:center;box-shadow:0 6px 18px rgba(0,0,0,.22)}',
    '#vocion-demo-key.on{opacity:1;transform:translateX(-50%) scale(1)}',
    '#vocion-demo-key{border-bottom-color:${accentRgba(0.75)}}',
  ].join('\n');
  const mount = () => {
    if (!document.body) return false;
    document.head.appendChild(css);
    const cur = document.createElement('div');
    cur.id = 'vocion-demo-cursor';
    cur.innerHTML = '<svg viewBox="0 0 22 30" width="22" height="30" xmlns="http://www.w3.org/2000/svg"><path d="M2 1.5 L2 22.5 L7.4 17.6 L11.2 27.2 L15.2 25.6 L11.4 16.2 L18.6 16.2 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const spot = document.createElement('div');
    spot.id = 'vocion-demo-spot';
    document.body.appendChild(spot);
    const key = document.createElement('div');
    key.id = 'vocion-demo-key';
    document.body.appendChild(key);
    document.body.appendChild(cur);
    return true;
  };
  if (!mount()) document.addEventListener('DOMContentLoaded', mount, { once: true });
  let shown = false;
  window.__vocionDemo = {
    moveTo(x, y) {
      const c = document.getElementById('vocion-demo-cursor');
      if (!c) return;
      if (!shown) { c.style.transition = 'none'; c.style.transform = 'translate(' + (x - 40) + 'px,' + (y + 40) + 'px)'; void c.offsetWidth; c.style.transition = ''; shown = true; }
      c.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    },
    ripple(x, y) {
      const r = document.createElement('div');
      r.className = 'vocion-demo-ripple';
      r.style.left = x + 'px'; r.style.top = y + 'px';
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 700);
    },
    keycap(label) {
      const k = document.getElementById('vocion-demo-key');
      if (!k) return;
      if (!label) { k.classList.remove('on'); return; }
      k.textContent = label;
      k.classList.add('on');
    },
    focusRect() {
      const pick = () => {
        const a = document.activeElement;
        if (a && a !== document.body && a !== document.documentElement) return a;
        return document.querySelector('[aria-selected="true"],[data-selected="true"],[data-highlighted="true"],[aria-current="true"]');
      };
      const el = pick();
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    },
    spotlight(rect) {
      const s = document.getElementById('vocion-demo-spot');
      if (!s) return;
      if (!rect) { s.style.opacity = '0'; return; }
      const pad = 10;
      s.style.left = (rect.x - pad) + 'px'; s.style.top = (rect.y - pad) + 'px';
      s.style.width = (rect.width + pad * 2) + 'px'; s.style.height = (rect.height + pad * 2) + 'px';
      s.style.opacity = '1';
    },
  };
})();`;
