import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveRange, coveredStart, coveredEnd, trimToByteBudget } from '../lib/archive-range.js';

const page = (first, last, chars = 100, owners = null) => ({
    first,
    last,
    chars,
    owners: owners ?? Array.from({ length: last - first + 1 }, (_, i) => first + i),
});

test('coveredStart finds the oldest message actually drawn', () => {
    assert.equal(coveredStart([page(10, 20), page(21, 30)]), 10);
    assert.equal(coveredStart([]), 0);
    assert.equal(coveredStart(undefined), 0);
});

test('coveredStart ignores page.first when owners disagree', () => {
    // A chunk page can carry owners that start later than `first`.
    assert.equal(coveredStart([{ first: 5, last: 9, owners: [7, 8, 9] }]), 5);
    assert.equal(coveredStart([{ first: 0, last: 0, owners: [12] }]), 0);
});

test('coveredEnd is exclusive and driven by the newest page', () => {
    assert.equal(coveredEnd([page(10, 20), page(21, 30)]), 31);
    assert.equal(coveredEnd([]), 0);
});

test('archiveRange returns the half-open range of a plan', () => {
    assert.deepEqual(archiveRange({ pages: [page(288, 400), page(401, 495)] }), { start: 288, end: 496 });
    assert.deepEqual(archiveRange({ pages: [] }), { start: 0, end: 0 });
    assert.deepEqual(archiveRange({}), { start: 0, end: 0 });
});

test('trimToByteBudget keeps everything that fits', () => {
    const pages = [page(0, 9), page(10, 19), page(20, 29)];
    const urls = ['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(10)];
    const trim = trimToByteBudget(pages, urls, 1000);
    assert.equal(trim.dropped, 0);
    assert.equal(trim.pages.length, 3);
    assert.deepEqual(trim.urls, urls);
});

test('trimToByteBudget drops the oldest pages and reports how many', () => {
    const pages = [page(0, 9), page(10, 19), page(20, 29)];
    const urls = ['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)];
    const trim = trimToByteBudget(pages, urls, 250);
    assert.equal(trim.dropped, 1);
    assert.equal(trim.pages.length, 2);
    assert.equal(trim.pages[0].first, 10);
    assert.deepEqual(trim.urls, urls.slice(1));
});

test('trimToByteBudget always keeps the newest page even when oversized', () => {
    const pages = [page(0, 9), page(10, 19)];
    const urls = ['a'.repeat(10), 'b'.repeat(9999)];
    const trim = trimToByteBudget(pages, urls, 50);
    assert.equal(trim.pages.length, 1);
    assert.equal(trim.pages[0].first, 10);
});

test('trimToByteBudget is a no-op for empty input', () => {
    const trim = trimToByteBudget([], [], 1000);
    assert.equal(trim.pages.length, 0);
    assert.equal(trim.dropped, 0);
});

test('trimming shrinks the covered range so older messages stay as text', () => {
    const pages = [page(0, 9), page(10, 19), page(20, 29)];
    const urls = ['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)];
    const trim = trimToByteBudget(pages, urls, 250);
    const plan = { pages: trim.pages };
    assert.deepEqual(archiveRange(plan), { start: 10, end: 30 });
    // Messages 0..9 are not covered any more and must not be removed from the prompt.
    assert.equal(archiveRange(plan).start, 10);
});
