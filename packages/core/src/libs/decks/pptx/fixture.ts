/**
 * A small fictional deck for the adapter tests. Plain sections at 1920 x 1080,
 * stacked on one page the way the engine renders them for measurement.
 */

import type { DeckFiles } from './types';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const FIXTURE_SLIDES: Record<string, string> = {
  cover: `<section id="cover" style="width:1920px;height:1080px;position:relative;background:#0F1B2D;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;overflow:hidden">
  <h1 style="position:absolute;left:120px;top:160px;width:1400px;margin:0;font-size:96px;font-weight:700;line-height:110px">Northwind quarterly review</h1>
  <p style="position:absolute;left:120px;top:420px;width:1200px;margin:0;font-size:40px;line-height:56px">Prepared for <b>Kestrel Capital</b> and the Larkfield Systems team.</p>
  <div style="position:absolute;left:120px;top:700px;width:600px;height:120px;background:linear-gradient(90deg,#1C6D69,#F18700);border-radius:12px"></div>
  <aside><p>Open with the headline number.</p><p>Pause for questions.</p></aside>
</section>`,
  numbers: `<section id="numbers" style="width:1920px;height:1080px;position:relative;background:#FFFFFF;color:#1A1A1A;font-family:Helvetica,Arial,sans-serif;overflow:hidden">
  <h2 style="position:absolute;left:120px;top:100px;margin:0;font-size:64px">Where Contoso Supply stands</h2>
  <ul style="position:absolute;left:120px;top:260px;width:1100px;margin:0;padding-left:48px;font-size:36px;line-height:54px">
    <li>Orders are up eleven percent</li>
    <li>Returns are down <i>two points</i></li>
  </ul>
  <div style="position:absolute;left:1300px;top:260px;width:360px;height:200px;background:#EEF2F6;border:4px solid #1C6D69;border-radius:24px"></div>
  <svg style="position:absolute;left:1300px;top:540px" width="300" height="200" viewBox="0 0 300 200"><circle cx="100" cy="100" r="80" fill="#1C6D69"/><rect x="190" y="40" width="80" height="120" fill="#F18700"/></svg>
  <img src="data:image/png;base64,${PNG_1PX}" alt="Acme mark" style="position:absolute;left:120px;top:700px;width:200px;height:200px">
</section>`,
  closing: `<section id="closing" style="width:1920px;height:1080px;position:relative;background:#F4EFE6;color:#222;font-family:Helvetica,Arial,sans-serif;overflow:hidden">
  <h2 style="position:absolute;left:120px;top:400px;margin:0;font-size:72px;text-transform:uppercase;letter-spacing:4px">Thank you</h2>
</section>`,
};

export const FIXTURE_DECK: DeckFiles = {
  title: 'Northwind quarterly review',
  order: ['cover', 'numbers', 'closing'],
  slides: FIXTURE_SLIDES,
};

export function fixturePage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#888}section{display:block;box-sizing:border-box}</style></head><body>${FIXTURE_DECK.order.map(id => FIXTURE_SLIDES[id]).join('\n')}</body></html>`;
}
