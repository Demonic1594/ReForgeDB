"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_LIKE_LENGTH = exports.LRUCache = exports.KeyedMutex = void 0;
exports.chunk = chunk;
exports.normalizeLike = normalizeLike;
exports.likePrefix = likePrefix;
exports.likeMatcher = likeMatcher;
exports.escapeRegExp = escapeRegExp;
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
 * least recently used one. With `maxWeight`, the total `weigh(value)` of the
 * entries is bounded too (an entry heavier than it is not kept at all).
 */
class LRUCache {
    max;
    ttl;
    maxWeight;
    weigh;
    map = new Map();
    totalWeight = 0;
    constructor(max, ttl = 0, maxWeight = Infinity, weigh = () => 1) {
        this.max = max;
        this.ttl = ttl;
        this.maxWeight = maxWeight;
        this.weigh = weigh;
    }
    /** The total weight of the entries. */
    get weight() {
        return this.totalWeight;
    }
    remove(key) {
        const entry = this.map.get(key);
        if (!entry)
            return false;
        this.map.delete(key);
        this.totalWeight -= entry.weight;
        return true;
    }
    get(key) {
        const entry = this.map.get(key);
        if (!entry)
            return undefined;
        if (entry.expires && entry.expires <= Date.now()) {
            this.remove(key);
            return undefined;
        }
        this.map.delete(key);
        this.map.set(key, entry);
        return { value: entry.value };
    }
    set(key, value, ttl = this.ttl) {
        this.remove(key);
        const weight = this.weigh(value);
        if (weight > this.maxWeight)
            return;
        this.map.set(key, { value, expires: ttl > 0 ? Date.now() + ttl : 0, weight });
        this.totalWeight += weight;
        while (this.map.size > this.max || this.totalWeight > this.maxWeight) {
            this.remove(this.map.keys().next().value);
        }
    }
    delete(key) {
        return this.remove(key);
    }
    clear() {
        this.map.clear();
        this.totalWeight = 0;
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
/** Longest `LIKE` pattern accepted, in characters. */
exports.MAX_LIKE_LENGTH = 1000;
/**
 * Makes a `LIKE` pattern safe to run: a run of `%` matches the same as one
 * `%`, so it is collapsed (some engines backtrack once per `%`), and
 * patterns longer than `MAX_LIKE_LENGTH` are refused.
 */
function normalizeLike(pattern) {
    if (pattern.length > exports.MAX_LIKE_LENGTH)
        throw new RangeError(`A search pattern may be at most ${exports.MAX_LIKE_LENGTH} characters (got ${pattern.length})`);
    return pattern.replace(/%{2,}/g, "%");
}
/** The literal text a `LIKE` pattern starts with (before its first `%` or `_`). */
function likePrefix(pattern) {
    const i = pattern.search(/[%_]/);
    return i === -1 ? pattern : pattern.slice(0, i);
}
/**
 * A matcher for a SQL `LIKE` pattern (`%` any text, `_` one character,
 * case-insensitive), for MongoDB, which has no `LIKE`. A regular expression
 * for it backtracks exponentially on patterns like `%a%a%a%b` and runs on
 * the database server; this greedy matcher takes linear time per wildcard.
 */
function likeMatcher(pattern) {
    const p = Array.from(normalizeLike(pattern).toLowerCase());
    return (value) => {
        if (typeof value !== "string")
            return false;
        const t = Array.from(value.toLowerCase());
        let ti = 0;
        let pi = 0;
        let star = -1;
        let resume = 0;
        while (ti < t.length) {
            if (pi < p.length && (p[pi] === "_" || (p[pi] !== "%" && p[pi] === t[ti]))) {
                ti++;
                pi++;
            }
            else if (pi < p.length && p[pi] === "%") {
                star = pi++;
                resume = ti;
            }
            else if (star !== -1) {
                pi = star + 1;
                ti = ++resume;
            }
            else
                return false;
        }
        while (pi < p.length && p[pi] === "%")
            pi++;
        return pi === p.length;
    };
}
/** Escapes text for use inside a regular expression. */
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
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