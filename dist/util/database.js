"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataBase = exports.MIN_COOLDOWN_EXPIRE_MAX_DELAY = exports.Leaderboard = void 0;
exports.resolveSettings = resolveSettings;
require("reflect-metadata");
const perf_hooks_1 = require("perf_hooks");
const typeorm_1 = require("typeorm");
const databaseManager_1 = require("./databaseManager");
const logger_1 = require("./logger");
const primitives_1 = require("./primitives");
const types_1 = require("./types");
/** Longest key MySQL can store in ForgeDB's `varchar(255)` columns. */
const MYSQL_MAX_KEY = 255;
/** Rows per `IN (...)` when deleting many records (safe for every driver). */
const DELETE_BATCH = 500;
/** Most variable names whose leaderboards are tracked for changes. */
const MAX_TRACKED_NAMES = 10_000;
/** Most leaderboard entries kept in memory across all cached leaderboards. */
const MAX_CACHED_ENTRIES = 1_000_000;
/** Errors that retrying the connection cannot fix. */
const FATAL_CONNECT_ERRORS = new Set(["DriverPackageNotInstalledError", "MissingDriverError", "DataTypeNotSupportedError", "ColumnTypeUndefinedError"]);
function isGuildData(data) {
    return data.type === "member" || data.type === "channel" || data.type === "role";
}
/** Drops `undefined` values, which MongoDB would store as `null`. */
function defined(obj) {
    const out = {};
    for (const key of Object.keys(obj))
        if (obj[key] !== undefined)
            out[key] = obj[key];
    return out;
}
const RECORD_COLUMNS = ["identifier", "name", "id", "type", "value", "guildId"];
const COOLDOWN_COLUMNS = ["identifier", "name", "id", "startedAt", "duration"];
/**
 * Plain SQL for the hot paths (get, set, cooldowns, leaderboard scans),
 * built once per connection from TypeORM's metadata, so table prefixes,
 * schemas and naming strategies still apply. TypeORM's repository methods
 * build a query builder on every call, which costs more than the query
 * itself on a fast database. `null` on MongoDB.
 */
function buildStatements(db, record, cooldown) {
    const kind = (0, types_1.driverKind)(db.options.type);
    if (kind === "mongodb")
        return null;
    const d = db.driver;
    const table = (target, columns) => {
        const meta = db.getMetadata(target);
        const name = meta.tablePath
            .split(".")
            .map((part) => d.escape(part))
            .join(".");
        const col = (prop) => {
            const column = meta.findColumnWithPropertyName(prop);
            if (!column)
                throw new logger_1.ReForgeDBError(`Entity ${meta.name} has no column ${prop}`);
            return d.escape(column.databaseName);
        };
        const params = columns.map((_, i) => d.createParameter(`p${i}`, i));
        const select = columns.map((c) => `${col(c)} AS ${d.escape(c)}`).join(", ");
        const insertCols = columns.map(col).join(", ");
        const rest = columns.slice(1);
        const conflict = kind === "mysql"
            ? `ON DUPLICATE KEY UPDATE ${rest.map((c) => `${col(c)} = VALUES(${col(c)})`).join(", ")}`
            : `ON CONFLICT (${col("identifier")}) DO UPDATE SET ${rest.map((c) => `${col(c)} = EXCLUDED.${col(c)}`).join(", ")}`;
        return {
            name,
            col,
            param: (i) => d.createParameter(`p${i}`, i),
            get: `SELECT ${select} FROM ${name} WHERE ${col("identifier")} = ${params[0]}`,
            upsert: `INSERT INTO ${name} (${insertCols}) VALUES (${params.join(", ")}) ${conflict}`,
        };
    };
    const r = table(record, RECORD_COLUMNS);
    const c = table(cooldown, COOLDOWN_COLUMNS);
    const scan = `SELECT ${r.col("id")} AS ${d.escape("id")}, ${r.col("value")} AS ${d.escape("value")} FROM ${r.name} WHERE ${r.col("name")} = ${r.param(0)} AND ${r.col("type")} = ${r.param(1)}`;
    const cooldownCols = COOLDOWN_COLUMNS.map(c.col).join(", ");
    const cooldownParams = COOLDOWN_COLUMNS.map((_, i) => c.param(i)).join(", ");
    const claimExpiredCooldown = `UPDATE ${c.name} SET ${c.col("startedAt")} = ${c.param(0)}, ${c.col("duration")} = ${c.param(1)}, ${c.col("name")} = ${c.param(2)}, ${c.col("id")} = ${c.param(3)} ` +
        `WHERE ${c.col("identifier")} = ${c.param(4)} AND ${c.col("startedAt")} + ${c.col("duration")} <= ${c.param(5)}`;
    const claimNewCooldown = kind === "mysql"
        ? `INSERT IGNORE INTO ${c.name} (${cooldownCols}) VALUES (${cooldownParams})`
        : `INSERT INTO ${c.name} (${cooldownCols}) VALUES (${cooldownParams}) ON CONFLICT (${c.col("identifier")}) DO NOTHING`;
    // SQLite and PostgreSQL: insert, or take over the row only if it has run
    // out; the row count says whether this statement started the cooldown.
    // MySQL's ON DUPLICATE KEY UPDATE cannot tell "updated" from "left as it
    // was" reliably (CLIENT_FOUND_ROWS), so it keeps the read-first claim.
    const cur = d.escape("cur");
    const claimCooldown = kind === "mysql"
        ? null
        : `INSERT INTO ${c.name} AS ${cur} (${cooldownCols}) VALUES (${cooldownParams}) ON CONFLICT (${c.col("identifier")}) DO UPDATE SET ` +
            ["name", "id", "startedAt", "duration"].map((k) => `${c.col(k)} = EXCLUDED.${c.col(k)}`).join(", ") +
            ` WHERE ${cur}.${c.col("startedAt")} + ${cur}.${c.col("duration")} <= EXCLUDED.${c.col("startedAt")}`;
    return {
        getRecord: r.get,
        upsertRecord: r.upsert,
        getCooldown: c.get,
        upsertCooldown: c.upsert,
        claimExpiredCooldown,
        claimNewCooldown,
        claimCooldown,
        scan,
        scanGuild: `${scan} AND ${r.col("guildId")} = ${r.param(2)}`,
    };
}
/** Values in column order for a raw query; drivers reject `undefined`. */
function row(obj, columns) {
    return columns.map((c) => (obj[c] === undefined ? null : obj[c]));
}
/**
 * A sorted leaderboard. Only values that are numbers take part; ties are
 * broken by ID (lowest first), so positions are the same in every function.
 */
class Leaderboard {
    query;
    entries;
    index = null;
    constructor(query, entries) {
        this.query = query;
        this.entries = entries;
    }
    get count() {
        return this.entries.length;
    }
    /** 1-based position of an ID, or `0` when it is not on the leaderboard. */
    positionOf(id) {
        if (!id)
            return 0;
        if (!this.index) {
            this.index = new Map();
            for (let i = 0; i < this.entries.length; i++)
                this.index.set(this.entries[i].id, i + 1);
        }
        return this.index.get(id) ?? 0;
    }
    /** The entries of a page (1-based), `perPage` per page. */
    page(page, perPage) {
        const start = (page - 1) * perPage;
        return { start, entries: this.entries.slice(start, start + perPage) };
    }
}
exports.Leaderboard = Leaderboard;
const DEFAULT_SETTINGS = {
    slowQueryThreshold: 1000,
    readyTimeout: 30_000,
    leaderboardCacheTTL: 2000,
    cooldownSweepInterval: 3_600_000,
    cooldownExpireInterval: 5000,
    cooldownExpireMaxDelay: 12 * 3_600_000,
    cache: null,
};
/** The smallest `cooldownExpireMaxDelay`: checks run every few seconds, and a restart takes a while. */
exports.MIN_COOLDOWN_EXPIRE_MAX_DELAY = 60_000;
/** Cooldowns handled per check; a check that finds a full batch runs again right away. */
const EXPIRE_BATCH = 500;
function nonNegative(name, value, fallback) {
    if (value === undefined || value === null)
        return fallback;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new logger_1.ReForgeDBError(`Option "${name}" must be a number of 0 or more, got ${JSON.stringify(value)}`);
    }
    return value;
}
function atLeast(name, value, fallback, min) {
    const n = nonNegative(name, value, fallback);
    if (n < min)
        throw new logger_1.ReForgeDBError(`Option "${name}" must be at least ${min} ms, got ${n}`);
    return n;
}
/** Validates the options of `new ReForgeDB()` and returns the resolved settings. */
function resolveSettings(options) {
    const o = (options ?? {});
    const type = o.type;
    if (type !== undefined && !["sqlite", "better-sqlite3", "mysql", "mariadb", "postgres", "mongodb"].includes(type)) {
        throw new logger_1.ReForgeDBError(`Unknown database type "${type}". Use sqlite, better-sqlite3, mysql, mariadb, postgres or mongodb.`);
    }
    if (type === "mongodb" && !o.url && !o.host) {
        throw new logger_1.ReForgeDBError(`The mongodb type needs a "url" (for example mongodb://localhost:27017/bot).`);
    }
    if (o.logLevel !== undefined && !(0, logger_1.isLogLevel)(o.logLevel)) {
        throw new logger_1.ReForgeDBError(`Unknown logLevel "${o.logLevel}". Use silent, error, warn, info, debug or trace.`);
    }
    if (o.events !== undefined && !Array.isArray(o.events))
        throw new logger_1.ReForgeDBError(`Option "events" must be an array of event names.`);
    const forgeDBFile = o.forgeDBFile;
    if (forgeDBFile !== undefined && !["use", "copy", "rename", "ignore"].includes(forgeDBFile)) {
        throw new logger_1.ReForgeDBError(`Unknown forgeDBFile "${String(forgeDBFile)}". Use use, copy, rename or ignore.`);
    }
    let cache = null;
    if (o.cache) {
        const c = o.cache === true ? {} : o.cache;
        const max = nonNegative("cache.max", c.max, 10_000);
        if (max < 1)
            throw new logger_1.ReForgeDBError(`Option "cache.max" must be at least 1.`);
        cache = { max: Math.floor(max), ttl: nonNegative("cache.ttl", c.ttl, 0) };
    }
    return {
        slowQueryThreshold: nonNegative("slowQueryThreshold", o.slowQueryThreshold, DEFAULT_SETTINGS.slowQueryThreshold),
        readyTimeout: nonNegative("readyTimeout", o.readyTimeout, DEFAULT_SETTINGS.readyTimeout),
        leaderboardCacheTTL: nonNegative("leaderboardCacheTTL", o.leaderboardCacheTTL, DEFAULT_SETTINGS.leaderboardCacheTTL),
        cooldownSweepInterval: nonNegative("cooldownSweepInterval", o.cooldownSweepInterval, DEFAULT_SETTINGS.cooldownSweepInterval),
        cooldownExpireInterval: nonNegative("cooldownExpireInterval", o.cooldownExpireInterval, DEFAULT_SETTINGS.cooldownExpireInterval),
        cooldownExpireMaxDelay: atLeast("cooldownExpireMaxDelay", o.cooldownExpireMaxDelay, DEFAULT_SETTINGS.cooldownExpireMaxDelay, exports.MIN_COOLDOWN_EXPIRE_MAX_DELAY),
        cache,
    };
}
const VARIABLE_TYPES = new Set(["user", "channel", "role", "message", "member", "custom", "guild", "old"]);
/** Checks data for `import()` completely before anything is written. */
function validateExport(input) {
    let data = input;
    if (typeof data === "string") {
        try {
            data = JSON.parse(data);
        }
        catch (err) {
            throw new logger_1.ReForgeDBError(`import(): the text is not valid JSON (${(0, logger_1.errorMessage)(err)})`);
        }
    }
    const d = data;
    if (!d || typeof d !== "object" || d.format !== "reforge.db" || d.version !== 1)
        throw new logger_1.ReForgeDBError('import(): this is not data from client.db.export() (format "reforge.db", version 1)');
    if (!Array.isArray(d.records) || !Array.isArray(d.cooldowns))
        throw new logger_1.ReForgeDBError("import(): records and cooldowns must be arrays");
    const problems = [];
    const text = (v, max = 1_000_000) => typeof v === "string" && v.length <= max;
    d.records.forEach((r, i) => {
        if (!r || typeof r !== "object")
            return problems.push(`records[${i}] is not an object`);
        if (!text(r.identifier, 2048) || r.identifier === "")
            problems.push(`records[${i}].identifier must be text`);
        if (!text(r.name, 1024))
            problems.push(`records[${i}].name must be text`);
        if (r.id !== null && r.id !== undefined && !text(r.id, 1024))
            problems.push(`records[${i}].id must be text or null`);
        if (!VARIABLE_TYPES.has(r.type))
            problems.push(`records[${i}].type must be one of ${[...VARIABLE_TYPES].join(", ")}`);
        if (!text(r.value, 16_000_000))
            problems.push(`records[${i}].value must be text`);
        if (r.guildId !== null && r.guildId !== undefined && !text(r.guildId, 64))
            problems.push(`records[${i}].guildId must be text or null`);
    });
    d.cooldowns.forEach((c, i) => {
        if (!c || typeof c !== "object")
            return problems.push(`cooldowns[${i}] is not an object`);
        if (!text(c.identifier, 2048) || c.identifier === "")
            problems.push(`cooldowns[${i}].identifier must be text`);
        if (!text(c.name, 1024))
            problems.push(`cooldowns[${i}].name must be text`);
        if (c.id !== null && c.id !== undefined && !text(c.id, 1024))
            problems.push(`cooldowns[${i}].id must be text or null`);
        for (const k of ["startedAt", "duration"])
            if (!Number.isSafeInteger(c[k]) || c[k] < 0)
                problems.push(`cooldowns[${i}].${k} must be a whole number of 0 or more`);
    });
    if (problems.length) {
        const more = problems.length > 10 ? ` (and ${problems.length - 10} more)` : "";
        throw new logger_1.ReForgeDBError(`import(): nothing was written, the data has ${problems.length} problem(s): ${problems.slice(0, 10).join("; ")}${more}`);
    }
    return d;
}
/**
 * ReForgeDB's storage: variables ("records") and cooldowns. Everything is
 * static, and the bot's client exposes the class as `client.db`.
 *
 * Every method waits for the connection (up to `readyTimeout`), so calling
 * one while the database is still connecting is safe. Failures are thrown as
 * `ReForgeDBError` with the driver's message.
 */
class DataBase extends databaseManager_1.DataBaseManager {
    /** The SQLite file, in the `folder` option (`database/reforge.db` by default). */
    database = "reforge.db";
    /** ForgeDB's file name; the `forgeDBFile` option says what happens to it. */
    previousDatabase = "forge.db";
    entityManager = {
        sqlite: [types_1.SQLiteRecord, types_1.Cooldown],
        mongodb: [types_1.MongoRecord, types_1.MongoCooldown],
        mysql: [types_1.MySQLRecord, types_1.SQLCooldown],
        postgres: [types_1.PostgreSQLRecord, types_1.SQLCooldown],
    };
    static entities = { Record: types_1.SQLiteRecord, Cooldown: types_1.Cooldown };
    static db = null;
    static sql = null;
    /**
     * When each cooldown this process saw runs out (ms since epoch). Only a
     * guess of whether a claim will pass, used to pick the statement that
     * likely decides it in one round trip; the database still decides every
     * claim, so a stale guess costs a round trip, never a wrong answer.
     */
    static cooldownHints = new Map();
    static emitter = null;
    static settings = { ...DEFAULT_SETTINGS };
    static fatal = null;
    static lastError = null;
    static closed = false;
    static waiters = new Set();
    static retryTimer = null;
    static wakeRetry = null;
    static sweeper = null;
    static readCache = null;
    static boards = new primitives_1.LRUCache(200, 0, MAX_CACHED_ENTRIES, (v) => v.board.count + 1);
    static generations = new Map();
    static globalGeneration = 0;
    static writeSeq = 0;
    static locks = new primitives_1.KeyedMutex();
    constructor(emitter, options) {
        super(options ?? { type: "sqlite" });
        this.previousDatabaseAction = databaseManager_1.DataBaseManager.config?.forgeDBFile ?? "use";
        DataBase.emitter = emitter;
        DataBase.configure(options);
    }
    /** Applies the options of `new ReForgeDB()`. */
    static configure(options) {
        DataBase.settings = resolveSettings(options);
        if (options?.logLevel)
            logger_1.ReForgeDBLogger.level = options.logLevel;
        const c = DataBase.settings.cache;
        DataBase.readCache = c ? new primitives_1.LRUCache(c.max, c.ttl) : null;
        DataBase.boards = new primitives_1.LRUCache(200, DataBase.settings.leaderboardCacheTTL, MAX_CACHED_ENTRIES, (v) => v.board.count + 1);
    }
    fallbackEntities(kind, error) {
        const e = error;
        if (kind === "mysql" && (e?.code === "ER_TOO_LONG_KEY" || e?.errno === 1071)) {
            logger_1.ReForgeDBLogger.warn("This MySQL server cannot index the variable names (keys are limited to 767 bytes). Leaderboards and searches will scan the table.");
            return [types_1.MySQLRecordWithoutIndex, types_1.SQLCooldown];
        }
        return undefined;
    }
    /**
     * MongoDB: removes duplicate documents of one key before the unique key
     * indexes are built. ForgeDB read and then wrote, so two first writes at
     * the same moment could both insert. The document kept is the first one
     * in the collection's natural order: the one ForgeDB read and updated.
     */
    async beforeSynchronize(db) {
        if ((0, types_1.driverKind)(db.options.type) !== "mongodb")
            return;
        for (const target of [types_1.MongoRecord, types_1.MongoCooldown]) {
            const groups = (await db.mongoManager
                .aggregate(target, [{ $group: { _id: "$identifier", ids: { $push: "$_id" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }], { allowDiskUse: true })
                .toArray());
            if (!groups.length)
                continue;
            const extra = groups.flatMap((g) => g.ids.slice(1));
            for (const part of (0, primitives_1.chunk)(extra, DELETE_BATCH))
                await db.mongoManager.deleteMany(target, { _id: { $in: part } });
            logger_1.ReForgeDBLogger.warn(`Removed ${extra.length} duplicate document(s) of ${groups.length} key(s) from ${db.getMetadata(target).tableName}, keeping the first of each`);
        }
    }
    /**
     * Connects, retrying with backoff (1 s, doubling up to 60 s) while the
     * database is unreachable. Never rejects: functions wait for the
     * connection, and fail with a clear error after `readyTimeout`.
     */
    async init() {
        DataBase.closed = false;
        for (let attempt = 0; !DataBase.closed; attempt++) {
            try {
                const db = await this.getDB();
                if (DataBase.closed) {
                    await db.destroy().catch(() => undefined);
                    return;
                }
                DataBase.attach(db);
                const type = db.options.type;
                if (attempt)
                    logger_1.ReForgeDBLogger.info(`Connected to ${type} after ${attempt + 1} attempts`);
                else
                    logger_1.ReForgeDBLogger.info(`Connected to ${type}`);
                DataBase.emit("connect");
                return;
            }
            catch (err) {
                DataBase.lastError = err;
                const name = err?.name;
                if (FATAL_CONNECT_ERRORS.has(name) || err instanceof logger_1.ReForgeDBError) {
                    DataBase.fail(new logger_1.ReForgeDBError(`Cannot use the database: ${(0, logger_1.errorMessage)(err)}`, err));
                    logger_1.ReForgeDBLogger.error(`Cannot use the database: ${(0, logger_1.errorMessage)(err)}`);
                    return;
                }
                const wait = Math.min(1000 * 2 ** attempt, 60_000);
                logger_1.ReForgeDBLogger.error(`Could not connect to the database (attempt ${attempt + 1}), retrying in ${wait / 1000}s: ${(0, logger_1.errorMessage)(err)}`);
                logger_1.ReForgeDBLogger.debug(err);
                await new Promise((resolve) => {
                    DataBase.wakeRetry = resolve;
                    DataBase.retryTimer = setTimeout(resolve, wait);
                });
                DataBase.retryTimer = DataBase.wakeRetry = null;
            }
        }
    }
    static attach(db) {
        const kind = (0, types_1.driverKind)(db.options.type);
        DataBase.db = db;
        DataBase.fatal = null;
        DataBase.lastError = null;
        const recordTarget = db.entityMetadatas.find((m) => m.tableName === (kind === "mongodb" ? "mongo_record" : "record"))?.target;
        DataBase.entities = {
            Record: recordTarget ?? (kind === "mongodb" ? types_1.MongoRecord : kind === "mysql" ? types_1.MySQLRecord : kind === "postgres" ? types_1.PostgreSQLRecord : types_1.SQLiteRecord),
            Cooldown: kind === "mongodb" ? types_1.MongoCooldown : kind === "sqlite" ? types_1.Cooldown : types_1.SQLCooldown,
        };
        try {
            DataBase.sql = buildStatements(db, DataBase.entities.Record, DataBase.entities.Cooldown);
        }
        catch (err) {
            // Slower, but always correct: go through TypeORM's repositories.
            DataBase.sql = null;
            logger_1.ReForgeDBLogger.debug("Could not prepare the fast statements, using repositories:", err);
        }
        for (const w of DataBase.waiters)
            w.resolve();
        DataBase.waiters.clear();
        DataBase.startSweeper();
        DataBase.startExpirer();
    }
    static fail(error) {
        DataBase.fatal = error;
        for (const w of DataBase.waiters)
            w.reject(error);
        DataBase.waiters.clear();
    }
    /** Whether the database is connected. */
    static get connected() {
        return !!DataBase.db?.isInitialized;
    }
    /** The entity family in use: `sqlite`, `mysql`, `postgres` or `mongodb`. */
    static get kind() {
        return (0, types_1.driverKind)(DataBase.db?.options.type ?? databaseManager_1.DataBaseManager.config?.type);
    }
    /** The TypeORM `DataSource`, or `null` before the connection is made. */
    static get dataSource() {
        return DataBase.db;
    }
    /**
     * Resolves once the database is connected. Rejects after `timeout` ms
     * (the `readyTimeout` option by default) or when the database cannot be
     * used at all (for example a missing driver package).
     */
    static ready(timeout = DataBase.settings.readyTimeout) {
        if (DataBase.db)
            return Promise.resolve();
        if (DataBase.fatal)
            return Promise.reject(DataBase.fatal);
        return new Promise((resolve, reject) => {
            const waiter = {
                resolve: () => {
                    clearTimeout(timer);
                    resolve();
                },
                reject: (e) => {
                    clearTimeout(timer);
                    reject(e);
                },
            };
            const timer = setTimeout(() => {
                DataBase.waiters.delete(waiter);
                const last = DataBase.lastError ? ` Last error: ${(0, logger_1.errorMessage)(DataBase.lastError)}` : "";
                reject(new logger_1.ReForgeDBError(`The database is not connected yet (waited ${timeout} ms).${last}`));
            }, timeout);
            timer.unref?.();
            DataBase.waiters.add(waiter);
        });
    }
    static async connection() {
        if (DataBase.db)
            return DataBase.db;
        await DataBase.ready();
        return DataBase.db;
    }
    static records(db) {
        return db.getRepository(DataBase.entities.Record);
    }
    static cooldowns(db) {
        return db.getRepository(DataBase.entities.Cooldown);
    }
    static get mongo() {
        return DataBase.kind === "mongodb";
    }
    /** Runs a database operation with timing, debug logging and error wrapping. */
    static async op(label, detail, run) {
        const db = DataBase.db ?? (await DataBase.connection());
        const started = perf_hooks_1.performance.now();
        try {
            const result = await run(db);
            const ms = perf_hooks_1.performance.now() - started;
            const slow = DataBase.settings.slowQueryThreshold;
            if (slow > 0 && ms >= slow)
                logger_1.ReForgeDBLogger.warn(`Slow ${label} (${detail}): ${ms.toFixed(1)} ms`);
            else if (logger_1.ReForgeDBLogger.enabled("debug"))
                logger_1.ReForgeDBLogger.debug(`${label} ${detail} (${ms.toFixed(2)} ms)`);
            return result;
        }
        catch (err) {
            if (err instanceof logger_1.ReForgeDBError)
                throw err;
            logger_1.ReForgeDBLogger.debug(`${label} ${detail} failed after ${(perf_hooks_1.performance.now() - started).toFixed(1)} ms:`, err);
            throw new logger_1.ReForgeDBError(`${label} failed: ${(0, logger_1.errorMessage)(err)}`, err);
        }
    }
    /**
     * With the read cache on, writes to one key run one at a time, so the
     * cache ends up holding the value the database holds. Without it the
     * database orders them and nothing needs to wait.
     */
    static ordered(identifier, task) {
        return DataBase.readCache ? DataBase.locks.run(`record\u0000${identifier}`, task) : task();
    }
    static listening(event) {
        return (DataBase.emitter?.listenerCount(event) ?? 0) > 0;
    }
    /** Emits an event; a listener that throws is logged, never breaks the write. */
    static emit(event, ...args) {
        try {
            ;
            DataBase.emitter?.emit(event, ...args);
        }
        catch (err) {
            logger_1.ReForgeDBLogger.error(`A ${event} listener threw:`, err);
        }
    }
    /**
     * Marks variables of `type`/`name` as changed (unknown: all of them).
     * Only names that have had a leaderboard are counted: bots often build
     * names from IDs (`warn_<user>`), and counting every name ever written
     * would grow without end.
     */
    static touch(type, name) {
        DataBase.writeSeq++;
        if (type !== undefined && name !== undefined) {
            const key = `${type}\u0000${name}`;
            const current = DataBase.generations.get(key);
            if (current !== undefined)
                DataBase.generations.set(key, current + 1);
        }
        else
            DataBase.globalGeneration++;
    }
    /** The change counter of a leaderboard's variable; starts counting it if needed. */
    static generation(type, name) {
        const key = `${type}\u0000${name}`;
        let current = DataBase.generations.get(key);
        if (current === undefined) {
            if (DataBase.generations.size >= MAX_TRACKED_NAMES) {
                // Start over; cached leaderboards are rebuilt once.
                DataBase.generations.clear();
                DataBase.globalGeneration++;
            }
            current = 0;
            DataBase.generations.set(key, current);
        }
        return current;
    }
    /** One record by identifier. */
    static async readRecord(db, identifier) {
        if (!DataBase.sql)
            return (await DataBase.records(db).findOneBy({ identifier }));
        const rows = (await db.query(DataBase.sql.getRecord, [identifier]));
        return rows[0] ? DataBase.entity(rows[0]) : null;
    }
    static entity(record) {
        return Object.assign(new DataBase.entities.Record(), record);
    }
    // ----------------------------------------------------------------- records
    /**
     * The key a variable is stored under. Unchanged from ForgeDB, so existing
     * databases keep working: `<type>_<name>_[<guildId>_]<id>`.
     */
    static make_intetifier(data) {
        return `${data.type}_${data.name}_${isGuildData(data) ? data.guildId + "_" : ""}${data.id}`;
    }
    /** Same as `make_intetifier` (which keeps its misspelled name for compatibility). */
    static makeIdentifier(data) {
        return DataBase.make_intetifier(data);
    }
    static toRecord(data) {
        if (!data || typeof data !== "object")
            throw new logger_1.ReForgeDBError("Expected variable data, got " + typeof data);
        if (typeof data.name !== "string")
            throw new logger_1.ReForgeDBError("A variable needs a name");
        if (!data.type)
            throw new logger_1.ReForgeDBError(`Variable "${data.name}" has no type`);
        const raw = data.value;
        const value = typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : typeof raw === "object" ? JSON.stringify(raw) : String(raw);
        const record = {
            identifier: DataBase.make_intetifier(data),
            name: data.name,
            id: data.id,
            type: data.type,
            value,
            guildId: isGuildData(data) ? data.guildId : undefined,
        };
        if (DataBase.kind === "mysql") {
            for (const [label, text] of [
                ["key", record.identifier],
                ["name", record.name],
                ["ID", record.id],
            ]) {
                if (typeof text === "string" && text.length > MYSQL_MAX_KEY) {
                    throw new logger_1.ReForgeDBError(`The variable ${label} is too long for MySQL (${text.length} characters, at most ${MYSQL_MAX_KEY}): ${text.slice(0, 60)}…`);
                }
            }
        }
        return record;
    }
    static async upsertRecord(db, record) {
        if (DataBase.mongo) {
            await db.getMongoRepository(DataBase.entities.Record).updateOne({ identifier: record.identifier }, { $set: defined(record) }, { upsert: true });
        }
        else if (DataBase.sql) {
            await db.query(DataBase.sql.upsertRecord, row(record, RECORD_COLUMNS));
        }
        else {
            await DataBase.records(db).upsert(record, { conflictPaths: ["identifier"], skipUpdateIfNoValuesChanged: false });
        }
    }
    /**
     * Creates or replaces a variable. One atomic upsert, so concurrent writes
     * to the same new variable never fail. The previous value is only read
     * when a `variableCreate` or `variableUpdate` listener needs it.
     */
    static async set(data) {
        const record = DataBase.toRecord(data);
        const watchCreate = DataBase.listening("variableCreate");
        const watchUpdate = DataBase.listening("variableUpdate");
        await DataBase.ordered(record.identifier, () => DataBase.op("set", record.identifier, async (db) => {
            const old = watchCreate || watchUpdate ? await DataBase.readRecord(db, record.identifier) : null;
            await DataBase.upsertRecord(db, record);
            DataBase.touch(record.type, record.name);
            DataBase.readCache?.set(record.identifier, { ...record });
            if (old) {
                if (watchUpdate)
                    DataBase.emit("variableUpdate", { newData: DataBase.entity(record), oldData: old, event: "variableUpdate" });
            }
            else if (watchCreate)
                DataBase.emit("variableCreate", { data: DataBase.entity(record), event: "variableCreate" });
        }));
    }
    /** Gets a variable, or `null` when it does not exist. */
    static async get(data) {
        const identifier = data.identifier ?? DataBase.make_intetifier(data);
        const hit = DataBase.readCache?.get(identifier);
        if (hit) {
            logger_1.ReForgeDBLogger.trace(`get ${identifier} (cache)`);
            return hit.value ? DataBase.entity(hit.value) : null;
        }
        const seq = DataBase.writeSeq;
        return DataBase.op("get", identifier, async (db) => {
            const found = await DataBase.readRecord(db, identifier);
            // Only cache what no concurrent write may have made stale.
            if (DataBase.readCache && DataBase.writeSeq === seq)
                DataBase.readCache.set(identifier, found ? { ...found } : null);
            return found;
        });
    }
    /** Every stored variable. */
    static async getAll() {
        return DataBase.op("getAll", "*", async (db) => (await DataBase.records(db).find()));
    }
    /**
     * Turns a filter into the database's `where`, plus checks to run on the
     * rows it returns. `LIKE` patterns are normalized (see `normalizeLike`).
     * MongoDB has no `LIKE`: it is sent only the pattern's literal prefix,
     * and the pattern itself is matched here (a regular expression for it
     * could take exponential time on the database server).
     */
    static where(filter) {
        const where = {};
        const checks = [];
        for (const [key, value] of Object.entries(filter)) {
            if (value === undefined)
                continue;
            if (value instanceof typeorm_1.FindOperator && value.type === "like") {
                let pattern;
                try {
                    pattern = (0, primitives_1.normalizeLike)(String(value.value));
                }
                catch (err) {
                    throw new logger_1.ReForgeDBError((0, logger_1.errorMessage)(err));
                }
                if (!DataBase.mongo) {
                    where[key] = (0, typeorm_1.Like)(pattern);
                    continue;
                }
                // With at most one %, the regular expression cannot backtrack
                // more than linearly: the database matches it, in one query.
                if ((pattern.match(/%/g)?.length ?? 0) <= 1) {
                    where[key] = (0, primitives_1.likeRegExp)(pattern);
                    continue;
                }
                const prefix = (0, primitives_1.likePrefix)(pattern);
                if (prefix)
                    where[key] = new RegExp(`^${(0, primitives_1.escapeRegExp)(prefix)}`, "i");
                const matches = (0, primitives_1.likeMatcher)(pattern);
                checks.push((row) => matches(row[key]));
            }
            else if (DataBase.mongo && value instanceof typeorm_1.FindOperator) {
                where[key] = value.type === "in" ? { $in: value.value } : value.value;
            }
            else
                where[key] = value;
        }
        return { where, checks };
    }
    static async findWhere(db, filter) {
        const { where, checks } = DataBase.where(filter);
        const rows = (await DataBase.records(db).find({ where }));
        return checks.length ? rows.filter((row) => checks.every((check) => check(row))) : rows;
    }
    /** Variables whose columns equal the given values (`Like()` operators are allowed). */
    static async find(data) {
        const filter = { ...(data ?? {}) };
        return DataBase.op("find", JSON.stringify(filter), (db) => DataBase.findWhere(db, filter));
    }
    static searchFilter(filter) {
        const where = {};
        if (filter.name !== undefined)
            where.name = (0, typeorm_1.Like)(filter.name);
        if (filter.id !== undefined)
            where.id = filter.id;
        if (filter.type !== undefined)
            where.type = filter.type;
        if (filter.value !== undefined)
            where.value = (0, typeorm_1.Like)(filter.value);
        if (filter.guildId !== undefined)
            where.guildId = filter.guildId;
        return where;
    }
    /** Variables matching a filter, with `LIKE` patterns for name and value. */
    static async search(filter) {
        return DataBase.op("search", JSON.stringify(filter), (db) => DataBase.findWhere(db, DataBase.searchFilter(filter)));
    }
    /** Deletes a variable. `variableDelete` is emitted only when it existed. */
    static async delete(data) {
        const identifier = data.identifier ?? DataBase.make_intetifier(data);
        const watch = DataBase.listening("variableDelete");
        return DataBase.ordered(identifier, () => DataBase.op("delete", identifier, async (db) => {
            const old = watch ? await DataBase.readRecord(db, identifier) : null;
            // Through the repository: it reports how many rows were deleted on every driver.
            const result = await DataBase.records(db).delete({ identifier });
            DataBase.touch(data.identifier ? undefined : data.type, data.identifier ? undefined : data.name);
            DataBase.readCache?.set(identifier, null);
            if (old)
                DataBase.emit("variableDelete", { data: old, event: "variableDelete" });
            return result;
        }));
    }
    /** Deletes the given variables in batches. Returns how many were deleted. */
    static async deleteMany(records) {
        if (!records.length)
            return 0;
        const watch = DataBase.listening("variableDelete");
        return DataBase.op("deleteMany", `${records.length} variables`, async (db) => {
            let affected = 0;
            for (const part of (0, primitives_1.chunk)(records, DELETE_BATCH)) {
                const ids = part.map((r) => r.identifier);
                const result = DataBase.mongo
                    ? await db.getMongoRepository(DataBase.entities.Record).deleteMany({ identifier: { $in: ids } })
                    : await DataBase.records(db).delete({ identifier: (0, typeorm_1.In)(ids) });
                affected += ("deletedCount" in result ? result.deletedCount : result.affected) ?? 0;
                for (const r of part) {
                    DataBase.touch(r.type, r.name);
                    DataBase.readCache?.set(r.identifier, null);
                    if (watch && r.name !== undefined)
                        DataBase.emit("variableDelete", { data: DataBase.entity(r), event: "variableDelete" });
                }
            }
            return affected;
        });
    }
    /**
     * Deletes every variable matching the filter. Without delete listeners
     * this is one query; with them the rows are read first for the events.
     */
    static async deleteMatching(filter) {
        if (!Object.values(filter).some((v) => v !== undefined))
            throw new logger_1.ReForgeDBError("deleteMatching needs at least one filter (use wipe() to delete everything)");
        const { where, checks } = DataBase.where(DataBase.searchFilter(filter));
        // Rows are read first when events need them, or when the database cannot match the filter itself.
        if (DataBase.listening("variableDelete") || checks.length)
            return DataBase.deleteMany(await DataBase.search(filter));
        return DataBase.op("deleteMatching", JSON.stringify(filter), async (db) => {
            const result = DataBase.mongo ? await db.getMongoRepository(DataBase.entities.Record).deleteMany(where) : await DataBase.records(db).delete(where);
            DataBase.touch();
            DataBase.readCache?.clear();
            return ("deletedCount" in result ? result.deletedCount : result.affected) ?? 0;
        });
    }
    /** Deletes every variable (not the cooldowns). */
    static async wipe() {
        return DataBase.op("wipe", "records", async (db) => {
            const result = DataBase.mongo ? await db.getMongoRepository(DataBase.entities.Record).deleteMany({}) : await DataBase.records(db).clear();
            DataBase.touch();
            DataBase.readCache?.clear();
            DataBase.boards.clear();
            return result;
        });
    }
    /**
     * A sorted leaderboard of a variable. Built once and reused for
     * `leaderboardCacheTTL` ms; any write of that variable by this process
     * rebuilds it.
     */
    static async leaderboard(query) {
        const sort = query.sort === "asc" ? "asc" : "desc";
        const q = { type: query.type, name: query.name, guildId: query.guildId, sort };
        const key = JSON.stringify([q.type, q.name, q.guildId ?? null, sort]);
        const generation = DataBase.generation(q.type, q.name);
        const global = DataBase.globalGeneration;
        const cached = DataBase.settings.leaderboardCacheTTL > 0 ? DataBase.boards.get(key) : undefined;
        if (cached && cached.value.generation === generation && cached.value.global === global)
            return cached.value.board;
        const rows = await DataBase.op("leaderboard", key, async (db) => {
            if (DataBase.sql) {
                const params = q.guildId !== undefined ? [q.name, q.type, q.guildId] : [q.name, q.type];
                return (await db.query(q.guildId !== undefined ? DataBase.sql.scanGuild : DataBase.sql.scan, params));
            }
            const where = { name: q.name, type: q.type };
            if (q.guildId !== undefined)
                where.guildId = q.guildId;
            return (await DataBase.records(db).find({ where, select: ["id", "value"] }));
        });
        const entries = [];
        for (const row of rows) {
            const score = (0, primitives_1.rankValue)(row.value);
            if (score !== null && row.id !== null && row.id !== undefined)
                entries.push({ id: String(row.id), value: row.value, score });
        }
        entries.sort(sort === "asc" ? (a, b) => a.score - b.score || (0, primitives_1.compareIds)(a.id, b.id) : (a, b) => b.score - a.score || (0, primitives_1.compareIds)(a.id, b.id));
        const board = new Leaderboard(q, entries);
        if (DataBase.settings.leaderboardCacheTTL > 0)
            DataBase.boards.set(key, { board, generation, global });
        return board;
    }
    // --------------------------------------------------------------- cooldowns
    /** The key a cooldown is stored under. Unchanged from ForgeDB: `<name>[_<id>]`. */
    static make_cdIdentifier(data) {
        return `${data.name}${data.id ? "_" + data.id : ""}`;
    }
    static checkDuration(duration) {
        if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
            throw new logger_1.ReForgeDBError(`A cooldown duration must be a number of milliseconds of 0 or more, got ${JSON.stringify(duration)}`);
        }
        const ms = Math.floor(duration);
        if (!Number.isSafeInteger(Date.now() + ms))
            throw new logger_1.ReForgeDBError(`A cooldown of ${duration} ms is too long`);
        return ms;
    }
    /** Starts (or restarts) a cooldown. */
    static async cdAdd(data) {
        const duration = DataBase.checkDuration(data.duration);
        const identifier = DataBase.make_cdIdentifier(data);
        const cd = { identifier, name: data.name, id: data.id, startedAt: Date.now(), duration };
        const result = await DataBase.op("cooldown add", identifier, async (db) => {
            if (DataBase.mongo)
                await db.getMongoRepository(DataBase.entities.Cooldown).updateOne({ identifier }, { $set: defined(cd) }, { upsert: true });
            else if (DataBase.sql)
                await db.query(DataBase.sql.upsertCooldown, row(cd, COOLDOWN_COLUMNS));
            else
                await DataBase.cooldowns(db).upsert(cd, { conflictPaths: ["identifier"], skipUpdateIfNoValuesChanged: false });
            return cd;
        });
        DataBase.hint(identifier, cd.startedAt + cd.duration);
        return result;
    }
    /** Ends a cooldown. */
    static async cdDelete(identifier) {
        DataBase.cooldownHints.delete(identifier);
        await DataBase.op("cooldown delete", identifier, (db) => DataBase.cooldowns(db).delete({ identifier }));
        DataBase.cooldownHints.delete(identifier);
    }
    /** Remembers when a cooldown runs out, at most 10,000 of them (the oldest are forgotten first). */
    static hint(identifier, endsAt) {
        DataBase.cooldownHints.delete(identifier);
        if (endsAt === null)
            return;
        DataBase.cooldownHints.set(identifier, endsAt);
        if (DataBase.cooldownHints.size > 10_000)
            DataBase.cooldownHints.delete(DataBase.cooldownHints.keys().next().value);
    }
    /** The stored cooldown with `left` (ms remaining, `0` when none or expired). */
    static async cdTimeLeft(identifier) {
        return DataBase.op("cooldown get", identifier, async (db) => {
            const data = DataBase.sql
                ? ((await db.query(DataBase.sql.getCooldown, [identifier]))[0] ?? null)
                : (await DataBase.cooldowns(db).findOneBy({ identifier }));
            if (!data) {
                DataBase.hint(identifier, null);
                return { left: 0 };
            }
            const startedAt = Number(data.startedAt);
            const duration = Number(data.duration);
            DataBase.hint(identifier, startedAt + duration);
            return { ...data, startedAt, duration, left: Math.max(duration - (Date.now() - startedAt), 0) };
        });
    }
    /**
     * Checks a cooldown and starts it when it is not running, as one step:
     * concurrent claims of the same cooldown in this process run one after
     * the other, so only one of them gets through. Returns `0` when the
     * cooldown was started, or the ms left when it was already running.
     */
    static async cdClaim(data) {
        const duration = DataBase.checkDuration(data.duration);
        const identifier = DataBase.make_cdIdentifier(data);
        // Claims in this process queue up here, so they do not race in the
        // database for nothing. Across processes the write below decides.
        return DataBase.locks.run(`cooldown\u0000${identifier}`, async () => {
            // Each claim costs one round trip when the guess below is right:
            // a cooldown that is likely running is read (and the claim ends
            // there), one that is likely free is claimed with one write. A
            // wrong guess costs one more round trip. A few attempts cover a
            // cooldown that runs out, or is deleted, between two statements.
            for (let attempt = 0;; attempt++) {
                const endsAt = DataBase.cooldownHints.get(identifier);
                const likelyFree = DataBase.canClaimFirst && (endsAt === undefined || endsAt <= Date.now());
                if (likelyFree) {
                    const cd = { identifier, name: data.name, id: data.id, startedAt: Date.now(), duration };
                    if (await DataBase.op("cooldown claim", identifier, (db) => DataBase.claimFirst(db, cd))) {
                        DataBase.hint(identifier, cd.startedAt + cd.duration);
                        return 0;
                    }
                    const left = (await DataBase.cdTimeLeft(identifier)).left;
                    if (left > 0 || attempt >= 2)
                        return Math.max(left, 1);
                    continue;
                }
                const current = await DataBase.cdTimeLeft(identifier);
                if (current.left > 0)
                    return current.left;
                const cd = { identifier, name: data.name, id: data.id, startedAt: Date.now(), duration };
                if (await DataBase.op("cooldown claim", identifier, (db) => DataBase.claimInDatabase(db, cd, current.identifier !== undefined))) {
                    DataBase.hint(identifier, cd.startedAt + cd.duration);
                    return 0;
                }
                // Another process started it between the read and the write.
                const left = (await DataBase.cdTimeLeft(identifier)).left;
                // A claim that did not start the cooldown never answers 0 ("started").
                if (left > 0 || attempt >= 2)
                    return Math.max(left, 1);
            }
        });
    }
    /** Whether a claim can be decided by one write on this database. */
    static get canClaimFirst() {
        return DataBase.mongo || !!DataBase.sql?.claimCooldown;
    }
    /**
     * Starts a cooldown with one write if it does not exist or has run out.
     * `true` when this call started it, `false` when it was running.
     */
    static async claimFirst(db, cd) {
        if (DataBase.mongo) {
            // One update pipeline with upsert ($expr is not allowed in an upsert's
            // filter): a missing cooldown is inserted, one that has run out takes
            // the new values, a running one keeps its own. Every expression of a
            // $set stage reads the document as it was, and values go in as
            // $literal, so a name starting with "$" is never read as a field.
            const free = { $lte: [{ $add: [{ $ifNull: ["$startedAt", 0] }, { $ifNull: ["$duration", 0] }] }, cd.startedAt] };
            const take = (field, value) => ({ $cond: [free, { $literal: value }, "$" + field] });
            const fields = { name: take("name", cd.name), startedAt: take("startedAt", cd.startedAt), duration: take("duration", cd.duration) };
            if (cd.id !== undefined)
                fields.id = take("id", cd.id);
            try {
                const result = await db.getMongoRepository(DataBase.entities.Cooldown).updateOne({ identifier: cd.identifier }, [{ $set: fields }], { upsert: true });
                return (result.upsertedCount ?? 0) > 0 || (result.modifiedCount ?? 0) > 0;
            }
            catch (err) {
                // Two first claims at once: the unique index refused the second insert.
                if (err?.code === 11000)
                    return false;
                throw err;
            }
        }
        const runner = db.createQueryRunner();
        try {
            const result = await runner.query(DataBase.sql.claimCooldown, row(cd, COOLDOWN_COLUMNS), true);
            return (result.affected ?? 0) > 0;
        }
        finally {
            await runner.release();
        }
    }
    /**
     * Starts a cooldown only if it is still free in the database: one that
     * exists is restarted only if it has run out, a new one is inserted only
     * if nobody inserted it first. `true` when this call started it.
     */
    static async claimInDatabase(db, cd, existed) {
        if (DataBase.mongo) {
            const repo = db.getMongoRepository(DataBase.entities.Cooldown);
            if (existed) {
                const expired = { $expr: { $lte: [{ $add: ["$startedAt", "$duration"] }, cd.startedAt] } };
                const result = await repo.updateOne({ identifier: cd.identifier, ...expired }, { $set: defined({ startedAt: cd.startedAt, duration: cd.duration, name: cd.name, id: cd.id }) });
                return result.matchedCount === 1;
            }
            try {
                await repo.insertOne(defined(cd));
                return true;
            }
            catch (err) {
                // The unique index refused a second document: someone else was first.
                if (err?.code === 11000)
                    return false;
                throw err;
            }
        }
        if (!DataBase.sql) {
            await DataBase.cooldowns(db).upsert(cd, { conflictPaths: ["identifier"], skipUpdateIfNoValuesChanged: false });
            return true;
        }
        const runner = db.createQueryRunner();
        try {
            const result = existed
                ? await runner.query(DataBase.sql.claimExpiredCooldown, [cd.startedAt, cd.duration, cd.name, cd.id ?? null, cd.identifier, cd.startedAt], true)
                : await runner.query(DataBase.sql.claimNewCooldown, row(cd, COOLDOWN_COLUMNS), true);
            return (result.affected ?? 0) > 0;
        }
        finally {
            await runner.release();
        }
    }
    /** Deletes every cooldown. */
    static async cdWipe() {
        DataBase.cooldownHints.clear();
        const result = await DataBase.op("wipe", "cooldowns", async (db) => (DataBase.mongo ? db.getMongoRepository(DataBase.entities.Cooldown).deleteMany({}) : DataBase.cooldowns(db).clear()));
        DataBase.cooldownHints.clear();
        return result;
    }
    /** Deletes cooldowns that have run out. Returns how many were deleted. */
    static async sweepCooldowns() {
        // With cooldownExpire on, the expiry check deletes each expired
        // cooldown when it fires (or drops) its event; sweeping here would
        // take them away from it.
        if (DataBase.expiryActive)
            return 0;
        const now = Date.now();
        return DataBase.op("cooldown sweep", "expired", async (db) => {
            if (DataBase.mongo) {
                const result = await db.getMongoRepository(DataBase.entities.Cooldown).deleteMany({ $expr: { $lte: [{ $add: ["$startedAt", "$duration"] }, now] } });
                return result.deletedCount ?? 0;
            }
            const esc = (c) => db.driver.escape(c);
            const result = await db
                .createQueryBuilder()
                .delete()
                .from(DataBase.entities.Cooldown)
                .where(`${esc("startedAt")} + ${esc("duration")} <= :now`, { now })
                .execute();
            return result.affected ?? 0;
        });
    }
    static startSweeper() {
        if (DataBase.sweeper)
            clearInterval(DataBase.sweeper);
        DataBase.sweeper = null;
        const every = DataBase.settings.cooldownSweepInterval;
        if (!every)
            return;
        const sweep = () => DataBase.sweepCooldowns()
            .then((n) => n && logger_1.ReForgeDBLogger.debug(`Deleted ${n} expired cooldown(s)`))
            .catch((err) => logger_1.ReForgeDBLogger.warn(`Could not delete expired cooldowns: ${(0, logger_1.errorMessage)(err)}`));
        DataBase.sweeper = setInterval(sweep, every);
        DataBase.sweeper.unref?.();
        setTimeout(sweep, Math.min(every, 5000)).unref?.();
    }
    // ------------------------------------------------------------ cooldownExpire
    static expirer = null;
    static expiring = false;
    /** Whether cooldownExpire is on: something listens to it and the check runs. */
    static get expiryActive() {
        return DataBase.settings.cooldownExpireInterval > 0 && DataBase.listening("cooldownExpire");
    }
    static startExpirer() {
        if (DataBase.expirer)
            clearInterval(DataBase.expirer);
        DataBase.expirer = null;
        const every = DataBase.settings.cooldownExpireInterval;
        if (!every)
            return;
        const tick = () => {
            if (DataBase.expiring || DataBase.closed || !DataBase.expiryActive)
                return;
            DataBase.expiring = true;
            DataBase.expireCooldowns()
                .catch((err) => logger_1.ReForgeDBLogger.warn(`Could not check for expired cooldowns: ${(0, logger_1.errorMessage)(err)}`))
                .finally(() => (DataBase.expiring = false));
        };
        DataBase.expirer = setInterval(tick, every);
        DataBase.expirer.unref?.();
        setTimeout(tick, Math.min(every, 1000)).unref?.();
    }
    /**
     * Fires cooldownExpire for cooldowns that ran out, and deletes them. Each
     * one is claimed with a conditional delete (same identifier, start and
     * duration), so with several processes on one database exactly one fires
     * it, and a cooldown restarted or deleted meanwhile fires nothing. One
     * that ran out more than `cooldownExpireMaxDelay` ago (the bot was off) is
     * deleted without an event. Returns how many were fired and dropped.
     */
    static async expireCooldowns(now = Date.now()) {
        let fired = 0;
        let dropped = 0;
        const maxDelay = DataBase.settings.cooldownExpireMaxDelay;
        for (;;) {
            const due = await DataBase.op("cooldown expire", "due", async (db) => {
                if (DataBase.mongo) {
                    return (await db.getMongoRepository(DataBase.entities.Cooldown).find({ where: { $expr: { $lte: [{ $add: ["$startedAt", "$duration"] }, now] } }, take: EXPIRE_BATCH }));
                }
                const esc = (c) => db.driver.escape(c);
                return (await DataBase.cooldowns(db)
                    .createQueryBuilder("c")
                    .where(`c.${esc("startedAt")} + c.${esc("duration")} <= :now`, { now })
                    .limit(EXPIRE_BATCH)
                    .getMany());
            });
            let claimed = 0;
            for (const row of due) {
                const cd = { identifier: row.identifier, name: row.name, id: row.id ?? null, startedAt: Number(row.startedAt), duration: Number(row.duration) };
                const mine = await DataBase.op("cooldown expire", cd.identifier, async (db) => {
                    if (DataBase.mongo) {
                        const result = await db.getMongoRepository(DataBase.entities.Cooldown).deleteOne({ identifier: cd.identifier, startedAt: cd.startedAt, duration: cd.duration });
                        return (result.deletedCount ?? 0) > 0;
                    }
                    const esc = (c) => db.driver.escape(c);
                    const result = await db
                        .createQueryBuilder()
                        .delete()
                        .from(DataBase.entities.Cooldown)
                        .where(`${esc("identifier")} = :identifier AND ${esc("startedAt")} = :startedAt AND ${esc("duration")} = :duration`, cd)
                        .execute();
                    return (result.affected ?? 0) > 0;
                });
                if (!mine)
                    continue; // another process fired it, or it was restarted or deleted
                claimed++;
                DataBase.cooldownHints.delete(cd.identifier);
                const expiredAt = cd.startedAt + cd.duration;
                if (now - expiredAt > maxDelay) {
                    dropped++;
                    continue;
                }
                fired++;
                logger_1.ReForgeDBLogger.debug(`cooldown ${cd.identifier} ran out ${now - expiredAt} ms ago: cooldownExpire`);
                DataBase.emit("cooldownExpire", { cooldown: { ...cd, expiredAt }, event: "cooldownExpire" });
            }
            // A full batch may have more behind it; a batch that claimed nothing
            // (another process got them all) is left to that process.
            if (due.length < EXPIRE_BATCH || claimed === 0 || DataBase.closed)
                break;
        }
        if (dropped) {
            logger_1.ReForgeDBLogger.info(`Dropped ${dropped} cooldownExpire event(s) of cooldowns that ran out more than ${Math.round(maxDelay / 60_000)} min ago while the bot was offline (cooldownExpireMaxDelay)`);
        }
        return { fired, dropped };
    }
    // ------------------------------------------------------- backup and export
    /**
     * SQLite: writes a consistent copy of the database to `file` while the bot
     * runs (`VACUUM INTO`), and returns its path. Without `file`, the copy goes
     * to `backups/reforge-<date>.db` next to the database. An existing file is
     * never overwritten. On other databases, use `export()` or the database's
     * own tools (pg_dump, mysqldump, mongodump).
     */
    static async backup(file) {
        const path = require("path");
        const fs = require("fs");
        if (DataBase.kind !== "sqlite") {
            throw new logger_1.ReForgeDBError(`backup() copies SQLite files; on ${DataBase.db?.options.type ?? DataBase.kind} use client.db.export() or the database's own backup tool (pg_dump, mysqldump, mongodump)`);
        }
        return DataBase.op("backup", file ?? "default", async (db) => {
            const source = String(db.options.database);
            const target = path.resolve(file ?? path.join(path.dirname(source), "backups", `${path.basename(source, ".db")}-${new Date().toISOString().replace(/[:.]/g, "-")}.db`));
            if (target === path.resolve(source))
                throw new logger_1.ReForgeDBError("A backup cannot be written over the database itself");
            if (fs.existsSync(target))
                throw new logger_1.ReForgeDBError(`${target} already exists; a backup never overwrites a file`);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            await db.query("VACUUM INTO ?", [target]);
            logger_1.ReForgeDBLogger.info(`Backup written to ${target}`);
            return target;
        });
    }
    /**
     * Every variable and cooldown as plain JSON-safe data, for any database.
     * `import()` reads it back, also into another type of database.
     */
    static async export() {
        const [records, cooldowns] = await Promise.all([
            DataBase.op("export", "records", async (db) => (await DataBase.records(db).find())),
            DataBase.op("export", "cooldowns", async (db) => (await DataBase.cooldowns(db).find())),
        ]);
        return {
            format: "reforge.db",
            version: 1,
            exportedAt: new Date().toISOString(),
            source: DataBase.kind,
            records: records.map((r) => ({ identifier: r.identifier, name: r.name, id: r.id ?? null, type: String(r.type), value: r.value, guildId: r.guildId ?? null })),
            cooldowns: cooldowns.map((c) => ({ identifier: c.identifier, name: c.name, id: c.id ?? null, startedAt: Number(c.startedAt), duration: Number(c.duration) })),
        };
    }
    /**
     * Writes data from `export()` (the object or its JSON text) into the
     * database. Existing variables and cooldowns (same identifier) are left as
     * they are unless `overwrite` is true. Everything is checked before the
     * first write, so invalid data writes nothing. Emits no events.
     */
    static async import(input, options = {}) {
        const data = validateExport(input);
        const result = { records: { created: 0, overwritten: 0, skipped: 0 }, cooldowns: { created: 0, overwritten: 0, skipped: 0 } };
        for (const r of data.records) {
            const outcome = await DataBase.op("import", r.identifier, async (db) => {
                const exists = DataBase.mongo
                    ? !!(await db.getMongoRepository(DataBase.entities.Record).findOneBy({ identifier: r.identifier }))
                    : !!(await DataBase.readRecord(db, r.identifier));
                if (exists && !options.overwrite)
                    return "skipped";
                const rowData = { ...r, id: r.id ?? undefined, guildId: r.guildId ?? undefined };
                if (DataBase.mongo)
                    await db.getMongoRepository(DataBase.entities.Record).updateOne({ identifier: r.identifier }, { $set: defined(rowData) }, { upsert: true });
                else if (DataBase.sql)
                    await db.query(DataBase.sql.upsertRecord, row(rowData, RECORD_COLUMNS));
                else
                    await DataBase.records(db).upsert(rowData, { conflictPaths: ["identifier"], skipUpdateIfNoValuesChanged: false });
                return exists ? "overwritten" : "created";
            });
            result.records[outcome]++;
        }
        for (const c of data.cooldowns) {
            const outcome = await DataBase.op("import", c.identifier, async (db) => {
                const exists = !!(await DataBase.cooldowns(db).findOneBy({ identifier: c.identifier }));
                if (exists && !options.overwrite)
                    return "skipped";
                const rowData = { ...c, id: c.id ?? undefined };
                if (DataBase.mongo)
                    await db.getMongoRepository(DataBase.entities.Cooldown).updateOne({ identifier: c.identifier }, { $set: defined(rowData) }, { upsert: true });
                else if (DataBase.sql)
                    await db.query(DataBase.sql.upsertCooldown, row(rowData, COOLDOWN_COLUMNS));
                else
                    await DataBase.cooldowns(db).upsert(rowData, { conflictPaths: ["identifier"], skipUpdateIfNoValuesChanged: false });
                return exists ? "overwritten" : "created";
            });
            result.cooldowns[outcome]++;
        }
        DataBase.clearCache();
        logger_1.ReForgeDBLogger.info(`Imported variables (${result.records.created} new, ${result.records.overwritten} overwritten, ${result.records.skipped} kept) and cooldowns (${result.cooldowns.created} new, ${result.cooldowns.overwritten} overwritten, ${result.cooldowns.skipped} kept)`);
        return result;
    }
    // ------------------------------------------------------------------- other
    /**
     * Runs a raw query (SQL, not available on MongoDB). The read cache is
     * cleared, because the query may change variables.
     */
    static async query(query, parameters) {
        if (DataBase.mongo)
            throw new logger_1.ReForgeDBError("Raw queries are not available on MongoDB");
        return DataBase.op("query", query.slice(0, 120), async (db) => {
            const result = await db.query(query, parameters);
            DataBase.touch();
            DataBase.readCache?.clear();
            return result;
        });
    }
    /** Round trip to the database in ms. */
    static async ping() {
        const db = await DataBase.connection();
        const started = perf_hooks_1.performance.now();
        try {
            if (DataBase.mongo) {
                const driver = db.driver;
                const client = driver.queryRunner?.databaseConnection;
                if (!client)
                    throw new logger_1.ReForgeDBError("MongoDB connection is not open");
                await client.db(driver.database).command({ ping: 1 });
            }
            else
                await db.query("SELECT 1");
        }
        catch (err) {
            if (err instanceof logger_1.ReForgeDBError)
                throw err;
            throw new logger_1.ReForgeDBError(`ping failed: ${(0, logger_1.errorMessage)(err)}`, err);
        }
        return perf_hooks_1.performance.now() - started;
    }
    /**
     * Forgets the cached variables and leaderboards, so the next reads go to
     * the database. Use it after changing the database outside ReForgeDB (a
     * script, a dashboard) when the `cache` option is on.
     */
    static clearCache() {
        DataBase.touch();
        DataBase.readCache?.clear();
        DataBase.boards.clear();
        DataBase.cooldownHints.clear();
    }
    /** Closes the connection and stops background work (retries, cooldown sweep). */
    static async close() {
        DataBase.closed = true;
        if (DataBase.retryTimer)
            clearTimeout(DataBase.retryTimer);
        DataBase.wakeRetry?.();
        if (DataBase.sweeper)
            clearInterval(DataBase.sweeper);
        if (DataBase.expirer)
            clearInterval(DataBase.expirer);
        DataBase.retryTimer = DataBase.sweeper = DataBase.expirer = null;
        DataBase.db = null;
        DataBase.sql = null;
        DataBase.readCache?.clear();
        DataBase.boards.clear();
        DataBase.cooldownHints.clear();
        await databaseManager_1.DataBaseManager.closeAll();
    }
}
exports.DataBase = DataBase;
//# sourceMappingURL=database.js.map