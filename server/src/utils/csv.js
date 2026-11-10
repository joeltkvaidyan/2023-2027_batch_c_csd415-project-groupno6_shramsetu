/**
 * CSV export helpers.
 *
 * Inherited from the migrant-worker Flask app, whose admin console let an
 * official download the worker and grievance lists. Rebuilt here with the three
 * things the original got wrong:
 *
 *   1. FORMULA INJECTION. A cell starting with =, +, - or @ is executed as a
 *      formula when the file is opened in Excel or LibreOffice. Since the data
 *      is worker- and official-supplied text, one grievance subject of
 *      `=HYPERLINK("http://evil","click")` becomes a live payload on a
 *      government desktop. Such cells are prefixed with an apostrophe, which
 *      spreadsheets treat as "this is text".
 *   2. ENCODING. A UTF-8 BOM, because Excel on Windows otherwise reads the file
 *      as the local codepage and every Tamil, Bengali, Telugu, Malayalam or
 *      Devanagari name becomes mojibake. Other tools ignore the BOM.
 *   3. ESCAPING. Quotes are doubled and any field containing a quote, comma or
 *      newline is quoted — the original built lines by joining with commas,
 *      which silently shifted every column after a comma inside a subject.
 */

/** Prefix that discharges a spreadsheet formula lead-in. */
const DANGEROUS_LEAD = /^[=+\-@\t\r]/;

function cell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (DANGEROUS_LEAD.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Build a CSV document.
 * @param {Array<Record<string, unknown>>} rows
 * @param {Array<{ key: string, header: string }>} columns
 * @returns {string} CRLF-separated CSV, UTF-8 BOM included.
 */
export function toCsv(rows, columns) {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(row[c.key])).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Send a CSV download. The filename is server-controlled, never user input. */
export function sendCsv(res, filename, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // A downloaded CSV is data, never something the browser should sniff and
  // render as HTML.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.send(csv);
}

/** `workers-2026-11-10.csv` — sortable, and no spaces or colons for Windows. */
export function datedFilename(prefix, now = new Date()) {
  const iso = now.toISOString().slice(0, 10);
  return `${prefix}-${iso}.csv`;
}
