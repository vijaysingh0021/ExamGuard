/** CSV output safe for spreadsheets: cells that start with a formula trigger are neutralised (CSV/formula injection). */
const FORMULA_START = /^[=+\-@\t\r]/;
export const csvCell = (value: unknown): string => {
  if (value == null) return '""';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
/** UTF-8 BOM so Excel reads non-ASCII names correctly; CRLF per RFC 4180. */
export const toCsv = (headers: string[], rows: unknown[][]) => `\uFEFF${[headers.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\r\n')}\r\n`;
