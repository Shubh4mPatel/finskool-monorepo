// The Payment column of a members import, judged the same way when a file is read, when a cell is edited and when the
// rows are checked again.

export const FREE_PRICE_MESSAGE = "The free community has no price: leave Payment blank or 0";
const PLAIN_NUMBER = /^(\d+(\.\d*)?|\.\d+)$/;

/** A Payment cell without the ₹ sign, spaces and thousands commas ("₹ 1,000" -> "1000"). */
const stripPaymentDecoration = (raw: string): string => raw.replace(/[₹,\s]/g, "");

/**
 * What the Payment cell is kept as. A plain amount is tidied ("₹1,000" -> "1000"); anything else (a minus sign, "2*500",
 * "abc") stays exactly as written, so the table shows what the sheet holds and the row can be seen to be wrong. It is
 * never turned into a different amount (stripping the minus of "-5" would make the row look like a valid 5).
 */
export function paymentCellText(raw: string): string {
  const tidy = stripPaymentDecoration(raw);
  return PLAIN_NUMBER.test(tidy) ? tidy : raw;
}

/** The amount a Payment cell holds, or NaN when it is not a plain number (blank is NaN too). */
export const paymentAmount = (raw: string): number => {
  const tidy = stripPaymentDecoration(raw);
  return PLAIN_NUMBER.test(tidy) ? Number(tidy) : NaN;
};

/**
 * Why a Payment cell is refused, or null. Run on every check, edited or not, so a row cannot become "Ready" just
 * because the cell was opened again. Blank is only for the free community.
 */
export function paymentProblem(raw: string, isFree: boolean): string | null {
  const text = raw.trim();
  if (/^-\s*[\d.]/.test(text) && PLAIN_NUMBER.test(stripPaymentDecoration(text.replace(/^-\s*/, "")))) return `Payment cannot be negative ("${text}")`;
  if (/[+\-*/]/.test(text)) return `Payment contains expression "${text}" — enter a plain number`;
  const tidy = stripPaymentDecoration(text);
  if (isFree) {
    if (tidy === "") return null;
    if (!PLAIN_NUMBER.test(tidy)) return "Invalid payment amount";
    return Number(tidy) > 0 ? FREE_PRICE_MESSAGE : null;
  }
  return !PLAIN_NUMBER.test(tidy) || !(Number(tidy) > 0) ? "Invalid payment amount" : null;
}
