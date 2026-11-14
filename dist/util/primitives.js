"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LRUCache = exports.KeyedMutex = void 0;
exports.chunk = chunk;
exports.likeToRegExp = likeToRegExp;
exports.compareIds = compareIds;
exports.rankValue = rankValue;
/**
 * Runs tasks with the same key one after another, and tasks with different
 * keys in parallel. Used so a check followed by a write (a cooldown claim)
 * cannot interleave with the same check from a concurrent command.
 */
class KeyedMutex {
    tails = new Map();
    async run(key, task) {
        const previous = this.tails.get(key) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve) => (release = resolve));
        const tail = previous.then(() => current);
        this.tails.set(key, tail);
        try {
            await previous;
            return await task();
        }
        finally {
            release();
            // Forget the key once nothing else is queued behind this task.
            if (this.tails.get(key) === tail)
                this.tails.delete(key);
        }
    }
    /** Keys with a running or queued task. */
    get size() {
        return this.tails.size;
    }
}
exports.KeyedMutex = KeyedMutex;
/**
 * A bounded least-recently-used map with an optional time to live. A `Map`
 * keeps insertion order, so re-inserting on access makes the first key the
 * least recently used one.
 */
class LRUCache {
    max;
    ttl;
    map = new Map();
    constructor(max, ttl = 0) {
        this.max = max;
        this.ttl = ttl;
    }
    get(key) {
        const entry = this.map.get(key);
        if (!entry)
            return undefined;
        if (entry.expires && entry.expires <= Date.now()) {
            this.map.delete(key);
            return undefined;
        }
        this.map.delete(key);
        this.map.set(key, entry);
        return { value: entry.value };
    }
    set(key, value, ttl = this.ttl) {
        this.map.delete(key);
        this.map.set(key, { value, expires: ttl > 0 ? Date.now() + ttl : 0 });
        while (this.map.size > this.max) {
            const oldest = this.map.keys().next().value;
            this.map.delete(oldest);
        }
    }
    delete(key) {
        return this.map.delete(key);
    }
    clear() {
        this.map.clear();
    }
    get size() {
        return this.map.size;
    }
}
exports.LRUCache = LRUCache;
/** Splits an array into chunks of at most `size` items. */
function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size)
        out.push(items.slice(i, i + size));
    return out;
}
/**
 * Turns a SQL `LIKE` pattern (`%` any text, `_` one character) into an
 * anchored, case-insensitive regular expression for MongoDB, which has no
 * `LIKE`. Everything else is matched literally.
 */
function likeToRegExp(pattern) {
    let source = "";
    for (const ch of pattern) {
        if (ch === "%")
            source += "[\\s\\S]*";
        else if (ch === "_")
            source += "[\\s\\S]";
        else
            source += ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
    return new RegExp(`^${source}$`, "i");
}
/**
 * Orders Discord IDs (numeric strings) by their numeric value without
 * BigInt, and anything else as text. Used to break leaderboard ties the same
 * way every time.
 */
function compareIds(a, b) {
    if (a === b)
        return 0;
    const numeric = /^\d+$/;
    if (numeric.test(a) && numeric.test(b) && a.length !== b.length)
        return a.length - b.length;
    return a < b ? -1 : 1;
}
/**
 * The number a stored value ranks with on a leaderboard, or `null` when it
 * is not a finite number. Empty values do not rank.
 */
function rankValue(value) {
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (trimmed === "")
        return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
}
//# sourceMappingURL=primitives.js.map