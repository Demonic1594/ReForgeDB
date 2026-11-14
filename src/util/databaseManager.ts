import "reflect-metadata"
import { constants, copyFileSync, existsSync, renameSync } from "fs"
import { join } from "path"
import { DataSource, DataSourceOptions, EntitySchema, MixedList } from "typeorm"
import { DriverKind, driverKind, IReForgeDBOptions, PreviousDatabaseAction } from "./types"
import { ReForgeDBLogger, errorMessage, ReForgeDBError } from "./logger"

/** How long `getDB()` waits for ReForgeDB to be constructed before failing. */
const CONFIG_TIMEOUT = 10_000

/** SQLite files that belong to a database file: rollback journal, write-ahead log and its index. */
const SIDE_FILES = ["-journal", "-wal", "-shm"]

/** Option keys that are ReForgeDB's own and never reach TypeORM. */
const OWN_OPTIONS = new Set([
    "forgeDBFile",
    "events",
    "logLevel",
    "slowQueryThreshold",
    "cache",
    "leaderboardCacheTTL",
    "cooldownSweepInterval",
    "readyTimeout",
    "synchronize",
    "typeorm",
    "folder",
    "wal",
])

let config: IReForgeDBOptions | undefined
const configWaiters: Array<(options: IReForgeDBOptions) => void> = []

/** One connection per database name, shared by every manager that asks for it. */
const connections = new Map<string, Promise<DataSource>>()

function waitForConfig(): Promise<IReForgeDBOptions> {
    if (config) return Promise.resolve(config)
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const i = configWaiters.indexOf(done)
            if (i !== -1) configWaiters.splice(i, 1)
            reject(new ReForgeDBError("Could not find the ReForgeDB configuration: add `new ReForgeDB()` to your client's extensions."))
        }, CONFIG_TIMEOUT)
        timer.unref?.()
        const done = (options: IReForgeDBOptions) => {
            clearTimeout(timer)
            resolve(options)
        }
        configWaiters.push(done)
    })
}

export type EntityList = MixedList<Function | string | EntitySchema>

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
export abstract class DataBaseManager {
    public abstract database: string
    public abstract entityManager: {
        sqlite: EntityList
        mongodb: EntityList
        mysql: EntityList
        postgres: EntityList
    }

    /**
     * SQLite only: the file name this database had before (for example
     * ForgeDB's `forge.db`). See `previousDatabaseAction` for what happens to
     * it when `database` does not exist yet.
     */
    public previousDatabase?: string

    /**
     * What to do with `previousDatabase` when it exists and `database` does
     * not (SQLite only). When both exist, `database` is used.
     *
     * - `use` (default): open the old file where it is; nothing is moved
     * - `copy`: copy it (and its `-journal`, `-wal`, `-shm` files) to
     *   `database` and use the copy; the old file is kept as it was
     * - `rename`: rename it (and its side files) to `database`
     * - `ignore`: create a new, empty `database`; the old file is left alone
     */
    public previousDatabaseAction: PreviousDatabaseAction = "use"

    /** The SQLite file this manager opens, once decided (`database` or `previousDatabase`). */
    #file?: string

    public type?: IReForgeDBOptions["type"]
    public static type: IReForgeDBOptions["type"]

    constructor(options?: IReForgeDBOptions) {
        if (!config && options) {
            // Copy: never change the object the bot passed in.
            config = { ...options, type: options.type ?? "sqlite" } as IReForgeDBOptions
            DataBaseManager.type = config.type
            for (const waiter of configWaiters.splice(0)) waiter(config)
        }
    }

    /** The settings given to `new ReForgeDB()`, once it has been constructed. */
    public static get config(): Readonly<IReForgeDBOptions> | undefined {
        return config
    }

    /** The entity family of the configured database type. */
    public static get kind(): DriverKind {
        return driverKind(config?.type)
    }

    /**
     * Entities to retry with when the database refuses the schema of
     * `entityManager` (for example an index an old MySQL cannot build).
     * Return `undefined` to give up instead.
     */
    protected fallbackEntities(_kind: DriverKind, _error: unknown): EntityList | undefined {
        return undefined
    }

    /** Builds the TypeORM options for this manager's database. */
    #buildOptions(options: IReForgeDBOptions, entities: EntityList): DataSourceOptions {
        const driver: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(options)) if (!OWN_OPTIONS.has(key)) driver[key] = value
        const kind = driverKind(options.type)
        const base: Record<string, unknown> = {
            ...driver,
            entities,
            synchronize: options.synchronize ?? true,
        }
        if (ReForgeDBLogger.enabled("trace")) {
            base.logging = "all"
            base.logger = "simple-console"
        }
        if (kind === "sqlite") {
            const sqlite = options as Extract<IReForgeDBOptions, { type: "sqlite" | "better-sqlite3" }>
            base.database = join(sqlite.folder ?? "database", this.#file ?? this.database)
            if (sqlite.wal !== false) base.enableWAL = true
            if (options.type === "sqlite") base.busyTimeout ??= 5000
            if (options.type === "better-sqlite3") base.timeout ??= 5000
        }
        if (kind === "mysql") base.charset ??= "utf8mb4_general_ci"
        return { ...base, ...(options.typeorm ?? {}) } as unknown as DataSourceOptions
    }

    /** Tuning applied right after a connection opens. */
    async #prepare(db: DataSource, options: IReForgeDBOptions) {
        if (driverKind(options.type) !== "sqlite") return
        const wal = (options as { wal?: boolean }).wal !== false
        try {
            // In WAL mode NORMAL is safe against corruption and only risks the
            // last transactions on a power cut, never on a crash of the bot.
            if (wal) await db.query("PRAGMA synchronous = NORMAL")
            // Leave WAL mode when it was turned off; it persists in the file.
            else await db.query("PRAGMA journal_mode = DELETE")
        } catch (err) {
            ReForgeDBLogger.warn(`Could not tune SQLite for ${this.database}: ${errorMessage(err)}`)
        }
    }

    /**
     * Runs after connecting and before TypeORM synchronizes the schema, for
     * clean-ups the new schema needs (ReForgeDB removes duplicate MongoDB
     * documents before building a unique index). Does nothing by default.
     */
    protected async beforeSynchronize(_db: DataSource): Promise<void> {}

    /**
     * Connects, runs `beforeSynchronize`, then synchronizes. A MariaDB server
     * reached with `type: "mysql"` is switched to the `mariadb` settings: with
     * the `mysql` ones TypeORM misreads MariaDB's column defaults and alters
     * the tables and rebuilds their indexes on every start.
     */
    async #connect(options: IReForgeDBOptions, entities: EntityList): Promise<DataSource> {
        const built = this.#buildOptions(options, entities)
        let db = await new DataSource({ ...built, synchronize: false } as DataSourceOptions).initialize()
        try {
            if ((built.type as string) === "mysql") {
                const rows = (await db.query("SELECT VERSION() AS version")) as Array<{ version?: string }>
                if (/mariadb/i.test(String(rows[0]?.version ?? ""))) {
                    await db.destroy()
                    ReForgeDBLogger.debug(`${this.database}: MariaDB server detected, using the mariadb settings`)
                    db = await new DataSource({ ...built, type: "mariadb", synchronize: false } as DataSourceOptions).initialize()
                }
            }
            await this.beforeSynchronize(db)
            if (built.synchronize) await db.synchronize()
            return db
        } catch (err) {
            if (db.isInitialized) await db.destroy().catch(() => undefined)
            throw err
        }
    }

    /**
     * Decides which SQLite file to open, and copies or renames the previous
     * one when asked to. Side files go first and the database file last, so
     * an interrupted copy or rename is finished on the next start: the new
     * file only exists once everything is in place.
     */
    #chooseFile(options: IReForgeDBOptions) {
        this.#file = this.database
        const previous = this.previousDatabase
        if (!previous || previous === this.database || driverKind(options.type) !== "sqlite") return
        const folder = (options as { folder?: string }).folder ?? "database"
        const from = join(folder, previous)
        const to = join(folder, this.database)
        if (!existsSync(from)) return
        const action = this.previousDatabaseAction
        if (existsSync(to)) {
            if (action !== "ignore") ReForgeDBLogger.warn(`Both ${from} and ${to} exist. Using ${to}; ${from} is left as it is (delete it once you no longer need it).`)
            return
        }
        switch (action) {
            case "ignore":
                ReForgeDBLogger.info(`Not using ${from}: starting a new database in ${to}`)
                return
            case "copy":
            case "rename": {
                const verb = action === "copy" ? "copy" : "rename"
                try {
                    for (const suffix of SIDE_FILES) {
                        if (!existsSync(from + suffix)) continue
                        // A side file of the new name without its database is left over from
                        // an interrupted copy: replace it. An interrupted rename already moved it.
                        if (action === "copy") copyFileSync(from + suffix, to + suffix)
                        else if (!existsSync(to + suffix)) renameSync(from + suffix, to + suffix)
                    }
                    if (action === "copy") copyFileSync(from, to, constants.COPYFILE_EXCL)
                    else renameSync(from, to)
                } catch (err) {
                    throw new ReForgeDBError(`Could not ${verb} ${from} to ${to}: ${errorMessage(err)}. Stop anything that uses the file and start again, or ${verb} it yourself.`, err)
                }
                ReForgeDBLogger.info(action === "copy" ? `Copied ${from} to ${to}; ${from} is kept as it was` : `Renamed ${from} to ${to}`)
                return
            }
            default:
                this.#file = previous
                ReForgeDBLogger.info(`Using ${from}. To move it to ${to}, see the forgeDBFile option.`)
        }
    }

    async #open(options: IReForgeDBOptions): Promise<DataSource> {
        const kind = driverKind(options.type)
        const entities = this.entityManager[kind]
        const started = Date.now()
        this.#chooseFile(options)
        try {
            const db = await this.#connect(options, entities)
            await this.#prepare(db, options)
            ReForgeDBLogger.debug(`Opened ${this.database} (${db.options.type}) in ${Date.now() - started} ms`)
            return db
        } catch (err) {
            const fallback = this.fallbackEntities(kind, err)
            if (!fallback) throw err
            ReForgeDBLogger.warn(`${this.database}: ${errorMessage(err)}. Retrying without it.`)
            const db = await this.#connect(options, fallback)
            await this.#prepare(db, options)
            return db
        }
    }

    /**
     * Returns the connected `DataSource` of this manager's database, opening
     * it on first use. Rejects when the connection fails; call it again to
     * retry.
     */
    protected async getDB(): Promise<DataSource> {
        const options = await waitForConfig()
        this.type = options.type
        DataBaseManager.type = options.type

        const existing = connections.get(this.database)
        if (existing) return existing

        const pending = this.#open(options)
        connections.set(this.database, pending)
        pending.catch(() => {
            if (connections.get(this.database) === pending) connections.delete(this.database)
        })
        return pending
    }

    /** Closes every connection opened through `DataBaseManager`. */
    public static async closeAll() {
        const all = [...connections.values()]
        connections.clear()
        await Promise.allSettled(
            all.map(async (pending) => {
                const db = await pending.catch(() => null)
                if (db?.isInitialized) await db.destroy()
            })
        )
    }

    /** Forgets the configuration and connections. For tests only. */
    public static _reset() {
        config = undefined
        connections.clear()
    }
}
