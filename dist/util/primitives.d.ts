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
 * least recently used one.
 */
export declare class LRUCache<K, V> {
    readonly max: number;
    readonly ttl: number;
    private readonly map;
    constructor(max: number, ttl?: number);
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
/**
 * Turns a SQL `LIKE` pattern (`%` any text, `_` one character) into an
 * anchored, case-insensitive regular expression for MongoDB, which has no
 * `LIKE`. Everything else is matched literally.
 */
export declare function likeToRegExp(pattern: string): RegExp;
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