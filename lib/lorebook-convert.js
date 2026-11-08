// World book format converter.
//
// SillyTavern's native shape is `{ entries: { "<uid>": entry } }`. Older files
// drift from it in two ways, and both reach this module:
//
// 1. `entries` as an ARRAY with native ST fields — everything works in ST's
//    scan path (Object.keys/values are array-tolerant), but tools and plugins
//    that index `entries[uid]` or expect a dict cannot rely on it, and the
//    shape silently invites breakage.
// 2. A NovelAI lorebook — entries carry `text`/`keys`/`displayName` instead of
//    `content`/`key`/`comment`. ST converts this shape only on manual file
//    import; a file copied straight into `worlds/` keeps its NAI fields and
//    its entries activate with empty content.
//
// The converter is pure: data in, data out, no fs and no DOM.
//
// Rule of safety: an already-native book is returned unchanged, and a
// conversion never drops entries — uids are preserved, missing ones assigned,
// collisions renumbered to the next free slot.

/** @typedef {{entries: object|Array}} WorldBook */

const isNovelAiEntry = entry => entry
    && typeof entry === 'object'
    && !('content' in entry)
    && ('text' in entry || 'displayName' in entry);

function convertNovelAiEntry(entry, index) {
    const displayName = typeof entry.displayName === 'string' ? entry.displayName : '';
    return {
        uid: index,
        key: Array.isArray(entry.keys) ? entry.keys : [],
        keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary : [],
        comment: displayName,
        content: typeof entry.text === 'string' ? entry.text : '',
        constant: entry.constant === true,
        vectorized: false,
        selective: entry.selective === true,
        selectiveLogic: Number.isFinite(entry.selectiveLogic) ? entry.selectiveLogic : 0,
        addMemo: displayName.trim() !== '',
        order: Number.isFinite(entry.insertion_order) ? entry.insertion_order
            : Number.isFinite(entry.contextConfig?.budgetPriority) ? entry.contextConfig.budgetPriority : 100,
        position: Number.isFinite(entry.position) ? entry.position : 0,
        disable: entry.enabled === false,
        excludeRecursion: entry.excludeRecursion === true,
        preventRecursion: entry.preventRecursion === true,
        delayUntilRecursion: false,
        displayIndex: index,
        probability: Number.isFinite(entry.activationPercent) ? entry.activationPercent : 100,
        useProbability: Number.isFinite(entry.activationPercent),
        depth: Number.isFinite(entry.depth) ? entry.depth : 4,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: entry.caseSensitive ?? null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: typeof entry.automationId === 'string' ? entry.automationId : '',
        role: 0,
        sticky: null,
        cooldown: null,
        delay: null,
        triggers: [],
        ignoreBudget: false,
    };
}

/**
 * Converts a world book to the native `{ entries: { uid: entry } }` shape.
 *
 * @param {WorldBook} data parsed world book json
 * @returns {{ data: WorldBook, changed: boolean, kind: 'native'|'array'|'novelai', count: number }}
 */
export function convertWorldBook(data) {
    if (!data || typeof data !== 'object' || !('entries' in data)) {
        return { data: data, changed: false, kind: 'native', count: 0 };
    }
    const raw = data.entries;
    if (!Array.isArray(raw)) {
        return { data: data, changed: false, kind: 'native', count: Object.keys(raw ?? {}).length };
    }

    const novelai = raw.some(isNovelAiEntry);
    const entries = {};
    const used = new Set;
    raw.forEach((entry, index) => {
        let uid = novelai ? index : Number(entry?.uid);
        if (!Number.isInteger(uid) || uid < 0 || used.has(uid)) {
            uid = index;
            while (used.has(uid)) uid++;
        }
        used.add(uid);
        entries[String(uid)] = novelai ? convertNovelAiEntry(entry, uid) : { ...entry, uid: uid };
    });
    return {
        data: { ...data, entries: entries },
        changed: true,
        kind: novelai ? 'novelai' : 'array',
        count: Object.keys(entries).length,
    };
}
