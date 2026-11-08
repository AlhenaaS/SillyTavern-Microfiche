// Archive range helpers for Microfiche.
//
// A plan describes which messages are replaced by images. Two rules matter for
// correctness, and both used to be broken:
//
// 1. Messages covered by the attached pages form a contiguous range
//    [first, last]. Everything outside it must keep travelling as text. The
//    caller used to remove messages from index 0, so whenever the planner chose
//    to archive only the newest part of the history, the uncovered older
//    messages were dropped from the prompt without being drawn anywhere.
//
// 2. When the byte budget forces the oldest pages out, the covered range has to
//    shrink with them, otherwise the same messages are lost again.

/**
 * The first message index covered by a set of pages.
 * @param {Array<{first: number, last: number, owners?: number[]}>} pages
 * @returns {number} lowest covered message index, or 0 when there are no pages
 */
export function coveredStart(pages) {
    let start = Infinity;
    for (const page of pages ?? []) {
        if (Number.isFinite(page?.first)) start = Math.min(start, page.first);
        for (const owner of page?.owners ?? []) start = Math.min(start, owner);
    }
    return Number.isFinite(start) ? start : 0;
}

/**
 * The exclusive end of the covered range: the index after the newest covered
 * message. Pages are ordered oldest first, so the last page decides.
 * @param {Array<{first: number, last: number, owners?: number[]}>} pages
 * @returns {number}
 */
export function coveredEnd(pages) {
    let end = 0;
    for (const page of pages ?? []) {
        if (Number.isFinite(page?.last)) end = Math.max(end, page.last + 1);
        for (const owner of page?.owners ?? []) end = Math.max(end, owner + 1);
    }
    return end;
}

/**
 * The half-open message range that a plan actually turns into images.
 * @param {{pages: Array}} plan
 * @returns {{start: number, end: number}} start inclusive, end exclusive
 */
export function archiveRange(plan) {
    const pages = plan?.pages ?? [];
    if (!pages.length) return { start: 0, end: 0 };
    return { start: coveredStart(pages), end: coveredEnd(pages) };
}

/**
 * Keeps the newest pages that fit in the byte budget, dropping the oldest ones.
 * At least one page is always kept: if even the newest page is over budget the
 * provider limit is handled there, not by silently sending nothing.
 *
 * @param {Array} pages Plan pages, ordered oldest first.
 * @param {string[]} urls Base64 payloads, same order as `pages`.
 * @param {number} maxBytes Budget for the combined payloads.
 * @returns {{pages: Array, urls: string[], dropped: number, bytes: number}}
 */export function trimToByteBudget(pages, urls, maxBytes) {
    const count = Math.min(pages?.length ?? 0, urls?.length ?? 0);
    if (count === 0) return { pages: [], urls: [], dropped: 0, bytes: 0 };
    let kept = 0;
    let bytes = 0;
    for (let i = count - 1; i >= 0; i--) {
        const size = urls[i]?.length ?? 0;
        if (kept > 0 && bytes + size > maxBytes) break;
        bytes += size;
        kept++;
    }
    const dropped = count - kept;
    return {
        pages: pages.slice(dropped, count),
        urls: urls.slice(dropped, count),
        dropped: dropped,
        bytes: bytes
    };
}

/**
 * How many real chat messages the tail of a plan keeps as text.
 *
 * `plan.tailStart` indexes into the message list handed to planArchive. When a
 * synthetic trailing user message was appended, the caller already asked the
 * planner for one extra kept message, so the tail covers the requested number
 * of real messages plus that placeholder. Counting real messages is therefore
 * just the number of real ids from `tailStart` on; the placeholder is handled
 * when building the plan, not here.
 *
 * @param {number} idsLength Number of real chat messages (promptIds().length).
 * @param {number} tailStart plan.tailStart.
 * @returns {number} count of real messages kept as text, never below 0
 */
export function keptMessageCount(idsLength, tailStart) {
    const start = Number.isFinite(tailStart) ? tailStart : 0;
    return Math.max(0, idsLength - start);
}
