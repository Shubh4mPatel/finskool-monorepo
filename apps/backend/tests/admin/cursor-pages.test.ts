import { describe, it, expect } from 'vitest'

type FetchCursorPage = <R extends { nextCursor: string | null }>(
  fetchWith: (cursor?: string) => Promise<R>,
  page: number,
  known?: readonly string[],
) => Promise<{ data: R; page: number; cursors: string[] }>

// The helper lives in the web app. It is loaded by path so this package's type-check does not have to compile it.
const helperPath = '../../../frontend/src/lib/cursorPages.ts'
const { fetchCursorPage } = (await import(/* @vite-ignore */ helperPath)) as { fetchCursorPage: FetchCursorPage }

// The admin Tickets / Services / Payment flags screens number their pages on top of cursor paging.
// A fake server of 7 rows, 3 a page: cursor "c2" fetches page 2, "c3" page 3.

const ROWS = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
const SIZE = 3

function fakeServer() {
  const calls: (string | undefined)[] = []
  const fetchWith = async (cursor?: string) => {
    calls.push(cursor)
    const page = cursor ? Number(cursor.slice(1)) : 1
    const items = ROWS.slice((page - 1) * SIZE, page * SIZE)
    return { items, nextCursor: page * SIZE < ROWS.length ? `c${page + 1}` : null, total: ROWS.length }
  }
  return { fetchWith, calls }
}

describe('fetchCursorPage', () => {
  it('page 1 is one request with no cursor, and remembers the cursor to page 2', async () => {
    const s = fakeServer()
    const r = await fetchCursorPage(s.fetchWith, 1)
    expect(r.data.items).toEqual(['a', 'b', 'c'])
    expect(r.page).toBe(1)
    expect(r.cursors).toEqual(['c2'])
    expect(s.calls).toEqual([undefined])
  })

  it('walks the pages in between when it has not been there yet', async () => {
    const s = fakeServer()
    const r = await fetchCursorPage(s.fetchWith, 3)
    expect(r.data.items).toEqual(['g'])
    expect(r.page).toBe(3)
    expect(s.calls).toEqual([undefined, 'c2', 'c3'])
    expect(r.cursors).toEqual(['c2', 'c3'])
  })

  it('goes straight to a page whose cursor it already knows', async () => {
    const s = fakeServer()
    const r = await fetchCursorPage(s.fetchWith, 2, ['c2', 'c3'])
    expect(r.data.items).toEqual(['d', 'e', 'f'])
    expect(s.calls).toEqual(['c2'])
    expect(r.cursors).toEqual(['c2', 'c3'])
  })

  it('steps back to an earlier page from the cursors it has', async () => {
    const s = fakeServer()
    const r = await fetchCursorPage(s.fetchWith, 1, ['c2', 'c3'])
    expect(r.data.items).toEqual(['a', 'b', 'c'])
    expect(s.calls).toEqual([undefined])
  })

  it('continues from the deepest cursor it knows instead of starting over', async () => {
    const s = fakeServer()
    const r = await fetchCursorPage(s.fetchWith, 3, ['c2'])
    expect(r.data.items).toEqual(['g'])
    expect(s.calls).toEqual(['c2', 'c3'])
  })

  it('with no known cursors it starts at page 1 again, which is what a live refresh wants', async () => {
    const s = fakeServer()
    await fetchCursorPage(s.fetchWith, 2, [])
    expect(s.calls).toEqual([undefined, 'c2'])
  })

  it('stops at the last page that exists when the list got shorter, and says which page that is', async () => {
    const s = fakeServer()
    const r = await fetchCursorPage(s.fetchWith, 9)
    expect(r.page).toBe(3)
    expect(r.data.items).toEqual(['g'])
    expect(r.data.nextCursor).toBeNull()
    expect(r.cursors).toEqual(['c2', 'c3'])
  })

  it('an empty list is page 1 with nothing on it', async () => {
    const r = await fetchCursorPage(async () => ({ items: [], nextCursor: null, total: 0 }), 4)
    expect(r.page).toBe(1)
    expect(r.cursors).toEqual([])
  })
})
