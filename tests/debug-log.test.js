import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDebugLog, describeError, LEVELS } from '../lib/debug-log.js';

test('levels are ordered by severity', () => {
    assert.ok(LEVELS.debug < LEVELS.info);
    assert.ok(LEVELS.info < LEVELS.warn);
    assert.ok(LEVELS.warn < LEVELS.error);
});

test('records events in order with a timestamp and level', () => {
    const log = createDebugLog({ now: () => 0 });
    log.info('first');
    log.warn('second', { a: 1 });
    const entries = log.entries();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].event, 'first');
    assert.equal(entries[0].level, 'info');
    assert.equal(entries[1].details.a, 1);
    assert.match(entries[0].at, /^\d{4}-\d{2}-\d{2}T/);
});

test('every public level method is wired to its own level', () => {
    const log = createDebugLog();
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    assert.deepEqual(log.entries().map(entry => entry.level), ['debug', 'info', 'warn', 'error']);
});

test('an event name is coerced to a string and details default to null', () => {
    const log = createDebugLog();
    log.info(42);
    const [entry] = log.entries();
    assert.equal(entry.event, '42');
    assert.equal(entry.details, null);
});

test('counts each level independently', () => {
    const log = createDebugLog();
    log.debug('d');
    log.warn('w');
    log.error('e');
    log.error('e2');
    assert.deepEqual(log.counts(), { debug: 1, info: 0, warn: 1, error: 2 });
});

test('the ring buffer evicts the oldest events and reports how many', () => {
    const log = createDebugLog({ limit: 3 });
    for (let i = 0; i < 5; i++) log.info(`e${i}`);
    assert.equal(log.size(), 3);
    assert.equal(log.dropped(), 2);
    assert.deepEqual(log.entries().map(e => e.event), ['e2', 'e3', 'e4']);
});

test('counts survive eviction so totals stay honest', () => {
    const log = createDebugLog({ limit: 1 });
    for (let i = 0; i < 4; i++) log.info(`e${i}`);
    assert.equal(log.counts().info, 4);
    assert.equal(log.size(), 1);
});

test('clear resets events, counters and the dropped tally', () => {
    const log = createDebugLog({ limit: 1 });
    log.info('a');
    log.info('b');
    log.clear();
    assert.equal(log.size(), 0);
    assert.equal(log.dropped(), 0);
    assert.deepEqual(log.counts(), { debug: 0, info: 0, warn: 0, error: 0 });
});

test('context is shared across records and copied out', () => {
    const log = createDebugLog();
    log.setContext({ model: 'gemini-x' });
    log.setContext({ source: 'makersuite' });
    assert.deepEqual(log.getContext(), { model: 'gemini-x', source: 'makersuite' });
    const copy = log.getContext();
    copy.model = 'tampered';
    assert.equal(log.getContext().model, 'gemini-x');
});

test('fail captures the message and the stack', () => {
    const log = createDebugLog();
    const err = new Error('boom');
    log.fail('intercept', err, { pages: 3 });
    const [entry] = log.entries();
    assert.equal(entry.level, 'error');
    assert.equal(entry.details.pages, 3);
    assert.equal(entry.details.error.name, 'Error');
    assert.equal(entry.details.error.message, 'boom');
    assert.ok(entry.details.error.stack.length > 0);
    assert.ok(entry.details.error.stack.some(line => line.includes('boom')));
});

test('describeError handles non-Error values', () => {
    assert.equal(describeError('plain').name, 'NonError');
    assert.equal(describeError('plain').message, 'plain');
    assert.equal(describeError(null).message, 'null');
    assert.equal(describeError({ code: 7 }).message, '{"code":7}');
});

test('describeError survives a circular object', () => {
    const circular = {};
    circular.self = circular;
    const described = describeError(circular);
    assert.equal(described.name, 'NonError');
    assert.ok(described.message.length > 0);
});

test('describeError survives an object whose toJSON throws', () => {
    const nasty = { toJSON() { throw new Error('nope'); } };
    assert.ok(describeError(nasty).message.length > 0);
});

test('snapshot is a serialisable payload with everything needed for a report', () => {
    const log = createDebugLog({ now: () => 0 });
    log.setContext({ model: 'm' });
    log.info('a');
    const snap = log.snapshot({ extensionVersion: '0.3.0', hostVersion: '1.19.0', note: 'hi' });
    assert.equal(snap.product, 'Microfiche');
    assert.equal(snap.extensionVersion, '0.3.0');
    assert.equal(snap.hostVersion, '1.19.0');
    assert.equal(snap.note, 'hi');
    assert.deepEqual(snap.context, { model: 'm' });
    assert.equal(snap.events.length, 1);
    assert.doesNotThrow(() => JSON.stringify(snap));
});

test('snapshot output is detached from later writes', () => {
    const log = createDebugLog();
    log.info('a');
    const snap = log.snapshot();
    log.info('b');
    assert.equal(snap.events.length, 1);
});

test('toText renders the header, counts and one line per event', () => {
    const log = createDebugLog({ now: () => 0 });
    log.setContext({ model: 'gemini-x' });
    log.info('planner', { pages: 2 });
    log.error('failed');
    const text = log.toText({ extensionVersion: '0.3.0', hostVersion: '1.19.0' });
    assert.match(text, /Microfiche diagnostics/);
    assert.match(text, /extension: 0\.3\.0/);
    assert.match(text, /host: 1\.19\.0/);
    assert.match(text, /counts: debug=0 info=1 warn=0 error=1/);
    assert.match(text, /model: gemini-x/);
    assert.match(text, /\[info\] planner/);
    assert.match(text, /\[error\] failed/);
    assert.equal(text.split('\n').filter(line => line.includes('[info]') || line.includes('[error]')).length, 2);
});

test('two instances do not share state', () => {
    const a = createDebugLog();
    const b = createDebugLog();
    a.info('only-a');
    assert.equal(b.size(), 0);
});
