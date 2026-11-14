import "reflect-metadata"
import { performance } from "perf_hooks"
import { DataSource, DeleteResult, FindOperator, In, Like, ObjectLiteral, Repository } from "typeorm"
import { TypedEmitter } from "tiny-typed-emitter"
import type { IReForgeDBEvents } from "../structures"
import type { TransformEvents } from ".."
import { DataBaseManager, EntityList } from "./databaseManager"
import { ReForgeDBLogger, errorMessage, isLogLevel, ReForgeDBError } from "./logger"
import { chunk, compareIds, escapeRegExp, KeyedMutex, likeMatcher, likePrefix, LRUCache, normalizeLike, rankValue } from "./primitives"
import {
    Cooldown,
    DriverKind,
    driverKind,
    GuildData,
    IReForgeDBOptions,
    MongoCooldown,
    MongoRecord,
    MySQLRecord,
    MySQLRecordWithoutIndex,
    PostgreSQLRecord,
    PreviousDatabaseAction,
    RecordData,
    RecordType,
    SQLCooldown,
    SQLiteRecord,
    StoredRecord,
} from "./types"

type AnyRecord = typeof SQLiteRecord | typeof MongoRecord | typeof MySQLRecord | typeof PostgreSQLRecord | typeof MySQLRecordWithoutIndex
type AnyCooldown = typeof MongoCooldown | typeof Cooldown | typeof SQLCooldown
type Emitter = TypedEmitter<TransformEvents<IReForgeDBEvents>>

/** Longest key MySQL can store in ForgeDB's `varchar(255)` columns. */
const MYSQL_MAX_KEY = 255
/** Rows per `IN (...)` when deleting many records (safe for every driver). */
const DELETE_BATCH = 500
/** Most variable names whose leaderboards are tracked for changes. */
const MAX_TRACKED_NAMES = 10_000
/** Most leaderboard entries kept in memory across all cached leaderboards. */
const MAX_CACHED_ENTRIES = 1_000_000
/** Errors that retrying the connection cannot fix. */
const FATAL_CONNECT_ERRORS = new Set(["DriverPackageNotInstalledError", "MissingDriverError", "DataTypeNotSupportedError", "ColumnTypeUndefinedError"])

function isGuildData(data: RecordData): data is GuildData {
    return data.type === "member" || data.type === "channel" || data.type === "role"
}

/** Drops `undefined` values, which MongoDB would store as `null`. */
function defined<T extends object>(obj: T): T {
    const out = {} as T
    for (const key of Object.keys(obj) as Array<keyof T>) if (obj[key] !== undefined) out[key] = obj[key]
    return out
}

interface Statements {
    getRecord: string
    upsertRecord: string
    getCooldown: string
    upsertCooldown: string
    /** Restarts a cooldown only if it has run out (params: startedAt, duration, name, id, identifier, now). */
    claimExpiredCooldown: string
    /** Starts a cooldown only if no row exists (params: the cooldown columns). */
    claimNewCooldown: string
    /** `id` and `value` of every row of a name and type. */
    scan: string
    /** The same, for one guild. */
    scanGuild: string
}

const RECORD_COLUMNS = ["identifier", "name", "id", "type", "value", "guildId"] as const
const COOLDOWN_COLUMNS = ["identifier", "name", "id", "startedAt", "duration"] as const

/**
 * Plain SQL for the hot paths (get, set, cooldowns, leaderboard scans),
 * built once per connection from TypeORM's metadata, so table prefixes,
 * schemas and naming strategies still apply. TypeORM's repository methods
 * build a query builder on every call, which costs more than the query
 * itself on a fast database. `null` on MongoDB.
 */
function buildStatements(db: DataSource, record: Function, cooldown: Function): Statements | null {
    const kind = driverKind(db.options.type)
    if (kind === "mongodb") return null
    const d = db.driver
    const table = (target: Function, columns: readonly string[]) => {
        const meta = db.getMetadata(target)
        const name = meta.tablePath
            .split(".")
            .map((part) => d.escape(part))
            .join(".")
        const col = (prop: string) => {
            const column = meta.findColumnWithPropertyName(prop)
            if (!column) throw new ReForgeDBError(`Entity ${meta.name} has no column ${prop}`)
            return d.escape(column.databaseName)
        }
        const params = columns.map((_, i) => d.createParameter(`p${i}`, i))
        const select = columns.map((c) => `${col(c)} AS ${d.escape(c)}`).join(", ")
        const insertCols = columns.map(col).join(", ")
        const rest = columns.slice(1)
        const conflict =
            kind === "mysql"
                ? `ON DUPLICATE KEY UPDATE ${rest.map((c) => `${col(c)} = VALUES(${col(c)})`).join(", ")}`
                : `ON CONFLICT (${col("identifier")}) DO UPDATE SET ${rest.map((c) => `${col(c)} = EXCLUDED.${col(c)}`).join(", ")}`
        return {
            name,
            col,
            param: (i: number) => d.createParameter(`p${i}`, i),
            get: `SELECT ${select} FROM ${name} WHERE ${col("identifier")} = ${params[0]}`,
            upsert: `INSERT INTO ${name} (${insertCols}) VALUES (${params.join(", ")}) ${conflict}`,
        }
    }
    const r = table(record, RECORD_COLUMNS)
    const c = table(cooldown, COOLDOWN_COLUMNS)
    const scan = `SELECT ${r.col("id")} AS ${d.escape("id")}, ${r.col("value")} AS ${d.escape("value")} FROM ${r.name} WHERE ${r.col("name")} = ${r.param(0)} AND ${r.col("type")} = ${r.param(1)}`
    const cooldownCols = COOLDOWN_COLUMNS.map(c.col).join(", ")
    const cooldownParams = COOLDOWN_COLUMNS.map((_, i) => c.param(i)).join(", ")
    const claimExpiredCooldown =
        `UPDATE ${c.name} SET ${c.col("startedAt")} = ${c.param(0)}, ${c.col("duration")} = ${c.param(1)}, ${c.col("name")} = ${c.param(2)}, ${c.col("id")} = ${c.param(3)} ` +
        `WHERE ${c.col("identifier")} = ${c.param(4)} AND ${c.col("startedAt")} + ${c.col("duration")} <= ${c.param(5)}`
    const claimNewCooldown =
        kind === "mysql"
            ? `INSERT IGNORE INTO ${c.name} (${cooldownCols}) VALUES (${cooldownParams})`
            : `INSERT INTO ${c.name} (${cooldownCols}) VALUES (${cooldownParams}) ON CONFLICT (${c.col("identifier")}) DO NOTHING`
    return {
        getRecord: r.get,
        upsertRecord: r.upsert,
        getCooldown: c.get,
        upsertCooldown: c.upsert,
        claimExpiredCooldown,
        claimNewCooldown,
        scan,
        scanGuild: `${scan} AND ${r.col("guildId")} = ${r.param(2)}`,
    }
}

/** Values in column order for a raw query; drivers reject `undefined`. */
function row(obj: Record<string, unknown>, columns: readonly string[]) {
    return columns.map((c) => (obj[c] === undefined ? null : obj[c]))
}

export interface SearchFilter {
    /** `LIKE` pattern for the variable name (`%` any text, `_` one character). */
    name?: string
    /** Exact ID. */
    id?: string
    /** Exact variable type. */
    type?: RecordType
    /** `LIKE` pattern for the value. */
    value?: string
    /** Exact guild ID. */
    guildId?: string
}

export interface LeaderboardQuery {
    type: RecordType
    name: string
    /** Only rows of this guild (member, channel and role variables). */
    guildId?: string
    /** Defaults to `desc` (highest first). */
    sort?: "asc" | "desc"
}

export interface LeaderboardEntry {
    /** The user, member, guild or channel ID. */
    id: string
    /** The stored value. */
    value: string
    /** The value as a number. */
    score: number
}

/**
 * A sorted leaderboard. Only values that are numbers take part; ties are
 * broken by ID (lowest first), so positions are the same in every function.
 */
export class Leaderboard {
    private index: Map<string, number> | null = null

    constructor(
        public readonly query: Readonly<LeaderboardQuery>,
        public readonly entries: readonly LeaderboardEntry[]
    ) {}

    get count() {
        return this.entries.length
    }

    /** 1-based position of an ID, or `0` when it is not on the leaderboard. */
    positionOf(id: string | undefined | null) {
        if (!id) return 0
        if (!this.index) {
            this.index = new Map()
            for (let i = 0; i < this.entries.length; i++) this.index.set(this.entries[i].id, i + 1)
        }
        return this.index.get(id) ?? 0
    }

    /** The entries of a page (1-based), `perPage` per page. */
    page(page: number, perPage: number) {
        const start = (page - 1) * perPage
        return { start, entries: this.entries.slice(start, start + perPage) }
    }
}

interface Settings {
    slowQueryThreshold: number
    readyTimeout: number
    leaderboardCacheTTL: number
    cooldownSweepInterval: number
    cache: { max: number; ttl: number } | null
}

const DEFAULT_SETTINGS: Settings = {
    slowQueryThreshold: 1000,
    readyTimeout: 30_000,
    leaderboardCacheTTL: 2000,
    cooldownSweepInterval: 3_600_000,
    cache: null,
}

function nonNegative(name: string, value: unknown, fallback: number): number {
    if (value === undefined || value === null) return fallback
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new ReForgeDBError(`Option "${name}" must be a number of 0 or more, got ${JSON.stringify(value)}`)
    }
    return value
}

/** Validates the options of `new ReForgeDB()` and returns the resolved settings. */
export function resolveSettings(options: IReForgeDBOptions | undefined): Settings {
    const o = (options ?? {}) as IReForgeDBOptions
    const type = (o as { type?: string }).type
    if (type !== undefined && !["sqlite", "better-sqlite3", "mysql", "mariadb", "postgres", "mongodb"].includes(type)) {
        throw new ReForgeDBError(`Unknown database type "${type}". Use sqlite, better-sqlite3, mysql, mariadb, postgres or mongodb.`)
    }
    if (type === "mongodb" && !(o as { url?: string }).url && !(o as { host?: string }).host) {
        throw new ReForgeDBError(`The mongodb type needs a "url" (for example mongodb://localhost:27017/bot).`)
    }
    if (o.logLevel !== undefined && !isLogLevel(o.logLevel)) {
        throw new ReForgeDBError(`Unknown logLevel "${o.logLevel}". Use silent, error, warn, info, debug or trace.`)
    }
    if (o.events !== undefined && !Array.isArray(o.events)) throw new ReForgeDBError(`Option "events" must be an array of event names.`)
    const forgeDBFile = (o as { forgeDBFile?: unknown }).forgeDBFile
    if (forgeDBFile !== undefined && !["use", "copy", "rename", "ignore"].includes(forgeDBFile as string)) {
        throw new ReForgeDBError(`Unknown forgeDBFile "${String(forgeDBFile)}". Use use, copy, rename or ignore.`)
    }
    let cache: Settings["cache"] = null
    if (o.cache) {
        const c = o.cache === true ? {} : o.cache
        const max = nonNegative("cache.max", c.max, 10_000)
        if (max < 1) throw new ReForgeDBError(`Option "cache.max" must be at least 1.`)
        cache = { max: Math.floor(max), ttl: nonNegative("cache.ttl", c.ttl, 0) }
    }
    return {
        slowQueryThreshold: nonNegative("slowQueryThreshold", o.slowQueryThreshold, DEFAULT_SETTINGS.slowQueryThreshold),
        readyTimeout: nonNegative("readyTimeout", o.readyTimeout, DEFAULT_SETTINGS.readyTimeout),
        leaderboardCacheTTL: nonNegative("leaderboardCacheTTL", o.leaderboardCacheTTL, DEFAULT_SETTINGS.leaderboardCacheTTL),
        cooldownSweepInterval: nonNegative("cooldownSweepInterval", o.cooldownSweepInterval, DEFAULT_SETTINGS.cooldownSweepInterval),
        cache,
    }
}

/**
 * ReForgeDB's storage: variables ("records") and cooldowns. Everything is
 * static, and the bot's client exposes the class as `client.db`.
 *
 * Every method waits for the connection (up to `readyTimeout`), so calling
 * one while the database is still connecting is safe. Failures are thrown as
 * `ReForgeDBError` with the driver's message.
 */
export class DataBase extends DataBaseManager {
    /** The SQLite file, in the `folder` option (`database/reforge.db` by default). */
    public database = "reforge.db"
    /** ForgeDB's file name; the `forgeDBFile` option says what happens to it. */
    public override previousDatabase = "forge.db"

    public entityManager = {
        sqlite: [SQLiteRecord, Cooldown],
        mongodb: [MongoRecord, MongoCooldown],
        mysql: [MySQLRecord, SQLCooldown],
        postgres: [PostgreSQLRecord, SQLCooldown],
    }

    private static entities: { Record: AnyRecord; Cooldown: AnyCooldown } = { Record: SQLiteRecord, Cooldown }
    private static db: DataSource | null = null
    private static sql: Statements | null = null
    private static emitter: Emitter | null = null
    private static settings: Settings = { ...DEFAULT_SETTINGS }
    private static fatal: ReForgeDBError | null = null
    private static lastError: unknown = null
    private static closed = false
    private static waiters = new Set<{ resolve: () => void; reject: (e: unknown) => void }>()
    private static retryTimer: NodeJS.Timeout | null = null
    private static wakeRetry: (() => void) | null = null
    private static sweeper: NodeJS.Timeout | null = null

    private static readCache: LRUCache<string, StoredRecord | null> | null = null
    private static boards = new LRUCache<string, { board: Leaderboard; generation: number; global: number }>(200, 0, MAX_CACHED_ENTRIES, (v) => v.board.count + 1)
    private static generations = new Map<string, number>()
    private static globalGeneration = 0
    private static writeSeq = 0
    private static readonly locks = new KeyedMutex()

    constructor(emitter: Emitter, options?: IReForgeDBOptions) {
        super(options ?? { type: "sqlite" })
        this.previousDatabaseAction = (DataBaseManager.config as { forgeDBFile?: PreviousDatabaseAction } | undefined)?.forgeDBFile ?? "use"
        DataBase.emitter = emitter
        DataBase.configure(options)
    }

    /** Applies the options of `new ReForgeDB()`. */
    private static configure(options: IReForgeDBOptions | undefined) {
        DataBase.settings = resolveSettings(options)
        if (options?.logLevel) ReForgeDBLogger.level = options.logLevel
        const c = DataBase.settings.cache
        DataBase.readCache = c ? new LRUCache(c.max, c.ttl) : null
        DataBase.boards = new LRUCache(200, DataBase.settings.leaderboardCacheTTL, MAX_CACHED_ENTRIES, (v) => v.board.count + 1)
    }

    protected override fallbackEntities(kind: DriverKind, error: unknown): EntityList | undefined {
        const e = error as { code?: string; errno?: number }
        if (kind === "mysql" && (e?.code === "ER_TOO_LONG_KEY" || e?.errno === 1071)) {
            ReForgeDBLogger.warn("This MySQL server cannot index the variable names (keys are limited to 767 bytes). Leaderboards and searches will scan the table.")
            return [MySQLRecordWithoutIndex, SQLCooldown]
        }
        return undefined
    }

    /**
     * MongoDB: removes duplicate documents of one key before the unique key
     * indexes are built. ForgeDB read and then wrote, so two first writes at
     * the same moment could both insert. The document kept is the first one
     * in the collection's natural order: the one ForgeDB read and updated.
     */
    protected override async beforeSynchronize(db: DataSource) {
        if (driverKind(db.options.type) !== "mongodb") return
        for (const target of [MongoRecord, MongoCooldown]) {
            const groups = (await db.mongoManager
                .aggregate(target, [{ $group: { _id: "$identifier", ids: { $push: "$_id" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }], { allowDiskUse: true })
                .toArray()) as Array<{ _id: string; ids: unknown[] }>
            if (!groups.length) continue
            const extra = groups.flatMap((g) => g.ids.slice(1))
            for (const part of chunk(extra, DELETE_BATCH)) await db.mongoManager.deleteMany(target, { _id: { $in: part } } as never)
            ReForgeDBLogger.warn(`Removed ${extra.length} duplicate document(s) of ${groups.length} key(s) from ${db.getMetadata(target).tableName}, keeping the first of each`)
        }
    }

    /**
     * Connects, retrying with backoff (1 s, doubling up to 60 s) while the
     * database is unreachable. Never rejects: functions wait for the
     * connection, and fail with a clear error after `readyTimeout`.
     */
    public async init(): Promise<void> {
        DataBase.closed = false
        for (let attempt = 0; !DataBase.closed; attempt++) {
            try {
                const db = await this.getDB()
                if (DataBase.closed) {
                    await db.destroy().catch(() => undefined)
                    return
                }
                DataBase.attach(db)
                const type = db.options.type
                if (attempt) ReForgeDBLogger.info(`Connected to ${type} after ${attempt + 1} attempts`)
                else ReForgeDBLogger.info(`Connected to ${type}`)
                DataBase.emit("connect")
                return
            } catch (err) {
                DataBase.lastError = err
                const name = (err as Error)?.name
                if (FATAL_CONNECT_ERRORS.has(name) || err instanceof ReForgeDBError) {
                    DataBase.fail(new ReForgeDBError(`Cannot use the database: ${errorMessage(err)}`, err))
                    ReForgeDBLogger.error(`Cannot use the database: ${errorMessage(err)}`)
                    return
                }
                const wait = Math.min(1000 * 2 ** attempt, 60_000)
                ReForgeDBLogger.error(`Could not connect to the database (attempt ${attempt + 1}), retrying in ${wait / 1000}s: ${errorMessage(err)}`)
                ReForgeDBLogger.debug(err)
                await new Promise<void>((resolve) => {
                    DataBase.wakeRetry = resolve
                    DataBase.retryTimer = setTimeout(resolve, wait)
                })
                DataBase.retryTimer = DataBase.wakeRetry = null
            }
        }
    }

    private static attach(db: DataSource) {
        const kind = driverKind(db.options.type)
        DataBase.db = db
        DataBase.fatal = null
        DataBase.lastError = null
        const recordTarget = db.entityMetadatas.find((m) => m.tableName === (kind === "mongodb" ? "mongo_record" : "record"))?.target as AnyRecord | undefined
        DataBase.entities = {
            Record: recordTarget ?? (kind === "mongodb" ? MongoRecord : kind === "mysql" ? MySQLRecord : kind === "postgres" ? PostgreSQLRecord : SQLiteRecord),
            Cooldown: kind === "mongodb" ? MongoCooldown : kind === "sqlite" ? Cooldown : SQLCooldown,
        }
        try {
            DataBase.sql = buildStatements(db, DataBase.entities.Record, DataBase.entities.Cooldown)
        } catch (err) {
            // Slower, but always correct: go through TypeORM's repositories.
            DataBase.sql = null
            ReForgeDBLogger.debug("Could not prepare the fast statements, using repositories:", err)
        }
        for (const w of DataBase.waiters) w.resolve()
        DataBase.waiters.clear()
        DataBase.startSweeper()
    }

    private static fail(error: ReForgeDBError) {
        DataBase.fatal = error
        for (const w of DataBase.waiters) w.reject(error)
        DataBase.waiters.clear()
    }

    /** Whether the database is connected. */
    public static get connected() {
        return !!DataBase.db?.isInitialized
    }

    /** The entity family in use: `sqlite`, `mysql`, `postgres` or `mongodb`. */
    public static override get kind(): DriverKind {
        return driverKind(DataBase.db?.options.type ?? DataBaseManager.config?.type)
    }

    /** The TypeORM `DataSource`, or `null` before the connection is made. */
    public static get dataSource() {
        return DataBase.db
    }

    /**
     * Resolves once the database is connected. Rejects after `timeout` ms
     * (the `readyTimeout` option by default) or when the database cannot be
     * used at all (for example a missing driver package).
     */
    public static ready(timeout = DataBase.settings.readyTimeout): Promise<void> {
        if (DataBase.db) return Promise.resolve()
        if (DataBase.fatal) return Promise.reject(DataBase.fatal)
        return new Promise<void>((resolve, reject) => {
            const waiter = {
                resolve: () => {
                    clearTimeout(timer)
                    resolve()
                },
                reject: (e: unknown) => {
                    clearTimeout(timer)
                    reject(e)
                },
            }
            const timer = setTimeout(() => {
                DataBase.waiters.delete(waiter)
                const last = DataBase.lastError ? ` Last error: ${errorMessage(DataBase.lastError)}` : ""
                reject(new ReForgeDBError(`The database is not connected yet (waited ${timeout} ms).${last}`))
            }, timeout)
            timer.unref?.()
            DataBase.waiters.add(waiter)
        })
    }

    private static async connection(): Promise<DataSource> {
        if (DataBase.db) return DataBase.db
        await DataBase.ready()
        return DataBase.db!
    }

    private static records(db: DataSource): Repository<ObjectLiteral> {
        return db.getRepository(DataBase.entities.Record)
    }

    private static cooldowns(db: DataSource): Repository<ObjectLiteral> {
        return db.getRepository(DataBase.entities.Cooldown)
    }

    private static get mongo() {
        return DataBase.kind === "mongodb"
    }

    /** Runs a database operation with timing, debug logging and error wrapping. */
    private static async op<T>(label: string, detail: string, run: (db: DataSource) => Promise<T>): Promise<T> {
        const db = DataBase.db ?? (await DataBase.connection())
        const started = performance.now()
        try {
            const result = await run(db)
            const ms = performance.now() - started
            const slow = DataBase.settings.slowQueryThreshold
            if (slow > 0 && ms >= slow) ReForgeDBLogger.warn(`Slow ${label} (${detail}): ${ms.toFixed(1)} ms`)
            else if (ReForgeDBLogger.enabled("debug")) ReForgeDBLogger.debug(`${label} ${detail} (${ms.toFixed(2)} ms)`)
            return result
        } catch (err) {
            if (err instanceof ReForgeDBError) throw err
            ReForgeDBLogger.debug(`${label} ${detail} failed after ${(performance.now() - started).toFixed(1)} ms:`, err)
            throw new ReForgeDBError(`${label} failed: ${errorMessage(err)}`, err)
        }
    }

    /**
     * With the read cache on, writes to one key run one at a time, so the
     * cache ends up holding the value the database holds. Without it the
     * database orders them and nothing needs to wait.
     */
    private static ordered<T>(identifier: string, task: () => Promise<T>): Promise<T> {
        return DataBase.readCache ? DataBase.locks.run(`record\u0000${identifier}`, task) : task()
    }

    private static listening(event: keyof IReForgeDBEvents) {
        return (DataBase.emitter?.listenerCount(event) ?? 0) > 0
    }

    /** Emits an event; a listener that throws is logged, never breaks the write. */
    private static emit<K extends keyof IReForgeDBEvents>(event: K, ...args: IReForgeDBEvents[K]) {
        try {
            ;(DataBase.emitter as unknown as { emit(e: string, ...a: unknown[]): boolean } | null)?.emit(event, ...args)
        } catch (err) {
            ReForgeDBLogger.error(`A ${event} listener threw:`, err)
        }
    }

    /**
     * Marks variables of `type`/`name` as changed (unknown: all of them).
     * Only names that have had a leaderboard are counted: bots often build
     * names from IDs (`warn_<user>`), and counting every name ever written
     * would grow without end.
     */
    private static touch(type?: string, name?: string) {
        DataBase.writeSeq++
        if (type !== undefined && name !== undefined) {
            const key = `${type}\u0000${name}`
            const current = DataBase.generations.get(key)
            if (current !== undefined) DataBase.generations.set(key, current + 1)
        } else DataBase.globalGeneration++
    }

    /** The change counter of a leaderboard's variable; starts counting it if needed. */
    private static generation(type: string, name: string) {
        const key = `${type}\u0000${name}`
        let current = DataBase.generations.get(key)
        if (current === undefined) {
            if (DataBase.generations.size >= MAX_TRACKED_NAMES) {
                // Start over; cached leaderboards are rebuilt once.
                DataBase.generations.clear()
                DataBase.globalGeneration++
            }
            current = 0
            DataBase.generations.set(key, current)
        }
        return current
    }

    /** One record by identifier. */
    private static async readRecord(db: DataSource, identifier: string): Promise<SQLiteRecord | null> {
        if (!DataBase.sql) return (await DataBase.records(db).findOneBy({ identifier })) as SQLiteRecord | null
        const rows = (await db.query(DataBase.sql.getRecord, [identifier])) as StoredRecord[]
        return rows[0] ? DataBase.entity(rows[0]) : null
    }

    private static entity(record: StoredRecord) {
        return Object.assign(new DataBase.entities.Record(), record) as SQLiteRecord
    }

    // ----------------------------------------------------------------- records

    /**
     * The key a variable is stored under. Unchanged from ForgeDB, so existing
     * databases keep working: `<type>_<name>_[<guildId>_]<id>`.
     */
    public static make_intetifier(data: RecordData) {
        return `${data.type}_${data.name}_${isGuildData(data) ? data.guildId + "_" : ""}${data.id}`
    }

    /** Same as `make_intetifier` (which keeps its misspelled name for compatibility). */
    public static makeIdentifier(data: RecordData) {
        return DataBase.make_intetifier(data)
    }

    private static toRecord(data: RecordData): StoredRecord {
        if (!data || typeof data !== "object") throw new ReForgeDBError("Expected variable data, got " + typeof data)
        if (typeof data.name !== "string") throw new ReForgeDBError("A variable needs a name")
        if (!data.type) throw new ReForgeDBError(`Variable "${data.name}" has no type`)
        const raw = data.value as unknown
        const value = typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : typeof raw === "object" ? JSON.stringify(raw) : String(raw)
        const record: StoredRecord = {
            identifier: DataBase.make_intetifier(data),
            name: data.name,
            id: data.id as string,
            type: data.type,
            value,
            guildId: isGuildData(data) ? data.guildId : undefined,
        }
        if (DataBase.kind === "mysql") {
            for (const [label, text] of [
                ["key", record.identifier],
                ["name", record.name],
                ["ID", record.id],
            ] as const) {
                if (typeof text === "string" && text.length > MYSQL_MAX_KEY) {
                    throw new ReForgeDBError(`The variable ${label} is too long for MySQL (${text.length} characters, at most ${MYSQL_MAX_KEY}): ${text.slice(0, 60)}…`)
                }
            }
        }
        return record
    }

    private static async upsertRecord(db: DataSource, record: StoredRecord) {
        if (DataBase.mongo) {
            await db.getMongoRepository(DataBase.entities.Record).updateOne({ identifier: record.identifier }, { $set: defined(record) }, { upsert: true })
        } else if (DataBase.sql) {
            await db.query(DataBase.sql.upsertRecord, row(record, RECORD_COLUMNS))
        } else {
            await DataBase.records(db).upsert(record, { conflictPaths: ["identifier"], skipUpdateIfNoValuesChanged: false })
        }
    }

    /**
     * Creates or replaces a variable. One atomic upsert, so concurrent writes
     * to the same new variable never fail. The previous value is only read
     * when a `variableCreate` or `variableUpdate` listener needs it.
     */
    public static async set(data: RecordData): Promise<void> {
        const record = DataBase.toRecord(data)
        const watchCreate = DataBase.listening("variableCreate")
        const watchUpdate = DataBase.listening("variableUpdate")
        await DataBase.ordered(record.identifier, () =>
            DataBase.op("set", record.identifier, async (db) => {
                const old = watchCreate || watchUpdate ? await DataBase.readRecord(db, record.identifier) : null
                await DataBase.upsertRecord(db, record)
                DataBase.touch(record.type, record.name)
                DataBase.readCache?.set(record.identifier, { ...record })
                if (old) {
                    if (watchUpdate) DataBase.emit("variableUpdate", { newData: DataBase.entity(record), oldData: old, event: "variableUpdate" })
                } else if (watchCreate) DataBase.emit("variableCreate", { data: DataBase.entity(record), event: "variableCreate" })
            })
        )
    }

    /** Gets a variable, or `null` when it does not exist. */
    public static async get(data: RecordData): Promise<SQLiteRecord | null> {
        const identifier = data.identifier ?? DataBase.make_intetifier(data)
        const hit = DataBase.readCache?.get(identifier)
        if (hit) {
            ReForgeDBLogger.trace(`get ${identifier} (cache)`)
            return hit.value ? DataBase.entity(hit.value) : null
        }
        const seq = DataBase.writeSeq
        return DataBase.op("get", identifier, async (db) => {
            const found = await DataBase.readRecord(db, identifier)
            // Only cache what no concurrent write may have made stale.
            if (DataBase.readCache && DataBase.writeSeq === seq) DataBase.readCache.set(identifier, found ? { ...(found as StoredRecord) } : null)
            return found
        })
    }

    /** Every stored variable. */
    public static async getAll(): Promise<SQLiteRecord[]> {
        return DataBase.op("getAll", "*", async (db) => (await DataBase.records(db).find()) as SQLiteRecord[])
    }

    /**
     * Turns a filter into the database's `where`, plus checks to run on the
     * rows it returns. `LIKE` patterns are normalized (see `normalizeLike`).
     * MongoDB has no `LIKE`: it is sent only the pattern's literal prefix,
     * and the pattern itself is matched here (a regular expression for it
     * could take exponential time on the database server).
     */
    private static where(filter: Record<string, unknown>): { where: Record<string, unknown>; checks: Array<(row: Record<string, unknown>) => boolean> } {
        const where: Record<string, unknown> = {}
        const checks: Array<(row: Record<string, unknown>) => boolean> = []
        for (const [key, value] of Object.entries(filter)) {
            if (value === undefined) continue
            if (value instanceof FindOperator && value.type === "like") {
                let pattern: string
                try {
                    pattern = normalizeLike(String(value.value))
                } catch (err) {
                    throw new ReForgeDBError(errorMessage(err))
                }
                if (!DataBase.mongo) {
                    where[key] = Like(pattern)
                    continue
                }
                const prefix = likePrefix(pattern)
                if (prefix) where[key] = new RegExp(`^${escapeRegExp(prefix)}`, "i")
                const matches = likeMatcher(pattern)
                checks.push((row) => matches(row[key]))
            } else if (DataBase.mongo && value instanceof FindOperator) {
                where[key] = value.type === "in" ? { $in: value.value } : value.value
            } else where[key] = value
        }
        return { where, checks }
    }

    private static async findWhere(db: DataSource, filter: Record<string, unknown>) {
        const { where, checks } = DataBase.where(filter)
        const rows = (await DataBase.records(db).find({ where })) as SQLiteRecord[]
        return checks.length ? rows.filter((row) => checks.every((check) => check(row as unknown as Record<string, unknown>))) : rows
    }

    /** Variables whose columns equal the given values (`Like()` operators are allowed). */
    public static async find(data?: RecordData | Record<string, unknown>): Promise<SQLiteRecord[]> {
        const filter = { ...(data ?? {}) } as Record<string, unknown>
        return DataBase.op("find", JSON.stringify(filter), (db) => DataBase.findWhere(db, filter))
    }

    private static searchFilter(filter: SearchFilter) {
        const where: Record<string, unknown> = {}
        if (filter.name !== undefined) where.name = Like(filter.name)
        if (filter.id !== undefined) where.id = filter.id
        if (filter.type !== undefined) where.type = filter.type
        if (filter.value !== undefined) where.value = Like(filter.value)
        if (filter.guildId !== undefined) where.guildId = filter.guildId
        return where
    }

    /** Variables matching a filter, with `LIKE` patterns for name and value. */
    public static async search(filter: SearchFilter): Promise<SQLiteRecord[]> {
        return DataBase.op("search", JSON.stringify(filter), (db) => DataBase.findWhere(db, DataBase.searchFilter(filter)))
    }

    /** Deletes a variable. `variableDelete` is emitted only when it existed. */
    public static async delete(data: RecordData): Promise<DeleteResult> {
        const identifier = data.identifier ?? DataBase.make_intetifier(data)
        const watch = DataBase.listening("variableDelete")
        return DataBase.ordered(identifier, () =>
            DataBase.op("delete", identifier, async (db) => {
                const old = watch ? await DataBase.readRecord(db, identifier) : null
                // Through the repository: it reports how many rows were deleted on every driver.
                const result = await DataBase.records(db).delete({ identifier })
                DataBase.touch(data.identifier ? undefined : data.type, data.identifier ? undefined : data.name)
                DataBase.readCache?.set(identifier, null)
                if (old) DataBase.emit("variableDelete", { data: old, event: "variableDelete" })
                return result
            })
        )
    }

    /** Deletes the given variables in batches. Returns how many were deleted. */
    public static async deleteMany(records: Array<Pick<StoredRecord, "identifier"> & Partial<StoredRecord>>): Promise<number> {
        if (!records.length) return 0
        const watch = DataBase.listening("variableDelete")
        return DataBase.op("deleteMany", `${records.length} variables`, async (db) => {
            let affected = 0
            for (const part of chunk(records, DELETE_BATCH)) {
                const ids = part.map((r) => r.identifier)
                const result = DataBase.mongo
                    ? await db.getMongoRepository(DataBase.entities.Record).deleteMany({ identifier: { $in: ids } })
                    : await DataBase.records(db).delete({ identifier: In(ids) })
                affected += ("deletedCount" in result ? result.deletedCount : (result as DeleteResult).affected) ?? 0
                for (const r of part) {
                    DataBase.touch(r.type, r.name)
                    DataBase.readCache?.set(r.identifier, null)
                    if (watch && r.name !== undefined) DataBase.emit("variableDelete", { data: DataBase.entity(r as StoredRecord), event: "variableDelete" })
                }
            }
            return affected
        })
    }

    /**
     * Deletes every variable matching the filter. Without delete listeners
     * this is one query; with them the rows are read first for the events.
     */
    public static async deleteMatching(filter: SearchFilter): Promise<number> {
        if (!Object.values(filter).some((v) => v !== undefined)) throw new ReForgeDBError("deleteMatching needs at least one filter (use wipe() to delete everything)")
        const { where, checks } = DataBase.where(DataBase.searchFilter(filter))
        // Rows are read first when events need them, or when the database cannot match the filter itself.
        if (DataBase.listening("variableDelete") || checks.length) return DataBase.deleteMany(await DataBase.search(filter))
        return DataBase.op("deleteMatching", JSON.stringify(filter), async (db) => {
            const result = DataBase.mongo ? await db.getMongoRepository(DataBase.entities.Record).deleteMany(where) : await DataBase.records(db).delete(where)
            DataBase.touch()
            DataBase.readCache?.clear()
            return ("deletedCount" in result ? result.deletedCount : (result as DeleteResult).affected) ?? 0
        })
    }

    /** Deletes every variable (not the cooldowns). */
    public static async wipe() {
        return DataBase.op("wipe", "records", async (db) => {
            const result = DataBase.mongo ? await db.getMongoRepository(DataBase.entities.Record).deleteMany({}) : await DataBase.records(db).clear()
            DataBase.touch()
            DataBase.readCache?.clear()
            DataBase.boards.clear()
            return result
        })
    }

    /**
     * A sorted leaderboard of a variable. Built once and reused for
     * `leaderboardCacheTTL` ms; any write of that variable by this process
     * rebuilds it.
     */
    public static async leaderboard(query: LeaderboardQuery): Promise<Leaderboard> {
        const sort = query.sort === "asc" ? "asc" : "desc"
        const q: LeaderboardQuery = { type: query.type, name: query.name, guildId: query.guildId, sort }
        const key = JSON.stringify([q.type, q.name, q.guildId ?? null, sort])
        const generation = DataBase.generation(q.type, q.name)
        const global = DataBase.globalGeneration
        const cached = DataBase.settings.leaderboardCacheTTL > 0 ? DataBase.boards.get(key) : undefined
        if (cached && cached.value.generation === generation && cached.value.global === global) return cached.value.board

        const rows = await DataBase.op("leaderboard", key, async (db) => {
            if (DataBase.sql) {
                const params = q.guildId !== undefined ? [q.name, q.type, q.guildId] : [q.name, q.type]
                return (await db.query(q.guildId !== undefined ? DataBase.sql.scanGuild : DataBase.sql.scan, params)) as Array<{ id: string; value: string }>
            }
            const where: Record<string, unknown> = { name: q.name, type: q.type }
            if (q.guildId !== undefined) where.guildId = q.guildId
            return (await DataBase.records(db).find({ where, select: ["id", "value"] as never })) as Array<{ id: string; value: string }>
        })

        const entries: LeaderboardEntry[] = []
        for (const row of rows) {
            const score = rankValue(row.value)
            if (score !== null && row.id !== null && row.id !== undefined) entries.push({ id: String(row.id), value: row.value, score })
        }
        entries.sort(sort === "asc" ? (a, b) => a.score - b.score || compareIds(a.id, b.id) : (a, b) => b.score - a.score || compareIds(a.id, b.id))
        const board = new Leaderboard(q, entries)
        if (DataBase.settings.leaderboardCacheTTL > 0) DataBase.boards.set(key, { board, generation, global })
        return board
    }

    // --------------------------------------------------------------- cooldowns

    /** The key a cooldown is stored under. Unchanged from ForgeDB: `<name>[_<id>]`. */
    public static make_cdIdentifier(data: { name?: string; id?: string }) {
        return `${data.name}${data.id ? "_" + data.id : ""}`
    }

    private static checkDuration(duration: unknown): number {
        if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
            throw new ReForgeDBError(`A cooldown duration must be a number of milliseconds of 0 or more, got ${JSON.stringify(duration)}`)
        }
        const ms = Math.floor(duration)
        if (!Number.isSafeInteger(Date.now() + ms)) throw new ReForgeDBError(`A cooldown of ${duration} ms is too long`)
        return ms
    }

    /** Starts (or restarts) a cooldown. */
    public static async cdAdd(data: { name: string; id?: string; duration: number }) {
        const duration = DataBase.checkDuration(data.duration)
        const identifier = DataBase.make_cdIdentifier(data)
        const cd = { identifier, name: data.name, id: data.id, startedAt: Date.now(), duration }
        return DataBase.op("cooldown add", identifier, async (db) => {
            if (DataBase.mongo) await db.getMongoRepository(DataBase.entities.Cooldown).updateOne({ identifier }, { $set: defined(cd) }, { upsert: true })
            else if (DataBase.sql) await db.query(DataBase.sql.upsertCooldown, row(cd, COOLDOWN_COLUMNS))
            else await DataBase.cooldowns(db).upsert(cd, { conflictPaths: ["identifier"], skipUpdateIfNoValuesChanged: false })
            return cd
        })
    }

    /** Ends a cooldown. */
    public static async cdDelete(identifier: string) {
        await DataBase.op("cooldown delete", identifier, (db) => DataBase.cooldowns(db).delete({ identifier }))
    }

    /** The stored cooldown with `left` (ms remaining, `0` when none or expired). */
    public static async cdTimeLeft(identifier: string): Promise<{ left: number; identifier?: string; name?: string; id?: string; startedAt?: number; duration?: number }> {
        return DataBase.op("cooldown get", identifier, async (db) => {
            const data = DataBase.sql
                ? (((await db.query(DataBase.sql.getCooldown, [identifier])) as Cooldown[])[0] ?? null)
                : ((await DataBase.cooldowns(db).findOneBy({ identifier })) as Cooldown | null)
            if (!data) return { left: 0 }
            const startedAt = Number(data.startedAt)
            const duration = Number(data.duration)
            return { ...data, startedAt, duration, left: Math.max(duration - (Date.now() - startedAt), 0) }
        })
    }

    /**
     * Checks a cooldown and starts it when it is not running, as one step:
     * concurrent claims of the same cooldown in this process run one after
     * the other, so only one of them gets through. Returns `0` when the
     * cooldown was started, or the ms left when it was already running.
     */
    public static async cdClaim(data: { name: string; id?: string; duration: number }): Promise<number> {
        const duration = DataBase.checkDuration(data.duration)
        const identifier = DataBase.make_cdIdentifier(data)
        // Claims in this process queue up here, so they do not race in the
        // database for nothing. Across processes the write below decides.
        return DataBase.locks.run(`cooldown\u0000${identifier}`, async () => {
            const current = await DataBase.cdTimeLeft(identifier)
            if (current.left > 0) return current.left
            const cd = { identifier, name: data.name, id: data.id, startedAt: Date.now(), duration }
            const claimed = await DataBase.op("cooldown claim", identifier, (db) => DataBase.claimInDatabase(db, cd, current.identifier !== undefined))
            if (claimed) return 0
            // Another process started it between the read and the write.
            return (await DataBase.cdTimeLeft(identifier)).left
        })
    }

    /**
     * Starts a cooldown only if it is still free in the database: one that
     * exists is restarted only if it has run out, a new one is inserted only
     * if nobody inserted it first. `true` when this call started it.
     */
    private static async claimInDatabase(db: DataSource, cd: { identifier: string; name: string; id?: string; startedAt: number; duration: number }, existed: boolean): Promise<boolean> {
        if (DataBase.mongo) {
            const repo = db.getMongoRepository(DataBase.entities.Cooldown)
            if (existed) {
                const expired = { $expr: { $lte: [{ $add: ["$startedAt", "$duration"] }, cd.startedAt] } }
                const result = await repo.updateOne({ identifier: cd.identifier, ...expired }, { $set: defined({ startedAt: cd.startedAt, duration: cd.duration, name: cd.name, id: cd.id }) })
                return result.matchedCount === 1
            }
            try {
                await repo.insertOne(defined(cd))
                return true
            } catch (err) {
                // The unique index refused a second document: someone else was first.
                if ((err as { code?: number })?.code === 11000) return false
                throw err
            }
        }
        if (!DataBase.sql) {
            await DataBase.cooldowns(db).upsert(cd, { conflictPaths: ["identifier"], skipUpdateIfNoValuesChanged: false })
            return true
        }
        const runner = db.createQueryRunner()
        try {
            const result = existed
                ? await runner.query(DataBase.sql.claimExpiredCooldown, [cd.startedAt, cd.duration, cd.name, cd.id ?? null, cd.identifier, cd.startedAt], true)
                : await runner.query(DataBase.sql.claimNewCooldown, row(cd, COOLDOWN_COLUMNS), true)
            return (result.affected ?? 0) > 0
        } finally {
            await runner.release()
        }
    }

    /** Deletes every cooldown. */
    public static async cdWipe() {
        return DataBase.op("wipe", "cooldowns", async (db) => (DataBase.mongo ? db.getMongoRepository(DataBase.entities.Cooldown).deleteMany({}) : DataBase.cooldowns(db).clear()))
    }

    /** Deletes cooldowns that have run out. Returns how many were deleted. */
    public static async sweepCooldowns(): Promise<number> {
        const now = Date.now()
        return DataBase.op("cooldown sweep", "expired", async (db) => {
            if (DataBase.mongo) {
                const result = await db.getMongoRepository(DataBase.entities.Cooldown).deleteMany({ $expr: { $lte: [{ $add: ["$startedAt", "$duration"] }, now] } })
                return result.deletedCount ?? 0
            }
            const esc = (c: string) => db.driver.escape(c)
            const result = await db
                .createQueryBuilder()
                .delete()
                .from(DataBase.entities.Cooldown)
                .where(`${esc("startedAt")} + ${esc("duration")} <= :now`, { now })
                .execute()
            return result.affected ?? 0
        })
    }

    private static startSweeper() {
        if (DataBase.sweeper) clearInterval(DataBase.sweeper)
        DataBase.sweeper = null
        const every = DataBase.settings.cooldownSweepInterval
        if (!every) return
        const sweep = () =>
            DataBase.sweepCooldowns()
                .then((n) => n && ReForgeDBLogger.debug(`Deleted ${n} expired cooldown(s)`))
                .catch((err) => ReForgeDBLogger.warn(`Could not delete expired cooldowns: ${errorMessage(err)}`))
        DataBase.sweeper = setInterval(sweep, every)
        DataBase.sweeper.unref?.()
        setTimeout(sweep, Math.min(every, 5000)).unref?.()
    }

    // ------------------------------------------------------------------- other

    /**
     * Runs a raw query (SQL, not available on MongoDB). The read cache is
     * cleared, because the query may change variables.
     */
    public static async query(query: string, parameters?: unknown[]) {
        if (DataBase.mongo) throw new ReForgeDBError("Raw queries are not available on MongoDB")
        return DataBase.op("query", query.slice(0, 120), async (db) => {
            const result = await db.query(query, parameters)
            DataBase.touch()
            DataBase.readCache?.clear()
            return result
        })
    }

    /** Round trip to the database in ms. */
    public static async ping(): Promise<number> {
        const db = await DataBase.connection()
        const started = performance.now()
        try {
            if (DataBase.mongo) {
                const driver = db.driver as unknown as { database?: string; queryRunner?: { databaseConnection: { db(name?: string): { command(c: object): Promise<unknown> } } } }
                const client = driver.queryRunner?.databaseConnection
                if (!client) throw new ReForgeDBError("MongoDB connection is not open")
                await client.db(driver.database).command({ ping: 1 })
            } else await db.query("SELECT 1")
        } catch (err) {
            if (err instanceof ReForgeDBError) throw err
            throw new ReForgeDBError(`ping failed: ${errorMessage(err)}`, err)
        }
        return performance.now() - started
    }

    /**
     * Forgets the cached variables and leaderboards, so the next reads go to
     * the database. Use it after changing the database outside ReForgeDB (a
     * script, a dashboard) when the `cache` option is on.
     */
    public static clearCache() {
        DataBase.touch()
        DataBase.readCache?.clear()
        DataBase.boards.clear()
    }

    /** Closes the connection and stops background work (retries, cooldown sweep). */
    public static async close() {
        DataBase.closed = true
        if (DataBase.retryTimer) clearTimeout(DataBase.retryTimer)
        DataBase.wakeRetry?.()
        if (DataBase.sweeper) clearInterval(DataBase.sweeper)
        DataBase.retryTimer = DataBase.sweeper = null
        DataBase.db = null
        DataBase.sql = null
        DataBase.readCache?.clear()
        DataBase.boards.clear()
        await DataBaseManager.closeAll()
    }
}
