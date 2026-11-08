import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RU, tr, setLanguageMode, getLanguageMode, setDetector, currentLanguage, applyI18n } from '../lib/lang.js';

const restore = () => {
    setLanguageMode('auto');
    setDetector(() => 'en');
};

test('every dictionary value is a non-empty string and keys are unique English sources', () => {
    const keys = Object.keys(RU);
    assert.ok(keys.length > 50, 'the dictionary should actually cover the UI');
    assert.equal(new Set(keys).size, keys.length, 'no duplicate keys');
    for (const [key, value] of Object.entries(RU)) {
        assert.equal(typeof value, 'string', key);
        assert.ok(value.trim().length > 0, `empty translation for: ${key}`);
        // The key is the English source: it must not itself be Russian.
        assert.doesNotMatch(key, /[А-яЁё]/, key);
    }
});

test('tr degrades to readable English for unknown keys', () => {
    restore();
    setLanguageMode('ru');
    assert.equal(tr('Not in the dictionary {x}'), 'Not in the dictionary {x}');
    restore();
});

test('language modes: auto follows the detector, ru and en force the choice', () => {
    restore();
    setDetector(() => 'ru-RU');
    assert.equal(currentLanguage(), 'ru');
    assert.equal(tr('On'), 'Включено');
    // An English tavern with a forced Russian extension.
    setDetector(() => 'en-US');
    assert.equal(currentLanguage(), 'en');
    assert.equal(tr('On'), 'On');
    setLanguageMode('ru');
    assert.equal(currentLanguage(), 'ru');
    assert.equal(tr('On'), 'Включено');
    // A Russian tavern forced to English.
    setDetector(() => 'ru');
    setLanguageMode('en');
    assert.equal(currentLanguage(), 'en');
    assert.equal(tr('On'), 'On');
    // Anything else falls back to auto.
    setLanguageMode('klingon');
    assert.equal(getLanguageMode(), 'auto');
    restore();
});

test('applyI18n translates text, titles and aria labels in a DOM-like subtree', () => {
    restore();
    setLanguageMode('ru');
    const made = attr => ({ attr, text: '', title: '', aria: '', getAttribute: () => attr, setAttribute(name, value) { this[name === 'title' ? 'title' : name === 'aria-label' ? 'aria' : 'attr'] = value; } });
    const textEl = made('On');
    textEl.textContent = '';
    const titleEl = made('Copy');
    const ariaEl = made('Number of newest messages to keep as text');
    const root = {
        querySelectorAll: selector => selector === '[data-i18n]' ? [textEl] : selector === '[data-i18n-title]' ? [titleEl] : [ariaEl],
    };
    applyI18n(root);
    assert.equal(textEl.textContent, 'Включено');
    assert.equal(titleEl.title, 'Копировать');
    assert.equal(ariaEl.aria, 'Сколько последних сообщений оставить текстом');
    // Unknown keys keep their English source.
    const unknown = made('No such key');
    unknown.textContent = '';
    applyI18n({ querySelectorAll: selector => selector === '[data-i18n]' ? [unknown] : [] });
    assert.equal(unknown.textContent, 'No such key');
    restore();
});

test('applyI18n tolerates a missing root', () => {
    restore();
    assert.doesNotThrow(() => applyI18n(null));
    assert.doesNotThrow(() => applyI18n(undefined));
});
