import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE, normalize, wrapPx, textWidth, paginate, planArchive, locate, layoutBlocks, MAX_UNKNOWN_SHARE } from '../lib/layout.js';

const makeChat = (count, chars) => Array.from({ length: count }, (_, i) => ({
    mes: `message ${i} ` + 'lorem ipsum dolor sit amet '.repeat(Math.ceil(chars / 27)).slice(0, chars),
    name: `n${i}`,
}));

const plan = (messages, overrides = {}) => planArchive({
    messages,
    keepTokens: 4000,
    keepMode: 'tokens',
    keepMessages: 3,
    coverTokens: 60000,
    maxPages: Infinity,
    pageCost: 560,
    chunkTokens: 2000,
    charsPerToken: 3.5,
    stopAt: () => null,
    ...overrides,
});

test('PAGE geometry is consistent', () => {
    assert.equal(PAGE.usable, PAGE.width - 2 * PAGE.margin);
    assert.ok(PAGE.rows > 0);
});

test('normalize collapses newlines into a paragraph marker', () => {
    assert.equal(normalize('a\n\nb').text, 'a ¶ b');
});

test('normalize replaces smart punctuation', () => {
    assert.equal(normalize('“a”—b…').text, '"a"--b...');
});

test('normalize counts glyphs the font cannot draw', () => {
    const { text, unknown } = normalize('ok \u4e2d\u6587');
    assert.ok(unknown > 0);
    assert.match(text, /\?/);
});

test('wrapPx never exceeds the pixel budget for spaceless text', () => {
    const lines = wrapPx('x'.repeat(5000), 300);
    for (const line of lines) assert.ok(textWidth(line) <= 300, `line too wide: ${textWidth(line)}`);
});

test('wrapPx keeps a single oversized glyph on its own line', () => {
    const lines = wrapPx('a\u4e2db', 3);
    assert.ok(lines.length >= 2);
});

test('paginate splits on the row budget and records owners', () => {
    const messages = [[...Array(100).keys()].map(i => `l${i}`), ['t1', 't2']];
    const pages = paginate(messages, 90);
    assert.equal(pages.length, 2);
    assert.equal(pages[0].owners.length, 90);
    assert.equal(pages[0].first, 0);
    assert.equal(pages[1].last, 1);
});

test('planArchive keeps the newest messages as text', () => {
    const chat = makeChat(50, 500);
    const p = plan(chat, { keepTokens: 4000 });
    assert.ok(p.tailStart <= chat.length);
    assert.ok(p.removeCount <= p.tailStart);
});

test('planArchive archive range is contiguous and ends at removeCount', () => {
    const p = plan(makeChat(300, 2000), { coverTokens: 20000 });
    const owners = [...new Set(p.pages.flatMap(pg => pg.owners))].sort((a, b) => a - b);
    assert.ok(owners.length > 0);
    assert.ok(owners.every((v, i) => i === 0 || owners[i - 1] + 1 === v), 'owners must be contiguous');
    assert.equal(p.removeCount, owners.at(-1) + 1);
});

test('planArchive stops at a tool call instead of archiving past it', () => {
    const chat = makeChat(40, 2000);
    chat[20] = { ...chat[20], extra: { tool_invocations: [{}] } };
    const p = planArchive({
        messages: chat,
        keepTokens: 0,
        coverTokens: 60000,
        maxPages: Infinity,
        pageCost: 560,
        chunkTokens: 2000,
        charsPerToken: 3.5,
        stopAt: m => (m.extra?.tool_invocations?.length ? 'a tool call' : null),
    });
    assert.equal(p.stoppedAt, 20);
    assert.equal(p.stopReason, 'a tool call');
    assert.ok(p.removeCount <= 20);
});

test('planArchive stops when too much text is undrawable', () => {
    const chat = makeChat(20, 1000);
    chat[10] = { mes: '\u4e2d'.repeat(1000), name: 'cn' };
    const p = planArchive({
        messages: chat,
        keepTokens: 0,
        coverTokens: 60000,
        maxPages: Infinity,
        pageCost: 560,
        chunkTokens: 2000,
        charsPerToken: 3.5,
        stopAt: () => null,
    });
    assert.equal(p.stoppedAt, 10);
    assert.ok(p.stopReason);
});

test('keepMode messages keeps exactly N real messages out of the archive', () => {
    const chat = makeChat(60, 1000);
    const p = plan(chat, { keepMode: 'messages', keepMessages: 5, coverTokens: 60000 });
    assert.equal(chat.length - p.tailStart, 5);
});

test('keepMode messages never keeps fewer than one message', () => {
    const chat = makeChat(10, 1000);
    const p = plan(chat, { keepMode: 'messages', keepMessages: 0, coverTokens: 60000 });
    assert.equal(chat.length - p.tailStart, 1);
});

test('an empty chat archives nothing', () => {
    const p = plan([], {});
    assert.equal(p.pages.length, 0);
    assert.equal(p.removeCount, 0);
});

test('locate finds the page and line span of a message', () => {
    const p = plan(makeChat(200, 1500), { coverTokens: 60000 });
    const target = p.pages[0].owners[0];
    const spots = locate(p, target);
    assert.ok(spots.length >= 1);
    assert.equal(spots[0].page, 0);
    assert.equal(spots[0].fromLine, 0);
    assert.ok(spots[0].toLine >= spots[0].fromLine);
});

test('locate returns nothing for an unarchived message', () => {
    const p = plan(makeChat(60, 1000), { coverTokens: 60000 });
    assert.deepEqual(locate(p, 9999), []);
});

test('layoutBlocks packs blocks into pages within the row budget', () => {
    const blocks = Array.from({ length: 200 }, (_, i) => `block ${i} ` + 'x'.repeat(300));
    const { pages, chars, unknown } = layoutBlocks(blocks, { packed: true });
    assert.ok(pages.length > 1);
    for (const page of pages) assert.ok(page.length <= PAGE.rows);
    assert.ok(chars > 0);
    assert.equal(unknown, 0);
});

test('layoutBlocks reports undrawable characters', () => {
    const { unknown } = layoutBlocks(['\u4e2d\u6587'], { packed: false });
    assert.equal(unknown, 2);
});

test('MAX_UNKNOWN_SHARE is a small positive threshold', () => {
    assert.ok(MAX_UNKNOWN_SHARE > 0 && MAX_UNKNOWN_SHARE < 1);
});

test('inline base64 data URLs collapse into a placeholder chip', () => {
    const blob = 'data:image/png;base64,' + 'A'.repeat(2048);
    const { text, unknown } = normalize(`look ${blob} end`);
    assert.ok(text.includes('[inline image/png data omitted, ~2 KB]'), text.slice(0, 140));
    assert.ok(!text.includes('AAAA'), 'the base64 noise is gone');
    assert.equal(unknown, 0, 'the placeholder is fully drawable');
    // Short data URLs are content, not payloads: untouched.
    const small = 'data:image/gif;base64,R0lGODlh';
    assert.ok(normalize(`x ${small} y`).text.includes(small));
});
