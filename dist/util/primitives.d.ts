/**
 * Runs tasks with the same key one after another, and tasks with different
 * keys in parallel. Used so a check followed by a write (a cooldown claim)
 * cannot interleave with the same check from a concurrent command.
 */
export declare class KeyedMutex {
    private readonly tails;
    run<T>(key: string, task: () => Promise<T>): Promise<T>;
    /** Keys with a running or queued task. */
    get size(): number;
}
/**
 * A bounded least-recently-used map with an optional time to live. A `Map`
 * keeps insertion order, so re-inserting on access makes the first key the
 * least recently used one. With `maxWeight`, the total `weigh(value)` of the
 * entries is bounded too (an entry heavier than it is not kept at all).
 */
export declare class LRUCache<K, V> {
    readonly max: number;
    readonly ttl: number;
    readonly maxWeight: number;
    private readonly weigh;
    private readonly map;
    private totalWeight;
    constructor(max: number, ttl?: number, maxWeight?: number, weigh?: (value: V) => number);
    /** The total weight of the entries. */
    get weight(): number;
    private remove;
    get(key: K): {
        value: V;
    } | undefined;
    set(key: K, value: V, ttl?: number): void;
    delete(key: K): boolean;
    clear(): void;
    get size(): number;
}
/** Splits an array into chunks of at most `size` items. */
export declare function chunk<T>(items: T[], size: number): T[][];
/** Longest `LIKE` pattern accepted, in characters. */
export declare const MAX_LIKE_LENGTH = 1000;
/**
 * Makes a `LIKE` pattern safe to run: a run of `%` matches the same as one
 * `%`, so it is collapsed (some engines backtrack once per `%`), and
 * patterns longer than `MAX_LIKE_LENGTH` are refused.
 */
export declare function normalizeLike(pattern: string): string;
/** The literal text a `LIKE` pattern starts with (before its first `%` or `_`). */
export declare function likePrefix(pattern: string): string;
/**
 * A matcher for a SQL `LIKE` pattern (`%` any text, `_` one character,
 * case-insensitive), for MongoDB, which has no `LIKE`. A regular expression
 * for it backtracks exponentially on patterns like `%a%a%a%b` and runs on
 * the database server; this greedy matcher takes linear time per wildcard.
 */
export declare function likeMatcher(pattern: string): (text: unknown) => boolean;
/**
 * An anchored, case-insensitive regular expression for a `LIKE` pattern. Use
 * it only for patterns with at most one `%`: with more, it can backtrack
 * exponentially (use `likeMatcher`).
 */
export declare function likeRegExp(pattern: string): RegExp;
/** Escapes text for use inside a regular expression. */
export declare function escapeRegExp(text: string): string;
/**
 * Orders Discord IDs (numeric strings) by their numeric value without
 * BigInt, and anything else as text. Used to break leaderboard ties the same
 * way every time.
 */
export declare function compareIds(a: string, b: string): number;
/**
 * The number a stored value ranks with on a leaderboard, or `null` when it
 * is not a finite number. Empty values do not rank.
 */
export declare function rankValue(value: unknown): number | null;
//# sourceMappingURL=primitives.d.ts.map