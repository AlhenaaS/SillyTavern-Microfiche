import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planArchive } from '../lib/layout.js';
import { keptMessageCount } from '../lib/archive-range.js';

const build = (real, lastIsUser) => Array.from({ length: real }, (_, i) => ({
    mes: `m${i}`,
    is_user: lastIsUser ? (i === real - 1 ? true : i % 2 === 0) : i % 2 === 0,
    name: `n${i}`,
}));

const planFor = (messages, keepMessages) => planArchive({
    messages,
    keepTokens: 4000,
    keepMode: 'messages',
    keepMessages,
    coverTokens: 60000,
    maxPages: Infinity,
    pageCost: 560,
    chunkTokens: 2000,
    charsPerToken: 3.5,
    stopAt: () => null,
});

test('keptMessageCount is the number of real messages from tailStart on', () => {
    assert.equal(keptMessageCount(40, 37), 3);
    assert.equal(keptMessageCount(40, 40), 0);
});

test('keptMessageCount never goes negative', () => {
    assert.equal(keptMessageCount(5, 99), 0);
});

test('keptMessageCount tolerates a missing tailStart', () => {
    assert.equal(keptMessageCount(10, undefined), 10);
    assert.equal(keptMessageCount(10, NaN), 10);
});

test('keeping N messages keeps exactly N real messages', () => {
    for (const keepMessages of [1, 2, 3, 7]) {
        const chat = build(40, false);
        const p = planFor(chat, keepMessages);
        assert.equal(keptMessageCount(chat.length, p.tailStart), keepMessages, `keepMessages=${keepMessages}`);
    }
});

test('the synthetic placeholder does not consume a kept slot', () => {
    // Preview path: the last message is not from the user, so a placeholder is
    // appended and the planner is asked for one extra message.
    const real = 40;
    const keepMessages = 3;
    const messages = build(real, false);
    const placeholder = !messages[messages.length - 1].is_user;
    assert.equal(placeholder, true);
    if (placeholder) messages.push({ mes: '', is_user: true, name: 'u', mfPlaceholder: true });

    const p = planFor(messages, keepMessages + 1);
    assert.equal(keptMessageCount(real, p.tailStart), keepMessages);
});

test('preview and real send agree on the kept count', () => {
    for (const real of [5, 12, 40, 101]) {
        for (const lastIsUser of [true, false]) {
            for (const keepMessages of [1, 2, 3, 7]) {
                const live = build(real, lastIsUser);
                const sendKept = keptMessageCount(real, planFor(live, keepMessages).tailStart);

                const messages = build(real, lastIsUser);
                const placeholder = !messages[messages.length - 1].is_user;
                if (placeholder) messages.push({ mes: '', is_user: true, name: 'u', mfPlaceholder: true });
                const previewKept = keptMessageCount(real, planFor(messages, keepMessages + (placeholder ? 1 : 0)).tailStart);

                assert.equal(previewKept, sendKept, `real=${real} lastIsUser=${lastIsUser} keep=${keepMessages}`);
            }
        }
    }
});

test('asking to keep more messages than exist keeps the whole chat', () => {
    const real = 5;
    const chat = build(real, false);
    const p = planFor(chat, 7);
    assert.equal(keptMessageCount(real, p.tailStart), real);
    assert.equal(p.pages.length, 0);
});
