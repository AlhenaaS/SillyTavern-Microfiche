import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLorebook, entryWantsImage, hasImageMarker, hasKeepMarker, IMG_MARKER } from '../lib/lorebook-split.js';

// The splitter cuts the joined world info block back into entries. The
// governing rule: anything not confidently attributed stays as text.

const wiFormat = block => `[World info:\n${block}]`;

const entry = (world, uid, content) => ({ world, uid, content });

test('splits a joined block into entry segments in original order', () => {
    const entries = [
        entry('BookA', 1, 'Dragons of the north. '),
        entry('BookA', 2, 'The southern swamps. '),
        entry('BookB', 7, 'Captain Vex rules the quay. '),
    ];
    const text = wiFormat(entries.map(e => e.content).join('\n'));
    const { segments, unattributed } = splitLorebook(text, entries);
    // The wi_format wrapper before the first entry and after the last one.
    assert.equal(unattributed, 2);
    const entrySegments = segments.filter(s => s.book !== null);
    assert.deepEqual(entrySegments.map(s => [ s.book, s.uid ]), [ [ 'BookA', 1 ], [ 'BookA', 2 ], [ 'BookB', 7 ] ]);
    // Each entry segment starts with its content (it may also carry the join
    // separator, which belongs to the block).
    entrySegments.forEach((s, i) => assert.ok(s.text.startsWith(entries[i].content)));
    // Segments reassemble into the original text — nothing is lost.
    assert.equal(segments.map(s => s.text).join(''), text);
});

test('entries missing from the block are skipped, not invented', () => {
    const text = wiFormat('Only this entry is present. ');
    const entries = [ entry('BookA', 1, 'Only this entry is present. '), entry('BookB', 2, 'Was filtered out. ') ];
    const { segments } = splitLorebook(text, entries);
    assert.deepEqual(segments.filter(s => s.book !== null).map(s => s.uid), [ 1 ]);
});

test('activation order (reverse of the join) still matches every entry', () => {
    // SillyTavern joins worldInfoBefore in ascending `order` (stable sort by
    // descending order + unshift per entry), but reports the
    // WORLD_INFO_ACTIVATED array in ACTIVATION order — a descending scan.
    // The splitter must follow the string, not the array order.
    const a = entry('BookA', 1, 'Alpha lore. ');
    const b = entry('BookA', 2, 'Beta lore. ');
    const c = entry('BookB', 3, 'Gamma lore. ');
    const text = wiFormat([ c.content, b.content, a.content ].join('\n'));
    const { segments, unattributed } = splitLorebook(text, [ a, b, c ]);
    const entrySegments = segments.filter(s => s.book !== null);
    assert.deepEqual(entrySegments.map(s => s.uid), [ 3, 2, 1 ]);
    assert.equal(unattributed, 2, 'only the wi_format wrapper stays unattributed');
    assert.equal(segments.map(s => s.text).join(''), text);
});

test('interleaved activation order across books matches every entry', () => {
    const a = entry('BookA', 1, 'Alpha line. ');
    const b = entry('BookB', 2, 'Beta line. ');
    const c = entry('BookA', 3, 'Gamma line. ');
    const text = wiFormat([ a.content, c.content, b.content ].join('\n'));
    const { segments } = splitLorebook(text, [ b, c, a ]);
    assert.deepEqual(segments.filter(s => s.book !== null).map(s => s.uid), [ 1, 3, 2 ]);
    assert.equal(segments.map(s => s.text).join(''), text);
});

test('an entry matched at its later occurrence when the early one is taken', () => {
    const same = 'Shared line. ';
    const a = entry('BookA', 1, same);
    const b = entry('BookB', 2, 'Tail lore. ' + same);
    // The block contains the shared line twice: once alone, once inside B.
    const text = wiFormat([ same, 'Middle lore. ', b.content ].join('\n'));
    const { segments } = splitLorebook(text, [ b, a ]);
    const attributed = segments.filter(s => s.book !== null);
    assert.equal(attributed.length, 2);
    assert.deepEqual(attributed.map(s => s.book), [ 'BookA', 'BookB' ]);
    assert.equal(segments.map(s => s.text).join(''), text);
});

test('macro-expanded content stays unattributed and therefore as text', () => {
    // The payload holds the macro already substituted; the raw entry content
    // no longer matches, so the whole block degrades to text. Nothing lost.
    const text = wiFormat('Greeting of Vlade expanded at runtime. ');
    const entries = [ entry('BookA', 1, 'Greeting of {{user}} expanded at runtime. ') ];
    const { segments, unattributed } = splitLorebook(text, entries);
    assert.equal(unattributed, 1);
    assert.equal(segments.every(s => s.book === null), true);
    assert.equal(segments[0].text, text);
});

test('duplicate entry content: occurrences are attributed in order', () => {
    const same = 'Identical lore line. ';
    const text = wiFormat([ same, 'Other line. ', same ].join('\n'));
    const entries = [ entry('BookA', 1, same), entry('BookB', 2, same) ];
    const { segments } = splitLorebook(text, entries);
    const attributed = segments.filter(s => s.book !== null);
    // Each entry claims its own occurrence, in order.
    assert.deepEqual(attributed.map(s => s.book), [ 'BookA', 'BookB' ]);
    assert.equal(segments.map(s => s.text).join(''), text);
});

test('one occurrence with two same-content entries: only the first is attributed', () => {
    const same = 'Identical lore line. ';
    const text = wiFormat(same);
    const entries = [ entry('BookA', 1, same), entry('BookB', 2, same) ];
    const { segments } = splitLorebook(text, entries);
    assert.deepEqual(segments.filter(s => s.book !== null).map(s => s.book), [ 'BookA' ]);
    assert.equal(segments.map(s => s.text).join(''), text);
});

test('empty text and empty entries produce no segments', () => {
    assert.deepEqual(splitLorebook('', []), { segments: [], unattributed: 0 });
    assert.deepEqual(splitLorebook(null, undefined), { segments: [], unattributed: 0 });
});

// --- Selection rules -------------------------------------------------------

const seg = (book, text) => ({ book, uid: 1, text });
const UNATTRIBUTED = { book: null, uid: null, text: 'template' };

test('mode all selects every attributed entry', () => {
    assert.equal(entryWantsImage(seg('BookA', 'plain'), { mode: 'all', books: {} }), true);
});

test('unattributed segments never become images', () => {
    assert.equal(entryWantsImage(UNATTRIBUTED, { mode: 'all', books: {} }), false);
});

test('mode selected follows the book map', () => {
    const selection = { mode: 'selected', books: { BookA: true, BookB: false } };
    assert.equal(entryWantsImage(seg('BookA', 'plain'), selection), true);
    assert.equal(entryWantsImage(seg('BookB', 'plain'), selection), false);
    // A book the user never saw defaults to text, not to image.
    assert.equal(entryWantsImage(seg('BookC', 'plain'), selection), false);
});

test('the keep marker forces text in every mode', () => {
    const content = 'Lore with ' + '<!-- microfiche:keep -->' + ' inside';
    assert.equal(hasKeepMarker(content), true);
    assert.equal(entryWantsImage(seg('BookA', content), { mode: 'all', books: {} }), false);
    assert.equal(entryWantsImage(seg('BookA', content), { mode: 'selected', books: { BookA: true } }), false);
});

test('the img marker forces an image even for an unticked book', () => {
    const content = 'Lore with ' + IMG_MARKER + ' inside';
    assert.equal(hasImageMarker(content), true);
    assert.equal(entryWantsImage(seg('BookB', content), { mode: 'selected', books: {} }), true);
});

test('markers are case-insensitive and space-tolerant', () => {
    assert.equal(hasImageMarker('<!--Microfiche:IMG-->'), true);
    assert.equal(hasImageMarker('<!--   microfiche:   img   -->'), true);
    assert.equal(hasKeepMarker('<!--Microfiche:Keep-->'), true);
    assert.equal(hasImageMarker('plain lore'), false);
});

test('selection tolerates missing shapes', () => {
    assert.equal(entryWantsImage(seg('BookA', 'plain'), undefined), true);
    assert.equal(entryWantsImage(seg('BookA', 'plain'), { mode: 'selected' }), false);
    assert.equal(entryWantsImage(null, { mode: 'all' }), false);
});
