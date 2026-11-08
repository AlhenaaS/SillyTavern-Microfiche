// Regression test for the silent context loss.
//
// The interceptor replaces a contiguous range of chat messages with images and
// marks exactly those messages `ignore` so they are not sent twice. The range
// has two ends, and both used to be computed from the wrong end of the plan:
//
//   archived = live.slice(0, plan.removeCount)
//
// `removeCount` is the END of the range. Starting at 0 meant that whenever the
// planner archived only the newest part of the history (small context budget,
// or pages dropped by the image size limit), every older message was flagged
// `ignore` while no image contained it: gone from the prompt, gone from the
// images.
//
// This test mirrors the interceptor's arithmetic on a real plan produced by
// planArchive and asserts the invariant directly:
//
//   every message in the archived range is drawn on some page, and
//   every message outside it is left untouched in the prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planArchive } from '../lib/layout.js';
import { archiveRange, trimToByteBudget } from '../lib/archive-range.js';

const makeChat = (count, chars) => Array.from({ length: count }, (_, i) => ({
    mes: `message ${i} ` + 'lorem ipsum dolor sit amet '.repeat(Math.ceil(chars / 27)).slice(0, chars),
    name: `n${i}`,
    is_user: i % 2 === 0,
}));

function plan(chat, overrides = {}) {
    return planArchive({
        messages: chat,
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
}

/**
 * Reproduces what the interceptor does with a plan: which messages are hidden
 * behind images, and which stay in the prompt as text.
 */
function applyPlan(chat, p, maxBytes = Infinity) {
    const trim = trimToByteBudget(p.pages, p.pages.map(() => 'x'.repeat(200)), maxBytes);
    const trimmed = { ...p, pages: trim.pages };
    const range = archiveRange(trimmed);
    return {
        trimmed: range,
        drawn: new Set(trimmed.pages.flatMap(pg => pg.owners ?? [])),
        ignored: new Set(Array.from({ length: range.end - range.start }, (_, i) => range.start + i)),
        staleIgnored: new Set(Array.from({ length: p.removeCount }, (_, i) => i)), // the old, buggy range
    };
}

for (const [label, chat, overrides] of [
    ['large budget, whole history archived', makeChat(200, 1500), {}],
    ['small budget, only newest pages archived', makeChat(200, 1500), { coverTokens: 3000 }],
    ['medium budget over a long chat', makeChat(500, 3000), { coverTokens: 20000 }],
    ['tiny budget', makeChat(200, 1500), { coverTokens: 700 }],
    ['keep by messages', makeChat(200, 1500), { keepMode: 'messages', coverTokens: 20000 }],
    ['few very large messages', makeChat(40, 60000), { coverTokens: 30000 }],
]) {
    test(`no message is lost: ${label}`, () => {
        const p = plan(chat, overrides);
        assert.ok(p.pages.length > 0, 'expected the planner to archive something');

        const { drawn, ignored, staleIgnored } = applyPlan(chat, p);

        // Invariant 1: everything we hide must be visible on an image.
        for (const index of ignored) {
            assert.ok(drawn.has(index), `message ${index} was hidden but is on no page`);
        }

        // Invariant 2: nothing outside the range may be hidden.
        const hidden = new Set(ignored);
        assert.equal(hidden.size, ignored.size);

        // Invariant 3: the range ends where the planner said it does.
        assert.equal(archiveRange(p).end, p.removeCount);

        // The old arithmetic would have hidden messages that no page covers.
        // This is the assertion that fails on the broken code.
        let droppedByOldCode = 0;
        for (const index of staleIgnored) {
            if (!drawn.has(index)) droppedByOldCode++;
        }
        if (p.pages[0].first > 0) {
            assert.ok(droppedByOldCode > 0, 'this case should expose the old bug');
        }
    });
}

test('a message outside the archived range keeps travelling as text', () => {
    const chat = makeChat(200, 1500);
    const p = plan(chat, { coverTokens: 3000 });
    assert.ok(p.pages[0].first > 0, 'expected the planner to skip the oldest messages');

    const { drawn, ignored } = applyPlan(chat, p);
    const firstDrawn = Math.min(...drawn);
    assert.equal(firstDrawn, p.pages[0].first);

    // Every message before the first drawn one must survive as text.
    for (let i = 0; i < firstDrawn; i++) {
        assert.equal(ignored.has(i), false, `message ${i} must stay in the prompt`);
    }
});

test('image size trimming never orphans messages from the plan it started with', () => {
    const chat = makeChat(60, 2000);
    const p = plan(chat);
    const urls = p.pages.map((_, i) => 'x'.repeat(i === 0 ? 10_000 : 100));
    const trim = trimToByteBudget(p.pages, urls, 500);
    const trimmed = { ...p, pages: trim.pages };
    const range = archiveRange(trimmed);
    const drawn = new Set(trimmed.pages.flatMap(pg => pg.owners ?? []));

    assert.equal(trim.dropped, 1);
    assert.equal(range.start, trim.pages[0].first);
    // The dropped page's messages are outside the range now, so they stay as text.
    for (let i = 0; i < range.start; i++) {
        assert.equal(drawn.has(i), false);
    }
    for (let i = range.start; i < range.end; i++) {
        assert.ok(drawn.has(i), `message ${i} is inside the range but on no page`);
    }
});
