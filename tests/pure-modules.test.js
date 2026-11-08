import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEEP_MARKER, textExemption } from '../lib/exempt.js';
import { savingsTotals, savingsDetail, exactTokens } from '../lib/savings.js';
import { setLanguageMode, getLanguageMode } from '../lib/lang.js';

test('KEEP_MARKER is the documented comment', () => {
    assert.equal(KEEP_MARKER, '<!-- microfiche:keep -->');
});

test('textExemption strips the marker and reports the exemption', () => {
    const { exempt, text } = textExemption(`before ${KEEP_MARKER} after`);
    assert.equal(exempt, true);
    assert.equal(text.trim(), 'before  after');
});

test('textExemption removes a whole marker-only line', () => {
    const { exempt, text } = textExemption('keep me\n<!-- microfiche:keep -->\nand me');
    assert.equal(exempt, true);
    assert.equal(text, 'keep me\nand me');
});

test('textExemption leaves untouched text alone', () => {
    const input = 'nothing to see here';
    assert.deepEqual(textExemption(input), { exempt: false, text: input });
});

test('textExemption is case-insensitive and tolerates inner spaces', () => {
    assert.equal(textExemption('x <!--Microfiche:Keep--> y').exempt, true);
    assert.equal(textExemption('x <!--   microfiche:keep   --> y').exempt, true);
});

test('textExemption does not match unrelated comments', () => {
    assert.equal(textExemption('x <!-- microfiche:other --> y').exempt, false);
});

test('savingsTotals adds the setup part and reports the difference', () => {
    const totals = savingsTotals({
        textTokens: 1000,
        imageTokens: 200,
        setup: { textTokens: 500, imageTokens: 100 },
    });
    assert.equal(totals.textTokens, 1500);
    assert.equal(totals.imageTokens, 300);
    assert.equal(totals.saved, 1200);
});

test('savingsTotals tolerates missing and non-numeric fields', () => {
    assert.deepEqual(savingsTotals(), { textTokens: 0, imageTokens: 0, saved: 0 });
    assert.deepEqual(savingsTotals({ textTokens: NaN, imageTokens: 'x' }), { textTokens: 0, imageTokens: 0, saved: 0 });
});

test('savingsTotals can report that an image cost more than the text', () => {
    assert.equal(savingsTotals({ textTokens: 100, imageTokens: 250 }).saved, -150);
});

test('exactTokens groups digits per the effective language', () => {
    const restore = getLanguageMode();
    setLanguageMode('en');
    assert.equal(exactTokens(1234567), '1,234,567');
    // ru-RU separates thousands with a (narrow) space.
    setLanguageMode('ru');
    assert.match(exactTokens(1234567), /^1\s?234\s?567$/);
    setLanguageMode(restore);
});

test('savingsDetail follows the language mode and the experimental caveat', () => {
    const restore = getLanguageMode();
    setLanguageMode('en');
    const plain = savingsDetail({ textTokens: 100, imageTokens: 10 });
    assert.match(plain, /Estimated input reduction/);
    assert.doesNotMatch(plain, /Experimental model/);
    assert.match(savingsDetail({ textTokens: 100, imageTokens: 10, experimental: true }), /Experimental model/);
    assert.match(savingsDetail({ textTokens: 100, imageTokens: 10, setup: { experimental: true } }), /Experimental model/);
    setLanguageMode('ru');
    assert.match(savingsDetail({ textTokens: 100, imageTokens: 10 }), /Ожидаемая экономия входа/);
    setLanguageMode(restore);
});
