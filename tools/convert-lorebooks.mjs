// Converts old-shape world books to SillyTavern's native format.
//
// Usage (run from anywhere with node):
//   node tools/convert-lorebooks.mjs              — scan the user's worlds/ dir
//   node tools/convert-lorebooks.mjs --check      — report only, write nothing
//   node tools/convert-lorebooks.mjs file.json …  — convert specific files
//
// For every book whose `entries` is an array (old ST export or NovelAI
// lorebook) the script writes the native `{ entries: { uid: entry } }` shape
// and keeps the original as `<name>.json.bak-<timestamp>`. Native books are
// left untouched.

import { readdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertWorldBook } from '../lib/lorebook-convert.js';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const paths = args.filter(a => a !== '--check');

const toolsDir = dirname(fileURLToPath(import.meta.url));
const defaultWorlds = resolve(toolsDir, '..', '..', '..', 'worlds');
const targets = paths.length ? paths : readdirSync(defaultWorlds).filter(f => f.endsWith('.json')).map(f => join(defaultWorlds, f));

let converted = 0;
let skipped = 0;
for (const path of targets) {
    let name = basename(path);
    let data;
    try {
        data = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
        console.log(`SKIP  ${name} — not valid JSON (${e.message})`);
        skipped++;
        continue;
    }
    const { data: convertedData, changed, kind, count } = convertWorldBook(data);
    if (!changed) {
        console.log(`OK    ${name} — already native (${count} entries)`);
        skipped++;
        continue;
    }
    if (checkOnly) {
        console.log(`OLD   ${name} — ${kind} format, ${count} entries`);
        converted++;
        continue;
    }
    const backup = `${path}.bak-${Date.now()}`;
    copyFileSync(path, backup);
    writeFileSync(path, JSON.stringify(convertedData, null, 4), 'utf8');
    console.log(`DONE  ${name} — ${kind} → native, ${count} entries; backup: ${basename(backup)}`);
    converted++;
}
console.log(`\n${checkOnly ? 'would convert' : 'converted'}: ${converted}, left as is: ${skipped}${!paths.length ? ` (scanned ${defaultWorlds})` : ''}`);
if (checkOnly && converted) process.exitCode = 1;
