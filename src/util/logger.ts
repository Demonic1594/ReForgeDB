import { Logger, LogPriority, LogType } from "@tryforge/forgescript"

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
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace"

const LEVELS: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 }
export const LOG_PREFIX = "[ReForgeDB]"

export function isLogLevel(value: unknown): value is LogLevel {
    return typeof value === "string" && value in LEVELS
}

/**
 * ReForgeDB's logger. Writes through ForgeScript's `Logger`, so output looks
 * like the rest of the bot, but uses its own level: `debug` and `trace` lines
 * are shown when ReForgeDB's level allows them, whatever ForgeScript's own
 * priority is.
 *
 * The level comes from the `logLevel` option, or the `REFORGEDB_LOG_LEVEL`
 * environment variable when the option is not set.
 */
export class DBLogger {
    static level: LogLevel = isLogLevel(process.env.REFORGEDB_LOG_LEVEL) ? process.env.REFORGEDB_LOG_LEVEL : "info"

    static enabled(level: LogLevel) {
        return LEVELS[this.level] >= LEVELS[level] && level !== "silent"
    }

    private static write(level: LogLevel, type: LogType, args: unknown[]) {
        if (!this.enabled(level)) return
        try {
            // Logger.log is private in ForgeScript's typings but public at run
            // time. LogPriority.None is always printed: the level gate is ours.
            const raw = Logger as unknown as { log?: (priority: LogPriority, type: LogType, ...a: unknown[]) => void }
            if (typeof raw.log === "function") raw.log(LogPriority.None, type, LOG_PREFIX, ...args)
            else if (type === LogType.Error) Logger.error(LOG_PREFIX, ...args)
            else if (type === LogType.Warn) Logger.warn(LOG_PREFIX, ...args)
            else Logger.info(LOG_PREFIX, ...args)
        } catch {
            // Never let logging break a database operation.
        }
    }

    static error(...args: unknown[]) {
        this.write("error", LogType.Error, args)
    }

    static warn(...args: unknown[]) {
        this.write("warn", LogType.Warn, args)
    }

    static info(...args: unknown[]) {
        this.write("info", LogType.Info, args)
    }

    static debug(...args: unknown[]) {
        this.write("debug", LogType.Debug, args)
    }

    static trace(...args: unknown[]) {
        this.write("trace", LogType.Debug, args)
    }
}

/** An error raised by ReForgeDB itself, with a message meant for the bot developer. */
export class ReForgeDBError extends Error {
    public override readonly name = "ReForgeDBError"

    constructor(
        message: string,
        public readonly cause?: unknown
    ) {
        super(message)
    }
}

/** The message of any thrown value, without a stack. */
export function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message || err.name
    if (typeof err === "string") return err
    try {
        return JSON.stringify(err)
    } catch {
        return String(err)
    }
}
