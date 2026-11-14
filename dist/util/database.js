"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataBase = exports.Leaderboard = void 0;
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
    return {
        getRecord: r.get,
        upsertRecord: r.upsert,
        getCooldown: c.get,
        upsertCooldown: c.upsert,
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
    cache: null,
};
function nonNegative(name, value, fallback) {
    if (value === undefined || value === null)
        return fallback;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new logger_1.ReForgeDBError(`Option "${name}" must be a number of 0 or more, got ${JSON.stringify(value)}`);
    }
    return value;
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
        cache,
    };
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
    static boards = new primitives_1.LRUCache(200);
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
        DataBase.boards = new primitives_1.LRUCache(200, DataBase.settings.leaderboardCacheTTL);
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
    /** Marks variables of `type`/`name` as changed (unknown: all of them). */
    static touch(type, name) {
        DataBase.writeSeq++;
        if (type !== undefined && name !== undefined) {
            const key = `${type}\u0000${name}`;
            DataBase.generations.set(key, (DataBase.generations.get(key) ?? 0) + 1);
        }
        else
            DataBase.globalGeneration++;
    }
    static generation(type, name) {
        return DataBase.generations.get(`${type}\u0000${name}`) ?? 0;
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
    /** Converts `Like()` operators for MongoDB, which has no `LIKE`. */
    static where(filter) {
        const where = {};
        for (const [key, value] of Object.entries(filter)) {
            if (value === undefined)
                continue;
            if (DataBase.mongo && value instanceof typeorm_1.FindOperator) {
                if (value.type === "like")
                    where[key] = (0, primitives_1.likeToRegExp)(String(value.value));
                else if (value.type === "in")
                    where[key] = { $in: value.value };
                else
                    where[key] = value.value;
            }
            else
                where[key] = value;
        }
        return where;
    }
    /** Variables whose columns equal the given values (`Like()` operators are allowed). */
    static async find(data) {
        const where = DataBase.where({ ...(data ?? {}) });
        return DataBase.op("find", JSON.stringify(where), async (db) => (await DataBase.records(db).find({ where })));
    }
    static searchWhere(filter) {
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
        return DataBase.where(where);
    }
    /** Variables matching a filter, with `LIKE` patterns for name and value. */
    static async search(filter) {
        const where = DataBase.searchWhere(filter);
        return DataBase.op("search", JSON.stringify(filter), async (db) => (await DataBase.records(db).find({ where })));
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
        if (DataBase.listening("variableDelete"))
            return DataBase.deleteMany(await DataBase.search(filter));
        const where = DataBase.searchWhere(filter);
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
        return DataBase.op("cooldown add", identifier, async (db) => {
            if (DataBase.mongo)
                await db.getMongoRepository(DataBase.entities.Cooldown).updateOne({ identifier }, { $set: defined(cd) }, { upsert: true });
            else if (DataBase.sql)
                await db.query(DataBase.sql.upsertCooldown, row(cd, COOLDOWN_COLUMNS));
            else
                await DataBase.cooldowns(db).upsert(cd, { conflictPaths: ["identifier"], skipUpdateIfNoValuesChanged: false });
            return cd;
        });
    }
    /** Ends a cooldown. */
    static async cdDelete(identifier) {
        await DataBase.op("cooldown delete", identifier, (db) => DataBase.cooldowns(db).delete({ identifier }));
    }
    /** The stored cooldown with `left` (ms remaining, `0` when none or expired). */
    static async cdTimeLeft(identifier) {
        return DataBase.op("cooldown get", identifier, async (db) => {
            const data = DataBase.sql
                ? ((await db.query(DataBase.sql.getCooldown, [identifier]))[0] ?? null)
                : (await DataBase.cooldowns(db).findOneBy({ identifier }));
            if (!data)
                return { left: 0 };
            const startedAt = Number(data.startedAt);
            const duration = Number(data.duration);
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
        DataBase.checkDuration(data.duration);
        const identifier = DataBase.make_cdIdentifier(data);
        return DataBase.locks.run(`cooldown\u0000${identifier}`, async () => {
            const { left } = await DataBase.cdTimeLeft(identifier);
            if (left > 0)
                return left;
            await DataBase.cdAdd(data);
            return 0;
        });
    }
    /** Deletes every cooldown. */
    static async cdWipe() {
        return DataBase.op("wipe", "cooldowns", async (db) => (DataBase.mongo ? db.getMongoRepository(DataBase.entities.Cooldown).deleteMany({}) : DataBase.cooldowns(db).clear()));
    }
    /** Deletes cooldowns that have run out. Returns how many were deleted. */
    static async sweepCooldowns() {
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
    }
    /** Closes the connection and stops background work (retries, cooldown sweep). */
    static async close() {
        DataBase.closed = true;
        if (DataBase.retryTimer)
            clearTimeout(DataBase.retryTimer);
        DataBase.wakeRetry?.();
        if (DataBase.sweeper)
            clearInterval(DataBase.sweeper);
        DataBase.retryTimer = DataBase.sweeper = null;
        DataBase.db = null;
        DataBase.sql = null;
        DataBase.readCache?.clear();
        DataBase.boards.clear();
        await databaseManager_1.DataBaseManager.closeAll();
    }
}
exports.DataBase = DataBase;
//# sourceMappingURL=database.js.map