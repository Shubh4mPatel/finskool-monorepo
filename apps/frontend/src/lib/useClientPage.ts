import { useMemo, useState } from "react";

/**
 * Pages an already-loaded list in the browser, for the small catalogs (communities, services, welcome kits) whose
 * endpoints hand back everything and double as dropdown sources.
 *
 * `resetKey` is whatever the list is filtered by: change it and the page falls back to 1 by itself. If the list
 * shrinks so the current page no longer exists (the last card on the last page was deleted) it lands on the last
 * page that does.
 */
export function useClientPage<T>(items: readonly T[], pageSize: number, resetKey = "") {
  const [state, setState] = useState({ key: resetKey, page: 1 });
  const requested = state.key === resetKey ? state.page : 1;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requested, totalPages);
  const pageItems = useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);
  return { page, pageItems, total: items.length, setPage: (next: number) => setState({ key: resetKey, page: next }) };
}
