// Lorebook entry splitting for Microfiche.
//
// For Chat Completion the whole world info lands in the prompt as ONE string:
// `formatWorldInfo(entries.join('\n'))` — the user's `wi_format` template
// wrapped around all activated entries joined by newlines. To let the user
// pick which BOOKS (or individual entries) go as images, that string has to
// be cut back apart along the entries that are known to be in it.
//
// The rule that keeps this safe is the same one that drove the context-loss
// fixes: whatever cannot be confidently attributed to an entry stays as
// text. Losing a lorebook page is a waste; losing lorebook TEXT is damage.
//
// The module is pure and DOM-free so it can be tested directly in Node.

/**
 * An activated world info entry as SillyTavern reports it
 * (`WORLD_INFO_ACTIVATED`, plus any constant entries recovered by the caller).
 * @typedef {{world: string, uid: number|string, content: string, position?: number}} WiEntry
 */

/** A piece of the payload string, in original order.
 * @typedef {{book: string|null, uid: number|string|null, text: string}} Segment
 */

/**
 * Collects every place an entry's content occurs in `text`.
 *
 * Tries the content verbatim first, then with trailing whitespace removed
 * (the join may have normalised it). Returns matches as [start, end, trailingWs]
 * spans, where trailingWs is how much whitespace the original content had
 * beyond the needle, so the caller can consume exactly the content's own tail.
 *
 * @param {string} text the payload block
 * @param {string} content the entry content to find
 * @returns {Array<[number, number, number]>} matches in document order
 */
function locateAll(text, content) {
    const candidates = [ ...new Set([ content, content.replace(/\s+$/, '') ]) ].filter(Boolean);
    for (const needle of candidates) {
        const found = [];
        let at = text.indexOf(needle);
        while (at !== -1) {
            found.push([ at, at + needle.length, content.length - needle.length ]);
            at = text.indexOf(needle, at + 1);
        }
        if (found.length) return found;
    }
    return [];
}

/**
 * Cuts a world info block back into per-entry segments.
 *
 * The block is one string: the activated entries joined by newlines in the
 * order SillyTavern sorted them into the prompt (ascending `order` — a stable
 * sort followed by an unshift per entry). The `WORLD_INFO_ACTIVATED` array,
 * by contrast, arrives in ACTIVATION order (a descending-`order` scan, plus
 * recursion activations later), which is not the join order. So entries are
 * matched by position IN THE STRING, never by their place in the array: every
 * occurrence of every entry's content is a candidate, candidates are claimed
 * left to right, each entry at most once, overlaps resolve to the earlier
 * start (the longer match wins ties, then the array order).
 *
 * An entry whose content is not found — macros or regex scripts may have
 * altered it beyond a literal match, or the entry was injected elsewhere
 * (atDepth, author's note) — is simply skipped; the text it occupies stays
 * `unattributed`.
 *
 * @param {string} text The world info block from the payload (worldInfoBefore
 *   or worldInfoAfter, already formatted).
 * @param {WiEntry[]} entries Activated entries for this block, any order.
 * @returns {{segments: Segment[], unattributed: number}} `segments` covers
 *   the whole `text` in order (entry segments carry their book and uid,
 *   unattributed ones have `book: null`); `unattributed` counts them.
 */
export function splitLorebook(text, entries) {
    const source = String(text ?? '');
    const segments = [];
    let unattributed = 0;

    const candidates = [];
    (entries ?? []).forEach((entry, index) => {
        const content = typeof entry?.content === 'string' ? entry.content : '';
        for (const [ start, end, trailingWs ] of locateAll(source, content)) {
            // Restore the content's own trailing whitespace, then consume the
            // join separator so it does not litter the block with one-character
            // unattributed segments.
            let matchEnd = Math.min(source.length, end + trailingWs);
            while (matchEnd < source.length && (source[matchEnd] === '\n' || source[matchEnd] === '\r')) matchEnd++;
            candidates.push({
                start: start,
                end: matchEnd,
                index: index,
                world: String(entry.world ?? ''),
                uid: entry.uid ?? null,
            });
        }
    });
    candidates.sort((a, b) => a.start - b.start
        || (b.end - b.start) - (a.end - a.start)
        || a.index - b.index);

    const claimed = new Set;
    let cursor = 0;
    const emitGap = end => {
        if (end > cursor) {
            segments.push({ book: null, uid: null, text: source.slice(cursor, end) });
            unattributed++;
        }
    };
    for (const candidate of candidates) {
        if (claimed.has(candidate.index) || candidate.start < cursor) continue;
        claimed.add(candidate.index);
        emitGap(candidate.start);
        segments.push({
            book: candidate.world,
            uid: candidate.uid,
            text: source.slice(candidate.start, candidate.end),
        });
        cursor = candidate.end;
    }
    emitGap(source.length);
    return { segments: segments, unattributed: unattributed };
}

/** The `<!-- microfiche:img -->` marker: this entry goes as an image. */
export const IMG_MARKER = '<!-- microfiche:img -->';

/**
 * True when the entry content carries the image marker. Case-insensitive,
 * tolerant of inner spaces — same rules as the keep marker in lib/exempt.js.
 * @param {string} content
 * @returns {boolean}
 */
export function hasImageMarker(content) {
    return /<!--\s*microfiche\s*:\s*img\s*-->/i.test(String(content ?? ''));
}

/**
 * Removes the image marker from entry content — it is a directive to
 * Microfiche, not lore, and must not be drawn into the page.
 * @param {string} content
 * @returns {string}
 */
export function stripImageMarker(content) {
    return String(content ?? '').replace(/<!--\s*microfiche\s*:\s*img\s*-->\s*/gi, '');
}

/**
 * True when the entry content carries the keep marker. The shared
 * `textExemption` strips it at render time; here it only decides placement.
 * @param {string} content
 * @returns {boolean}
 */
export function hasKeepMarker(content) {
    return /<!--\s*microfiche\s*:\s*keep\s*-->/i.test(String(content ?? ''));
}

/**
 * Decides whether one entry segment goes as an image.
 *
 * Priority: entry markers beat the mode, the mode beats the book selection.
 * Unattributed text never goes as an image — the caller never even asks.
 *
 * @param {{book: string|null, uid: number|string|null, text: string}} segment
 * @param {{mode: string, books: Record<string, boolean>}} selection
 *   `mode` is 'all' or 'selected'; `books` maps book name → chosen.
 * @returns {boolean}
 */
export function entryWantsImage(segment, selection) {
    if (!segment || segment.book === null) return false;
    const content = segment.text ?? '';
    if (hasKeepMarker(content)) return false;
    if (hasImageMarker(content)) return true;
    if (selection?.mode === 'selected') return selection.books?.[segment.book] === true;
    return true;
}
