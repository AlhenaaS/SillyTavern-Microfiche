import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditPayload, attachmentMap, compareOrder, textOf, MIN_ARCHIVE_MATCH_CHARS } from '../lib/payload-audit.js';

// The audit exists to catch a payload that quietly lost content. Every test
// below is a way content can disappear, plus the "no leak" guard that keeps the
// report itself safe to attach to a bug report.

// Long enough to be a definite match, and unique in the payloads below.
const LONG = 'The archive replaced this paragraph about the harbour at dawn. '.repeat(3).trim();
const LONG_OTHER = 'A completely different paragraph about the ledger and the tide tables. '.repeat(3).trim();

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const PDF = 'data:application/pdf;base64,JVBERi0xLjQK';

const imageBlock = url => ({ type: 'image_url', image_url: { url } });
const textBlock = text => ({ type: 'text', text });
const fileBlock = data => ({ type: 'file', file: { file_data: data } });
const inputFileBlock = data => ({ type: 'input_file', file_data: data });

test('textOf extracts strings and joins adjacent text parts of one message', () => {
    assert.equal(textOf({ content: 'plain' }), 'plain');
    assert.equal(textOf({ content: [ textBlock('a'), textBlock('b') ] }), 'a\nb');
    // Non-text parts contribute an empty slot, exactly like the interceptor.
    assert.equal(textOf({ content: [ textBlock('a'), imageBlock(PNG), textBlock('b') ] }), 'a\n\nb');
    assert.equal(textOf({ content: [ imageBlock(PNG) ] }), '');
    assert.equal(textOf({}), '');
    assert.equal(textOf(undefined), '');
});

test('textOf ignores non-text blocks and missing text', () => {
    assert.equal(textOf({ content: [ { type: 'image_url' }, { type: 'text' } ] }), '\n');
});

test('an empty payload audits to a zeroed report', () => {
    assert.deepEqual(auditPayload([], [], [], []), {
        messages: 0,
        textMessages: 0,
        textParts: 0,
        textChars: 0,
        imageParts: 0,
        fileParts: 0,
        mimeTypes: {},
        archivedMessages: 0,
        archivedTextMatches: 0,
        ambiguousTextMatches: 0,
        unmatchedArchivedMessages: [],
        expectedAttachments: 0,
        matchedAttachments: 0,
        missingAttachments: 0,
    });
});

test('counts real content images and file forms', () => {
    const messages = [
        { role: 'user', content: [ textBlock('setup'), imageBlock(PNG), imageBlock(JPEG) ] },
        { role: 'user', content: [ fileBlock(PDF), inputFileBlock(PDF) ] },
        // Shapes that are NOT content: no url, or the wrong type.
        { role: 'user', content: [ { type: 'image_url' }, { type: 'image_url', image_url: {} } ] },
        { role: 'user', content: 'just text' },
    ];
    const r = auditPayload(messages);
    assert.equal(r.messages, 4);
    assert.equal(r.imageParts, 2);
    assert.equal(r.fileParts, 2);
    assert.equal(r.textParts, 2);
    assert.equal(r.textChars, 'setup'.length + 'just text'.length);
    // Only the two messages that carry real text count; the url-less
    // image-only message collapses to whitespace and is not a survivor.
    assert.equal(r.textMessages, 2);
});

test('mime types are counted without ever returning an url', () => {
    const messages = [
        { role: 'user', content: [ imageBlock(PNG), imageBlock(PNG), imageBlock(JPEG) ] },
        { role: 'user', content: [ fileBlock(PDF) ] },
    ];
    const r = auditPayload(messages);
    assert.deepEqual(r.mimeTypes, { 'image/png': 2, 'image/jpeg': 1, 'application/pdf': 1 });
    const serialized = JSON.stringify(r);
    assert.doesNotMatch(serialized, /base64/);
    assert.doesNotMatch(serialized, /data:image/);
});

test('a surviving archived message is reported as a definite match', () => {
    const messages = [ { role: 'user', content: [ textBlock('lead in'), textBlock(LONG), imageBlock(PNG) ] } ];
    const r = auditPayload(messages, [ { name: 'hist', text: LONG } ]);
    assert.equal(r.archivedMessages, 1);
    assert.equal(r.archivedTextMatches, 1);
    assert.equal(r.ambiguousTextMatches, 0);
    assert.equal(r.unmatchedArchivedMessages.length, 0);
});

test('a genuinely missing archived message is reported as absent', () => {
    const messages = [ { role: 'user', content: [ imageBlock(PNG) ] } ];
    const r = auditPayload(messages, [ { name: 'hist', text: LONG } ]);
    assert.equal(r.archivedTextMatches, 0);
    assert.equal(r.ambiguousTextMatches, 0);
    assert.equal(r.unmatchedArchivedMessages.length, 1);
    assert.equal(r.unmatchedArchivedMessages[0].reason, 'absent');
    assert.deepEqual(Object.keys(r.unmatchedArchivedMessages[0]), [ 'reason' ]);
});

test('matching normalises CR and whitespace', () => {
    const source = 'Line one\r\n\r\nLine   two\n\tLine three';
    const messages = [ { role: 'user', content: [ textBlock('Line one\n\nLine two Line three ' + 'x'.repeat(90)) ] } ];
    const r = auditPayload(messages, [ { text: source + ' ' + 'x'.repeat(90) } ]);
    assert.equal(r.archivedTextMatches, 1);
});

test('matching tolerates a name prefix added to the message', () => {
    const messages = [ { role: 'user', content: [ textBlock(`Alice: ${LONG}`) ] } ];
    const r = auditPayload(messages, [ { name: 'Alice', text: LONG } ]);
    assert.equal(r.archivedTextMatches, 1);
});

test('a text also present among the kept messages is ambiguous, not missing', () => {
    const messages = [ { role: 'user', content: [ textBlock(LONG) ] } ];
    // The same text was expected to survive as a kept message AND to be
    // archived: the audit cannot tell which copy it sees.
    const r = auditPayload(messages, [ { text: LONG } ], [ { text: LONG } ]);
    assert.equal(r.archivedTextMatches, 0);
    assert.equal(r.ambiguousTextMatches, 1);
    assert.equal(r.unmatchedArchivedMessages[0].reason, 'kept-duplicate');
});

test('a short archived text is ambiguous rather than a false alarm', () => {
    const short = 'too short to be sure';
    assert.ok(short.length < MIN_ARCHIVE_MATCH_CHARS);
    const messages = [ { role: 'user', content: [ textBlock(short) ] } ];
    const r = auditPayload(messages, [ { text: short } ]);
    assert.equal(r.archivedMessages, 1);
    assert.equal(r.archivedTextMatches, 0);
    assert.equal(r.ambiguousTextMatches, 1);
    assert.equal(r.unmatchedArchivedMessages[0].reason, 'too-short');
});

test('a text occurring twice in the payload is ambiguous', () => {
    const messages = [
        { role: 'user', content: [ textBlock(LONG) ] },
        { role: 'assistant', content: [ textBlock(LONG) ] },
    ];
    const r = auditPayload(messages, [ { text: LONG } ]);
    assert.equal(r.archivedTextMatches, 0);
    assert.equal(r.ambiguousTextMatches, 1);
    assert.equal(r.unmatchedArchivedMessages[0].reason, 'payload-duplicate');
});

test('two archived entries with the same text are ambiguous, not definite', () => {
    // Two descriptors repeating one text cannot be told apart, so neither
    // match may ever claim to be definite.
    const messages = [ { role: 'user', content: [ textBlock(LONG) ] } ];
    const r = auditPayload(messages, [ { name: 'first', text: LONG }, { name: 'second', text: LONG } ]);
    assert.equal(r.archivedMessages, 2);
    assert.equal(r.archivedTextMatches, 0);
    assert.equal(r.ambiguousTextMatches, 2);
    assert.deepEqual(r.unmatchedArchivedMessages.map(e => e.reason), [ 'archived-duplicate', 'archived-duplicate' ]);
    assert.doesNotMatch(JSON.stringify(r), /first|second/);
});

test('matching never runs across a message boundary', () => {
    // Two messages whose joined text would contain the archived text, but
    // neither of them alone does.
    const head = 'The archive replaced this paragraph about the'.repeat(2);
    const tail = 'harbour at dawn and the ledger and the tide. '.repeat(2);
    const messages = [
        { role: 'user', content: [ textBlock(head) ] },
        { role: 'assistant', content: [ textBlock(tail) ] },
    ];
    const migrated = `${head} ${tail}`;
    assert.ok(migrated.length >= MIN_ARCHIVE_MATCH_CHARS);
    const r = auditPayload(messages, [ { text: migrated } ]);
    assert.equal(r.archivedTextMatches, 0);
    assert.equal(r.unmatchedArchivedMessages[0].reason, 'absent');
});

test('adjacent text parts of one message may match together', () => {
    const split = LONG.indexOf(' about ');
    assert.ok(split > 0);
    const messages = [ { role: 'user', content: [ textBlock(LONG.slice(0, split)), textBlock(LONG.slice(split + 1)) ] } ];
    const r = auditPayload(messages, [ { text: LONG } ]);
    assert.equal(r.archivedTextMatches, 1);
});

test('setup attachments that survive are counted as matched', () => {
    const messages = [
        { role: 'user', content: [ textBlock('setup'), { type: 'image_url', image_url: { url: JPEG } } ] },
        { role: 'user', content: [ { type: 'file', file: { file_data: PDF } } ] },
    ];
    const r = auditPayload(messages, [], [], [ JPEG, PDF ]);
    assert.equal(r.expectedAttachments, 2);
    assert.equal(r.matchedAttachments, 2);
    assert.equal(r.missingAttachments, 0);
});

test('missing setup attachments are counted, PNG and PDF alike', () => {
    const messages = [ { role: 'user', content: [ { type: 'image_url', image_url: { url: JPEG } } ] } ];
    const r = auditPayload(messages, [], [], [ JPEG, PNG, PDF ]);
    assert.equal(r.expectedAttachments, 3);
    assert.equal(r.matchedAttachments, 1);
    assert.equal(r.missingAttachments, 2);
});

test('attachment correlation requires an exact URL rather than a substring', () => {
    const messages = [ { role: 'user', content: [ inputFileBlock(`prefix-${PDF}-suffix`) ] } ];
    const r = auditPayload(messages, [], [], [ PDF ]);
    assert.equal(r.matchedAttachments, 0);
    assert.equal(r.missingAttachments, 1);
});

test('the report never leaks urls, base64 or message text', () => {
    const messages = [
        { role: 'user', content: [ textBlock(LONG), imageBlock(PNG), fileBlock(PDF) ] },
    ];
    const archived = [ { name: 'hist', text: LONG_OTHER } ];
    const r = auditPayload(messages, archived, [], [ PNG ]);
    const serialized = JSON.stringify(r);
    assert.doesNotMatch(serialized, /data:/);
    assert.doesNotMatch(serialized, /base64/);
    assert.doesNotMatch(serialized, /iVBOR/);
    assert.doesNotMatch(serialized, new RegExp(LONG_OTHER.slice(0, 20)));
    // The unmatched entry carries only the reason enum: no text, no name.
    // A caller-supplied descriptor name is accepted but never reported back.
    const entry = r.unmatchedArchivedMessages[0];
    assert.deepEqual(Object.keys(entry).sort(), [ 'reason' ]);
    assert.equal(entry.reason, 'absent');
    assert.doesNotMatch(serialized, /hist/);
});

test('every reported value is a number, boolean, enum or plain container', () => {
    const r = auditPayload(
        [ { role: 'user', content: [ textBlock(LONG), imageBlock(PNG) ] } ],
        [ { text: LONG_OTHER } ],
        [],
        [ PNG ],
    );
    const numbers = [ 'messages', 'textMessages', 'textParts', 'textChars', 'imageParts', 'fileParts',
        'archivedMessages', 'archivedTextMatches', 'ambiguousTextMatches',
        'expectedAttachments', 'matchedAttachments', 'missingAttachments' ];
    for (const key of numbers) assert.equal(typeof r[key], 'number', key);
    for (const [ mime, count ] of Object.entries(r.mimeTypes)) {
        assert.equal(typeof mime, 'string');
        assert.equal(typeof count, 'number');
    }
    assert.ok(Array.isArray(r.unmatchedArchivedMessages));
});

// ---------------------------------------------------------------------------
// Attachment order map.
// ---------------------------------------------------------------------------

const chatPage = page => ({
    source: 'chat',
    page,
    format: 'pdf',
    first: (page - 1) * 4,
    last: page * 4 - 1,
    owners: [ (page - 1) * 4, page * 4 - 1 ],
    ids: [ (page - 1) * 4, page * 4 - 1 ],
});
const setupPageDescriptor = (page, kinds) => ({ source: 'setup', page, groupPage: 1, kinds });

test('attachmentMap lists every attachment in payload order with its page', () => {
    const messages = [
        { role: 'system', content: [ textBlock('setup'), imageBlock(PDF) ] },
        { role: 'user', content: [ textBlock('note'), imageBlock(PDF.replace('JVBERi0', 'JVBERi1')), imageBlock(PNG), imageBlock(PDF.replace('JVBERi0', 'JVBERi2')) ] },
    ];
    const pageByUrl = new Map([
        [ PDF, chatPage(2) ],
        [ PDF.replace('JVBERi0', 'JVBERi1'), setupPageDescriptor(1, [ 'preset', 'card' ]) ],
        [ PDF.replace('JVBERi0', 'JVBERi2'), chatPage(4) ],
        [ PNG, chatPage(3) ],
    ]);
    const m = attachmentMap(messages, pageByUrl);
    assert.equal(m.entries.length, 4);
    assert.deepEqual(m.entries.map(e => [ e.messageIndex, e.partIndex ]), [ [ 0, 1 ], [ 1, 1 ], [ 1, 2 ], [ 1, 3 ] ]);
    assert.deepEqual(m.entries.map(e => e.page.page), [ 2, 1, 3, 4 ]);
    assert.deepEqual(m.entries.map(e => e.page.source), [ 'chat', 'setup', 'chat', 'chat' ]);
    assert.deepEqual(m.entries.map(e => e.mime), [ 'application/pdf', 'application/pdf', 'image/png', 'application/pdf' ]);
    assert.equal(m.entries.every(e => e.tracking === 'tracked'), true);
    assert.deepEqual(m.entries[1].page.kinds, [ 'preset', 'card' ]);
    assert.equal(m.tracked, 4);
    assert.equal(m.untracked, 0);
    assert.equal(m.ambiguous, 0);
});

test('attachmentMap marks a foreign attachment as untracked', () => {
    const messages = [ { role: 'user', content: [ imageBlock(PNG) ] } ];
    const m = attachmentMap(messages, new Map);
    assert.equal(m.entries[0].tracking, 'untracked');
    assert.equal(m.entries[0].page, null);
    assert.equal(m.untracked, 1);
});

test('attachmentMap reports a reused url as ambiguous, not tracked', () => {
    // The renderer caches pages, so the same url can legitimately appear twice;
    // its position then cannot be pinned to one page.
    const messages = [
        { role: 'user', content: [ imageBlock(PNG) ] },
        { role: 'user', content: [ imageBlock(PNG) ] },
    ];
    const m = attachmentMap(messages, new Map([ [ PNG, chatPage(1) ] ]));
    assert.equal(m.entries.every(e => e.tracking === 'ambiguous'), true);
    assert.equal(m.ambiguous, 2);
    assert.equal(m.tracked, 0);
});

test('attachmentMap and compareOrder never leak urls or base64', () => {
    const messages = [ { role: 'user', content: [ imageBlock(PNG), fileBlock(PDF) ] } ];
    const pageByUrl = new Map([ [ PNG, chatPage(1) ] ]);
    const m = attachmentMap(messages, pageByUrl);
    const serialized = JSON.stringify({ m, order: compareOrder(null, m) });
    assert.doesNotMatch(serialized, /data:/);
    assert.doesNotMatch(serialized, /base64/);
    assert.doesNotMatch(serialized, /iVBOR/);
    assert.doesNotMatch(serialized, /JVBERi/);
});

test('compareOrder distinguishes first, unchanged, reordered and missing', () => {
    const messages = pages => pages.map(url => ({ role: 'user', content: [ imageBlock(url) ] }));
    const pageByUrl = new Map([ [ PNG, chatPage(1) ], [ JPEG, chatPage(2) ], [ PDF, chatPage(3) ] ]);
    const first = attachmentMap(messages([ PNG, JPEG, PDF ]), pageByUrl);
    assert.equal(compareOrder(null, first).status, 'first');
    const same = attachmentMap(messages([ PNG, JPEG, PDF ]), pageByUrl);
    assert.equal(compareOrder(first, same).status, 'unchanged');
    const flipped = attachmentMap(messages([ JPEG, PNG, PDF ]), pageByUrl);
    assert.equal(compareOrder(first, flipped).status, 'reordered');
    const short = attachmentMap(messages([ JPEG, PDF ]), pageByUrl);
    const missing = compareOrder(first, short);
    assert.equal(missing.status, 'missing');
    assert.equal(missing.missing, 1);
});

test('compareOrder refuses to judge a sequence with a reused url', () => {
    const messages = [ { role: 'user', content: [ imageBlock(PNG), imageBlock(PNG) ] } ];
    const dup = attachmentMap(messages, new Map([ [ PNG, chatPage(1) ] ]));
    assert.equal(compareOrder(null, dup).status, 'ambiguous');
});
