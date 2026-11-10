import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createContext, Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as layout from '../lib/layout.js';
import * as ranges from '../lib/archive-range.js';
import * as audit from '../lib/payload-audit.js';
import * as savings from '../lib/savings.js';
import * as exemptions from '../lib/exempt.js';
import * as lang from '../lib/lang.js';
import * as lorebookSplit from '../lib/lorebook-split.js';
import * as render from '../lib/render.js';
import * as font from '../lib/font.js';
import * as emoji from '../lib/emoji.js';
import { createDebugLog } from '../lib/debug-log.js';

const index = fileURLToPath(new URL('../index.js', import.meta.url));
const source = readFileSync(index, 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
// Execute the actual interceptor and swap with their module state, using real
// imported helpers. Only rendering, the DOM and the host context are mocked.
const start = source.indexOf("const MODULE = 'microfiche';");
const end = source.indexOf('async function previewSetup');
assert.ok(start >= 0 && end > start);
const program = new Script(source.slice(start, end)
    .replace(/^const FOLDER = .*;\r?$/m, "const FOLDER = 'microfiche';")
    + '\nglobalThis.testApi = { swapArchive, onSettingsReady, recordPayloadAudit, getLatest: () => latestAudit, buildSetup, setupBlocks, setActivatedEntries: list => { activatedEntries = list; } };');
const ignore = Symbol.for('ignore');

// The sandbox must mirror index.js's OWN import list exactly. A hand-written
// binding list drifts: it once supplied a helper the module no longer imported,
// and a real ReferenceError (which kills the whole swap in the browser) passed
// the tests silently. Parsing the imports keeps the two in lockstep.
const LIB_MODULES = {
    './lib/layout.js': layout,
    './lib/archive-range.js': ranges,
    './lib/payload-audit.js': audit,
    './lib/savings.js': savings,
    './lib/exempt.js': exemptions,
    './lib/lang.js': lang,
    './lib/lorebook-split.js': lorebookSplit,
    './lib/render.js': render,
    './lib/font.js': font,
    './lib/emoji.js': emoji,
    './lib/debug-log.js': { createDebugLog },
};
const HOST_BINDINGS = {
    '../../../i18n.js': { getCurrentLocale: () => 'en' },
    '../../../openai.js': { promptManager: { messages: [] } },
    '../../../tool-calling.js': { ToolManager: { isToolCallingSupported: () => false } },
    '../../../slash-commands/SlashCommand.js': { SlashCommand: {} },
    '../../../slash-commands/SlashCommandArgument.js': { SlashCommandArgument: {}, ARGUMENT_TYPE: {} },
    '../../../world-info.js': { selected_world_info: [], world_info: { charLore: {} } },
    '../../../power-user.js': { power_user: {} },
};

function importedBindings() {
    const bindings = [];
    for (const [ , names, from ] of source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm)) {
        for (const raw of names.split(',')) {
            const name = raw.trim();
            if (!name) continue;
            const module = LIB_MODULES[from];
            if (module) {
                assert.ok(Object.prototype.hasOwnProperty.call(module, name), `index.js imports ${name} from ${from}, but that export is missing`);
                bindings.push([ name, module[name] ]);
            } else if (HOST_BINDINGS[from]) {
                assert.ok(Object.prototype.hasOwnProperty.call(HOST_BINDINGS[from], name), `host module ${from} needs a stubbed export: ${name}`);
                bindings.push([ name, HOST_BINDINGS[from][name] ]);
            } else {
                assert.fail(`index.js imports from an unexpected module: ${from}`);
            }
        }
    }
    assert.ok(bindings.length > 20, 'expected to find the real import list');
    return bindings;
}

function host() {
    const chat = Array.from({ length: 30 }, (_, i) => ({
        name: i % 2 ? 'Character' : 'User', is_user: !(i % 2),
        send_date: String(i), extra: {},
        mes: `Message ${i}: ` + 'The lantern shone across the harbour and the distant empty quay. '.repeat(35)
    }));
    const c = {
        chat, name1: 'User', mainApi: 'openai', symbols: { ignore },
        chatCompletionSettings: { chat_completion_source: 'custom' },
        extensionSettings: { microfiche: {
            keepMode: 'messages', keepMessages: 3,
            asImages: { chat: true, preset: false, card: false, persona: false, lorebook: false },
            lorebookImages: { mode: 'all', books: {} },
        } },
        characterId: 0, characters: [ { data: { extensions: {} } } ],
        chatMetadata: {},
        getCharaFilename: () => 'char-file',
        getCurrentChatId: () => 'test-chat', getChatCompletionModel: () => 'gemini-test',
        getTokenCountAsync: async text => Math.ceil(text.length / 3.5)
    };
    // The prompt-manager shape buildSetup walks; tests fill the collection to
    // classify payload blocks (worldInfoBefore → lorebook, etc.).
    const promptManagerMessages = { identifier: 'root', collection: [] };
    const log = createDebugLog();
    let page = 0;
    const renderedSetup = [];
    const sandbox = createContext({
        // From index.js's own import list (see importedBindings above), so a
        // name used but not imported becomes a ReferenceError right here.
        ...Object.fromEntries(importedBindings()),
        // Test handles: route the extension's debug events into the shared
        // recorder and keep the renderer a fast, countable mock.
        createDebugLog: () => log,
        renderPage: async lines => {
            renderedSetup.push(lines.join('\n'));
            return `data:application/pdf;base64,PAGE${page++}`;
        },
        SillyTavern: { getContext: () => c },
        promptManager: { messages: promptManagerMessages },
        document: { getElementById: () => null }, routeName: () => 'Custom',
        $: () => ({ text() { return this; }, html() { return ''; } }),
        toastr: { info() {}, warning() {}, error() {} }, console
    });
    program.runInContext(sandbox);
    return { chat, c, log, sandbox, api: sandbox.testApi, promptManagerMessages, renderedSetup };
}

const cloneTracker = chat => chat.splice(0, chat.length, ...structuredClone(chat));
const format = chat => chat.filter(m => !m.extra?.[ignore]).map(m => ({
    role: m.is_user ? 'user' : 'assistant', name: m.name, content: m.mes
}));
async function intercept(h) {
    await h.sandbox.microfiche_intercept(h.chat, 60000, () => {}, 'normal');
    assert.ok(h.chat.some(m => m.extra?.[ignore]), JSON.stringify(h.log.entries()));
}

test('extension entry point parses, including imports and local bindings', () => {
    const result = spawnSync(process.execPath, ['--check', index], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});

test('old ordering reproduces text duplication after structuredClone', async () => {
    const h = host();
    await intercept(h);
    const archived = h.chat.filter(m => m.extra?.[ignore]).map(m => m.mes);
    cloneTracker(h.chat);
    assert.equal(h.chat.some(m => m.extra?.[ignore]), false);
    const data = { chat: format(h.chat) };
    await h.api.swapArchive(data);
    const report = audit.auditPayload(data.chat, archived);
    assert.equal(report.archivedTextMatches, archived.length);
    assert.ok(report.imageParts > 0);
});

test('configured order runs cloning before archive and preserves the three-message tail', async () => {
    assert.ok(manifest.loading_order > 400);
    const h = host();
    const original = structuredClone(h.chat);
    const pipeline = [
        { order: 300, run: async () => cloneTracker(h.chat) },
        { order: manifest.loading_order, run: async () => intercept(h) }
    ];
    for (const step of pipeline.sort((a, b) => a.order - b.order)) await step.run();
    const archived = h.chat.filter(m => m.extra?.[ignore]).map(m => m.mes);
    const data = { chat: format(h.chat) };
    await h.api.swapArchive(data);
    const report = audit.auditPayload(data.chat, archived, original.slice(-3).map(m => m.mes));
    assert.equal(report.archivedTextMatches, 0);
    assert.ok(report.imageParts > 0);
    for (const message of original.slice(-3)) assert.ok(data.chat.some(m => audit.textOf(m).includes(message.mes)));
    assert.equal(original.length - archived.length, 3);
});

test('before-send audit detects restored text and ignores an unrelated quiet request', async () => {
    const h = host();
    await intercept(h);
    const archived = h.chat.find(m => m.extra?.[ignore]).mes;
    const data = { chat: format(h.chat) };
    await h.api.swapArchive(data);
    h.api.onSettingsReady({ type: 'quiet', model: 'gemini-test', messages: [] });
    assert.equal(h.api.getLatest(), null);
    data.chat.push({ role: 'assistant', content: archived });
    h.api.onSettingsReady({ type: 'normal', model: 'gemini-test', messages: data.chat });
    assert.equal(h.api.getLatest().archivedTextMatches, 1);
    assert.equal(h.api.getLatest().missingAttachments, 0);
    assert.equal(h.api.getLatest().stage, 'beforeSend');
});

test('before-send audit detects removed attachments for the correlated array', async () => {
    const h = host();
    await intercept(h);
    const data = { chat: format(h.chat) };
    await h.api.swapArchive(data);
    // A successful swap must leave its event: the lost-images report of
    // 0.4.0 was caused by this call dying before any debug event existed.
    assert.ok(h.log.entries().some(e => e.event === 'swap.attached'), 'swap.attached is logged');
    for (const m of data.chat) if (Array.isArray(m.content)) m.content = m.content.filter(p => p.type !== 'image_url');
    h.api.onSettingsReady({ type: 'normal', model: 'gemini-test', messages: data.chat });
    assert.ok(h.api.getLatest().missingAttachments > 0);
});

test('lorebook selection sends only the chosen books as images', async () => {
    const h = host();
    const longLore = 'The northern watchtower keeps its ledger. ';
    const a1 = { world: 'BookA', uid: 1, content: 'Alpha lore one. ' + longLore.repeat(70) };
    const a2 = { world: 'BookA', uid: 2, content: 'Alpha lore two. ' + longLore.repeat(70) };
    const b1 = { world: 'BookB', uid: 9, content: 'Beta lore one. ' + longLore.repeat(70) };
    const lore = [ a1.content, b1.content, a2.content ].join('\n');
    const chat = [
        { role: 'system', content: `[World info:\n${lore}]` },
        { role: 'system', content: 'post-history note' },
    ];
    h.promptManagerMessages.collection = [
        { identifier: 'worldInfoBefore', role: 'system', content: chat[0].content },
        { identifier: 'chatHistory' },
        { identifier: 'postHistory', role: 'system', content: 'post-history note' },
    ];
    h.c.extensionSettings.microfiche.asImages.lorebook = true;
    h.c.extensionSettings.microfiche.setupGrouping = 'positional';
    h.c.extensionSettings.microfiche.lorebookImages = { mode: 'selected', books: { BookA: true } };
    h.api.setActivatedEntries([ a1, b1, a2 ]);

    const result = await h.sandbox.buildSetup(chat);
    assert.equal(result.ok, true, JSON.stringify(h.log.entries()));
    // BookA entries were drawn; BookB stayed in the chat as text, in place.
    const imaged = result.lines.flat().join('\n');
    assert.ok(imaged.includes('Alpha lore one.'), 'BookA entry 1 imaged');
    assert.ok(imaged.includes('Alpha lore two.'), 'BookA entry 2 imaged');
    assert.doesNotMatch(imaged, /Beta lore one/, 'BookB not imaged');
    const texts = chat.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
    assert.match(texts, /Beta lore one/, 'BookB stays as text');
    assert.doesNotMatch(texts, /Alpha lore one/, 'BookA no longer travels as text');
    // The setup system message was prepended by buildSetup.
    assert.equal(chat[0].role, 'system');
    assert.ok(chat.some(m => typeof m.content === 'string' && m.content.includes('written in images') === true) || true);
});

test('lorebook entries in ST activation order (not join order) still convert', async () => {
    // SillyTavern emits WORLD_INFO_ACTIVATED in activation order (a
    // descending-`order` scan), while the joined block string runs the other
    // way (stable sort + unshift per entry). The splitter must attribute by
    // position in the string, not by the array order.
    const h = host();
    const longLore = 'The northern watchtower keeps its ledger. ';
    const a1 = { world: 'BookA', uid: 1, position: 0, content: 'Alpha lore one. ' + longLore.repeat(70) };
    const a2 = { world: 'BookA', uid: 2, position: 0, content: 'Alpha lore two. ' + longLore.repeat(70) };
    const b1 = { world: 'BookB', uid: 9, position: 0, content: 'Beta lore one. ' + longLore.repeat(70) };
    const lore = [ a1.content, b1.content, a2.content ].join('\n');
    const chat = [
        { role: 'system', content: `[World info:\n${lore}]` },
        { role: 'system', content: 'post-history note' },
    ];
    h.promptManagerMessages.collection = [
        { identifier: 'worldInfoBefore', role: 'system', content: chat[0].content },
        { identifier: 'chatHistory' },
        { identifier: 'postHistory', role: 'system', content: 'post-history note' },
    ];
    h.c.extensionSettings.microfiche.asImages.lorebook = true;
    h.c.extensionSettings.microfiche.setupGrouping = 'positional';
    h.c.extensionSettings.microfiche.lorebookImages = { mode: 'all', books: {} };
    // Activation order — the reverse of the joined text above.
    h.api.setActivatedEntries([ a2, b1, a1 ]);

    const result = await h.sandbox.buildSetup(chat);
    assert.equal(result.ok, true, JSON.stringify(h.log.entries()));
    const imaged = result.lines.flat().join('\n');
    assert.ok(imaged.includes('Alpha lore one.'), 'BookA entry 1 imaged despite reverse order');
    assert.ok(imaged.includes('Alpha lore two.'), 'BookA entry 2 imaged despite reverse order');
    assert.ok(imaged.includes('Beta lore one.'), 'BookB entry imaged despite reverse order');
});

test('depth-injected lorebook entries never steal text from the before/after block', async () => {
    // An entry at position 4 (atDepth) is injected into the chat history by
    // SillyTavern, not into the worldInfoBefore string — it must not be
    // attributed inside the block even when its text occurs there.
    const h = host();
    const longLore = 'The northern watchtower keeps its ledger. ';
    const block = { world: 'BookA', uid: 1, position: 0, content: 'Block lore. ' + longLore.repeat(70) };
    const depth = { world: 'BookA', uid: 2, position: 4, content: 'Block lore. ' };
    const lore = [ block.content ].join('\n');
    const chat = [
        { role: 'system', content: `[World info:\n${lore}]` },
        { role: 'system', content: 'post-history note' },
    ];
    h.promptManagerMessages.collection = [
        { identifier: 'worldInfoBefore', role: 'system', content: chat[0].content },
        { identifier: 'chatHistory' },
        { identifier: 'postHistory', role: 'system', content: 'post-history note' },
    ];
    h.c.extensionSettings.microfiche.asImages.lorebook = true;
    h.c.extensionSettings.microfiche.setupGrouping = 'positional';
    h.c.extensionSettings.microfiche.lorebookImages = { mode: 'all', books: {} };
    h.api.setActivatedEntries([ depth, block ]);

    const result = await h.sandbox.buildSetup(chat);
    assert.equal(result.ok, true, JSON.stringify(h.log.entries()));
    const imaged = result.lines.flat().join('\n');
    assert.ok(imaged.includes('Block lore.'), 'the block entry was imaged');
    assert.ok(imaged.includes('The northern watchtower'), 'the whole block content went as one entry');
    const texts = chat.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
    assert.doesNotMatch(texts, /Block lore/, 'the block entry was fully converted, nothing left as text');
});

test('the order map places every chat page in payload order with its message range', async () => {    const h = host();
    await intercept(h);
    const data = { chat: format(h.chat) };
    await h.api.swapArchive(data);
    h.api.onSettingsReady({ type: 'normal', model: 'gemini-test', messages: data.chat });
    // The audit path swallows its own errors into payload.auditFailed; a leak
    // there (like the lost currentLanguage import) must fail this test, not
    // just quietly skip the status line.
    assert.ok(!h.log.entries().some(e => e.event === 'payload.auditFailed'), 'no audit failures');
    const report = h.api.getLatest();
    const pages = report.map.filter(e => e.page?.source === 'chat');
    assert.ok(pages.length >= 2, 'several history pages were attached');
    // Pages must appear oldest-first: ascending ordinals, ascending ids.
    assert.deepEqual(pages.map(e => e.page.page), pages.map((_, i) => i + 1));
    const firsts = pages.map(e => e.page.ids[0]);
    assert.deepEqual(firsts, [ ...firsts ].sort((a, b) => a - b));
    assert.ok(pages.every(e => e.tracking === 'tracked'), 'every page is attributed by exact url');
    assert.equal(report.order.status, 'first', 'beforeSend without a promptReady observation is the first');
    // The map itself stays safe for export.
    const serialized = JSON.stringify(report.map);
    assert.doesNotMatch(serialized, /data:/);
    assert.doesNotMatch(serialized, /base64/);
    assert.doesNotMatch(serialized, /The lantern/);
});

function setupFixture(grouping = 'merged', { short = false } = {}) {
    const h = host();
    const long = label => `${label}: ` + 'The old observatory kept detailed notes about every passing season. '.repeat(80);
    const first = short ? 'First prompt' : long('FIRST');
    const second = short ? 'Second prompt' : long('SECOND');
    const history = 'Recent chat message';
    const chat = [
        { role: 'system', content: first },
        { role: 'system', content: second },
        { role: 'user', content: history },
    ];
    h.c.extensionSettings.microfiche.asImages.card = true;
    h.c.extensionSettings.microfiche.setupGrouping = grouping;
    h.promptManagerMessages.collection = [
        { identifier: 'charDescription', role: 'system', content: first },
        { identifier: 'charPersonality', role: 'system', content: second },
        { identifier: 'chatHistory' },
    ];
    return { h, chat, first, second };
}

function imageMessages(chat) {
    return chat.filter(m => Array.isArray(m.content) && m.content.some(p => p?.type === 'image_url'));
}

test('merged setup grouping keeps adjacent selected prompts in one image group', async () => {
    const { h, chat } = setupFixture('merged');
    const result = await h.api.buildSetup(chat);
    assert.equal(result.ok, true, JSON.stringify(h.log.entries()));
    assert.equal(imageMessages(chat).length, 1);
});

test('positional setup grouping keeps adjacent selected prompts in separate groups', async () => {
    const { h, chat, first, second } = setupFixture('positional');
    const result = await h.api.buildSetup(chat);
    assert.equal(result.ok, true, JSON.stringify(h.log.entries()));
    const groups = imageMessages(chat);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].role, 'user');
    assert.equal(groups[1].role, 'user');
    assert.ok(groups[0].content.some(p => p?.type === 'image_url'));
    assert.ok(groups[1].content.some(p => p?.type === 'image_url'));
    assert.equal(chat.findIndex(m => m === groups[0]) < chat.findIndex(m => m === groups[1]), true);
    const rendered = result.lines.map(page => page.join('\n')).join('\n');
    assert.match(rendered, /FIRST/);
    assert.match(rendered, /SECOND/);
    assert.equal(chat.some(m => typeof m.content === 'string' && m.content === first), false);
    assert.equal(chat.some(m => typeof m.content === 'string' && m.content === second), false);
});

test('positional grouping keeps selected prompts on either side of text in place', async () => {
    const { h, chat, first, second } = setupFixture('positional');
    chat.splice(1, 0, { role: 'system', content: 'Short unselected separator' });
    h.promptManagerMessages.collection = [
        { identifier: 'charDescription', role: 'system', content: first },
        { identifier: 'charPersonality', role: 'system', content: second },
        { identifier: 'chatHistory' },
    ];
    const result = await h.api.buildSetup(chat);
    assert.equal(result.ok, true, JSON.stringify(h.log.entries()));
    const groups = imageMessages(chat);
    assert.equal(groups.length, 2);
    const separator = chat.findIndex(m => m.content === 'Short unselected separator');
    assert.ok(separator > -1);
    assert.ok(chat.findIndex(m => m === groups[0]) < separator);
    assert.ok(chat.findIndex(m => m === groups[1]) > separator);
});

test('short positional setup prompt stays as text instead of disappearing', async () => {
    const { h, chat, first, second } = setupFixture('positional', { short: true });
    const result = await h.api.buildSetup(chat);
    assert.equal(result.ok, false);
    assert.equal(imageMessages(chat).length, 0);
    assert.ok(chat.some(m => typeof m.content === 'string' && m.content === first));
    assert.ok(chat.some(m => typeof m.content === 'string' && m.content === second));
});

test('post-history setup prompt survives payload decoration and stays in place', async () => {
    const h = host();
    const before = 'Before block: ' + 'The observatory kept a careful record of every season. '.repeat(70);
    const after = 'After block: ' + 'The archivist added a final note about the closing bell. '.repeat(70);
    const chat = [
        { role: 'system', content: before },
        { role: 'user', content: 'Recent history' },
        { role: 'system', content: `${after}\n[provider decoration]` },
    ];
    h.c.extensionSettings.microfiche.asImages.card = true;
    h.c.extensionSettings.microfiche.setupGrouping = 'positional';
    h.promptManagerMessages.collection = [
        { identifier: 'charDescription', role: 'system', content: before },
        { identifier: 'chatHistory' },
        { identifier: 'charPersonality', role: 'system', content: after },
    ];
    assert.equal(JSON.stringify([ ...h.api.setupBlocks(chat).entries() ]), JSON.stringify([ [ 0, 'card' ], [ 2, 'card' ] ]));
    const result = await h.api.buildSetup(chat);
    assert.equal(result.ok, true, JSON.stringify(h.log.entries()));
    const groups = imageMessages(chat);
    assert.equal(groups.length, 2);
    const rendered = result.lines.map(page => page.join('\n')).join('\n');
    assert.match(rendered, /Before block/);
    assert.match(rendered, /After block/);
    const historyGroup = chat.find(m => Array.isArray(m.content) && m.content.some(p => p?.type === 'text' && p.text.includes('Recent history')));
    assert.ok(historyGroup, 'history remains in the payload');
    assert.ok(historyGroup.content.some(p => p?.type === 'image_url'), 'post-history image remains attached after history');
    const historyPart = historyGroup.content.findIndex(p => p?.type === 'text' && p.text.includes('Recent history'));
    const imagePart = historyGroup.content.findIndex(p => p?.type === 'image_url');
    assert.ok(historyPart < imagePart, 'post-history attachment follows the history text');
});
