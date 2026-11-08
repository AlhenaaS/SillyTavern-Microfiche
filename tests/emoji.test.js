import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMOJI_NAMES } from '../lib/emoji-names.js';
import { describeEmoji } from '../lib/emoji.js';

// The trie is built lazily now, so guard that the lazy path returns exactly
// what the previous eager implementation returned.
function reference(text) {
    const chars = Array.from(text);
    let out = '';
    for (let i = 0; i < chars.length; ) {
        let node = REFERENCE_ROOT;
        let name;
        let end = i;
        for (let j = i; j < chars.length && node.has(chars[j]); j++) {
            node = node.get(chars[j]);
            if (node.name) {
                name = node.name;
                end = j + 1;
            }
        }
        if (name) {
            out += `[emoji: ${name}]`;
            i = end;
        } else {
            out += chars[i++];
        }
    }
    return out;
}

const REFERENCE_ROOT = (() => {
    const root = new Map;
    for (const [emoji, name] of EMOJI_NAMES) {
        let node = root;
        for (const ch of emoji) {
            if (!node.has(ch)) node.set(ch, new Map);
            node = node.get(ch);
        }
        node.name = name;
    }
    return root;
})();

test('describeEmoji matches the eager reference on representative text', () => {
    const samples = [
        '',
        'plain ascii only',
        'Привет 😀 мир',
        '😀😃😄',
        'a👍🏽b',
        '1️⃣ test',
        '👨‍👩‍👧‍👦 family',
        '🇺🇸 flag',
        'no emoji here, just text.',
        '😀'.repeat(20),
        'text with ¶ paragraph and 😀 emoji',
    ];
    for (const sample of samples) {
        assert.equal(describeEmoji(sample), reference(sample), `sample: ${JSON.stringify(sample)}`);
    }
});

test('describeEmoji matches the eager reference for every known emoji', () => {
    for (const [emoji] of EMOJI_NAMES) {
        assert.equal(describeEmoji(emoji), reference(emoji), `emoji: ${JSON.stringify(emoji)}`);
    }
});

test('describeEmoji leaves plain text untouched', () => {
    assert.equal(describeEmoji('hello world'), 'hello world');
});
