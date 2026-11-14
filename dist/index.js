"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_HANDLER_NAME = exports.ReForgeDBLogger = exports.ReForgeDBError = exports.Leaderboard = exports.DataBase = exports.DataBaseManager = exports.ReForgeDB = void 0;
const forgescript_1 = require("@tryforge/forgescript");
const tiny_typed_emitter_1 = require("tiny-typed-emitter");
const util_1 = require("./util");
const structures_1 = require("./structures");
const pkg = require("../package.json");
/**
 * The read cache is only correct when one process writes the database. A bot
 * split over several processes (sharding) is the common way to break that.
 */
function warnIfSharded(client) {
    const { shards, shardCount } = client.options;
    const partial = Array.isArray(shards) && typeof shardCount === "number" && shards.length < shardCount;
    if (client.shard || partial) {
        util_1.ReForgeDBLogger.warn("The cache option is on, but this bot runs in several processes (sharding). A variable written by one process is not seen by the others until its cached copy expires. Turn cache off, or give it a short ttl.");
    }
}
/**
 * ReForgeDB: variables, leaderboards and cooldowns for ForgeScript, stored in
 * SQLite, better-sqlite3, MySQL/MariaDB, PostgreSQL or MongoDB.
 *
 * @example
 * const client = new ForgeClient({
 *     extensions: [new ReForgeDB({ type: "better-sqlite3", events: ["variableUpdate"] })],
 * })
 */
class ReForgeDB extends forgescript_1.ForgeExtension {
    options;
    /** Name this extension registers under, for `requireExtensions` of other extensions. */
    static extensionName = "reforge.db";
    static rawDefaults = {};
    static compiledDefaults = new Map();
    name = ReForgeDB.extensionName;
    description = pkg.description;
    version = pkg.version;
    commands;
    emitter = new tiny_typed_emitter_1.TypedEmitter();
    constructor(options) {
        super();
        this.options = options;
        // Fail at start-up with a clear message, not on the first command.
        (0, util_1.resolveSettings)(options);
        if (options?.logLevel)
            util_1.ReForgeDBLogger.level = options.logLevel;
    }
    init(client) {
        this.commands = new structures_1.ReForgeDBCommandManager(client);
        forgescript_1.EventManager.load(structures_1.EVENT_HANDLER_NAME, __dirname + "/events");
        this.load(__dirname + "/functions");
        // Kept from ForgeDB: other code (QuorielDB's transfer, extensions) uses client.db.
        client.db = util_1.DataBase;
        if (this.options?.events?.length)
            client.events.load(structures_1.EVENT_HANDLER_NAME, this.options.events);
        if (this.options?.cache)
            warnIfSharded(client);
        // Connects in the background with retries; never rejects.
        void new util_1.DataBase(this.emitter, this.options).init();
    }
    /** Resolves once the database is connected (rejects after `timeout` ms). */
    static ready(timeout) {
        return util_1.DataBase.ready(timeout);
    }
    /**
     * Declares default values, used when a variable is read but was never
     * set (and the function call gives no default). Strings are ForgeScript
     * code and run in the reading command's context, so `"$username"` works.
     * Each call replaces the previous defaults.
     */
    variables(rec) {
        ReForgeDB.variables(rec);
    }
    static variables(rec) {
        if (!rec || typeof rec !== "object")
            throw new util_1.ReForgeDBError("ReForgeDB.variables() expects an object of name: default");
        ReForgeDB.rawDefaults = { ...rec };
        ReForgeDB.compiledDefaults.clear();
    }
    /** The declared defaults, as given to `variables()`. */
    static get defaults() {
        return ReForgeDB.rawDefaults;
    }
    /** Whether a default was declared for `name`. */
    static hasDefault(name) {
        return Object.prototype.hasOwnProperty.call(ReForgeDB.rawDefaults, name);
    }
    /**
     * The default for `name`: compiled ForgeScript for strings (compiled on
     * first use, once every extension's functions are registered), or the
     * value itself.
     */
    static defaultFor(name) {
        if (!ReForgeDB.hasDefault(name))
            return undefined;
        const raw = ReForgeDB.rawDefaults[name];
        if (typeof raw !== "string")
            return { value: raw };
        let code = ReForgeDB.compiledDefaults.get(name);
        if (!code) {
            try {
                code = forgescript_1.Compiler.compile(raw);
            }
            catch (err) {
                throw new util_1.ReForgeDBError(`The default of variable "${name}" is not valid ForgeScript: ${(0, util_1.errorMessage)(err)}`, err);
            }
            ReForgeDB.compiledDefaults.set(name, code);
        }
        return { code };
    }
}
exports.ReForgeDB = ReForgeDB;
var util_2 = require("./util");
Object.defineProperty(exports, "DataBaseManager", { enumerable: true, get: function () { return util_2.DataBaseManager; } });
Object.defineProperty(exports, "DataBase", { enumerable: true, get: function () { return util_2.DataBase; } });
Object.defineProperty(exports, "Leaderboard", { enumerable: true, get: function () { return util_2.Leaderboard; } });
Object.defineProperty(exports, "ReForgeDBError", { enumerable: true, get: function () { return util_2.ReForgeDBError; } });
Object.defineProperty(exports, "ReForgeDBLogger", { enumerable: true, get: function () { return util_2.ReForgeDBLogger; } });
var structures_2 = require("./structures");
Object.defineProperty(exports, "EVENT_HANDLER_NAME", { enumerable: true, get: function () { return structures_2.EVENT_HANDLER_NAME; } });
//# sourceMappingURL=index.js.map