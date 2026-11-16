/**
 * Minimal RFC 4180 CSV for the §9.1 import/export format. Pure and
 * deterministic — no deps, no locale, no clock. Handles quoted fields with
 * embedded commas/quotes/newlines, CRLF and LF, a leading UTF-8 BOM, and a
 * missing trailing newline.
 */

export interface CsvParseResult {
  readonly rows: string[][];
}

export class CsvParseError extends Error {}

/** Parse CSV text into rows of fields. Quoted fields may span lines; the
 * physical line number of each row (1-based, header = 1) is preserved. */
export function parseCsv(text: string): { rows: string[][]; lineNumbers: number[] } {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  const lineNumbers: number[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let fieldStarted = false;
  let sawAnyChar = false;

  const endField = (): void => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    lineNumbers.push(line);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    sawAnyChar = true;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field.length === 0 && !fieldStarted) inQuotes = true;
      else field += ch;
      fieldStarted = true;
      continue;
    }
    if (ch === ',') {
      endField();
      continue;
    }
    if (ch === '\n') {
      endRow();
      line++;
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
      line++;
      continue;
    }
    field += ch;
    fieldStarted = true;
  }

  if (inQuotes) throw new CsvParseError('Unterminated quoted field');
  if (sawAnyChar && (field.length > 0 || row.length > 0)) endRow();
  return { rows, lineNumbers };
}

/** Serialize rows to RFC 4180 CSV: quote a field when it contains a comma,
 * quote, CR or LF; double embedded quotes. */
export function stringifyCsv(rows: readonly (readonly string[])[]): string {
  const out: string[] = [];
  for (const row of rows) {
    out.push(row.map(csvField).join(','));
  }
  return `${out.join('\r\n')}\r\n`;
}

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
