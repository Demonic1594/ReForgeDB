"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReForgeDBError = exports.DBLogger = exports.LOG_PREFIX = void 0;
exports.isLogLevel = isLogLevel;
exports.errorMessage = errorMessage;
const forgescript_1 = require("@tryforge/forgescript");
const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };
exports.LOG_PREFIX = "[ReForgeDB]";
function isLogLevel(value) {
    return typeof value === "string" && value in LEVELS;
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
class DBLogger {
    static level = isLogLevel(process.env.REFORGEDB_LOG_LEVEL) ? process.env.REFORGEDB_LOG_LEVEL : "info";
    static enabled(level) {
        return LEVELS[this.level] >= LEVELS[level] && level !== "silent";
    }
    static write(level, type, args) {
        if (!this.enabled(level))
            return;
        try {
            // Logger.log is private in ForgeScript's typings but public at run
            // time. LogPriority.None is always printed: the level gate is ours.
            const raw = forgescript_1.Logger;
            if (typeof raw.log === "function")
                raw.log(forgescript_1.LogPriority.None, type, exports.LOG_PREFIX, ...args);
            else if (type === forgescript_1.LogType.Error)
                forgescript_1.Logger.error(exports.LOG_PREFIX, ...args);
            else if (type === forgescript_1.LogType.Warn)
                forgescript_1.Logger.warn(exports.LOG_PREFIX, ...args);
            else
                forgescript_1.Logger.info(exports.LOG_PREFIX, ...args);
        }
        catch {
            // Never let logging break a database operation.
        }
    }
    static error(...args) {
        this.write("error", forgescript_1.LogType.Error, args);
    }
    static warn(...args) {
        this.write("warn", forgescript_1.LogType.Warn, args);
    }
    static info(...args) {
        this.write("info", forgescript_1.LogType.Info, args);
    }
    static debug(...args) {
        this.write("debug", forgescript_1.LogType.Debug, args);
    }
    static trace(...args) {
        this.write("trace", forgescript_1.LogType.Debug, args);
    }
}
exports.DBLogger = DBLogger;
/** An error raised by ReForgeDB itself, with a message meant for the bot developer. */
class ReForgeDBError extends Error {
    cause;
    name = "ReForgeDBError";
    constructor(message, cause) {
        super(message);
        this.cause = cause;
    }
}
exports.ReForgeDBError = ReForgeDBError;
/** The message of any thrown value, without a stack. */
function errorMessage(err) {
    if (err instanceof Error)
        return err.message || err.name;
    if (typeof err === "string")
        return err;
    try {
        return JSON.stringify(err);
    }
    catch {
        return String(err);
    }
}
//# sourceMappingURL=logger.js.map