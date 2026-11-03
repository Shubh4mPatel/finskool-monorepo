import * as XLSX from "xlsx";
import { api } from "@/lib/api";

// Mirrors apps/backend/src/modules/performance/performance.dto.ts and performance.validator.ts.

export type PerformanceKind = "intraday" | "swing" | "investor";
export type PerformanceSegment = "main" | "investor" | "long_term" | "us_investment";
export type TradeVisibility = "auto" | "show" | "hide";

export const KIND_LABEL: Record<PerformanceKind, string> = { intraday: "Intraday", swing: "Swing Alpha", investor: "Investor" };
export const KIND_ORDER: PerformanceKind[] = ["intraday", "swing", "investor"];
export const SEGMENT_LABEL: Record<PerformanceSegment, string> = {
  main: "Main",
  investor: "Investor",
  long_term: "Long Term",
  us_investment: "US Investment",
};

export interface Board {
  communityId: string;
  communityName: string;
  communitySlug: string;
  kind: PerformanceKind;
  segments: PerformanceSegment[];
  hideNewerThanDays: number;
  maxFreeTrades: number;
  capital: number;
  margin: number;
  chargesPerTrade: number;
  note: string | null;
}

/** The few board fields most dialogs need, so the page can open them before the full board has loaded. */
export type BoardRef = Pick<Board, "communityId" | "communityName" | "kind">;

export interface BoardListItem {
  communityId: string;
  name: string;
  slug: string;
  kind: PerformanceKind;
  segments: PerformanceSegment[];
}

export interface BoardList {
  boards: BoardListItem[];
  unlinked: { communityId: string; name: string; slug: string; type: string | null }[];
}

export interface Period {
  id: string;
  segment: PerformanceSegment;
  fromMonth: string;
  toMonth: string;
  label: string;
  given: number;
  met: number;
  metPct: number;
}

export interface IntradaySummary {
  kind: "intraday";
  capitalDeployed: number;
  grossPnl: number;
  totalCharges: number;
  overallPnl: number;
  totalTrades: number;
  profitMakingTrades: number;
  lossMakingTrades: number;
  profitMakingPct: number;
  lossMakingPct: number;
}

export interface SwingSummary {
  kind: "swing" | "investor";
  averageHoldingDays: number | null;
  totalTrades: number;
  periods: Period[];
}

export type Summary = IntradaySummary | SwingSummary;

export interface Overview {
  board: Board;
  segment: PerformanceSegment;
  summary: Summary;
  noteText: string | null;
}

interface RowBase {
  id: string;
  serialNo: number;
  tradeDate: string;
  name: string;
  entryPrice: number;
  visibility: TradeVisibility;
  visibleToFree: boolean;
}

export interface IntradayRow extends RowBase {
  side: "buy" | "sell";
  exitPrice: number;
  plPerShare: number;
  plPct: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
}

export interface SwingRow extends RowBase {
  symbol: string;
  cmp: number | null;
  returnPct: number | null;
  status: "open" | "target_met";
  targetPct: number;
  targetPrice: number;
  analysis: string | null;
  exitDate: string | null;
  holdingDays: number | null;
}

export type TradeRow = IntradayRow | SwingRow;

export interface TradeList {
  items: TradeRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  months: string[];
}

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: { row: number; ref: string; reason: string }[];
  dryRun: boolean;
}

/** What the Add trade / Edit trade form sends. Fields a kind does not use are left out. */
export interface TradeInput {
  tradeDate?: string;
  name?: string;
  symbol?: string;
  side?: "buy" | "sell";
  entryPrice?: number | string;
  exitPrice?: number | string;
  cmp?: number | string | null;
  targetPct?: number | string | null;
  analysis?: string | null;
  exitDate?: string | null;
  visibility?: TradeVisibility;
}

export interface SettingsInput {
  hideNewerThanDays?: number;
  maxFreeTrades?: number;
  capital?: number;
  margin?: number;
  chargesPerTrade?: number;
  note?: string | null;
}

const BASE = "/api/v1/admin/performance";
const q = (params: Record<string, string | number | undefined>): string => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};

export const performanceApi = {
  boards: () => api.get<BoardList>(`${BASE}/boards`),
  linkBoard: (communityId: string, kind: PerformanceKind) => api.post<Board>(`${BASE}/boards`, { communityId, kind }),
  overview: (communityId: string, segment: PerformanceSegment) =>
    api.get<Overview>(`${BASE}/communities/${communityId}/overview${q({ segment })}`),
  trades: (communityId: string, p: { segment: PerformanceSegment; month?: string; page: number; order: "asc" | "desc" }) =>
    api.get<TradeList>(`${BASE}/communities/${communityId}/trades${q({ ...p, pageSize: 50 })}`),
  addTrade: (communityId: string, segment: PerformanceSegment, trade: TradeInput) =>
    api.post<{ id: string }>(`${BASE}/communities/${communityId}/trades`, { ...trade, segment }),
  updateTrade: (communityId: string, tradeId: string, trade: TradeInput) =>
    api.patch<{ id: string }>(`${BASE}/communities/${communityId}/trades/${tradeId}`, trade),
  deleteTrade: (communityId: string, tradeId: string) => api.delete<{ deleted: true }>(`${BASE}/communities/${communityId}/trades/${tradeId}`),
  importTrades: (communityId: string, segment: PerformanceSegment, rows: SheetRow[], dryRun: boolean) =>
    api.post<ImportSummary>(`${BASE}/communities/${communityId}/import`, { segment, rows, dryRun }),
  updateSettings: (communityId: string, settings: SettingsInput) =>
    api.patch<Board>(`${BASE}/communities/${communityId}/settings`, settings),
  addPeriod: (communityId: string, segment: PerformanceSegment, fromMonth: string, toMonth: string) =>
    api.post<{ id: string }>(`${BASE}/communities/${communityId}/periods`, { segment, fromMonth, toMonth }),
  updatePeriod: (communityId: string, periodId: string, fromMonth: string, toMonth: string) =>
    api.patch<{ id: string }>(`${BASE}/communities/${communityId}/periods/${periodId}`, { fromMonth, toMonth }),
  deletePeriod: (communityId: string, periodId: string) =>
    api.delete<{ deleted: true }>(`${BASE}/communities/${communityId}/periods/${periodId}`),
};

// ─── formatting ─────────────────────────────────────────────────────────────

/** 1234.5 -> "1,234.50"; whole rupee amounts drop the decimals. */
export function formatNumber(n: number, decimals = 2): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export const formatRupees = (n: number): string => Math.round(n).toLocaleString("en-IN");

/** A signed amount for P&L columns: "+1,982" / "-1,697". */
export const formatPnl = (n: number): string => `${n > 0 ? "+" : ""}${formatRupees(n)}`;

export const formatPct = (n: number, signed = false): string => `${signed && n > 0 ? "+" : ""}${n.toFixed(2)}%`;

/** Green for a gain, red for a loss, neutral for flat. */
export const gainClass = (n: number): string => (n > 0 ? "text-emerald-600" : n < 0 ? "text-red-500" : "text-primary");

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10-01" -> "1 Oct 2026". */
export function formatTradeDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${SHORT_MONTHS[Number(m) - 1]} ${y}`;
}

/** "2026-10" -> "October 2026". */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${LONG_MONTHS[Number(m) - 1]} ${y}`;
}

/** The last `count` months up to and including this one, newest first, as YYYY-MM. */
export function recentMonths(count: number, now = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

// ─── sheets ─────────────────────────────────────────────────────────────────

/** One parsed sheet row, keyed the way the API expects. `row` is the sheet row number (header is row 1). */
export type SheetRow = { row: number } & Record<string, unknown>;

export const MAX_SHEET_BYTES = 5 * 1024 * 1024;
export const MAX_SHEET_ROWS = 2000;

// Header text is matched with everything but letters and digits removed, lower-cased, so "NSE Code",
// "nse_code" and "NSE-CODE" are the same column. Columns that are not listed (Returns, Holding Days, Free users,
// S.N., Target Price, ...) are calculated by the system and are simply ignored.
const ALIASES: Record<string, string[]> = {
  tradeDate: ["date", "tradedate"],
  name: ["stock", "stockname", "name", "tradename", "company", "companyname"],
  symbol: ["nsecode", "symbol", "nsesymbol", "nse", "code", "ticker"],
  side: ["type", "side", "buysell", "action"],
  entryPrice: ["entry", "entryprice", "buyprice"],
  exitPrice: ["exit", "exitprice"],
  cmp: ["cmp", "currentmarketprice", "currentprice"],
  targetPct: ["target", "targetpct", "targetpercent"],
  analysis: ["analysis", "status", "remarks"],
  exitDate: ["exitdate", "exiton", "exitedon"],
};

const REQUIRED: Record<PerformanceKind, { key: string; label: string }[]> = {
  intraday: [
    { key: "tradeDate", label: "Date" },
    { key: "name", label: "Stock" },
    { key: "side", label: "Type" },
    { key: "entryPrice", label: "Entry" },
    { key: "exitPrice", label: "Exit" },
  ],
  swing: [
    { key: "tradeDate", label: "Date" },
    { key: "name", label: "Trade Name" },
    { key: "symbol", label: "NSE Code" },
    { key: "entryPrice", label: "Entry" },
  ],
  investor: [
    { key: "tradeDate", label: "Date" },
    { key: "name", label: "Trade Name" },
    { key: "symbol", label: "NSE Code" },
    { key: "entryPrice", label: "Entry" },
  ],
};

/** Columns each kind reads, for the template and the upload help text. */
export const SHEET_COLUMNS: Record<PerformanceKind, string[]> = {
  intraday: ["Date", "Stock", "Type", "Entry", "Exit"],
  swing: ["Date", "Trade Name", "NSE Code", "Entry", "CMP", "Target %", "Analysis", "Exit Date"],
  investor: ["Date", "Trade Name", "NSE Code", "Entry", "CMP", "Target %", "Analysis", "Exit Date"],
};

const normalizeHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const pad = (n: number): string => String(n).padStart(2, "0");
const MONTH_INDEX: Record<string, number> = Object.fromEntries(SHORT_MONTHS.map((m, i) => [m.toLowerCase(), i + 1]));

function validDay(y: number, m: number, d: number): string | undefined {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : undefined;
}

/**
 * A sheet date as YYYY-MM-DD, or the original text when it can't be read (the server then reports that row).
 * Day comes before month in "01/10/2026", the Indian convention; ISO and "1 Oct 2026" are unambiguous.
 */
export function normalizeDate(v: unknown): string {
  if (v instanceof Date) {
    // A date cell arrives as local midnight give or take a few minutes; half a day later is unambiguous.
    const d = new Date(v.getTime() + 12 * 60 * 60 * 1000);
    return validDay(d.getFullYear(), d.getMonth() + 1, d.getDate()) ?? "";
  }
  if (typeof v === "number") {
    // An Excel serial number in a General-formatted cell.
    if (v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
      return validDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) ?? String(v);
    }
    return String(v);
  }
  const s = String(v ?? "").trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return validDay(+m[1]!, +m[2]!, +m[3]!) ?? s;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) return validDay(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[2]!, +m[1]!) ?? s;
  m = /^(\d{1,2})[\s-]+([A-Za-z]{3})[A-Za-z]*[\s,.-]+(\d{2}|\d{4})$/.exec(s);
  if (m && MONTH_INDEX[m[2]!.toLowerCase()]) {
    return validDay(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, MONTH_INDEX[m[2]!.toLowerCase()]!, +m[1]!) ?? s;
  }
  return s;
}

export interface ParsedSheet {
  rows: SheetRow[];
  /** Required columns the sheet does not have. When not empty the sheet cannot be imported. */
  missing: string[];
  /** Header cells that were read, so the admin can see what was and was not picked up. */
  recognised: string[];
  ignored: string[];
}

export class SheetError extends Error {}

/**
 * Reads the first sheet of a .csv / .xlsx / .xls file into API rows. Parsing happens in the browser (as on
 * Import CSV); the server validates every row again. CSV text is read as plain strings so a date like
 * "01/10/2026" is not guessed as month-first by the spreadsheet library.
 */
export async function parseSheet(file: File, kind: PerformanceKind): Promise<ParsedSheet> {
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new SheetError("Please choose a .csv, .xlsx or .xls file.");
  if (file.size > MAX_SHEET_BYTES) throw new SheetError("That file is over 5 MB.");

  let workbook: XLSX.WorkBook;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    workbook = XLSX.read(data, { type: "array", raw: /\.csv$/i.test(file.name), cellDates: true });
  } catch {
    throw new SheetError("Couldn't read that file. Try saving it again as a .csv or .xlsx.");
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) throw new SheetError("That file has no sheets.");

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  if (raw.length === 0) throw new SheetError("The sheet has no rows under its header.");

  // header text -> canonical key
  const headers = Object.keys(raw[0]!);
  const keyOf = new Map<string, string>();
  const recognised: string[] = [];
  const ignored: string[] = [];
  for (const header of headers) {
    const norm = normalizeHeader(header);
    const key = Object.entries(ALIASES).find(([, names]) => names.includes(norm))?.[0];
    // Two header cells for one field: the first wins.
    if (key && ![...keyOf.values()].includes(key)) {
      keyOf.set(header, key);
      recognised.push(header.trim());
    } else if (header.trim() && !header.startsWith("__EMPTY")) ignored.push(header.trim());
  }

  const present = new Set(keyOf.values());
  const missing = REQUIRED[kind].filter(c => !present.has(c.key)).map(c => c.label);

  const rows: SheetRow[] = [];
  raw.forEach((record, i) => {
    const out: SheetRow = { row: i + 2 };
    let any = false;
    for (const [header, key] of keyOf) {
      const v = record[header];
      if (v === "" || v === null || v === undefined) continue;
      any = true;
      out[key] = key === "tradeDate" || key === "exitDate" ? normalizeDate(v) : typeof v === "number" ? v : String(v).trim();
    }
    if (any) rows.push(out);
  });

  if (rows.length > MAX_SHEET_ROWS) throw new SheetError(`A sheet can have at most ${MAX_SHEET_ROWS.toLocaleString("en-IN")} rows; this one has ${rows.length.toLocaleString("en-IN")}.`);
  return { rows, missing, recognised, ignored };
}

const SAMPLE_ROWS: Record<PerformanceKind, string[][]> = {
  intraday: [
    ["2026-10-01", "Ambuja Cement", "Buy", "368.20", "365.70"],
    ["2026-10-05", "CAMS", "Sell", "687.55", "682.10"],
  ],
  swing: [
    ["2026-08-12", "BLS International", "BLS", "262", "209.98", "5", "5% booked", "2026-08-14"],
    ["2026-08-24", "Airtel", "BHARTIARTL", "1938", "1973.70", "5", "HOLD", ""],
  ],
  investor: [
    ["2026-08-12", "Skipper", "SKIPPER", "543", "491.80", "10", "10% booked", "2026-09-07"],
    ["2026-08-24", "GNG Electronics", "EBGNG", "614", "660.50", "10", "Hold", ""],
  ],
};

/** Downloads a small CSV with the columns the board reads, to fill in and upload. */
export function downloadSampleSheet(kind: PerformanceKind): void {
  const csv = [SHEET_COLUMNS[kind], ...SAMPLE_ROWS[kind]].map(r => r.join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `performance-${kind}-sample.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
