// Structured diagnostics for Microfiche.
//
// The extension only ever wrote to console.error/console.warn with a bare
// string, so when something went wrong the user had nothing to send and there
// was no record of what the planner had decided before the failure. This module
// keeps a bounded ring buffer of typed events plus the captured errors, and can
// render them as text or JSON for a bug report.
//
// It deliberately has no DOM and no SillyTavern dependency so it can be tested
// directly in Node.

/** Event levels, ordered by severity. */
export const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

const DEFAULT_LIMIT = 500;

const isLevel = value => Object.prototype.hasOwnProperty.call(LEVELS, value);

/**
 * Normalises anything throwable into a serialisable shape.
 * @param {unknown} error
 * @returns {{name: string, message: string, stack: string[]}}
 */
export function describeError(error) {
    if (error instanceof Error) {
        return {
            name: error.name || 'Error',
            message: error.message || String(error),
            stack: String(error.stack ?? '').split('\n').map(line => line.trim()).filter(Boolean),
        };
    }
    if (error && typeof error === 'object') {
        let message = '';
        try {
            message = JSON.stringify(error);
        } catch {
            message = String(error);
        }
        return { name: 'NonError', message: message || String(error), stack: [] };
    }
    return { name: 'NonError', message: String(error), stack: [] };
}

/**
 * Creates an independent recorder. Kept as a factory so tests can create
 * isolated instances instead of sharing module state.
 *
 * @param {{limit?: number, now?: () => number}} [options]
 */
export function createDebugLog({ limit = DEFAULT_LIMIT, now = () => Date.now() } = {}) {
    const events = [];
    const counts = { debug: 0, info: 0, warn: 0, error: 0 };
    let dropped = 0;
    let context = {};

    const record = (level, event, details) => {
        if (!isLevel(level)) throw new TypeError(`Unknown log level: ${level}`);
        counts[level]++;
        events.push({
            at: new Date(now()).toISOString(),
            level,
            event: String(event),
            details: details === undefined ? null : details,
        });
        while (events.length > limit) {
            events.shift();
            dropped++;
        }
        return events[events.length - 1];
    };

    return {
        debug: (event, details) => record('debug', event, details),
        info: (event, details) => record('info', event, details),
        warn: (event, details) => record('warn', event, details),
        error: (event, details) => record('error', event, details),

        /** Records an exception together with its stack. */
        fail: (event, error, details) => record('error', event, {
            ...(details ?? {}),
            error: describeError(error),
        }),

        /** Attaches stable facts (model, source, format) to every export. */
        setContext(update) {
            context = { ...context, ...update };
        },

        getContext() {
            return { ...context };
        },

        /** @returns {Array} copy of the buffered events, oldest first */
        entries: () => events.slice(),

        /** @returns {number} number of events evicted by the size limit */
        dropped: () => dropped,

        counts: () => ({ ...counts }),

        size: () => events.length,

        clear() {
            events.length = 0;
            dropped = 0;
            for (const level of Object.keys(counts)) counts[level] = 0;
        },

        /**
         * Builds the export payload.
         * @param {{extensionVersion?: string, hostVersion?: string, note?: string}} [meta]
         */
        snapshot(meta = {}) {
            return {
                product: 'Microfiche',
                extensionVersion: meta.extensionVersion ?? '',
                hostVersion: meta.hostVersion ?? '',
                exportedAt: new Date(now()).toISOString(),
                note: meta.note ?? '',
                context: { ...context },
                counts: { ...counts },
                dropped: dropped,
                events: events.slice(),
            };
        },

        /**
         * Human-readable export. Deliberately mirrors the JSON so a user can
         * paste either one into a bug report.
         * @param {{extensionVersion?: string, hostVersion?: string, note?: string}} [meta]
         */
        toText(meta = {}) {
            const snap = this.snapshot(meta);
            const lines = [
                `Microfiche diagnostics`,
                `extension: ${snap.extensionVersion || 'unknown'}`,
                `host: ${snap.hostVersion || 'unknown'}`,
                `exported: ${snap.exportedAt}`,
                `events: ${snap.events.length} (dropped ${snap.dropped})`,
                `counts: debug=${snap.counts.debug} info=${snap.counts.info} warn=${snap.counts.warn} error=${snap.counts.error}`,
            ];
            const contextEntries = Object.entries(snap.context);
            if (contextEntries.length) {
                lines.push('context:');
                for (const [key, value] of contextEntries) lines.push(`  ${key}: ${format(value)}`);
            }
            if (snap.note) lines.push(`note: ${snap.note}`);
            lines.push('');
            for (const event of snap.events) {
                lines.push(`${event.at} [${event.level}] ${event.event}${event.details === null ? '' : ' ' + format(event.details)}`);
            }
            return lines.join('\n');
        },
    };
}

function format(value) {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
