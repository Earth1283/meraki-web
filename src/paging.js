// Paging for the lists that load a page at a time: grades, attendance and both
// submission tables (see loadMore in state.js). No DOM or state imports, so
// it can be tested on its own.

export const PAGE_SIZE = 69;

/** Whether a paged list has rows left to load: by the server's total when it
 * gave one, else by whether the last page came back full. `exhausted` means a
 * page added nothing new, so stop asking until the next refresh. */
export function hasMoreRows(loadedCount, page) {
  if (!page || page.exhausted) return false;
  if (page.total != null) return loadedCount < page.total;
  return !!page.full;
}
