import { EMOJI_NAMES } from './emoji-names.js';

// The table is ~275 KB, so building the trie at import time costs every page
// load even when no emoji is ever described. Build it on first use instead.
let root = null;

function trie() {
    if (root) return root;
    root = new Map;
    for (const [emoji, name] of EMOJI_NAMES) {
        let node = root;
        for (const ch of emoji) {
            if (!node.has(ch)) node.set(ch, new Map);
            node = node.get(ch);
        }
        node.name = name;
    }
    return root;
}

export function describeEmoji(text) {
    const chars = Array.from(text);
    let out = '';
    const start = trie();
    let node;
    for (let i = 0; i < chars.length; ) {
        node = start;
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
