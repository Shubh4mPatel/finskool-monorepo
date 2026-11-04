/**
 * Numbered pages on top of a list the server pages by cursor.
 *
 * A cursor only says "the page after this one", so page N is reached by following the cursors from page 1. This
 * remembers the cursors it has met (`known[i]` fetches page `i + 2`), so stepping to a page it has already passed is
 * one request, and going further only walks the pages in between. Pass no `known` cursors to start from page 1, which
 * is what a refresh after live changes wants: the old cursors may no longer fall on page boundaries.
 *
 * If the list is shorter than `page` (rows were removed meanwhile) it stops at the last page that exists and says so
 * in `page`, so the caller can land there instead of showing an empty screen.
 */
export async function fetchCursorPage<R extends { nextCursor: string | null }>(
  fetchWith: (cursor?: string) => Promise<R>,
  page: number,
  known: readonly string[] = [],
): Promise<{ data: R; page: number; cursors: string[] }> {
  // Only the cursors up to the page asked for are of any use.
  const cursors = known.slice(0, Math.max(0, page - 1));
  let reached = cursors.length + 1;
  let data = await fetchWith(cursors[cursors.length - 1]);
  while (reached < page && data.nextCursor) {
    cursors.push(data.nextCursor);
    reached += 1;
    data = await fetchWith(data.nextCursor);
  }
  // The cursor to the page after this one is known too: the next click is a single request.
  return { data, page: reached, cursors: data.nextCursor ? [...cursors, data.nextCursor] : cursors };
}
