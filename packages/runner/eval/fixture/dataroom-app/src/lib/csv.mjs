// CSV the way every export writes it: a header row, CRLF line ends, fields quoted when they hold a
// comma, a quote or a line break, and a leading = + - @ neutralised so a spreadsheet does not run it.
function field(value) {
  let s = String(value ?? '');
  if (/^[=+\-@]/.test(s)) {
    s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  return `${[header, ...rows].map(r => r.map(field).join(',')).join('\r\n')}\r\n`;
}

/** The response for a CSV download named `filename`. */
export function csvResponse(filename, header, rows) {
  return { status: 200, type: 'csv', headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"` }, body: toCsv(header, rows) };
}
