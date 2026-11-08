import { PAGE, planArchive, locate, layoutBlocks, normalize, wrapPx, paginate, MAX_UNKNOWN_SHARE, CHARS_PER_TOKEN, displayName, sourceLine } from './lib/layout.js';

import { renderPage, renderPagesPdf } from './lib/render.js';

import { savingsTotals, savingsDetail, exactTokens } from './lib/savings.js';

import { KEEP_MARKER, textExemption } from './lib/exempt.js';

import { archiveRange, trimToByteBudget, keptMessageCount } from './lib/archive-range.js';

import { createDebugLog } from './lib/debug-log.js';

import { auditPayload, attachmentMap, compareOrder, textOf } from './lib/payload-audit.js';

import { tr, setLanguageMode, setDetector, applyI18n, currentLanguage } from './lib/lang.js';

import { splitLorebook, entryWantsImage, stripImageMarker, hasKeepMarker } from './lib/lorebook-split.js';

import { getCurrentLocale } from '../../../i18n.js';

import { selected_world_info, world_info } from '../../../world-info.js';

import { power_user } from '../../../power-user.js';

import { GLYPH_H } from './lib/font.js';

import { promptManager } from '../../../openai.js';

import { SlashCommand } from '../../../slash-commands/SlashCommand.js';

import { SlashCommandArgument, ARGUMENT_TYPE } from '../../../slash-commands/SlashCommandArgument.js';

const MODULE = 'microfiche';

const FOLDER = new URL('.', import.meta.url).pathname.split('/scripts/extensions/')[1]?.replace(/\/$/, '') ?? 'third-party/microfiche';

const DEFAULTS = Object.freeze({
    enabled: true,
    offModels: [],
    experimentalModels: {},
    keepTokens: 4e3,
    keepMode: 'tokens',
    keepMessages: 3,
    showSavings: false,
    showNotifications: false,
    detail: 'medium',
    language: 'auto',
    lorebookImages: {
        mode: 'all',
        books: {}
    },
    asImages: {
        chat: true,
        preset: false,
        card: false,
        persona: false,
        lorebook: false
    },
    packSetup: true,
    setupGrouping: 'merged'
});

const PAGE_COST = Object.freeze({
    low: 280,
    pdf: 560,
    png: 1120
});

const MAX_IMAGE_BYTES = 18e6;

const GEMINI_MODEL = /gemini/i;

const NOT_A_CHAT_MODEL = /gemma|embed|tts|imagen|image|veo|live|audio|robotics|computer-use|aqa/i;

const TESTED_MODEL = /argon/i;

const MODEL_SELECTS = {
    makersuite: '#model_google_select',
    vertexai: '#model_vertexai_select',
    openrouter: '#model_openrouter_select',
    custom: '#model_custom_select'
};

const CHUNK_TOKENS = 2e3;

const NOTE = '[Earlier messages, as pages of text, oldest first. Each message starts with [Name]; ' + '¶ is a paragraph break; [emoji: name] represents an emoji. The chat continues after the images.]';

const SETUP_SYSTEM = 'Some instructions, character details and world info are written in images at their positions in this conversation. ' + 'Apply them alongside the text instructions, exactly as if their text were written here.';

const SETUP_NOTE = '[Instructions, characters and world info, as images of text. [emoji: name] represents an emoji. A ? stands for another character the font cannot draw.]';

const SETUP_NOTE_PACKED = SETUP_NOTE.replace(' A ?', ' ¶ is a line break. A ?');

const GEMINI_SOURCES = [ 'makersuite', 'vertexai' ];

const SOURCE_NAMES = {
    makersuite: 'Google AI Studio',
    vertexai: 'Vertex AI',
    openrouter: 'OpenRouter',
    custom: 'Custom'
};

const ctx = () => SillyTavern.getContext();

const debug = createDebugLog();

// Set from the extension manifest once settings render; used to label exports.
let extensionVersion = '';

// SillyTavern exposes no version in its context object; the client renders it
// into #version_display on startup, so read that instead of guessing a field.
function hostVersion() {
    return String(document.getElementById('version_display')?.textContent ?? '').trim();
}

function diagnosticsMeta(note = '') {
    return {
        extensionVersion: extensionVersion,
        hostVersion: hostVersion(),
        note: note
    };
}

/**
 * Records the facts that make a failure reproducible, without dumping the
 * chat itself (that would leak the user's roleplay into a bug report).
 */
function logEnvironment() {
    const c = ctx();
    debug.setContext({
        model: currentModel(),
        api: String(c.mainApi ?? ''),
        source: String(oai().chat_completion_source ?? ''),
        chatId: String(c.getCurrentChatId?.() ?? ''),
        chatLength: Array.isArray(c.chat) ? c.chat.length : 0,
    });
}

const ignoreSymbol = () => ctx().symbols?.ignore ?? Symbol.for('ignore');

const waiting = new Map;

let lastSent = null;

// True while a QUIET generation is in flight (another extension's background
// request — a summarizer, a memory plugin, vector storage). Such requests go
// through Generate() and fire PROMPT_READY like any other, but their payload
// is not the chat the user sees: swapping pages into it feeds images to a
// model that may not accept them and trashes the lastSetup state. MAIN
// generations reset the flag; PROMPT_READY skips while it holds.
let quietGeneration = false;

let replyStats = null;

let lastSetup = null;

let pendingAudit = null;

let auditRequests = new WeakMap;

let setupPageByUrl = new Map;

// What the currently open page viewer shows: title, page data URLs and the
// line arrays behind them, so the export buttons can hand out PNG/JPG files
// and assemble one multi-page PDF. One popup at a time; replaced on open.
let currentPopupExport = null;

let latestAudit = null;

let lastPromptReadyMap = null;

// The last problem the audits saw, shown next to the payload status until the
// next request resets it: cut attachments, a lost marker, duplicate text.
let lastNotice = null;

// The world info entries SillyTavern activated for the current request,
// refreshed by WORLD_INFO_ACTIVATED on every generation (WI runs after the
// generation interceptors and before PROMPT_READY, so the capture is fresh
// exactly when buildSetup needs it).
let activatedEntries = [];

function onWorldInfoActivated(data) {
    activatedEntries = Array.isArray(data)
        ? data.map(e => ({
            world: String(e?.world ?? ''),
            uid: e?.uid ?? null,
            content: String(e?.content ?? ''),
            // Kept to tell block entries (before/after) apart from the ones
            // SillyTavern injects elsewhere (atDepth, author's note, EM): those
            // never appear in the worldInfoBefore/After strings, and letting
            // them match there could steal text by coincidence.
            position: e?.position,
        })).filter(e => e.content)
        : [];
}

function clearActivatedEntries() {
    activatedEntries = [];
}

function onGenerationStarted(type, options) {
    quietGeneration = type === 'quiet' || Boolean(options?.quiet_prompt);
}

function clearPendingAudit() {
    pendingAudit = null;
    auditRequests = new WeakMap;
    setupPageByUrl = new Map;
    lastPromptReadyMap = null;
    lastNotice = null;
}

function showPayloadAudit() {
    const report = latestAudit;
    const text = !report ? tr('No request audited yet.')
        : tr('{stage}: {att} attachments, {chars} text characters. {arch} archived texts found, {amb} inconclusive. {miss} expected attachments missing. Keep: {keep}.')
            .replace('{stage}', report.stage === 'beforeSend' ? tr('Before sending to SillyTavern') : tr('After prompt replacement'))
            .replace('{att}', report.imageParts + report.fileParts)
            .replace('{chars}', report.textChars.toLocaleString(currentLanguage() === 'ru' ? 'ru-RU' : 'en-US'))
            .replace('{arch}', report.archivedTextMatches)
            .replace('{amb}', report.ambiguousTextMatches)
            .replace('{miss}', report.missingAttachments)
            .replace('{keep}', report.keepMode === 'messages' ? `${report.keepMessages} ${tr('msg')}` : `${report.keepTokens} ${tr('tokens')}`)
            + (lastNotice ? ` ⚠ ${lastNotice}` : '');
    $('#mf_payload_status').text(text);
    const table = $('#mf_payload_map');
    if (!table.length) return;
    const entries = report?.map ?? [];
    table.html(!entries.length ? '' : `<table class="mf-order-table"><thead><tr><th>${tr('#msg')}</th><th>${tr('#part')}</th><th>${tr('Kind')}</th><th>${tr('Source')}</th></tr></thead><tbody>`
        + entries.map(e => {
            const where = !e.page ? tr('untracked')
                : e.page.source === 'setup'
                    ? `${tr('setup page')} ${e.page.page}${e.page.kinds?.length ? ` — ${e.page.kinds.map(kind => tr(KIND_NAMES[kind] ?? kind)).join(' + ')}` : ''}`
                    : `${tr('chat page')} ${e.page.page} (${e.page.format}) — ${tr('messages')} ${e.page.ids ? `#${e.page.ids[0]}–#${e.page.ids[1]}` : `${tr('planner')} ${e.page.first}–${e.page.last}`}`;
            return `<tr><td>${e.messageIndex}</td><td>${e.partIndex}</td><td>${escapeHtml(e.mime || e.attachment)}</td><td>${escapeHtml(where)}</td></tr>`;
        }).join('') + '</tbody></table>');
}

function recordPayloadAudit(messages, entry, stage) {
    // Merge the chat-page and setup-page descriptors; both are keyed by url
    // and held only in memory.
    const pageByUrl = new Map([ ...(entry.pageByUrl ?? []), ...(setupPageByUrl ?? []) ]);
    const map = attachmentMap(messages, pageByUrl);
    const order = compareOrder(stage === 'beforeSend' ? lastPromptReadyMap : null, map);
    if (stage === 'promptReady') lastPromptReadyMap = map;
    const report = {
        stage: stage,
        keepMode: entry.keepMode,
        keepMessages: entry.keepMessages,
        keepTokens: entry.keepTokens,
        plannedArchivedMessages: entry.archivedTexts.length,
        plannedKeptMessages: entry.keptTexts.length,
        order: order,
        map: map.entries,
        ...auditPayload(messages, entry.archivedTexts, entry.keptTexts, entry.urls),
        attachmentsTracked: map.tracked,
        attachmentsUntracked: map.untracked,
        attachmentsAmbiguous: map.ambiguous,
    };
    latestAudit = report;
    // The beforeSend stage is the authoritative one: whatever a later extension
    // re-added is visible here, right before the request leaves the browser.
    if (stage === 'beforeSend' && report.archivedTextMatches > 0) {
        lastNotice = tr('Archived history was found in the request as both text and images — another extension is putting it back. Make Microfiche load last among extensions or disable the one interfering.');
        notify('warning', 'duplicate', lastNotice);
    } else if (stage === 'beforeSend' && (order.status === 'reordered' || order.status === 'missing')) {
        lastNotice = tr('The attachment order or set changed between prompt assembly and sending — another extension seems to interfere with the request.');
    }
    debug[report.archivedTextMatches || report.missingAttachments || order.status === 'reordered' || order.status === 'missing' ? 'warn' : 'info'](`payload.${stage}`, report);
    showPayloadAudit();
    return report;
}

function onSettingsReady(data) {
    debug.debug('settingsReady.enter', {
        type: String(data?.type ?? ''),
        isArray: Array.isArray(data?.messages),
        messages: Array.isArray(data?.messages) ? data.messages.length : -1,
    });
    if (!Array.isArray(data?.messages) || data.type === 'quiet') return;
    let entry = auditRequests.get(data.messages);
    // Some host routes copy the array. Only correlate a copy when all of our
    // exact attachments survived; never attach an old audit to a background request.
    if (!entry && pendingAudit && data.model === pendingAudit.model && data.type === pendingAudit.type) {
        const check = auditPayload(data.messages, [], [], pendingAudit.urls);
        if (check.expectedAttachments && !check.missingAttachments) entry = pendingAudit;
    }
    if (!entry || entry.chatId !== ctx().getCurrentChatId()) return;
    try {
        recordPayloadAudit(data.messages, entry, 'beforeSend');
    } catch (error) {
        debug.fail('payload.auditFailed', error, { stage: 'beforeSend' });
    } finally {
        auditRequests.delete(data.messages);
        if (pendingAudit === entry) pendingAudit = null;
    }
}

const notified = new Set;

function notify(level, key, message, once = true) {
    if (level === 'info' && !settings().showNotifications) return;
    const id = `${ctx().getCurrentChatId?.() ?? ''}:${key}`;
    // once=false: repeat on every matching request (the success toast must
    // also fire on swipes and edits, not only on the first send).
    if (once) {
        if (notified.has(id)) return;
        notified.add(id);
    }
    debug[level === 'error' ? 'error' : level === 'warning' || level === 'warn' ? 'warn' : 'info']('notify', { key: key, message: message });
    toastr[level](message, 'Microfiche');
}

const pageTokenCache = new Map;

function pageTokens(page) {
    const text = page.lines.join('\n');
    const key = `${currentModel()}\n${text}`;
    if (!pageTokenCache.has(key)) {
        const fallback = Math.round(page.chars / CHARS_PER_TOKEN);
        const count = Promise.resolve().then(() => ctx().getTokenCountAsync(text)).then(n => Number.isFinite(n) && n > 0 ? n : fallback, () => fallback);
        pageTokenCache.set(key, count);
        if (pageTokenCache.size > 500) pageTokenCache.delete(pageTokenCache.keys().next().value);
    }
    return pageTokenCache.get(key);
}

async function countedStats(plan, format) {
    const stats = statsOf(plan, format);
    stats.textTokens = plan.sourceText !== undefined ? await pageTokens({
        lines: [ plan.sourceText ],
        chars: plan.archivedChars
    }) : (await Promise.all(plan.pages.map(pageTokens))).reduce((a, b) => a + b, 0);
    return stats;
}

// One-time repair of settings written by older versions. Runs once per stored
// settings object instead of on every settings() call, which used to delete
// keys, rebuild asImages as a fresh object and churn garbage on hot paths.
const migrated = new WeakSet;

function migrateSettings(s) {
    if (migrated.has(s)) return;
    migrated.add(s);
    delete s.modelMatch;
    delete s.pageTokens;
    delete s.reach;
    delete s.maxPages;
    if (s.setupImages === true) s.asImages = {
        preset: true,
        card: true,
        persona: true,
        lorebook: true
    };
    delete s.setupImages;
}

// 'auto' follows the tavern's UI language; the detector reads it from the
// host i18n module (the same source the tavern itself uses).
setDetector(() => getCurrentLocale());

function settings() {
    const all = ctx().extensionSettings;
    all[MODULE] ??= {};
    const s = all[MODULE];
    migrateSettings(s);
    if (!Array.isArray(s.offModels)) s.offModels = [];
    if (!s.experimentalModels || typeof s.experimentalModels !== 'object' || Array.isArray(s.experimentalModels)) s.experimentalModels = {};
    if (s.keepMode !== 'messages') s.keepMode = 'tokens';
    if (s.language !== 'ru' && s.language !== 'en') s.language = 'auto';
    setLanguageMode(s.language);
    // 'merged' packs every ticked setup prompt into one image group (cheapest);
    // 'positional' draws one group per prompt so each keeps its preset slot,
    // which is what makes before/after world info land where they belong.
    if (s.setupGrouping !== 'positional') s.setupGrouping = 'merged';
    // Which lorebook entries go as images: 'all' keeps the historical
    // whole-lorebook behavior, 'selected' follows the per-book checkboxes.
    const lorebookImages = s.lorebookImages && typeof s.lorebookImages === 'object' && !Array.isArray(s.lorebookImages) ? s.lorebookImages : (s.lorebookImages = {});
    if (lorebookImages.mode !== 'selected') lorebookImages.mode = 'all';
    if (!lorebookImages.books || typeof lorebookImages.books !== 'object' || Array.isArray(lorebookImages.books)) lorebookImages.books = {};
    // Keep the object identity stable: callers hold references to it.
    const asImages = s.asImages && typeof s.asImages === 'object' && !Array.isArray(s.asImages) ? s.asImages : (s.asImages = {});
    for (const [key, value] of Object.entries(DEFAULTS.asImages)) {
        if (typeof asImages[key] !== 'boolean') asImages[key] = value;
    }
    for (const [key, value] of Object.entries(DEFAULTS)) {
        if (key !== 'asImages') s[key] ??= value;
    }
    return s;
}

const oai = () => ctx().chatCompletionSettings ?? {};

const SETUP_KINDS = [ 'preset', 'card', 'persona', 'lorebook' ];

const setupOn = () => SETUP_KINDS.some(kind => settings().asImages[kind]);

function pageFormat() {
    if (!isGemini(currentModel())) return 'png';
    const detail = settings().detail;
    if (detail === 'high') return 'png';
    if (detail === 'low' && !GEMINI_SOURCES.includes(oai().chat_completion_source)) return 'low';
    return 'pdf';
}

const currentModel = () => String(ctx().getChatCompletionModel?.() ?? '');

const isGemini = model => GEMINI_MODEL.test(model) && !NOT_A_CHAT_MODEL.test(model);

const experimentalKey = () => JSON.stringify([ oai().chat_completion_source ?? '', currentModel() ]);

function experimentalConfig() {
    return settings().experimentalModels[experimentalKey()];
}

function pageCost(format = pageFormat()) {
    if (isGemini(currentModel())) return PAGE_COST[format];
    const value = Number(experimentalConfig()?.pageTokens);
    return Number.isFinite(value) && value >= 1 ? Math.min(1e5, Math.round(value)) : 1500;
}

function modelMatches() {
    if (ctx().mainApi !== 'openai') return false;
    const model = currentModel();
    if (!model) return false;
    return isGemini(model) ? !settings().offModels.includes(model) : experimentalConfig()?.enabled === true;
}

// Reading the connection's <select> options costs a DOM query plus a sort on
// every refresh. The list only changes when the source or the selected model
// changes, so cache it on exactly those two values.
let modelsCache = null;
let modelsCacheKey = null;

function connectionModels() {
    const source = oai().chat_completion_source;
    const current = currentModel();
    const key = `${source ?? ''}\n${current}`;
    if (modelsCacheKey === key) return modelsCache;
    const select = MODEL_SELECTS[source];
    const ids = select ? $(`${select} option`).map((_, o) => String(o.value)).get() : [];
    if (current) ids.push(current);
    modelsCache = [ ...new Set(ids) ].filter(isGemini).sort();
    modelsCacheKey = key;
    return modelsCache;
}

function stopAt(m) {
    if (m.extra?.tool_invocations?.length) return tr('a tool call');
    if (oai().media_inlining !== false && (m.extra?.media?.length || m.extra?.image)) return tr('an attached image or file');
    return null;
}

function makePlan(messages, contextSize, placeholder = false) {
    const s = settings();
    return planArchive({
        messages: messages,
        keepTokens: Number(s.keepTokens) || 0,
        keepMode: s.keepMode,
        // The planner counts every message it is given, including the synthetic
        // trailing user message. Ask for one extra so the user gets the number
        // of real messages they configured.
        keepMessages: (Number(s.keepMessages) || 0) + (placeholder ? 1 : 0),
        coverTokens: contextSize,
        maxPages: Infinity,
        pageCost: pageCost(),
        chunkTokens: CHUNK_TOKENS,
        charsPerToken: CHARS_PER_TOKEN,
        stopAt: stopAt
    });
}

function statsOf(plan, format = pageFormat()) {
    return {
        pages: plan.pages.length,
        format: format,
        messages: plan.removeCount,
        textTokens: Math.round(plan.archivedChars / CHARS_PER_TOKEN),
        imageTokens: plan.pages.length * pageCost(format),
        experimental: !isGemini(currentModel()),
        stoppedAt: plan.stoppedAt,
        stopReason: plan.stopReason ?? null
    };
}

const k = n => n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);

/** Escapes untrusted text before it is interpolated into a popup's HTML. */
const escapeHtml = text => $('<div>').text(text ?? '').html();

function promptIds() {
    return ctx().chat.map((m, i) => m.is_system ? -1 : i).filter(i => i >= 0);
}

function currentPlan() {
    const c = ctx();
    const o = oai();
    const contextSize = (Number(o.openai_max_context) || 64e3) - (Number(o.openai_max_tokens) || 0);
    const ids = promptIds();
    const messages = ids.map(i => c.chat[i]);
    const placeholder = Boolean(messages.length && !messages[messages.length - 1].is_user);
    if (placeholder) messages.push({
        mes: '',
        is_user: true,
        name: c.name1,
        extra: {},
        mfPlaceholder: true
    });
    return {
        plan: makePlan(messages, contextSize, placeholder),
        ids: ids,
        sent: false
    };
}

function activePlan() {
    const c = ctx();
    if (lastSent && lastSent.chatId === c.getCurrentChatId() && lastSent.chatLength <= c.chat.length) return lastSent;
    return currentPlan();
}

function messagePlan(mesId) {
    const active = activePlan();
    const spotsFor = view => {
        const index = view.ids.indexOf(mesId);
        return index < 0 ? [] : locate(view.plan, index);
    };
    let spots = spotsFor(active);
    if (spots.length || !active.sent) return {
        active: active,
        spots: spots
    };
    const next = currentPlan();
    spots = spotsFor(next);
    return {
        active: next,
        spots: spots
    };
}

function messagePreview(mesId) {
    const view = messagePlan(mesId);
    if (view.spots.length) return view;
    const c = ctx();
    const ids = promptIds();
    const index = ids.indexOf(mesId);
    if (index < 0) return view;
    const messageLines = ids.map(id => {
        const m = c.chat[id];
        const head = normalize(displayName(m)).text;
        return wrapPx(`[${head}] ${normalize(m.mes).text}`, PAGE.usable);
    });
    const plan = {
        pages: paginate(messageLines, PAGE.rows)
    };
    return {
        active: {
            plan: plan,
            ids: ids,
            sent: false,
            previewOnly: true
        },
        spots: locate(plan, index)
    };
}

function chatIdsFor(chat, positions) {
    const c = ctx();
    const ids = promptIds();
    if (chat.length > ids.length + 1) return null;
    const out = positions.map(i => ids[i]);
    const same = positions.every((i, n) => {
        const real = c.chat[out[n]];
        return real && real.send_date === chat[i].send_date && real.name === chat[i].name && real.is_user === chat[i].is_user;
    });
    return same ? out : null;
}

globalThis.microfiche_intercept = async function(chat, contextSize, abort, type) {
    debug.debug('intercept.enter', {
        type: String(type ?? ''),
        messages: Array.isArray(chat) ? chat.length : -1,
        pending: waiting.size,
    });
    if (type === 'quiet') return;
    try {
        clearPendingAudit();
        for (const entry of waiting.values()) entry.stale = true;
        const s = settings();
        if (!Array.isArray(chat)) {
            debug.warn('intercept.skipped', { reason: 'chat is not an array' });
            return;
        }
        if (!s.enabled) {
            debug.debug('intercept.skipped', { reason: 'disabled' });
            return;
        }
        if (!s.asImages.chat) {
            debug.debug('intercept.skipped', { reason: 'chat images unticked' });
            return;
        }
        if (!modelMatches()) {
            debug.debug('intercept.skipped', { reason: 'model not enabled', model: currentModel() });
            return;
        }
        logEnvironment();
        const ignore = ignoreSymbol();
        const live = [];
        chat.forEach((m, i) => {
            if (m && typeof m.mes === 'string' && !m.extra?.[ignore]) live.push(i);
        });
        const plan = makePlan(live.map(i => chat[i]), contextSize);
        if (!plan.pages.length) {
            debug.info('intercept.tooShort', {
                liveMessages: live.length,
                contextSize: contextSize,
                stoppedAt: plan.stoppedAt,
                stopReason: plan.stopReason ?? null,
            });
            return;
        }
        const format = pageFormat();
        let urls = await Promise.all(plan.pages.map(p => renderPage(p.lines, format === 'pdf' ? 'pdf' : 'png')));
        const trim = trimToByteBudget(plan.pages, urls, MAX_IMAGE_BYTES);
        urls = trim.urls;
        if (trim.dropped) {
            plan.pages = trim.pages;
            plan.archivedChars = plan.pages.reduce((sum, p) => sum + p.chars, 0);
            const owners = [ ...new Set(plan.pages.flatMap(p => p.owners)) ].sort((a, b) => a - b);
            plan.sourceText = owners.map(i => sourceLine(chat[live[i]])).join('\n\n');
        }
        const range = archiveRange(plan);
        const archived = live.slice(range.start, range.end);
        const skipped = live.slice(0, range.start);
        debug.info('intercept.plan', {
            keepMode: s.keepMode,
            keepMessages: Number(s.keepMessages) || 0,
            keepTokens: Number(s.keepTokens) || 0,
            format: format,
            pages: plan.pages.length,
            pagesDroppedBySize: trim.dropped,
            liveMessages: live.length,
            archivedStart: range.start,
            archivedEnd: range.end,
            archivedMessages: archived.length,
            keptAsTextBeforeRange: skipped.length,
            bytes: trim.bytes,
            maxBytes: MAX_IMAGE_BYTES,
            tailStart: plan.tailStart,
            stoppedAt: plan.stoppedAt,
            stopReason: plan.stopReason ?? null,
        });
        if (!archived.length) {
            debug.warn('intercept.noArchiveRange', { pages: plan.pages.length, start: range.start, end: range.end });
            return;
        }
        const ids = chatIdsFor(chat, live);
        const c = ctx();
        const marker = `⟦MICROFICHE_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}⟧`;
        const archivedSet = new Set(archived);
        // Where each history page ends up, for the attachment order map. The
        // urls are keys held only in memory; the exported report never carries
        // them. `first`/`last`/`owners` index the filtered live list, `ids` are
        // the real chat message ids (null when the chat could not be matched).
        const pageByUrl = new Map(plan.pages.map((p, i) => [ urls[i], {
            source: 'chat',
            page: i + 1,
            format: format,
            first: p.first,
            last: p.last,
            owners: [ ...new Set(p.owners) ].sort((a, b) => a - b),
            ids: ids ? [ ids[p.first], ids[p.last] ] : null,
        } ]));
        const audit = {
            archivedTexts: archived.map(i => chat[i].mes),
            keptTexts: live.filter(i => !archivedSet.has(i)).map(i => chat[i].mes),
            pageByUrl: pageByUrl,
            urls: urls,
            type: type,
            model: currentModel(),
            chatId: c.getCurrentChatId(),
            keepMode: s.keepMode,
            keepMessages: Number(s.keepMessages) || 0,
            keepTokens: Number(s.keepTokens) || 0
        };
        for (const i of archived) chat[i] = {
            ...chat[i],
            extra: {
                ...chat[i].extra ?? {},
                [ignore]: true
            }
        };
        const at = archived[archived.length - 1] + 1;
        chat.splice(at, 0, {
            name: c.name1,
            is_user: true,
            is_system: false,
            send_date: chat[at - 1]?.send_date ?? '',
            mes: marker,
            extra: {}
        });
        waiting.set(marker, {
            audit: audit,
            urls: urls,
            text: plan.pages.map(p => p.lines.join('\n')).join('\n'),
            format: format,
            stats: countedStats(plan, format).catch(() => statsOf(plan, format)),
            sent: ids ? {
                plan: plan,
                ids: ids,
                sent: true,
                chatId: c.getCurrentChatId(),
                chatLength: c.chat.length
            } : null
        });
        if (skipped.length) {
            console.warn('[Microfiche]', `${skipped.length} older message(s) did not fit the image budget and stay as text.`);
        }
        if (trim.dropped) {
            notify('warning', 'trimmed', tr('Older pages did not fit the image size limit, so the {n} oldest pages were left out; their messages stay as text.').replace('{n}', trim.dropped));
        }
        while (waiting.size > 8) {
            const oldest = waiting.keys().next().value;
            waiting.delete(oldest);
            debug.warn('waiting.evicted', { marker: oldest });
        }
    } catch (error) {
        debug.fail('intercept.failed', error, { type: type, contextSize: contextSize });
        console.error('[Microfiche] Skipped for this request, sending plain text.', error);
        notify('error', 'intercept', tr('Couldn’t make the images, so this message went as normal text. Details in the browser console.'));
    }
};

function roleView(chat) {
    const o = oai();
    const gemini = GEMINI_SOURCES.includes(o.chat_completion_source);
    let lead = 0;
    if (gemini && o.use_sysprompt) while (lead < chat.length - 1 && chat[lead]?.role === 'system') lead++;
    return i => {
        const role = chat[i]?.role;
        if (i < lead) return 'instruction';
        if (gemini && (role === 'system' || role === 'tool')) return 'user';
        return role;
    };
}

// Image groups that must not be glued to one another. Two groups belong to two
// different prompt positions; merging them would move pages around in the
// payload (World Info (after) drifting up before the chat, for instance).
// A group may still merge with neighbouring TEXT, which is what keeps the
// Gemini user/system pairing intact.
const imageGroupBarrier = new WeakSet();

function isolate(chat, index, { barrier = false } = {}) {
    const role = roleView(chat);
    if (role(index) !== 'user') return;
    const mergeable = i => role(i) === 'user' && !chat[i]?.tool_calls && !chat[i]?.tool_call_id && !imageGroupBarrier.has(chat[i]);
    let from = index;
    let to = index;
    while (from > 0 && mergeable(from - 1)) from--;
    while (to < chat.length - 1 && mergeable(to + 1)) to++;
    if (from === to && !barrier) return;
    const c = ctx();
    const parts = [];
    const pushText = text => {
        if (!text) return;
        const last = parts[parts.length - 1];
        if (last?.type === 'text') last.text += '\n\n' + text; else parts.push({
            type: 'text',
            text: text
        });
    };
    for (let i = from; i <= to; i++) {
        const m = chat[i];
        const prefix = m.name === 'example_user' ? c.name1 : m.name === 'example_assistant' ? c.name2 : m.name;
        const named = text => prefix && !text.startsWith(`${prefix}: `) ? `${prefix}: ${text}` : text;
        if (i === index || Array.isArray(m.content)) {
            for (const part of Array.isArray(m.content) ? m.content : []) {
                if (part?.type === 'text') {
                    if (i === index) parts.push({
                        ...part
                    }); else pushText(named(part.text));
                } else {
                    parts.push(part);
                }
            }
        } else {
            pushText(named(String(m.content ?? '')));
        }
    }
    const merged = {
        role: 'user',
        content: parts
    };
    const isGroup = barrier || imageGroupBarrier.has(chat[index]);
    chat.splice(from, to - from + 1, merged);
    // The merged message inherits the boundary so a later pass over another
    // group cannot swallow it.
    if (isGroup) imageGroupBarrier.add(merged);
    return merged;
}

function swapArchive(data) {
    for (const [marker, entry] of waiting) {
        const index = data.chat.findIndex(m => textOf(m).includes(marker));
        if (index === -1) continue;
        waiting.delete(marker);
        const message = data.chat[index];
        try {
            message.role = 'user';
            delete message.name;
            message.content = [ {
                type: 'text',
                text: NOTE
            }, ...entry.urls.map(url => ({
                type: 'image_url',
                image_url: entry.format === 'low' ? {
                    url: url,
                    detail: 'low'
                } : {
                    url: url
                }
            })) ];
            isolate(data.chat, index, { barrier: true });
            pendingAudit = entry.audit;
            auditRequests.set(data.chat, entry.audit);
            if (entry.sent) lastSent = entry.sent;
            debug.info('swap.attached', {
                marker: marker,
                pages: entry.urls.length,
                format: entry.format,
                route: routeName(),
                model: currentModel(),
                index: index,
            });
            return entry.stats;
        } catch (error) {
            debug.fail('swap.failed', error, { marker: marker, pages: entry.urls.length, index: index });
            console.error('[Microfiche] Could not place the pages, sending their text instead.', error);
            data.chat[index] = {
                role: 'user',
                content: entry.text
            };
            notify('error', 'swap', tr('Couldn’t attach the images, so their text went instead. Details in the browser console.'));
        }
        return null;
    }
    if (waiting.size) {
        lastNotice = tr('The marker with the images was cut from the request: the context limit or another extension. The images did not go out.');
        debug.warn('swap.markerNotFound', {
            pending: waiting.size,
            reason: 'the context limit or another extension cut the marker message',
        });
    }
    return null;
}

const setupPageCache = new Map;

function setupPage(lines, format) {
    const key = `${format}\n${lines.join('\n')}`;
    if (!setupPageCache.has(key)) {
        setupPageCache.set(key, renderPage(lines, format === 'pdf' ? 'pdf' : 'png'));
        if (setupPageCache.size > 64) setupPageCache.delete(setupPageCache.keys().next().value);
    }
    return setupPageCache.get(key);
}

const KIND_OF = {
    charDescription: 'card',
    charPersonality: 'card',
    scenario: 'card',
    dialogueExamples: 'card',
    personaDescription: 'persona',
    worldInfoBefore: 'lorebook',
    worldInfoAfter: 'lorebook'
};

const KIND_NAMES = {
    preset: 'Preset',
    card: 'Character card',
    persona: 'Persona',
    lorebook: 'Lorebook'
};

function promptKinds() {
    const kinds = new Map;
    const walk = (item, top) => {
        if (Array.isArray(item?.collection)) {
            for (const child of item.collection) walk(child, top ?? child?.identifier);
        } else if (typeof item?.content === 'string' && !kinds.has(item.content)) {
            kinds.set(item.content, KIND_OF[top] ?? 'preset');
        }
    };
    walk(promptManager?.messages, null);
    return kinds;
}

function setupEnd(chat) {
    const prefix = [];
    let history = false;
    const walk = item => {
        if (history) return;
        if (item?.identifier === 'chatHistory' || item?.identifier === 'newMainChat' || /^chatHistory-/.test(item?.identifier ?? '')) {
            history = true;
        } else if (Array.isArray(item?.collection)) {
            for (const child of item.collection) walk(child);
        } else if (item?.content || item?.tool_calls) {
            prefix.push(item);
        }
    };
    walk(promptManager?.messages);
    if (history && prefix.length < chat.length && prefix.every((m, i) => m.role === chat[i]?.role && m.name === chat[i]?.name && JSON.stringify(m.content) === JSON.stringify(chat[i]?.content))) return prefix.length;
    let end = 0;
    while (end < chat.length - 1 && chat[end]?.role === 'system' && typeof chat[end].content === 'string') end++;
    return end;
}

function setupBlocks(chat) {
    const selected = new Map;
    const kinds = promptKinds();
    for (let i = 0, end = setupEnd(chat); i < end; i++) selected.set(i, kinds.get(chat[i].content) ?? 'preset');
    let history = false;
    let tail = [];
    const historyIds = new Set([ 'chatHistory', 'newMainChat', 'newChat', 'groupNudge', 'emptyUserMessageReplacement', 'continueNudge' ]);
    const walk = (item, top) => {
        if (historyIds.has(item?.identifier) || /^chatHistory-|^toolCall-/.test(item?.identifier ?? '')) {
            if (!history) {
                history = true;
                tail = [];
            }
            return;
        }
        if (Array.isArray(item?.collection)) {
            for (const child of item.collection) walk(child, top ?? child?.identifier);
        } else if (history && (item?.content || item?.tool_calls)) {
            tail.push({
                message: item,
                kind: KIND_OF[top ?? item.identifier] ?? 'preset'
            });
        }
    };
    walk(promptManager?.messages, null);
    const start = chat.length - tail.length;
    // Post-history prompts are matched leniently: the payload may differ from
    // the raw prompt because of macro substitution, a name prefix, or text
    // parts already wrapped into an array (e.g. an image group swapped in).
    // A match still requires the prompt text to appear at the START of the
    // payload text, so an unrelated trailing message can never be claimed.
    const textHead = m => typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? String(m.content.find(p => typeof p?.text === 'string')?.text ?? '') : '';
    const matches = (m, payload) => payload && payload.role === m.role && textHead(payload).startsWith(String(m.content ?? '').slice(0, 60));
    if (history && start >= 0 && tail.every(({message: m}, i) => matches(m, chat[start + i]))) {
        tail.forEach(({kind: kind}, i) => selected.set(start + i, kind));
    }
    return selected;
}

async function buildSetup(chat) {
    const selected = setupBlocks(chat);
    if (!selected.size) return {
        ok: false,
        reason: tr('no identifiable setup blocks in the prompt')
    };
    const end = chat.length;
    const c = ctx();
    const ticked = settings().asImages;
    const format = pageFormat();
    const out = [];
    const sent = {
        pages: [],
        textTokens: 0,
        imageTokens: 0,
        kinds: new Set
    };
    const kept = [];
    // Setup pages get their own ordinals (global across the request) and carry
    // the kinds of the whole run they were packed from — a packed page can mix
    // preset/card/persona/lorebook blocks, so per-block attribution is not
    // claimed. The urls are matching keys only, never exported.
    const setupPageByUrl = new Map;
    let setupOrdinal = 0;
    let imageBytes = chat.reduce((sum, m) => sum + (Array.isArray(m.content) ? m.content.reduce((n, p) => n + (p?.image_url?.url?.length ?? 0), 0) : 0), 0);
    let skipped = null;
    let run = [];
    // Which payload message the open run belongs to. In 'positional' mode the
    // run is closed as soon as a block from another prompt arrives, so every
    // prompt keeps its own image group at its own place in the payload.
    let runOwner = -1;
    const positional = settings().setupGrouping === 'positional';
    const openGroup = async index => {
        if (positional && runOwner !== index) await flush();
    };
    const flush = async () => {
        runOwner = -1;
        if (!run.length) return;
        const group = run;
        run = [];
        const blocks = group.map(({m: m}) => {
            const name = m.name === 'example_user' ? c.name1 : m.name === 'example_assistant' ? c.name2 : m.name;
            return name ? `${name}: ${m.content}` : m.content;
        });
        const {pages: pages, chars: chars, unknown: unknown} = layoutBlocks(blocks, {
            packed: settings().packSetup
        });
        const textTokens = await pageTokens({
            lines: blocks,
            chars: chars
        });
        const imageTokens = pages.length * pageCost(format);
        const note = settings().packSetup ? SETUP_NOTE_PACKED : SETUP_NOTE;
        const overhead = sent.pages.length ? [ note ] : [ SETUP_SYSTEM, note ];
        const overheadTokens = await pageTokens({
            lines: overhead,
            chars: overhead.join('\n').length
        });
        if (!pages.length || unknown / Math.max(1, chars) > MAX_UNKNOWN_SHARE || imageTokens + overheadTokens >= textTokens * .8) {
            skipped = unknown / Math.max(1, chars) > MAX_UNKNOWN_SHARE ? tr('too much of it is in letters the font lacks') : tr('too short to save anything');
            out.push(...group.map(({m: m}) => m));
            return;
        }
        const urls = await Promise.all(pages.map(lines => setupPage(lines, format)));
        const bytes = urls.reduce((sum, url) => sum + url.length, 0);
        if (imageBytes + bytes > MAX_IMAGE_BYTES) {
            skipped = tr('the image size limit would be exceeded');
            out.push(...group.map(({m: m}) => m));
            return;
        }
        imageBytes += bytes;
        const kinds = [ ...new Set(group.map(g => g.kind)) ];
        urls.forEach((url, j) => setupPageByUrl.set(url, {
            source: 'setup',
            page: ++setupOrdinal,
            groupPage: j + 1,
            kinds: kinds,
        }));
        out.push({
            role: 'user',
            content: [ {
                type: 'text',
                text: note
            }, ...urls.map(url => ({
                type: 'image_url',
                image_url: format === 'low' ? {
                    url: url,
                    detail: 'low'
                } : {
                    url: url
                }
            })) ],
            mfSetup: true
        });
        sent.pages.push(...pages);
        sent.textTokens += textTokens;
        sent.imageTokens += imageTokens;
        for (const g of group) sent.kinds.add(g.kind);
    };
    for (let i = 0; i < end; i++) {
        if (!selected.has(i) || ![ 'system', 'user' ].includes(chat[i].role) || typeof chat[i].content !== 'string' || chat[i].tool_calls || chat[i].tool_call_id || chat[i].signature || chat[i].reasoning) {
            await flush();
            out.push(chat[i]);
            continue;
        }
        const kind = selected.get(i);
        // Lorebook blocks can be cut back into their entries: when the
        // activation capture is available, each entry decides on its own
        // whether it goes as an image (mode + per-book choice + markers).
        // Anything the splitter cannot attribute stays as text — losing
        // lorebook TEXT is damage, losing an image is only a waste.
        if (kind === 'lorebook' && settings().asImages.lorebook && activatedEntries.length) {
            const selection = settings().lorebookImages;
            // Only entries positioned before/after can be inside this block;
            // entries without a position (older captures) are still trusted.
            const blockEntries = activatedEntries.filter(e => e.position === undefined || e.position === 0 || e.position === 1);
            const { segments } = splitLorebook(String(chat[i].content ?? ''), blockEntries);
            if (segments.length) {
                // A book missing from the selection map stays as text silently
                // in 'selected' mode — exactly how a transferred old book looks
                // "broken". Say which book to tick instead of staying quiet.
                if (selection.mode === 'selected') {
                    for (const segment of segments) {
                        if (segment.book === null || selection.books?.[segment.book] === true || hasKeepMarker(segment.text)) continue;
                        notify('warning', 'unlisted:' + segment.book, tr('Lorebook {name} is active but unticked — its entries went as text. Tick the book under Lorebook pages to send it as images.').replace('{name}', segment.book));
                    }
                }
                for (const segment of segments) {
                    if (entryWantsImage(segment, selection)) {
                        await openGroup(i);
                        runOwner = i;
                        run.push({
                            m: { ...chat[i], content: stripImageMarker(segment.text) },
                            kind: kind
                        });
                        continue;
                    }
                    await flush();
                    const { exempt: exempt, text: text } = textExemption(segment.text);
                    if (hasKeepMarker(segment.text)) {
                        kept.push({
                            kind: kind,
                            active: true,
                            text: String(text ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? '',
                            tokens: Math.round(String(text ?? '').length / CHARS_PER_TOKEN)
                        });
                    }
                    out.push({ ...chat[i], content: exempt ? text : segment.text });
                }
                continue;
            }
        }
        const {exempt: exempt, text: text} = textExemption(chat[i].content);
        const message = exempt ? {
            ...chat[i],
            content: text
        } : chat[i];
        if (exempt) {
            kept.push({
                kind: kind,
                active: Boolean(ticked[kind]),
                text: String(text ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? '',
                tokens: Math.round(String(text ?? '').length / CHARS_PER_TOKEN)
            });
            if (ticked[kind]) skipped ??= 'marked to stay as text';
        }
        if (ticked[kind] && !exempt) {
            await openGroup(i);
            runOwner = i;
            run.push({
                m: message,
                kind: kind
            });
        } else {
            await flush();
            out.push(message);
        }
    }
    await flush();
    if (!sent.pages.length) {
        chat.splice(0, end, ...out);
        return {
            ok: false,
            reason: skipped ?? tr('none of the ticked parts are in this prompt'),
            kept: kept
        };
    }
    chat.splice(0, end, {
        role: 'system',
        content: SETUP_SYSTEM
    }, ...out);
    // Group boundaries stay marked until every group has been isolated, so
    // separate groups cannot merge with each other; the marks are dropped from
    // the payload afterwards.
    // Isolate every image group, oldest last: each group keeps its own
    // position, and the barrier marks stop isolate() from gluing one group to
    // another. Merging a group into neighbouring TEXT stays allowed.
    const groups = [];
    for (let i = 0; i < chat.length; i++) {
        if (!chat[i]?.mfSetup) continue;
        // Mark every group before isolating any of them. Without this first
        // pass, isolating the newest adjacent group could absorb the older
        // one before its own barrier existed.
        imageGroupBarrier.add(chat[i]);
        delete chat[i].mfSetup;
        groups.push(i);
    }
    for (const i of groups.reverse()) isolate(chat, i, { barrier: true });
    const order = Object.keys(KIND_NAMES).filter(kind => sent.kinds.has(kind));
    return {
        ok: true,
        pages: sent.pages.length,
        lines: sent.pages,
        format: format,
        textTokens: sent.textTokens,
        imageTokens: sent.imageTokens,
        kinds: order,
        kept: kept,
        pageByUrl: setupPageByUrl,
        experimental: !isGemini(currentModel())
    };
}

async function swapSetup(chat) {
    lastSetup = await buildSetup(chat);
    if (!lastSetup.ok) return null;
    // Recorded for the attachment order map; previews build setup on a cloned
    // prompt and never reach the audit, so they do not overwrite this.
    setupPageByUrl = lastSetup.pageByUrl;
    const {pages: pages, textTokens: textTokens, imageTokens: imageTokens, kinds: kinds, experimental: experimental} = lastSetup;
    return {
        pages: pages,
        textTokens: textTokens,
        imageTokens: imageTokens,
        kinds: kinds,
        experimental: experimental
    };
}

async function previewSetup() {
    const c = ctx();
    let captured = null;
    const grab = data => {
        if (data?.dryRun && !captured && Array.isArray(data.chat)) captured = structuredClone(data.chat);
    };
    c.eventSource.on(c.eventTypes.CHAT_COMPLETION_PROMPT_READY, grab);
    try {
        await c.generate('normal', {}, true);
    } finally {
        c.eventSource.removeListener(c.eventTypes.CHAT_COMPLETION_PROMPT_READY, grab);
    }
    return captured ? buildSetup(captured) : {
        ok: false,
        reason: tr('couldn’t build the prompt')
    };
}

async function onPromptReady(data) {
    // Enter events are debug-level: they cost nothing normally, but when the
    // images are mysteriously cut, the export shows exactly which silent exit
    // (dryRun / non-array chat / never called) swallowed the swap.
    debug.debug('promptReady.enter', {
        dryRun: Boolean(data?.dryRun),
        isArray: Array.isArray(data?.chat),
        chatLength: Array.isArray(data?.chat) ? data.chat.length : -1,
        waiting: waiting.size,
    });
    if (data?.dryRun || !Array.isArray(data?.chat)) {
        debug.debug('promptReady.skipped', {
            dryRun: Boolean(data?.dryRun),
            isArray: Array.isArray(data?.chat),
            waiting: waiting.size,
        });
        return;
    }
    if (quietGeneration) {
        debug.debug('promptReady.skipped', { reason: 'quiet generation', waiting: waiting.size });
        return;
    }
    const archive = waiting.size ? swapArchive(data) : null;
    let setup = null;
    if (setupOn() && settings().enabled && modelMatches()) {
        try {
            setup = await swapSetup(data.chat);
        } catch (error) {
            debug.fail('setup.failed', error, { chatLength: data.chat.length });
            console.error('[Microfiche] Blocks before the chat sent as text.', error);
            lastSetup = {
                ok: false,
                reason: 'an error, details in the browser console'
            };
        }
    } else {
        lastSetup = null;
        // The user ticked the extension but this model has no images: say so,
        // once per chat per model, instead of silently sending plain text.
        if (settings().enabled && setupOn()) {
            const model = currentModel();
            notify('warning', 'nomatch:' + model, tr('Pictures are off for model {m} — the request went as plain text. Enable the model in Microfiche settings (model list or Other models) if it supports images.').replace('{m}', model));
        }
    }
    if (pendingAudit && auditRequests.get(data.chat) === pendingAudit) {
        try {
            recordPayloadAudit(data.chat, pendingAudit, 'promptReady');
        } catch (error) {
            debug.fail('payload.auditFailed', error, { stage: 'promptReady' });
        }
    }
    if (archive || setup) {
        replyStats = Promise.resolve(archive).then(st => setup ? {
            ...st ?? {
                pages: 0,
                textTokens: 0,
                imageTokens: 0
            },
            setup: setup
        } : st);
        replyStats.then(st => notify('info', 'first', savingsDetail(st), false));
    } else {
        replyStats = Promise.resolve({
            pages: 0,
            textTokens: 0,
            imageTokens: 0
        });
    }
    refreshSoon();
}

function checkMissing() {
    for (const entry of waiting.values()) {
        if (entry.stale || entry.reported) continue;
        entry.reported = true;
        lastNotice = tr('The images were cut from the request by the context limit or another extension.');
        debug.warn('swap.cutBeforeSending', {
            pages: entry.urls.length,
            reason: 'the context limit or another extension removed the message before sending',
        });
        notify('warning', 'cut', tr('The images were cut from the request by the context limit or another extension.'));
    }
}

function routeName() {
    const source = oai().chat_completion_source;
    return SOURCE_NAMES[source] ?? source ?? '';
}

async function onMessageReceived(messageId) {
    checkMissing();
    if (!replyStats) return;
    const pending = replyStats;
    replyStats = null;
    const message = ctx().chat[messageId];
    if (message && !message.is_user) {
        message.extra ??= {};
        message.extra.microfiche = await pending;
    }
    refreshSoon();
}

let refreshTimer = null;

function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh().catch(e => console.error('[Microfiche] refresh failed', e)), 150);
}

const kindList = (kinds = []) => {
    const names = kinds.map(kind => KIND_NAMES[kind] ?? kind);
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} ${tr('and')} ${names.at(-1)}` : names[0] ?? tr('setup');
};

async function status() {
    const c = ctx();
    if (settings().enabled && c.mainApi === 'openai' && modelMatches()) {
        const stats = c.chat?.findLast(m => !m.is_user && !m.is_system)?.extra?.microfiche;
        if (stats) {
            const {saved: saved} = savingsTotals(stats);
            return {
                state: saved > 0 ? 'working' : 'waiting',
                text: tr('Latest reply: ~{n} {dir} input tokens.').replace('{n}', k(Math.abs(saved))).replace('{dir}', saved >= 0 ? tr('fewer') : tr('more')),
                detail: savingsDetail(stats)
            };
        }
    }
    const st = await chatStatus();
    if ([ 'working', 'waiting' ].includes(st.state)) return {
        state: 'waiting',
        text: tr('Ready.'),
        detail: tr('Next-request estimates are in Preview.')
    };
    return {
        ...st,
        detail: st.detail ?? st.text
    };
}

async function chatStatus() {
    const c = ctx();
    const s = settings();
    if (!s.enabled) return {
        state: 'off',
        text: tr('Off.')
    };
    if (c.mainApi !== 'openai') return {
        state: 'idle',
        text: tr('Not running: needs Chat Completion.')
    };
    if (!modelMatches()) {
        const model = currentModel() || tr('This model');
        return isGemini(currentModel()) ? {
            state: 'idle',
            text: tr('Not running: this model is unticked.'),
            detail: tr('{model} is unticked under Advanced → Models.').replace('{model}', model)
        } : {
            state: 'idle',
            text: tr('Not running: this model needs opt-in.'),
            detail: tr('Enable {model} under Advanced → Other models (experimental). It must accept image input.').replace('{model}', model)
        };
    }
    if (!c.chat?.length || c.characterId === undefined && !c.groupId) return {
        state: 'idle',
        text: tr('Open a chat.')
    };
    if (!s.asImages.chat) {
        return setupOn() ? {
            state: 'waiting',
            saved: 0,
            detail: tr('Chat history goes as normal text.')
        } : {
            state: 'idle',
            text: tr('Nothing ticked under Send as images.')
        };
    }
    const {plan: plan, ids: ids} = currentPlan();
    if (!plan.pages.length) {
        if (plan.stoppedAt === 0) return {
            state: 'idle',
            text: tr('Not running in this chat.'),
            detail: tr('The first message has {reason}, so nothing goes as images.').replace('{reason}', plan.stopReason)
        };
        const tokensOf = (from, to) => ids.slice(from, to).reduce((n, i) => n + String(c.chat[i]?.mes ?? '').length, 0) / CHARS_PER_TOKEN;
        const older = Math.round(tokensOf(0, plan.tailStart));
        const keptCount = keptMessageCount(ids.length, plan.tailStart);
        const newestText = s.keepMode === 'messages'
            ? tr('Your newest {n} messages stay as text.').replace('{n}', keptCount)
            : tr('Your newest {n} stays as text.').replace('{n}', k(Math.round(tokensOf(plan.tailStart, ids.length))));
        return {
            state: 'waiting',
            saved: 0,
            detail: tr('Older messages stay as text until an image saves tokens (about {cost} tokens per image). They’re at {older} now. ').replace('{cost}', k(pageCost())).replace('{older}', k(older)) + newestText
        };
    }
    const st = await countedStats(plan);
    let detail = tr('Older messages go as {n} images: {image} tokens instead of {text}.').replace('{n}', st.pages).replace('{image}', k(st.imageTokens)).replace('{text}', k(st.textTokens));
    if (plan.stoppedAt !== null) detail += tr(' Images stop before message #{id} ({reason}).').replace('{id}', ids[plan.stoppedAt]).replace('{reason}', plan.stopReason);
    return {
        state: 'working',
        saved: st.textTokens - st.imageTokens,
        detail: detail
    };
}

let shownModels = null;

function renderExperimentalModel() {
    const model = currentModel();
    const other = !isGemini(model);
    const enabled = experimentalConfig()?.enabled === true;
    $('#mf_experimental').show();
    $('#mf_experimental_model').text(other ? model || tr('No model selected') : tr('another model (select one first)'));
    $('#mf_experimental_enabled').prop('checked', other && enabled).prop('disabled', !other || !model || ctx().mainApi !== 'openai');
    $('#mf_experimental_cost_row').toggle(other && enabled);
    const input = $('#mf_experimental_cost');
    if (document.activeElement !== input[0]) input.val(pageCost());
    $('#mf_detail').prop('disabled', other);
    $('#mf_quality_note').text(other ? tr('Other models use PNG images. The quality settings and savings above apply to Gemini.') : tr('Lower is cheaper but gets more wrong. Medium is the sweet spot. High gets more details right. On AI Studio and Vertex, Low goes as Medium.'));
}

function renderModels() {
    renderExperimentalModel();
    const s = settings();
    const models = ctx().mainApi === 'openai' ? connectionModels() : [];
    const key = JSON.stringify([ models, s.offModels ]);
    if (key === shownModels) return;
    shownModels = key;
    const box = $('#mf_models').empty();
    if (!models.length) {
        box.append($('<small>').text(tr('No Gemini models on this connection.')));
        return;
    }
    for (const model of models) {
        const input = $('<input type="checkbox">').val(model).prop('checked', !s.offModels.includes(model));
        const name = $('<span>').text(model);
        if (TESTED_MODEL.test(model)) name.append($('<small class="mf-tested">').text(tr(' tested')));
        box.append($('<label class="checkbox_label">').append(input, name));
    }
}

// Every lorebook that could be contributing entries to this chat: the global
// selection, the character's own book, chat-bound and persona books, plus any
// extra books attached through character lore.
function lorebookChoices() {
    const c = ctx();
    const names = new Set;
    const add = value => {
        if (typeof value === 'string' && value) names.add(value);
        else if (value && typeof value.name === 'string' && value.name) names.add(value.name);
    };
    for (const name of selected_world_info ?? []) add(name);
    add(c.characters?.[c.characterId]?.data?.extensions?.world);
    add(c.chatMetadata?.world_info);
    add(power_user?.persona_description_lorebook);
    const file = c.getCharaFilename?.(c.characterId);
    const extra = file ? world_info?.charLore?.[file]?.extraBooks : null;
    for (const book of Array.isArray(extra) ? extra : []) add(book);
    return [ ...names ];
}

let shownLorebooks = null;

function renderLorebooks() {
    const s = settings();
    const ticked = s.asImages.lorebook;
    $('#mf_lorebook_pick').toggle(ticked);
    if (!ticked) return;
    $('#mf_lorebook_mode').val(s.lorebookImages.mode);
    $('#mf_lorebook_selected').toggle(s.lorebookImages.mode === 'selected');
    const choices = lorebookChoices();
    const key = JSON.stringify([ choices, s.lorebookImages.books ]);
    if (key === shownLorebooks) return;
    shownLorebooks = key;
    const box = $('#mf_lorebooks').empty();
    if (!choices.length) {
        box.append($('<small>').text(tr('No lorebooks are active in this chat.')));
        return;
    }
    for (const name of choices) {
        const input = $('<input type="checkbox">').prop('checked', s.lorebookImages.books[name] === true);
        input.on('change', function() {
            s.lorebookImages.books[name] = this.checked;
            lastSetup = null;
            ctx().saveSettingsDebounced();
        });
        box.append($('<label class="checkbox_label">').append(input, $('<span>').text(name)));
    }
}

// refresh() runs on a 150 ms debounce wired to a dozen events, so it must not
// re-touch the DOM when nothing changed. Both caches below are keyed on the
// values that actually affect the rendered result.
let lastPreviewState = null;
const badgeCache = new Map;

async function refresh() {
    const c = ctx();
    const s = settings();
    renderModels();
    renderLorebooks();
    const st = await status();
    $('#mf_status').attr('data-state', st.state).attr('title', st.detail).text(st.text);
    const canPreview = s.enabled && s.asImages.chat && modelMatches();
    const previewState = `${canPreview}|${s.showSavings}`;
    const previewChanged = previewState !== lastPreviewState;
    lastPreviewState = previewState;
    if (previewChanged) badgeCache.clear();
    $('#chat .mes').each(function() {
        const id = Number(this.getAttribute('mesid'));
        const onPage = canPreview && Boolean(c.chat[id]);
        if (previewChanged || this.classList.contains('mf-on-page') !== onPage) {
            this.classList.toggle('mf-on-page', onPage);
        }
        const stats = c.chat[id]?.extra?.microfiche;
        let badge = badgeCache.get(id);
        if (!badge || !badge.closest('body')) {
            badge = $(this).find('.mf_saved').first();
            badgeCache.set(id, badge);
        }
        if (!badge.length) return;
        if (s.showSavings && (stats?.pages || stats?.setup?.pages)) {
            const {saved: saved} = savingsTotals(stats);
            const label = `${saved >= 0 ? '−' : '+'}${k(Math.abs(saved))}`;
            if (badge.text() !== label) {
                badge.text(label).attr('title', tr('About {n} {dir} tokens on this reply.').replace('{n}', exactTokens(Math.abs(saved))).replace('{dir}', saved >= 0 ? tr('tokens saved') : tr('extra tokens')));
            }
            badge.show();
        } else if (badge.is(':visible')) {
            badge.hide();
        }
    });
}

const exportButtons = (url, i) => {
    const buttons = url.startsWith('data:application/pdf')
        ? `<button type="button" class="menu_button mf-export" data-mf-page="${i}">${tr('Download PDF')}</button>`
        : `<button type="button" class="menu_button mf-export" data-mf-page="${i}">${tr('Download PNG')}</button>` + `<button type="button" class="menu_button mf-export" data-mf-kind="jpg" data-mf-page="${i}">${tr('Download JPG')}</button>`;
    const zoom = `<button type="button" class="menu_button mf-zoom-btn" data-mf-kind="in" title="${tr('Zoom in')}">＋</button>` + `<button type="button" class="menu_button mf-zoom-btn" data-mf-kind="out" title="${tr('Zoom out')}">－</button>` + `<button type="button" class="menu_button mf-zoom-btn" data-mf-kind="reset" title="${tr('Reset zoom')}">⟲</button>`;
    return `<div class="mf-export-row">${zoom}${buttons}</div>`;
};

const allPagesPdfButton = () => `<div class="mf-export-row"><button type="button" class="menu_button mf-export-pdf">${tr('All pages as one PDF')}</button></div>`;

const slug = s => String(s ?? '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'microfiche';

// Zoom state lives on the img itself; scale 1 clears the override so the CSS
// default (fit the frame, or 1:1 with the mf-zoom class) takes over again.
// While zoomed, touch-action switches to none: one finger then pans the page
// in JS instead of the browser scrolling the popup.
function setZoom(img, scale) {
    if (!img) return;
    scale = Math.min(8, Math.max(1, scale || 1));
    if (scale === 1) {
        delete img.dataset.mfScale;
        img.style.width = '';
        img.style.height = '';
        img.style.touchAction = '';
    } else {
        img.dataset.mfScale = String(scale);
        img.style.width = `${PAGE.width * scale}px`;
        img.style.height = `${PAGE.height * scale}px`;
        img.style.touchAction = 'none';
    }
}

const zoomTarget = event => event.target?.closest?.('.mf-popup .mf-thumb, .mf-popup .mf-sheet img') ?? null;

function downloadDataUrl(url, name) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
}

// The pages are crisp 1-bit bitmaps; the JPEG copy doubles the resolution
// (nearest neighbour, so the pixels stay sharp) for viewers that dislike PNG.
async function jpegFromDataUrl(url, scale = 2) {
    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('page image failed to load'));
        img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const cx = canvas.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, canvas.width, canvas.height);
    cx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
}

async function showPage(mesId) {
    const c = ctx();
    const {active: active, spots: spots} = messagePreview(mesId);
    if (!spots.length) {
        toastr.info(tr('No image for this message yet. Microfiche keeps recent messages as text; Advanced sets how much stays as text.'), 'Microfiche');
        return;
    }
    const total = active.plan.pages.length;
    const urls = [];
    const blocks = await Promise.all(spots.map(async ({page: page, fromLine: fromLine, toLine: toLine}, i) => {
        const url = await renderPage(active.plan.pages[page].lines);
        urls[i] = url;
        const top = PAGE.margin + fromLine * GLYPH_H;
        const height = (toLine - fromLine + 1) * GLYPH_H;
        return `<div class="mf-page-block"><div class="mf-caption">${tr('Image {i} of {n}, this message highlighted').replace('{i}', page + 1).replace('{n}', total)}</div>` + `<div class="mf-scroll"><div class="mf-sheet" style="width:${PAGE.width}px;height:${PAGE.height}px">` + `<img src="${url}" width="${PAGE.width}" height="${PAGE.height}" alt="">` + `<div class="mf-mark" style="top:${top}px;height:${height}px"></div></div></div>` + exportButtons(url, i) + `</div>`;
    }));
    const source = active.previewOnly ? tr('Chat layout preview only. This message currently stays as text; these preview pages are not attached to a request.') : active.sent ? tr('Exactly what was attached to your last request.') : tr('Preview for your next message, using the chat as it is now.');
    const pagesLines = [ ...new Set(spots.map(s => s.page)) ].sort((a, b) => a - b).map(p => active.plan.pages[p].lines);
    currentPopupExport = { title: c.name2 || 'microfiche', urls: urls, pagesLines: pagesLines };
    // A combined PDF embeds bitmaps exactly like the pdf page format does, so
    // it is only offered when the pages themselves are bitmaps, not PDFs.
    const pdfRow = pagesLines.length && urls.every(u => !u.startsWith('data:application/pdf')) ? allPagesPdfButton() : '';
    const popup = c.callGenericPopup(`<div class="mf-popup"><div class="mf-caption">${source}</div>${pdfRow}${blocks.join('')}</div>`, c.POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true
    });
    requestAnimationFrame(() => {
        const mark = document.querySelector('.mf-popup .mf-mark');
        const box = mark?.closest('.mf-scroll');
        if (box) box.scrollTop = Math.max(0, mark.offsetTop - 60);
    });
    await popup;
    currentPopupExport = null;
}

async function gallery(title, pages, caption) {
    const urls = await Promise.all(pages.map(lines => renderPage(lines)));
    currentPopupExport = { title: title, urls: urls, pagesLines: pages };
    const pdfRow = pages.length && urls.every(u => !u.startsWith('data:application/pdf')) ? allPagesPdfButton() : '';
    return `<h4 class="mf-gallery-title">${title}</h4>${pdfRow}` + urls.map((url, i) => `<div class="mf-page-block"><div class="mf-caption">${caption(i, urls.length)}</div>` + `<div class="mf-scroll mf-preview-frame" style="--mf-used-height:${Math.min(PAGE.height, PAGE.margin * 2 + pages[i].length * GLYPH_H)}"><img class="mf-thumb" src="${url}" width="${PAGE.width}" height="${PAGE.height}" alt="${escapeHtml(title)}, image ${i + 1}" title="${tr('Click to see the full page')}"></div>` + exportButtons(url, i) + `</div>`).join('');
}

function keptHtml(kept) {
    if (!Array.isArray(kept) || !kept.length) return '';
    const item = entry => `<li>${escapeHtml(tr(KIND_NAMES[entry.kind] ?? entry.kind))} · ~${exactTokens(entry.tokens)} ${tr('tokens')} — ${escapeHtml(entry.text.slice(0, 80))}${entry.text.length > 80 ? '…' : ''}</li>`;
    const active = kept.filter(entry => entry.active);
    const inactive = kept.filter(entry => !entry.active);
    let html = '';
    if (active.length) {
        const total = active.reduce((n, entry) => n + entry.tokens, 0);
        html += `<p><b>${tr('Kept as text by the keep marker (~{n} tokens):').replace('{n}', exactTokens(total))}</b></p><ul>${active.map(item).join('')}</ul>`;
    }
    if (inactive.length) {
        html += `<p>${tr('Keep markers found, but they only apply once the matching box under Send as images is ticked:')}</p><ul>${inactive.map(item).join('')}</ul>`;
    }
    return html;
}

async function showStats() {
    const c = ctx();
    const s = settings();
    const st = await status();
    const parts = [];
    const details = [];
    const latest = c.chat?.findLast(m => !m.is_user && !m.is_system)?.extra?.microfiche;
    if (latest) details.push(`<p><b>${tr('Latest reply:')}</b> ${escapeHtml(savingsDetail(latest))}</p>`);
    const running = s.enabled && c.mainApi === 'openai' && modelMatches();
    if (running) {
        details.push(`<p><b>${tr('Connection:')}</b> ${escapeHtml(currentModel())} ${tr('on')} ${escapeHtml(routeName())}, ` + (isGemini(currentModel()) ? {
            low: tr('low quality images (about 280 tokens each).'),
            pdf: tr('medium quality images (about 560 tokens each).'),
            png: tr('high quality images (about 1120 tokens each).')
        }[pageFormat()] : tr('experimental PNG images, using your estimate of {n} tokens each. Recall and billing are untested.').replace('{n}', exactTokens(pageCost()))) + '</p>');
    }
    let images = 0;
    const nextStats = {
        textTokens: 0,
        imageTokens: 0,
        experimental: !isGemini(currentModel())
    };
    const ticked = SETUP_KINDS.filter(kind => s.asImages[kind]);
    if (running && c.chat?.length && ticked.length) {
        const setup = await previewSetup().catch(error => ({
            ok: false,
            reason: String(error?.message ?? error)
        }));
        if (setup.ok) {
            images += setup.pages;
            nextStats.setup = setup;
            details.push(`<p>${escapeHtml(tr('{kinds}: {text} text tokens → {image} image tokens.').replace('{kinds}', kindList(setup.kinds)).replace('{text}', exactTokens(setup.textTokens)).replace('{image}', exactTokens(setup.imageTokens)))}</p>`);
            parts.push(await gallery(tr('Setup · {n} images').replace('{n}', setup.pages), setup.lines, (i, n) => tr('Image {i} of {n} · click to see the full page').replace('{i}', i + 1).replace('{n}', n)));
            details.push(keptHtml(setup.kept));
        } else {
            parts.push('<h4 class="mf-gallery-title">' + tr('Setup stays as text') + '</h4>');
            details.push(`<p>${escapeHtml(kindList(ticked))}: ${escapeHtml(setup.reason)}.</p>`);
            details.push(keptHtml(setup.kept));
        }
    }
    if (running && c.chat?.length && s.asImages.chat) {
        const {plan: plan, ids: ids} = currentPlan();
        if (plan.pages.length) {
            const st2 = await countedStats(plan);
            images += plan.pages.length;
            nextStats.textTokens = st2.textTokens;
            nextStats.imageTokens = st2.imageTokens;
            details.push(`<p>${escapeHtml(tr('Chat: {text} text tokens → {image} image tokens.').replace('{text}', exactTokens(st2.textTokens)).replace('{image}', exactTokens(st2.imageTokens)))}</p>`);
            parts.push(await gallery(tr('Chat · {n} images').replace('{n}', st2.pages), plan.pages.map(p => p.lines), (i, n) => tr('Image {i} of {n}: messages #{a} to #{b}').replace('{i}', i + 1).replace('{n}', n).replace('{a}', ids[plan.pages[i].first]).replace('{b}', ids[plan.pages[i].last])));
        } else {
            parts.push('<h4 class="mf-gallery-title">' + tr('Chat stays as text for now') + '</h4>');
        }
    }
    if (images) {
        const saved = savingsTotals(nextStats).saved;
        parts.unshift(`<p class="mf-preview-summary">${tr('Next message: about <b>{n} {dir} input tokens</b>.').replace('{n}', k(Math.abs(saved))).replace('{dir}', saved >= 0 ? tr('fewer') : tr('more'))}</p>`);
        details.push(`<p><b>${tr('Next message:')}</b> ${escapeHtml(savingsDetail(nextStats))}</p>`);
        details.push(`<p>${tr('Blank space is hidden in these thumbnails. Click an image to see the full page. An exempt prompt keeps the image groups on either side separate, preserving prompt order.')}</p>`);
    }
    if (details.length) parts.push(`<details class="mf-preview-details"><summary>${tr('Details')}</summary>${details.join('')}</details>`);
    if (!images) parts.push(`<p>${escapeHtml(running && c.chat?.length ? tr('Nothing goes as images with your next message.') : st.text)}</p>`);
    await c.callGenericPopup(`<h3>${tr('Microfiche preview')}</h3><div class="justifyLeft mf-popup">${parts.join('')}</div>`, c.POPUP_TYPE.TEXT, '', images ? {
        wide: true,
        large: true,
        allowVerticalScrolling: true
    } : {});
}

function bindSettings() {
    const s = settings();
    const save = () => {
        ctx().saveSettingsDebounced();
        refreshSoon();
    };
    $('#mf_copy_keep').on('click', async () => {
        try {
            await navigator.clipboard.writeText(KEEP_MARKER);
            toastr.success(tr('Paste it anywhere in the prompt you want to keep as text.'), tr('Marker copied'));
        } catch {
            await ctx().callGenericPopup(`<p>${tr('Copy this into your prompt:')}</p><pre>${$('<div>').text(KEEP_MARKER).html()}</pre>`, ctx().POPUP_TYPE.TEXT);
        }
    });
    $('#mf_enabled').prop('checked', s.enabled).on('change', function() {
        s.enabled = this.checked;
        save();
    });
    // Language: 'auto' follows the tavern UI; 'ru'/'en' force the choice so
    // someone on an English tavern can still have these settings in Russian.
    // A change re-translates the panel and re-renders every dynamic string.
    const applyLanguage = () => {
        applyI18n($('#microfiche_settings')[0]);
        renderModels();
        syncKeepMode();
        showPayloadAudit();
        const counts = debug.counts();
        const total = debug.size();
        debugStatus(total ? tr('{n} events buffered · {w} warnings · {e} errors').replace('{n}', total).replace('{w}', counts.warn).replace('{e}', counts.error) : tr('Nothing logged yet.'));
        refreshSoon();
    };
    $('#mf_lang').val(s.language).on('change', function() {
        s.language = this.value;
        setLanguageMode(s.language);
        save();
        applyLanguage();
    });
    const debugStatus = text => $('#mf_debug_status').text(text);
    const refreshDebugStatus = () => {
        const counts = debug.counts();
        const total = debug.size();
        debugStatus(total
            ? tr('{n} events buffered · {w} warnings · {e} errors').replace('{n}', total).replace('{w}', counts.warn).replace('{e}', counts.error)
            : tr('Nothing logged yet.'));
    };
    refreshDebugStatus();
    $('#mf_debug_export').on('click', () => {
        try {
            const snapshot = debug.snapshot(diagnosticsMeta('exported from settings'));
            const blob = new Blob([ JSON.stringify(snapshot, null, 2) ], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `microfiche-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            link.click();
            URL.revokeObjectURL(url);
            debug.info('debug.exported', { events: snapshot.events.length });
            refreshDebugStatus();
            toastr.success(tr('Diagnostics saved. Attach the file when reporting the problem.'), 'Microfiche');
        } catch (error) {
            debug.fail('debug.exportFailed', error);
            toastr.error(tr('Could not save the diagnostics file. Details in the browser console.'), 'Microfiche');
        }
    });
    $('#mf_debug_copy').on('click', async () => {
        const text = debug.toText(diagnosticsMeta('copied from settings'));
        try {
            await navigator.clipboard.writeText(text);
            debug.info('debug.copied', { chars: text.length });
            refreshDebugStatus();
            toastr.success(tr('Diagnostics copied to the clipboard.'), 'Microfiche');
        } catch {
            await ctx().callGenericPopup(`<p>${tr('Copy this into your report:')}</p><pre>${escapeHtml(text)}</pre>`, ctx().POPUP_TYPE.TEXT);
        }
    });
    $('#mf_debug_clear').on('click', () => {
        debug.clear();
        debugStatus(tr('Nothing logged yet.'));
        toastr.info(tr('Diagnostics cleared.'), 'Microfiche');
    });
    $('#mf_experimental_enabled').on('change', function() {
        if (!currentModel() || isGemini(currentModel())) return;
        s.experimentalModels[experimentalKey()] = {
            enabled: this.checked,
            pageTokens: pageCost()
        };
        lastSetup = null;
        save();
    });
    $('#mf_experimental_cost').on('change', function() {
        if (!currentModel() || isGemini(currentModel())) return;
        const value = Number(this.value);
        const pageTokens = Number.isFinite(value) ? Math.max(1, Math.min(1e5, Math.round(value))) : 1500;
        s.experimentalModels[experimentalKey()] = {
            enabled: experimentalConfig()?.enabled === true,
            pageTokens: pageTokens
        };
        lastSetup = null;
        save();
    });
    $('#mf_models').on('change', 'input', function() {
        const model = String(this.value);
        s.offModels = s.offModels.filter(m => m !== model);
        if (!this.checked) s.offModels.push(model);
        save();
    });
    const syncKeepMode = () => {
        const byMessages = s.keepMode === 'messages';
        $('#mf_keep').toggle(!byMessages);
        $('#mf_keep_messages').toggle(byMessages);
        $('#mf_keep_note').text(byMessages
            ? tr('The newest N messages go as normal text; everything older than them goes as images. Raise it to keep recent wording sharper.')
            : tr('The newest message always goes as normal text, plus older ones up to this many tokens. Lower saves a bit more. Higher keeps exact wording sharper.'));
    };
    $('#mf_keep_mode').val(s.keepMode).on('change', function() {
        s.keepMode = this.value === 'messages' ? 'messages' : 'tokens';
        syncKeepMode();
        save();
    });
    $('#mf_keep').val(s.keepTokens).on('input', function() {
        s.keepTokens = Math.max(0, Number(this.value) || 0);
        save();
    });
    $('#mf_keep_messages').val(s.keepMessages).on('input', function() {
        s.keepMessages = Math.max(1, Number(this.value) || 1);
        save();
    });
    syncKeepMode();
    $('#mf_detail').val(s.detail).on('change', function() {
        s.detail = [ 'low', 'high' ].includes(this.value) ? this.value : 'medium';
        save();
    });
    $('#mf_notifications').prop('checked', s.showNotifications).on('change', function() {
        s.showNotifications = this.checked;
        save();
    });
    $('#mf_savings').prop('checked', s.showSavings).on('change', function() {
        s.showSavings = this.checked;
        save();
    });
    $('#mf_pack').prop('checked', s.packSetup).on('change', function() {
        s.packSetup = this.checked;
        lastSetup = null;
        save();
    });
    $('#mf_grouping').val(s.setupGrouping).on('change', function() {
        s.setupGrouping = this.value === 'positional' ? 'positional' : 'merged';
        lastSetup = null;
        save();
    });
    for (const kind of Object.keys(DEFAULTS.asImages)) {
        $(`#mf_img_${kind}`).prop('checked', s.asImages[kind]).on('change', function() {
            s.asImages[kind] = this.checked;
            lastSetup = null;
            save();
        });
    }
    $('#microfiche_settings .inline-drawer-toggle').on('click', () => renderModels());
    // Which lorebook pages are drawn: every entry, or only the chosen books.
    $('#mf_lorebook_mode').val(s.lorebookImages.mode).on('change', function() {
        s.lorebookImages.mode = this.value === 'selected' ? 'selected' : 'all';
        lastSetup = null;
        save();
        renderLorebooks();
    });
    $('#mf_stats').on('click', () => showStats().catch(e => console.error('[Microfiche] stats failed', e)));
    // Translate the panel and every dynamic string once the handlers exist.
    applyLanguage();
}

function registerCommand() {
    ctx().SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'microfiche',
        helpString: tr('Shows what Microfiche does in this chat. <code>/microfiche on</code> or <code>/microfiche off</code> switches it.'),
        unnamedArgumentList: [ SlashCommandArgument.fromProps({
            description: tr('on, off, or nothing to show the status'),
            typeList: [ ARGUMENT_TYPE.STRING ],
            enumList: [ 'on', 'off' ],
            isRequired: false
        }) ],
        callback: async (_args, value) => {
            const arg = String(value ?? '').trim().toLowerCase();
            if (arg === 'on' || arg === 'off') {
                settings().enabled = arg === 'on';
                $('#mf_enabled').prop('checked', settings().enabled);
                ctx().saveSettingsDebounced();
                refreshSoon();
                return String(settings().enabled);
            }
            await showStats();
            return '';
        }
    }));
}

// Built at insert time so a language switch takes effect without a reload.
const messageButton = () => `<div title="${tr('Preview this message as an image')}" class="mes_button mf_show_page fa-solid fa-file-image" role="button" tabindex="0" aria-label="${tr('Preview this message as an image')}"></div>`;

const SAVED_BADGE = '<div class="mf_saved" style="display:none"></div>';

// Sits in the name row inside .mes_block rather than in .mesAvatarWrapper:
// the avatar wrapper is hidden with `display: none !important` in Document chat
// style, which used to take the only page-view affordance with it.
const pageIcon = () => `<div class="mf_page_icon fa-solid fa-file-image" title="${tr('Preview this message as an image')}." role="button" tabindex="0" aria-label="${tr('Preview this message as an image')}"></div>`;

const PAGE_ICON_HOST = '.mes_block .ch_name .flex-container.alignItemsBaseline';

function hostFor(root, selector) {
    const scope = $(root);
    const direct = scope.is(selector) ? scope : scope.find(selector).first();
    if (direct.length) return direct;
    // Fall back to any visible name row inside this message.
    const fallback = scope.find('.mes_block .ch_name').first();
    return fallback.length ? fallback : $();
}

function installMessageBits(root) {
    const scope = $(root);
    if (!scope.find('.mf_show_page').length) scope.find('.extraMesButtons').prepend(messageButton());
    if (!scope.find('.mf_page_icon').length) hostFor(root, PAGE_ICON_HOST).append(pageIcon());
    if (!scope.find('.mf_saved').length) hostFor(root, PAGE_ICON_HOST).append(SAVED_BADGE);
}

// Read our own manifest so exports carry the exact extension version.
async function loadManifestVersion() {
    try {
        const response = await fetch(`/scripts/extensions/${FOLDER}/manifest.json`, { cache: 'no-cache' });
        if (!response.ok) return;
        const manifest = await response.json();
        extensionVersion = String(manifest?.version ?? '');
    } catch (error) {
        debug.fail('manifest.failed', error);
    }
}

jQuery(async () => {
    settings();
    await loadManifestVersion();
    debug.info('started', { extensionVersion: extensionVersion, hostVersion: hostVersion() });
    $('#extensions_settings2').append(await ctx().renderExtensionTemplateAsync(FOLDER, 'settings'));
    bindSettings();
    registerCommand();
    installMessageBits('#message_template');
    $('#chat .mes').each(function() {
        installMessageBits(this);
    });
    $(document).on('click', '.mf-popup .mf-thumb', function() {
        this.classList.toggle('mf-zoom');
        this.closest('.mf-preview-frame')?.classList.toggle('mf-expanded');
        // Returning to fit clears any pinch/ctrl-wheel zoom state with it.
        if (!this.classList.contains('mf-zoom')) setZoom(this, 1);
    });
    // Zoom: the ＋/－/⟲ buttons on each page, Ctrl+wheel for fine steps (a
    // plain wheel keeps scrolling the popup), pinch on touch screens, and a
    // double click resets to fit.
    $(document).on('click', '.mf-popup .mf-zoom-btn', function() {
        const img = this.closest('.mf-page-block')?.querySelector('img');
        const kind = this.dataset.mfKind;
        if (!img) return;
        if (kind === 'reset') setZoom(img, 1);
        else setZoom(img, (Number(img.dataset.mfScale) || 1) * (kind === 'in' ? 1.5 : 1 / 1.5));
    });
    $(document).on('wheel', '.mf-popup .mf-thumb, .mf-popup .mf-sheet img', function(event) {
        if (!(event.originalEvent?.ctrlKey || event.originalEvent?.metaKey)) return;
        event.preventDefault();
        setZoom(this, (Number(this.dataset.mfScale) || 1) * (event.originalEvent.deltaY < 0 ? 1.15 : 1 / 1.15));
    });
    $(document).on('dblclick', '.mf-popup .mf-thumb, .mf-popup .mf-sheet img', function() {
        setZoom(this, 1);
    });
    // Touch: two fingers pinch-zoom, one finger pans while zoomed (the page
    // is dragged around) and keeps the browser's own vertical scrolling at
    // fit scale (touch-action: pan-y in the stylesheet, none while zoomed).
    // jQuery's listeners are passive on document, so the touch trio is native.
    document.addEventListener('touchstart', event => {
        const img = zoomTarget(event);
        if (!img) return;
        const t = event.touches;
        if (t.length === 2) {
            img.dataset.mfPinchStart = String(Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY));
            img.dataset.mfPinchScale = img.dataset.mfScale || '1';
            delete img.dataset.mfPanX;
            delete img.dataset.mfPanY;
        } else if (t.length === 1 && (Number(img.dataset.mfScale) || 1) > 1) {
            img.dataset.mfPanX = String(t[0].clientX);
            img.dataset.mfPanY = String(t[0].clientY);
        }
    }, { passive: true });
    document.addEventListener('touchmove', event => {
        const img = zoomTarget(event);
        if (!img) return;
        const t = event.touches;
        if (t.length === 2 && img.dataset.mfPinchStart) {
            event.preventDefault();
            const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
            setZoom(img, Number(img.dataset.mfPinchScale) * dist / Number(img.dataset.mfPinchStart));
            return;
        }
        if (t.length === 1 && img.dataset.mfPanX !== undefined) {
            event.preventDefault();
            const box = img.closest('.mf-scroll');
            if (box) {
                box.scrollLeft -= t[0].clientX - Number(img.dataset.mfPanX);
                box.scrollTop -= t[0].clientY - Number(img.dataset.mfPanY);
            }
            img.dataset.mfPanX = String(t[0].clientX);
            img.dataset.mfPanY = String(t[0].clientY);
        }
    }, { passive: false });
    const endTouch = event => {
        const img = zoomTarget(event);
        if (!img) return;
        delete img.dataset.mfPinchStart;
        delete img.dataset.mfPinchScale;
        delete img.dataset.mfPanX;
        delete img.dataset.mfPanY;
        if ((Number(img.dataset.mfScale) || 1) < 1.05) setZoom(img, 1);
    };
    document.addEventListener('touchend', endTouch);
    document.addEventListener('touchcancel', endTouch);
    $(document).on('click', '.mf-popup .mf-export', function() {
        const exp = currentPopupExport;
        const i = Number(this.dataset.mfPage);
        if (!exp || !exp.urls[i]) return;
        const url = exp.urls[i];
        const name = `${slug(exp.title)}-page-${i + 1}`;
        if (url.startsWith('data:application/pdf')) {
            downloadDataUrl(url, `${name}.pdf`);
        } else if (this.dataset.mfKind === 'jpg') {
            jpegFromDataUrl(url).then(jpeg => downloadDataUrl(jpeg, `${name}.jpg`)).catch(e => console.error('[Microfiche] jpg export failed', e));
        } else {
            downloadDataUrl(url, `${name}.png`);
        }
    });
    $(document).on('click', '.mf-popup .mf-export-pdf', async function() {
        const exp = currentPopupExport;
        if (!exp?.pagesLines?.length) return;
        this.disabled = true;
        try {
            downloadDataUrl(await renderPagesPdf(exp.pagesLines), `${slug(exp.title)}-pages.pdf`);
        } catch (e) {
            console.error('[Microfiche] pdf export failed', e);
        } finally {
            this.disabled = false;
        }
    });
    $(document).on('keydown', '.mf_show_page, .mf_page_icon', function(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        $(this).trigger('click');
    });
    $(document).on('click', '.mf_show_page, .mf_page_icon', function() {
        const id = Number($(this).closest('.mes').attr('mesid'));
        showPage(id).catch(e => console.error('[Microfiche] page view failed', e));
    });
    const c = ctx();
    const t = c.eventTypes;
    c.eventSource.makeLast(t.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
    if (t.CHAT_COMPLETION_SETTINGS_READY) c.eventSource.on(t.CHAT_COMPLETION_SETTINGS_READY, onSettingsReady);
    // Fresh per generation: WI activates after the interceptors and before
    // PROMPT_READY, so buildSetup sees exactly this request's entries.
    if (t.WORLD_INFO_ACTIVATED) c.eventSource.on(t.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
    if (t.GENERATION_STARTED) c.eventSource.on(t.GENERATION_STARTED, onGenerationStarted);
    c.eventSource.on(t.MESSAGE_RECEIVED, onMessageReceived);
    c.eventSource.on(t.CHAT_CHANGED, () => {
        lastSent = null;
        clearActivatedEntries();
        // Without this the one-shot keys from a previous chat would suppress the
        // same warning in every later chat, and the Set would grow for the
        // whole session.
        notified.clear();
        refreshSoon();
    });
    for (const e of [ t.MESSAGE_DELETED, t.MESSAGE_EDITED ]) c.eventSource.on(e, () => {
        lastSent = null;
        refreshSoon();
    });
    for (const e of [ t.MESSAGE_SENT, t.MESSAGE_SWIPED, t.MORE_MESSAGES_LOADED, t.CHARACTER_MESSAGE_RENDERED, t.USER_MESSAGE_RENDERED, t.GENERATION_ENDED, t.SETTINGS_UPDATED, t.CHATCOMPLETION_MODEL_CHANGED, t.CHATCOMPLETION_SOURCE_CHANGED, t.MAIN_API_CHANGED ]) {
        if (e) c.eventSource.on(e, () => {
            // The connection's model list can change without the source or the
            // selected model changing, so drop the cached list on settings edits.
            modelsCacheKey = null;
            if (e === t.GENERATION_ENDED) quietGeneration = false;
            refreshSoon();
        });
    }
    refreshSoon();
});
