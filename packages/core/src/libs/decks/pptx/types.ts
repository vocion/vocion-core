/**
 * The shapes the PPTX adapter passes around. Pure data, no behaviour.
 *
 * `DeckFiles` is a structural subset of the contract's DeckSpec (docs/decks.md)
 * so the engine can hand its own spec straight in. Positions are in slide
 * pixels on the 1920 x 1080 canvas; the exporter converts to inches
 * (1920px = 13.333in, so 144 px/in) and font px to points (1px = 0.5pt).
 */

import type { Buffer } from 'node:buffer';

export type DeckFiles = {
  title: string;
  /** Slide ids in presentation order. */
  order: string[];
  /** Slide id to the slide's HTML (a `<section id="…">` element). */
  slides: Record<string, string>;
  faces?: Record<string, { family: string; href: string }>;
  assets?: Record<string, { url: string; contentType: string }>;
};

/** A box in slide pixels. */
export type Box = { x: number; y: number; w: number; h: number };

export type TextRun = {
  /** Text with `text-transform` already applied. `\n` is a line break. */
  text: string;
  fontFamily: string;
  sizePx: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  /** `RRGGBB`, no hash. */
  color: string;
};

export type TextObject = {
  kind: 'text';
  /** `vocion:<slideId>:<path>`. */
  name: string;
  box: Box;
  runs: TextRun[];
  align: 'left' | 'center' | 'right' | 'justify';
  /** Absolute line height in px, or null for the font's normal. */
  lineHeightPx: number | null;
  letterSpacingPx: number;
  /** A list item's marker. The box already excludes the marker's gutter. */
  bullet: 'bullet' | 'number' | null;
  /** Width of the marker gutter in px (only when `bullet` is set). */
  indentPx: number;
};

export type ImageObject = {
  kind: 'image';
  name: string;
  box: Box;
  /** PNG or JPEG bytes. */
  bytes: Buffer;
  contentType: 'image/png' | 'image/jpeg';
  /** The page's `src` (or `asset:<key>`) for the record; not used to export. */
  src: string;
  alt: string;
};

export type ShapeObject = {
  kind: 'shape';
  name: string;
  box: Box;
  shape: 'rect' | 'rounded' | 'ellipse';
  /** `RRGGBB` or null for no fill. */
  fill: string | null;
  /** 0 (opaque) to 1 (invisible). */
  fillTransparency: number;
  borderColor: string | null;
  borderPx: number;
  radiusPx: number;
};

export type RasterObject = {
  kind: 'raster';
  name: string;
  box: Box;
  /** A PNG of the element as rendered, at 2x. */
  png: Buffer;
  /** Why it has no native form, for the README and the report. */
  reason: string;
};

export type LayoutObject = TextObject | ImageObject | ShapeObject | RasterObject;

export type SlideLayout = {
  slideId: string;
  width: number;
  height: number;
  background: { color: string } | { png: Buffer };
  /** In paint order, back to front. */
  objects: LayoutObject[];
  /** The slide's `<aside>` text, paragraphs separated by `\n`. */
  notes: string;
};

export type ImportReportEntry = {
  slideId: string;
  status: 'kept' | 'text-edited' | 'converted' | 'added' | 'removed' | 'moved';
  details?: string[];
};

export type NewAsset = { key: string; bytes: Buffer; contentType: string };
