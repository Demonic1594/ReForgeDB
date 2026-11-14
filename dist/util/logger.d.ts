/**
 * How much ReForgeDB writes to the console.
 *
 * - `silent`: nothing
 * - `error`: failed operations and connection errors
 * - `warn`: also slow operations and misconfiguration (the default is `info`)
 * - `info`: also connection and start-up messages
 * - `debug`: also every database operation with its duration
 * - `trace`: also every SQL statement TypeORM runs
 */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";
export declare const LOG_PREFIX = "[ReForgeDB]";
export declare function isLogLevel(value: unknown): value is LogLevel;
/**
 * ReForgeDB's logger. Writes through ForgeScript's `Logger`, so output looks
 * like the rest of the bot, but uses its own level: `debug` and `trace` lines
 * are shown when ReForgeDB's level allows them, whatever ForgeScript's own
 * priority is.
 *
 * The level comes from the `logLevel` option, or the `REFORGEDB_LOG_LEVEL`
 * environment variable when the option is not set.
 */
export declare class DBLogger {
    static level: LogLevel;
    static enabled(level: LogLevel): boolean;
    private static write;
    static error(...args: unknown[]): void;
    static warn(...args: unknown[]): void;
    static info(...args: unknown[]): void;
    static debug(...args: unknown[]): void;
    static trace(...args: unknown[]): void;
}
/** An error raised by ReForgeDB itself, with a message meant for the bot developer. */
export declare class ReForgeDBError extends Error {
    readonly cause?: unknown;
    readonly name = "ReForgeDBError";
    constructor(message: string, cause?: unknown);
}
/** The message of any thrown value, without a stack. */
export declare function errorMessage(err: unknown): string;
//# sourceMappingURL=logger.d.ts.map