import { api } from "@/lib/api";

/** A stock as the admin search returns it (the `stocks` table: name, NSE/BSE code and logo). */
export interface StockOption {
  id: string;
  name: string;
  symbol: string;
  sector: string | null;
  /** Our own copy of the logo; null when the stock has none and the screens draw its initials. */
  logoUrl: string | null;
  exchange: "nse" | "bse" | null;
}

export const stocksApi = {
  /** Up to 20 active stocks whose name or code contains `term`. */
  search: (term: string) => api.get<StockOption[]>(`/api/v1/stocks?search=${encodeURIComponent(term)}`),
};
