import { GLYPH_H } from './font.js';

import { glyphRows, glyphWidth } from './font-hybrid.js';

import { describeEmoji } from './emoji.js';

export const PAGE = Object.freeze({
    width: 1568,
    height: 728,
    margin: 4,
    usable: 1568 - 2 * 4,
    rows: Math.floor((728 - 2 * 4) / GLYPH_H)
});

export const PARA = '¶';

export const MAX_UNKNOWN_SHARE = .05;

/** Fallback ratio used to estimate tokens when no tokenizer is available. */
export const CHARS_PER_TOKEN = 3.5;

/** Display name for a message, used in page headers and source text. */
export const displayName = m => m?.name || (m?.is_user ? 'User' : 'Character');

/** Line of source text for one message, as it will read on a page. */
export const sourceLine = m => `${displayName(m)}: ${m?.mes ?? ''}`;

const REPLACE = {
    '‘': '\'',
    '’': '\'',
    '‚': '\'',
    '‛': '\'',
    '′': '\'',
    '“': '"',
    '”': '"',
    '„': '"',
    '‟': '"',
    '″': '"',
    '–': '-',
    '—': '--',
    '―': '--',
    '−': '-',
    '…': '...',
    '•': '*',
    ' ': ' ',
    ' ': ' ',
    ' ': ' ',
    ' ': ' ',
    ' ': ' ',
    '​': '',
    '‌': '',
    '‍': '',
    '\ufeff': '',
    '\t': ' ',
    '\ufe0f': '',      // emoji variation selector: invisible, keep it out of the pages
    '⊘': '(/)',       // circled slash, used by status boards
    '\u20e3': ''      // combining enclosing keycap
};

const REPLACE_RE = new RegExp(`[${Object.keys(REPLACE).join('')}]`, 'g');

// Inline base64 payloads (screenshots pasted as data URLs and the like) are
// ASCII, so the font could draw them — a solid page of base64 noise nobody
// can read. They become a short placeholder chip instead: the model gets the
// same information (an image was here) without thousands of dead characters.
const DATA_URL_RE = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{256,}/gi;

const dataUrlPlaceholder = m => `[inline ${m.slice(5, m.indexOf(';'))} data omitted, ~${Math.max(1, Math.round(m.length * 3 / 4 / 1024))} KB]`;

export function normalize(text) {
    let out = describeEmoji(String(text ?? '').replace(DATA_URL_RE, dataUrlPlaceholder)).replace(/\r/g, '').replace(REPLACE_RE, ch => REPLACE[ch]);
    out = out.split('\n').map(p => p.trim()).filter(Boolean).join(` ${PARA} `);
    out = out.replace(/ {2,}/g, ' ').trim();
    let unknown = 0;
    let result = '';
    for (const ch of out) {
        const code = ch.codePointAt(0);
        if (glyphRows(code) === null) {
            unknown++;
            result += '?';
        } else {
            result += ch;
        }
    }
    return {
        text: result,
        unknown: unknown
    };
}

export function textWidth(text) {
    let w = 0;
    for (const ch of String(text)) w += glyphWidth(ch.codePointAt(0));
    return w;
}

export function wrapPx(text, maxPx) {
    const lines = [];
    let line = '';
    let lineW = 0;
    const spaceW = glyphWidth(32);
    for (let word of String(text).split(' ')) {
        while (textWidth(word) > maxPx) {
            if (line) {
                lines.push(line);
                line = '';
                lineW = 0;
            }
            const chars = [...word];
            let n = 0;
            let w = 0;
            while (n < chars.length && w + glyphWidth(chars[n].codePointAt(0)) <= maxPx) {
                w += glyphWidth(chars[n++].codePointAt(0));
            }
            if (!n) n = 1;
            lines.push(chars.slice(0, n).join(''));
            word = chars.slice(n).join('');
        }
        if (!word) continue;
        const wordW = textWidth(word);
        if (!line) {
            line = word;
            lineW = wordW;
        } else if (lineW + spaceW + wordW <= maxPx) {
            line += ' ' + word;
            lineW += spaceW + wordW;
        } else {
            lines.push(line);
            line = word;
            lineW = wordW;
        }
    }
    if (line) lines.push(line);
    return lines;
}

export function paginate(messageLines, rows) {
    const pages = [];
    let page = null;
    const close = () => {
        if (page && page.lines.length) pages.push(page);
        page = null;
    };
    messageLines.forEach((lines, index) => {
        if (page && page.lines.length + lines.length > rows) close();
        for (const line of lines) {
            if (!page) page = {
                lines: [],
                owners: [],
                first: index,
                last: index,
                splitsAtEnd: false
            };
            if (page.lines.length === rows) {
                page.splitsAtEnd = true;
                close();
                page = {
                    lines: [],
                    owners: [],
                    first: index,
                    last: index,
                    splitsAtEnd: false
                };
            }
            page.lines.push(line);
            page.owners.push(index);
            page.last = index;
        }
    });
    close();
    return pages;
}

export function planArchive({messages: messages, keepTokens: keepTokens, keepMode: keepMode = 'tokens', keepMessages: keepMessages = 0, coverTokens: coverTokens, maxPages: maxPages, pageCost: pageCost, chunkTokens: chunkTokens = 0, charsPerToken: charsPerToken = CHARS_PER_TOKEN, stopAt: stopAt = () => null}) {
    const est = s => String(s ?? '').length / charsPerToken;
    let tailStart = messages.length;
    let tailTokens = 0;
    if (keepMode === 'messages' && messages.length) {
        const keep = Math.max(1, Math.min(Math.max(0, keepMessages), messages.length));
        tailStart = messages.length - keep;
        for (let i = tailStart; i < messages.length; i++) tailTokens += est(messages[i].mes);
    } else if (keepMode !== 'messages') {
        while (tailStart > 0) {
            const cost = est(messages[tailStart - 1].mes);
            if (tailStart < messages.length && tailTokens + cost > keepTokens) break;
            tailTokens += cost;
            tailStart--;
        }
    }
    const messageLines = [];
    const chars = [];
    let stoppedAt = null;
    let stopReason = null;
    for (let i = 0; i < tailStart; i++) {
        const m = messages[i];
        const {text: text, unknown: unknown} = normalize(m.mes);
        const reason = stopAt(m) ?? (text.length && unknown / text.length > MAX_UNKNOWN_SHARE ? 'characters the font doesn\'t have' : null);
        if (reason) {
            stoppedAt = i;
            stopReason = reason;
            break;
        }
        const head = `[${normalize(displayName(m)).text}]`;
        messageLines.push(wrapPx(text ? `${head} ${text}` : head, PAGE.usable));
        chars.push(String(m.mes ?? '').length);
    }
    let pages = paginate(messageLines, PAGE.rows);
    pages.pop();
    while (pages.length && pages[pages.length - 1].splitsAtEnd) pages.pop();
    const chunks = [];
    if (chunkTokens > 0) {
        let start = pages.length ? pages[pages.length - 1].last + 1 : 0;
        let size = 0;
        for (let i = start; i < messageLines.length; i++) {
            size += chars[i] / charsPerToken;
            if (size < chunkTokens) continue;
            const chunk = chunkPage(messageLines, chars, start, i);
            if (!chunk) break;
            chunks.push(chunk);
            start = i + 1;
            size = 0;
        }
    }
    if (chunkTokens > 0 && Number.isFinite(pageCost) && pageCost > 0) {
        const start = chunks.length ? chunks[chunks.length - 1].last + 1 : pages.length ? pages[pages.length - 1].last + 1 : 0;
        if (start < messageLines.length) {
            const pending = chunkPage(messageLines, chars, start, messageLines.length - 1);
            if (pending && pending.chars / charsPerToken > pageCost) {
                chunks.push({
                    ...pending,
                    growing: true
                });
            }
        }
    }
    const budget = Math.max(0, coverTokens - tailTokens);
    const chosen = [];
    let covered = chunks.reduce((n, c) => n + (pageCost ?? c.chars / charsPerToken), 0);
    for (let p = pages.length - 1; p >= 0 && chosen.length + chunks.length < maxPages; p--) {
        let pageChars = 0;
        for (let i = pages[p].first; i <= pages[p].last; i++) {
            if (i !== pages[p].first || p === 0 || pages[p - 1].last !== i) pageChars += chars[i];
        }
        const pageTokens = pageCost ?? pageChars / charsPerToken;
        if ((chosen.length || chunks.length) && covered + pageTokens > budget) break;
        covered += pageTokens;
        chosen.unshift({
            lines: pages[p].lines,
            owners: pages[p].owners,
            first: pages[p].first,
            last: pages[p].last,
            chars: pageChars
        });
    }
    chosen.push(...chunks);
    const removeCount = chosen.length ? chosen[chosen.length - 1].last + 1 : 0;
    const archivedChars = chosen.reduce((sum, p) => sum + p.chars, 0);
    const sourceIds = [ ...new Set(chosen.flatMap(page => page.owners)) ].sort((a, b) => a - b);
    const sourceText = sourceIds.map(i => sourceLine(messages[i])).join('\n\n');
    return {
        pages: chosen,
        removeCount: removeCount,
        tailStart: tailStart,
        stoppedAt: stoppedAt,
        stopReason: stopReason,
        archivedChars: archivedChars,
        sourceText: sourceText
    };
}

function chunkPage(messageLines, chars, first, last) {
    const lines = [];
    const owners = [];
    let sum = 0;
    for (let i = first; i <= last; i++) {
        for (const line of messageLines[i]) {
            lines.push(line);
            owners.push(i);
        }
        sum += chars[i];
    }
    return lines.length <= PAGE.rows ? {
        lines: lines,
        owners: owners,
        first: first,
        last: last,
        chars: sum
    } : null;
}

export function locate(plan, index) {
    const found = [];
    plan.pages.forEach((page, p) => {
        const from = page.owners.indexOf(index);
        if (from !== -1) found.push({
            page: p,
            fromLine: from,
            toLine: page.owners.lastIndexOf(index)
        });
    });
    return found;
}

export function layoutBlocks(blocks, {packed: packed = true, maxPx: maxPx = PAGE.usable, rows: rows = PAGE.rows} = {}) {
    let chars = 0;
    let unknown = 0;
    let lines = [];
    if (packed) {
        const texts = [];
        for (const block of blocks) {
            const n = normalize(block);
            chars += String(block ?? '').length;
            unknown += n.unknown;
            if (n.text) texts.push(n.text);
        }
        lines = texts.length ? wrapPx(texts.join(` ${PARA} `), maxPx) : [];
    } else {
        for (const block of blocks) {
            for (const raw of String(block ?? '').split('\n')) {
                const n = normalize(raw);
                chars += raw.length;
                unknown += n.unknown;
                if (n.text) lines.push(...wrapPx(n.text, maxPx)); else if (lines.length && lines[lines.length - 1] !== '') lines.push('');
            }
            if (lines.length && lines[lines.length - 1] !== '') lines.push('');
        }
        while (lines.length && lines[lines.length - 1] === '') lines.pop();
    }
    const pages = [];
    for (let i = 0; i < lines.length; i += rows) pages.push(lines.slice(i, i + rows));
    return {
        pages: pages,
        chars: chars,
        unknown: unknown
    };
}
