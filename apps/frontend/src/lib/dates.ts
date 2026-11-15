/** Calendar-date helpers. Dates travel as `YYYY-MM-DD` strings (what the API and `<input type="date">` use). */

const DATE_PARAM = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Formats using the date's own calendar fields (not toISOString, which shifts to UTC and can land
 * on the wrong day depending on the browser's timezone).
 */
export function toDateParam(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The calendar day of a date cell read from a spreadsheet (SheetJS `cellDates`), as YYYY-MM-DD.
 *
 * SheetJS builds the Date in local time and, in some timezones, a few seconds off midnight on the wrong side of it
 * (in India an 8 Nov cell arrives as 23:59:50 on 7 Nov). Neither toISOString (UTC) nor the plain local fields give the
 * day the cell shows then, so the Date is nudged five minutes forward first: that lands past midnight whichever way it
 * was off, and a cell that holds a time of day still keeps its day.
 */
export function sheetDay(d: Date): string {
  return toDateParam(new Date(d.getTime() + 5 * 60 * 1000));
}

/** `YYYY-MM-DD` → a local-midnight Date, or undefined if it isn't one. */
export function parseDateParam(value: string): Date | undefined {
  const match = DATE_PARAM.exec(value);
  if (!match) return undefined;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  // Rejects rollovers like 2026-02-31.
  return date.getMonth() === Number(m) - 1 ? date : undefined;
}

export const startOfToday = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Adds calendar months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(date.getDate(), lastDay));
  return result;
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export const formatDisplayDate = (d: Date): string =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
