"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataBaseManager = void 0;
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const types_1 = require("./types");
const logger_1 = require("./logger");
/** How long `getDB()` waits for ReForgeDB to be constructed before failing. */
const CONFIG_TIMEOUT = 10_000;
/** Option keys that are ReForgeDB's own and never reach TypeORM. */
const OWN_OPTIONS = new Set(["events", "logLevel", "slowQueryThreshold", "cache", "leaderboardCacheTTL", "cooldownSweepInterval", "readyTimeout", "synchronize", "typeorm", "folder", "wal"]);
let config;
const configWaiters = [];
/** One connection per database name, shared by every manager that asks for it. */
const connections = new Map();
function waitForConfig() {
    if (config)
        return Promise.resolve(config);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const i = configWaiters.indexOf(done);
            if (i !== -1)
                configWaiters.splice(i, 1);
            reject(new logger_1.ReForgeDBError("Could not find the ReForgeDB configuration: add `new ReForgeDB()` to your client's extensions."));
        }, CONFIG_TIMEOUT);
        timer.unref?.();
        const done = (options) => {
            clearTimeout(timer);
            resolve(options);
        };
        configWaiters.push(done);
    });
}
/**
 * Base class for anything that stores data through ReForgeDB's connection
 * settings: ReForgeDB itself, and other extensions with their own tables.
 *
 * A subclass names its database (`database`, also the SQLite file name) and
 * lists its entities per database type. `getDB()` then returns a connected
 * TypeORM `DataSource` that uses the settings given to `new ReForgeDB()`.
 * Connections are shared by name, and a failed connection is not cached, so
 * calling `getDB()` again retries.
 *
 * The internals are `#private`, so a subclass can name its own methods freely
 * (`connect`, `open`, `prepare`, ...) without replacing them by accident.
 *
 * @example
 * class TicketsDatabase extends DataBaseManager {
 *     database = "tickets.db"
 *     entityManager = { sqlite: [Ticket], mysql: [Ticket], postgres: [Ticket], mongodb: [MongoTicket] }
 *     connect() { return this.getDB() }
 * }
 */
class DataBaseManager {
    type;
    static type;
    constructor(options) {
        if (!config && options) {
            // Copy: never change the object the bot passed in.
            config = { ...options, type: options.type ?? "sqlite" };
            DataBaseManager.type = config.type;
            for (const waiter of configWaiters.splice(0))
                waiter(config);
        }
    }
    /** The settings given to `new ReForgeDB()`, once it has been constructed. */
    static get config() {
        return config;
    }
    /** The entity family of the configured database type. */
    static get kind() {
        return (0, types_1.driverKind)(config?.type);
    }
    /**
     * Entities to retry with when the database refuses the schema of
     * `entityManager` (for example an index an old MySQL cannot build).
     * Return `undefined` to give up instead.
     */
    fallbackEntities(_kind, _error) {
        return undefined;
    }
    /** Builds the TypeORM options for this manager's database. */
    #buildOptions(options, entities) {
        const driver = {};
        for (const [key, value] of Object.entries(options))
            if (!OWN_OPTIONS.has(key))
                driver[key] = value;
        const kind = (0, types_1.driverKind)(options.type);
        const base = {
            ...driver,
            entities,
            synchronize: options.synchronize ?? true,
        };
        if (logger_1.DBLogger.enabled("trace")) {
            base.logging = "all";
            base.logger = "simple-console";
        }
        if (kind === "sqlite") {
            const sqlite = options;
            base.database = `${sqlite.folder ?? "database"}/${this.database}`;
            if (sqlite.wal !== false)
                base.enableWAL = true;
            if (options.type === "sqlite")
                base.busyTimeout ??= 5000;
            if (options.type === "better-sqlite3")
                base.timeout ??= 5000;
        }
        if (kind === "mysql")
            base.charset ??= "utf8mb4_general_ci";
        return { ...base, ...(options.typeorm ?? {}) };
    }
    /** Tuning applied right after a connection opens. */
    async #prepare(db, options) {
        if ((0, types_1.driverKind)(options.type) !== "sqlite")
            return;
        const wal = options.wal !== false;
        try {
            // In WAL mode NORMAL is safe against corruption and only risks the
            // last transactions on a power cut, never on a crash of the bot.
            if (wal)
                await db.query("PRAGMA synchronous = NORMAL");
            // Leave WAL mode when it was turned off; it persists in the file.
            else
                await db.query("PRAGMA journal_mode = DELETE");
        }
        catch (err) {
            logger_1.DBLogger.warn(`Could not tune SQLite for ${this.database}: ${(0, logger_1.errorMessage)(err)}`);
        }
    }
    /**
     * Connects and synchronizes. A MariaDB server reached with `type: "mysql"`
     * is switched to the `mariadb` settings: with the `mysql` ones TypeORM
     * misreads MariaDB's column defaults and alters the tables and rebuilds
     * their indexes on every start.
     */
    async #connect(options, entities) {
        const built = this.#buildOptions(options, entities);
        if (built.type !== "mysql")
            return new typeorm_1.DataSource(built).initialize();
        const db = await new typeorm_1.DataSource({ ...built, synchronize: false }).initialize();
        try {
            const rows = (await db.query("SELECT VERSION() AS version"));
            if (/mariadb/i.test(String(rows[0]?.version ?? ""))) {
                await db.destroy();
                logger_1.DBLogger.debug(`${this.database}: MariaDB server detected, using the mariadb settings`);
                return new typeorm_1.DataSource({ ...built, type: "mariadb" }).initialize();
            }
            if (built.synchronize)
                await db.synchronize();
            return db;
        }
        catch (err) {
            if (db.isInitialized)
                await db.destroy().catch(() => undefined);
            throw err;
        }
    }
    async #open(options) {
        const kind = (0, types_1.driverKind)(options.type);
        const entities = this.entityManager[kind];
        const started = Date.now();
        try {
            const db = await this.#connect(options, entities);
            await this.#prepare(db, options);
            logger_1.DBLogger.debug(`Opened ${this.database} (${db.options.type}) in ${Date.now() - started} ms`);
            return db;
        }
        catch (err) {
            const fallback = this.fallbackEntities(kind, err);
            if (!fallback)
                throw err;
            logger_1.DBLogger.warn(`${this.database}: ${(0, logger_1.errorMessage)(err)}. Retrying without it.`);
            const db = await this.#connect(options, fallback);
            await this.#prepare(db, options);
            return db;
        }
    }
    /**
     * Returns the connected `DataSource` of this manager's database, opening
     * it on first use. Rejects when the connection fails; call it again to
     * retry.
     */
    async getDB() {
        const options = await waitForConfig();
        this.type = options.type;
        DataBaseManager.type = options.type;
        const existing = connections.get(this.database);
        if (existing)
            return existing;
        const pending = this.#open(options);
        connections.set(this.database, pending);
        pending.catch(() => {
            if (connections.get(this.database) === pending)
                connections.delete(this.database);
        });
        return pending;
    }
    /** Closes every connection opened through `DataBaseManager`. */
    static async closeAll() {
        const all = [...connections.values()];
        connections.clear();
        await Promise.allSettled(all.map(async (pending) => {
            const db = await pending.catch(() => null);
            if (db?.isInitialized)
                await db.destroy();
        }));
    }
    /** Forgets the configuration and connections. For tests only. */
    static _reset() {
        config = undefined;
        connections.clear();
    }
}
exports.DataBaseManager = DataBaseManager;
//# sourceMappingURL=databaseManager.js.map