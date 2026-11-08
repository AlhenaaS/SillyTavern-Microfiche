import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertWorldBook } from '../lib/lorebook-convert.js';

// Old-shape world books convert to the native uid-keyed shape without losing
// entries; native books pass through untouched.

test('native books are returned unchanged', () => {
    const book = { entries: { '0': { uid: 0, key: ['a'], content: 'lore' } }, originalData: null };
    const r = convertWorldBook(book);
    assert.equal(r.changed, false);
    assert.equal(r.kind, 'native');
    assert.equal(r.data, book, 'same object, not a copy');
});

test('ST-shaped array entries become a uid-keyed object', () => {
    const book = { entries: [
        { uid: 4, key: ['baylor'], content: 'Baylor lore. ', disable: false },
        { uid: 9, key: ['westeros'], content: 'Westeros lore. ', disable: false },
    ] };
    const { data, changed, kind, count } = convertWorldBook(book);
    assert.equal(changed, true);
    assert.equal(kind, 'array');
    assert.equal(count, 2);
    assert.deepEqual(Object.keys(data.entries), [ '4', '9' ]);
    assert.equal(data.entries['4'].uid, 4);
    assert.equal(data.entries['9'].content, 'Westeros lore. ');
    assert.equal(data.entries['4'].key[0], 'baylor');
});

test('missing and colliding uids are renumbered without loss', () => {
    const book = { entries: [
        { key: ['no-uid'], content: 'one' },
        { uid: 0, key: ['zero'], content: 'two' },
        { uid: 0, key: ['dup'], content: 'three' },
    ] };
    const { data, count } = convertWorldBook(book);
    assert.equal(count, 3);
    const contents = Object.values(data.entries).map(e => e.content).sort();
    assert.deepEqual(contents, [ 'one', 'three', 'two' ]);
    const uids = Object.keys(data.entries);
    assert.equal(new Set(uids).size, 3, 'all keys unique');
});

test('NovelAI entries are mapped to ST fields', () => {
    const book = { lorebookVersion: 4, entries: [
        { keys: [ 'greeting' ], text: 'Hello there. ', displayName: 'A memo', enabled: false, insertion_order: 55, activationPercent: 60 },
    ] };
    const { data, changed, kind } = convertWorldBook(book);
    assert.equal(changed, true);
    assert.equal(kind, 'novelai');
    const e = data.entries['0'];
    assert.equal(e.content, 'Hello there. ');
    assert.deepEqual(e.key, [ 'greeting' ]);
    assert.equal(e.comment, 'A memo');
    assert.equal(e.disable, true, 'enabled: false → disable: true');
    assert.equal(e.order, 55);
    assert.equal(e.probability, 60);
    assert.equal(e.useProbability, true);
    assert.equal(e.uid, 0);
});

test('a book without entries is treated as native', () => {
    assert.equal(convertWorldBook({}).kind, 'native');
    assert.equal(convertWorldBook(null).changed, false);
});
