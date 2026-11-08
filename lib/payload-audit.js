// Payload audit for Microfiche.
//
// Everything here exists to answer one question without ever looking at the
// colour of the pixels: did the request that went out still carry the content
// it was supposed to carry?
//
// The interceptor replaces archived history with page images and expects a
// known set of kept messages and of setup attachments (the PDF, the profile
// picture, ...) to survive untouched. When something silently disappears the
// user sees a worse answer and no error. This module turns that suspicion into
// numbers.
//
// Two rules keep the report safe to attach to a bug report:
//
//   1. Only numbers, booleans and a fixed set of enum strings come out. No
//      URLs, no message text, no file contents, not even a caller-supplied
//      message name. There is a test for that.
//   2. A text match is only reported as *definite* when it is long enough to be
//      meaningful and appears exactly once in the searched body. Anything
//      short, or appearing in more than one place, is reported as *ambiguous*,
//      because guessing there would produce false "message lost" alarms.
//
// The module has no DOM and no SillyTavern dependency so it can be tested
// directly in Node.

/** Shortest archived text that can ever count as a definite match. */
export const MIN_ARCHIVE_MATCH_CHARS = 80;

/**
 * The text of one message, whatever shape its content arrived in.
 *
 * A match never runs across messages, but a single message may hold several
 * adjacent text parts (an isolated group does). Those are joined with a
 * newline, exactly like the interceptor's own `textOf`.
 *
 * @param {{content?: unknown}} message OpenAI-style chat message.
 * @returns {string} its text, '' when it carries none
 */
export function textOf(message) {
    const content = message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => typeof part?.text === 'string' ? part.text : '').join('\n');
    }
    return '';
}

/** The text carried by an archived/kept descriptor. */
function entryText(entry) {
    if (typeof entry === 'string') return entry;
    return typeof entry?.text === 'string' ? entry.text : '';
}

/** Collapses CR and any run of whitespace to a single space. */
function normalize(text) {
    return String(text).replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

/** How many times `needle` occurs in `haystack` (both already normalised). */
function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let count = 0;
    let at = 0;
    while ((at = haystack.indexOf(needle, at)) !== -1) {
        count++;
        at += needle.length;
    }
    return count;
}

/** The exact mime type buried in a data URI, or null when there is none. */
function mimeOf(value) {
    if (typeof value !== 'string') return null;
    return /^data:([^;,]+)/i.exec(value)?.[1]?.toLowerCase() ?? null;
}

/** Reads the url out of an OpenAI-style `image_url` or Responses `input_image`. */
function blockUrl(part) {
    if (typeof part?.image_url === 'string') return part.image_url;
    if (typeof part?.image_url?.url === 'string') return part.image_url.url;
    return null;
}

/** True for a real content image block. */
function isImagePart(part) {
    return (part?.type === 'image_url' || part?.type === 'input_image') && typeof blockUrl(part) === 'string';
}

/** True for the OpenAI-style `{type:'file', file:{...}}` block. */
function isFilePart(part) {
    return part?.type === 'file' && part?.file != null && typeof part.file === 'object';
}

/** True for the Responses-style `{type:'input_file', ...}` block. */
function isInputFilePart(part) {
    return part?.type === 'input_file' && part != null && typeof part === 'object';
}

/** The raw payload string a file block carries, for exact url matching. */
function filePayloadString(part) {
    const source = isFilePart(part) ? part.file : part;
    return [ source?.file_data, source?.file_url, source?.url, source?.image_url ]
        .find(value => typeof value === 'string') ?? null;
}

/**
 * The safe, exportable half of a page descriptor: no urls, no text, no names.
 */
function describePage(descriptor) {
    if (!descriptor || typeof descriptor !== 'object') return null;
    const page = {
        source: descriptor.source === 'setup' ? 'setup' : 'chat',
        page: Number(descriptor.page) || 0,
    };
    if (page.source === 'setup') {
        page.groupPage = Number(descriptor.groupPage) || 1;
        page.kinds = Array.isArray(descriptor.kinds) ? descriptor.kinds.map(kind => String(kind)) : [];
        return page;
    }
    page.format = typeof descriptor.format === 'string' ? descriptor.format : '';
    if (Number.isFinite(descriptor.first)) page.first = descriptor.first;
    if (Number.isFinite(descriptor.last)) page.last = descriptor.last;
    page.owners = Array.isArray(descriptor.owners) ? descriptor.owners.filter(Number.isFinite) : [];
    page.ids = Array.isArray(descriptor.ids) && descriptor.ids.every(Number.isFinite) ? descriptor.ids : null;
    return page;
}

/**
 * Maps every attachment in the outgoing payload to the page it was meant to
 * carry, in payload order. This is the ordering half of the audit: counts
 * alone cannot tell whether the pages were attached oldest-first.
 *
 * Matching is by exact url, in memory only. A url used in several places
 * (or reused by the renderer's cache across groups) is reported as
 * `ambiguous` rather than guessed.
 *
 * @param {Array} messages The request messages.
 * @param {Map<string, object>} pageByUrl url → page descriptor
 *   (`{source: 'chat'|'setup', page, ...}`); chat pages also carry
 *   `format`, `first`, `last`, `owners`, `ids`.
 * @returns {{
 *   entries: Array<{messageIndex: number, partIndex: number, role: string,
 *     attachment: string, mime: string, tracking: string, page: object|null}>,
 *   tracked: number, untracked: number, ambiguous: number
 * }}
 */
export function attachmentMap(messages, pageByUrl = new Map()) {
    // Duck-typed rather than `instanceof Map`: a caller in another realm (an
    // isolated script, a vm) produces Map objects this realm's `instanceof`
    // does not recognise.
    const lookup = typeof pageByUrl?.get === 'function' ? pageByUrl : new Map(Object.entries(pageByUrl ?? {}));
    // One url appearing in several places cannot be attributed to one page.
    const counts = new Map;
    for (const message of messages ?? []) {
        for (const part of Array.isArray(message?.content) ? message.content : []) {
            const url = isImagePart(part) ? blockUrl(part) : isFilePart(part) || isInputFilePart(part) ? filePayloadString(part) : null;
            if (typeof url === 'string' && url) counts.set(url, (counts.get(url) ?? 0) + 1);
        }
    }
    const entries = [];
    let tracked = 0;
    let untracked = 0;
    let ambiguous = 0;
    (messages ?? []).forEach((message, messageIndex) => {
        const content = message?.content;
        if (!Array.isArray(content)) return;
        content.forEach((part, partIndex) => {
            const isImage = isImagePart(part);
            const isFile = !isImage && (isFilePart(part) || isInputFilePart(part));
            if (!isImage && !isFile) return;
            const url = isImage ? blockUrl(part) : filePayloadString(part);
            const descriptor = typeof url === 'string' ? lookup.get(url) : undefined;
            const entry = {
                messageIndex: messageIndex,
                partIndex: partIndex,
                role: typeof message?.role === 'string' ? message.role : '',
                attachment: isImage ? 'image' : 'file',
                mime: mimeOf(url) ?? '',
            };
            if (!descriptor) {
                entry.tracking = 'untracked';
                entry.page = null;
                untracked++;
            } else if ((counts.get(url) ?? 0) > 1) {
                entry.tracking = 'ambiguous';
                entry.page = describePage(descriptor);
                ambiguous++;
            } else {
                entry.tracking = 'tracked';
                entry.page = describePage(descriptor);
                tracked++;
            }
            entries.push(entry);
        });
    });
    return { entries: entries, tracked: tracked, untracked: untracked, ambiguous: ambiguous };
}

/**
 * Compares the tracked-page sequence of the current observation against the
 * earlier one (usually promptReady vs beforeSend). Message merging by the
 * host shifts `messageIndex` values, so only the page sequence is compared.
 *
 * @param {object|null} previous The earlier attachment map, or null when the
 *   current observation is the first one.
 * @param {object} current The current attachment map from `attachmentMap`.
 * @returns {{status: string, tracked: number, previous: number, missing?: number}}
 *   status: 'first' (nothing to compare with), 'unchanged', 'reordered',
 *   'missing' (a previously tracked page is gone) or 'ambiguous' (a reused
 *   url makes the sequence uncertain).
 */
export function compareOrder(previous, current) {
    const key = page => page ? `${page.source}#${page.page}` : null;
    const seq = map => (map?.entries ?? []).filter(entry => entry.tracking === 'tracked').map(entry => key(entry.page));
    const before = seq(previous);
    const after = seq(current);
    const tracked = after.length;
    if (current?.ambiguous) return { status: 'ambiguous', tracked: tracked, previous: before.length };
    if (!previous || !before.length) return { status: 'first', tracked: tracked, previous: before.length };
    if (before.length === tracked && before.every((k, i) => k === after[i])) {
        return { status: 'unchanged', tracked: tracked, previous: before.length };
    }
    const missing = before.filter(k => !after.includes(k)).length;
    if (missing) return { status: 'missing', tracked: tracked, previous: before.length, missing: missing };
    return { status: 'reordered', tracked: tracked, previous: before.length };
}

/**
 * Audits one request payload: what content survived, and whether the archived
 * history and the expected attachments are really still in there.
 *
 * @param {Array} messages The request messages (OpenAI or Responses shapes).
 * @param {Array} archivedTexts Messages that were meant to be replaced by
 *   images. Each is `{name?, text}` or a plain string.
 * @param {Array} keptTexts Messages that were meant to stay in the prompt as
 *   text. Used to detect an ambiguous archived match.
 * @param {string[]} expectedUrls Attachment data URIs that must still be sent.
 * @returns {{
 *   messages: number, textMessages: number, textParts: number, textChars: number,
 *   imageParts: number, fileParts: number, mimeTypes: Record<string, number>,
 *   archivedMessages: number, archivedTextMatches: number, ambiguousTextMatches: number,
 *   unmatchedArchivedMessages: Array<{reason: string}>,
 *   expectedAttachments: number, matchedAttachments: number, missingAttachments: number
 * }}
 */
export function auditPayload(messages, archivedTexts = [], keptTexts = [], expectedUrls = []) {
    // 1. Walk every message once, collecting the text it still carries and the
    //    images and files it still attaches.
    const messageTexts = [];
    const imageUrls = [];
    const fileUrls = [];
    const mimeTypes = {};
    let textParts = 0;
    let textChars = 0;
    let imageParts = 0;
    let fileParts = 0;

    for (const message of messages ?? []) {
        const content = message?.content;
        // A message counts as text only when its normalised text is non-empty;
        // a lone image block collapses to whitespace, not to a survivor.
        const text = normalize(textOf(message));
        if (text) messageTexts.push(text);
        if (typeof content === 'string') {
            // A bare string is one text part too.
            if (content) {
                textParts++;
                textChars += content.length;
            }
        }
        for (const part of Array.isArray(content) ? content : []) {
            if (typeof part?.text === 'string') {
                textParts++;
                textChars += part.text.length;
            }
            if (isImagePart(part)) {
                imageParts++;
                const url = blockUrl(part);
                imageUrls.push(url);
                const mime = mimeOf(url);
                if (mime) mimeTypes[mime] = (mimeTypes[mime] ?? 0) + 1;
            } else if (isFilePart(part) || isInputFilePart(part)) {
                fileParts++;
                const payload = filePayloadString(part);
                if (payload) {
                    fileUrls.push(payload);
                    const mime = mimeOf(payload);
                    if (mime) mimeTypes[mime] = (mimeTypes[mime] ?? 0) + 1;
                }
            }
        }
    }

    // 2. Match archived texts against the text still present. A null byte
    //    keeps a match from ever running across a message boundary.
    const haystack = messageTexts.join('\n\u0000\n');
    const kept = (keptTexts ?? []).map(entry => normalize(entryText(entry))).filter(Boolean);
    let archivedTextMatches = 0;
    let ambiguousTextMatches = 0;
    const unmatchedArchivedMessages = [];

    const archived = (archivedTexts ?? []).map(entry => normalize(entryText(entry)));
    const frequencies = new Map;
    for (const text of archived) frequencies.set(text, (frequencies.get(text) ?? 0) + 1);
    for (const needle of archived) {
        if (needle.length < MIN_ARCHIVE_MATCH_CHARS) {
            ambiguousTextMatches++;
            unmatchedArchivedMessages.push({ reason: 'too-short' });
            continue;
        }
        const alsoKept = kept.some(text => text.includes(needle));
        const occurrences = countOccurrences(haystack, needle);
        const duplicated = frequencies.get(needle) > 1;
        if (duplicated || alsoKept || occurrences > 1) {
            ambiguousTextMatches++;
            unmatchedArchivedMessages.push({
                reason: duplicated ? 'archived-duplicate' : alsoKept ? 'kept-duplicate' : 'payload-duplicate',
            });
            continue;
        }
        if (occurrences === 1) {
            archivedTextMatches++;
            continue;
        }
        unmatchedArchivedMessages.push({ reason: 'absent' });
    }

    // 3. Match each expected attachment URL exactly inside the data that is
    //    actually going out. URLs themselves are never returned.
    const sent = imageUrls.concat(fileUrls);
    const expectedAttachments = (expectedUrls ?? []).length;
    let matchedAttachments = 0;
    for (const url of expectedUrls ?? []) {
        if (typeof url === 'string' && url && sent.some(payload => payload === url)) matchedAttachments++;
    }

    return {
        messages: (messages ?? []).length,
        textMessages: messageTexts.length,
        textParts: textParts,
        textChars: textChars,
        imageParts: imageParts,
        fileParts: fileParts,
        mimeTypes: mimeTypes,
        archivedMessages: (archivedTexts ?? []).length,
        archivedTextMatches: archivedTextMatches,
        ambiguousTextMatches: ambiguousTextMatches,
        unmatchedArchivedMessages: unmatchedArchivedMessages,
        expectedAttachments: expectedAttachments,
        matchedAttachments: matchedAttachments,
        missingAttachments: expectedAttachments - matchedAttachments,
    };
}
