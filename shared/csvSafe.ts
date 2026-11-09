/**
 * Spreadsheet formula-injection defence. Imported document text is untrusted: a supplier name such as
 * `=HYPERLINK("http://evil","click")` must never execute when a clerk opens the export in Excel.
 * OWASP: prefix cells that start with = + - @ TAB or CR with a single quote.
 */
const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

/** Neutralise a *text* cell. Do not use for numeric cells that are genuinely numbers. */
export function neutralise(value: string): string {
  return DANGEROUS_PREFIX.test(value) ? `'${value}` : value;
}

export function csvCell(value: string | number | boolean | null | undefined, opts: { numeric?: boolean } = {}): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  // Plain negative numbers such as "-12.50" are legitimate numerics: allow only when declared numeric AND well-formed.
  const isPlainNumber = opts.numeric === true && /^-?\d+(\.\d+)?$/.test(str);
  if (!isPlainNumber) str = neutralise(str);
  if (/[",\n\r]/.test(str)) str = `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][], numericCols: number[] = []): string {
  const lines = [headers.map((h) => csvCell(h)).join(",")];
  for (const row of rows) lines.push(row.map((c, i) => csvCell(c, { numeric: numericCols.includes(i) })).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
