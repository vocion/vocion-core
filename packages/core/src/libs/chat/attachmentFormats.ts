/**
 * The files a chat turn can carry, and what a person is told when one cannot
 * come along.
 *
 * Pure and dependency-free on purpose: the composer reads it in the browser
 * (the file picker's `accept`, a refusal before a 300 MB upload starts, the
 * chip's label) and the upload route reads it on the server, so the two can
 * never disagree about what is accepted or say it in different words.
 *
 * The copy rule (founder, 2026-10-09, after "Export-All-Leads.xlsx" came back
 * as "this is application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"):
 * a person never reads a MIME type. A refusal is one line in plain words that
 * names the file, says what Vocion cannot do, and when there is one, the move
 * that works ("Export it as PDF or PowerPoint").
 */

/** How the model receives a file: an image block, or text under the message. */
export type AttachmentKind = 'image' | 'document';

/**
 * What the file is, which decides how it is read. `sheet` files are tables
 * the agent can filter row by row; the rest are text.
 */
export type AttachmentFamily = 'image' | 'pdf' | 'text' | 'sheet' | 'doc' | 'slides' | 'mail';

export type AttachmentFormat = {
  ext: string;
  contentType: string;
  kind: AttachmentKind;
  family: AttachmentFamily;
  /** How a person would name it: "Excel spreadsheet", "PDF". */
  label: string;
};

const F = (ext: string, contentType: string, family: AttachmentFamily, label: string): AttachmentFormat => ({
  ext,
  contentType,
  kind: family === 'image' ? 'image' : 'document',
  family,
  label,
});

/** Every accepted format, by extension. The first entry for a type is its canonical extension. */
export const ATTACHMENT_FORMATS: readonly AttachmentFormat[] = [
  F('png', 'image/png', 'image', 'PNG image'),
  F('jpg', 'image/jpeg', 'image', 'JPEG image'),
  F('jpeg', 'image/jpeg', 'image', 'JPEG image'),
  F('webp', 'image/webp', 'image', 'WebP image'),
  F('gif', 'image/gif', 'image', 'GIF image'),
  F('pdf', 'application/pdf', 'pdf', 'PDF'),
  F('txt', 'text/plain', 'text', 'Text file'),
  F('md', 'text/markdown', 'text', 'Markdown'),
  F('markdown', 'text/markdown', 'text', 'Markdown'),
  F('json', 'application/json', 'text', 'JSON'),
  F('html', 'text/html', 'text', 'Web page'),
  F('htm', 'text/html', 'text', 'Web page'),
  F('xml', 'application/xml', 'text', 'XML'),
  F('csv', 'text/csv', 'sheet', 'CSV'),
  F('tsv', 'text/tab-separated-values', 'sheet', 'TSV'),
  F('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'sheet', 'Excel spreadsheet'),
  F('xlsm', 'application/vnd.ms-excel.sheet.macroenabled.12', 'sheet', 'Excel spreadsheet'),
  F('xls', 'application/vnd.ms-excel', 'sheet', 'Excel spreadsheet'),
  F('ods', 'application/vnd.oasis.opendocument.spreadsheet', 'sheet', 'OpenDocument spreadsheet'),
  F('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'doc', 'Word document'),
  F('odt', 'application/vnd.oasis.opendocument.text', 'doc', 'OpenDocument text'),
  F('pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'slides', 'PowerPoint deck'),
  F('odp', 'application/vnd.oasis.opendocument.presentation', 'slides', 'OpenDocument slides'),
  F('eml', 'message/rfc822', 'mail', 'Email'),
  F('msg', 'application/vnd.ms-outlook', 'mail', 'Outlook email'),
];

const BY_EXT = new Map(ATTACHMENT_FORMATS.map(f => [f.ext, f]));
const BY_TYPE = new Map<string, AttachmentFormat>();
for (const f of ATTACHMENT_FORMATS) {
  if (!BY_TYPE.has(f.contentType)) {
    BY_TYPE.set(f.contentType, f);
  }
}
// Types browsers and mail clients report for the same files under other names.
BY_TYPE.set('text/xml', BY_EXT.get('xml')!);
BY_TYPE.set('application/csv', BY_EXT.get('csv')!);
BY_TYPE.set('application/vnd.ms-excel.sheet.macroEnabled.12'.toLowerCase(), BY_EXT.get('xlsm')!);

/** Files at or over this many bytes are refused, whatever they are. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Images are sent to the model inline; the vendors cap them around here. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** How many files one message may carry. */
export const MAX_ATTACHMENTS = 10;

/**
 * The file picker's `accept`: every extension, so a picker on any OS offers
 * exactly what the server takes.
 */
export const ATTACHMENT_ACCEPT = ATTACHMENT_FORMATS.map(f => `.${f.ext}`).join(',');

/** One line for the composer's hint: what can be attached. */
export const ATTACHMENT_HINT = 'PDF, Office, image or text file';

/**
 * The lower-cased extension of a file name, without the dot; '' when there is none.
 * @param name - A file name.
 */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * The format a file is, from its name first and its reported type second.
 * The extension wins because browsers report `application/octet-stream` (or
 * nothing) for `.md`, `.msg` and friends, and Windows reports `.csv` as
 * `application/vnd.ms-excel`.
 * @param file - Name and reported type.
 * @param file.name
 * @param file.type
 */
export function formatOf(file: { name: string; type?: string }): AttachmentFormat | null {
  const byExt = BY_EXT.get(extensionOf(file.name));
  if (byExt) {
    return byExt;
  }
  const reported = (file.type ?? '').split(';')[0]!.trim().toLowerCase();
  return BY_TYPE.get(reported) ?? null;
}

/**
 * What to do instead, for formats people commonly try. Keyed by extension.
 */
const INSTEAD: Record<string, string> = {
  'key': 'Export it as PDF or PowerPoint.',
  'pages': 'Export it as PDF or Word.',
  'numbers': 'Export it as Excel or CSV.',
  'doc': 'Save it as .docx or PDF.',
  'dot': 'Save it as .docx or PDF.',
  'rtf': 'Save it as .docx or PDF.',
  'ppt': 'Save it as .pptx or PDF.',
  'pps': 'Save it as .pptx or PDF.',
  'ppsx': 'Save it as .pptx or PDF.',
  'xlsb': 'Save it as .xlsx or CSV.',
  'odg': 'Export it as PDF or PNG.',
  'heic': 'Export it as JPEG or PNG.',
  'heif': 'Export it as JPEG or PNG.',
  'tif': 'Export it as PNG or JPEG.',
  'tiff': 'Export it as PNG or JPEG.',
  'bmp': 'Export it as PNG or JPEG.',
  'svg': 'Export it as PNG.',
  'psd': 'Export it as PNG or JPEG.',
  'ai': 'Export it as PDF or PNG.',
  'sketch': 'Export it as PDF or PNG.',
  'fig': 'Export it as PDF or PNG.',
  'zip': 'Unzip it and attach the files inside.',
  'rar': 'Unpack it and attach the files inside.',
  '7z': 'Unpack it and attach the files inside.',
  'gz': 'Unpack it and attach the files inside.',
  'tar': 'Unpack it and attach the files inside.',
  'mp4': 'Share it from your phone, or attach a transcript.',
  'mov': 'Share it from your phone, or attach a transcript.',
  'm4a': 'Attach a transcript instead.',
  'mp3': 'Attach a transcript instead.',
  'wav': 'Attach a transcript instead.',
};

function sizeText(n: number): string {
  const mb = n / (1024 * 1024);
  if (mb >= 1) {
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  }
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * A size the way a chip shows it: "820 KB", "1.2 MB".
 * @param n - Bytes.
 */
export function formatBytes(n: number): string {
  return sizeText(n);
}

/**
 * Why a file cannot be attached, in one plain line, or null when it can.
 * Never names a MIME type.
 * @param file - Name, reported type and size.
 * @param file.name
 * @param file.type
 * @param file.size
 */
export function refusalFor(file: { name: string; type?: string; size: number }): string | null {
  const format = formatOf(file);
  if (!format) {
    const ext = extensionOf(file.name);
    if (!ext) {
      return `Vocion can't tell what kind of file “${file.name}” is. Add an extension like .pdf or .xlsx and try again.`;
    }
    const instead = INSTEAD[ext] ?? 'Attach a PDF, an Office file, an image or a text file.';
    return `Vocion can't read .${ext} files yet. ${instead}`;
  }
  if (file.size <= 0) {
    return `${file.name} is empty.`;
  }
  if (format.kind === 'image' && file.size > MAX_IMAGE_BYTES) {
    return `${file.name} is ${sizeText(file.size)}. Images can be up to ${sizeText(MAX_IMAGE_BYTES)}; a smaller export or a screenshot works.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is ${sizeText(file.size)}. Files can be up to ${sizeText(MAX_UPLOAD_BYTES)}.`;
  }
  return null;
}
