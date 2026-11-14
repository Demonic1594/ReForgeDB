import "reflect-metadata"
import { performance } from "perf_hooks"
import { DataSource, DeleteResult, FindOperator, In, Like, ObjectLiteral, Repository } from "typeorm"
import { TypedEmitter } from "tiny-typed-emitter"
import type { IDBEvents } from "../structures"
import type { TransformEvents } from ".."
import { DataBaseManager, EntityList } from "./databaseManager"
import { DBLogger, errorMessage, isLogLevel, ReForgeDBError } from "./logger"
import { chunk, compareIds, KeyedMutex, likeToRegExp, LRUCache, rankValue } from "./primitives"
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
    RecordData,
    RecordType,
    SQLCooldown,
    SQLiteRecord,
    StoredRecord,
} from "./types"

type AnyRecord = typeof SQLiteRecord | typeof MongoRecord | typeof MySQLRecord | typeof PostgreSQLRecord | typeof MySQLRecordWithoutIndex
type AnyCooldown = typeof MongoCooldown | typeof Cooldown | typeof SQLCooldown
type Emitter = TypedEmitter<TransformEvents<IDBEvents>>

/** Longest key MySQL can store in ForgeDB's `varchar(255)` columns. */
const MYSQL_MAX_KEY = 255
/** Rows per `IN (...)` when deleting many records (safe for every driver). */
const DELETE_BATCH = 500
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
    return {
        getRecord: r.get,
        upsertRecord: r.upsert,
        getCooldown: c.get,
        upsertCooldown: c.upsert,
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
    public database = "forge.db"
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
    private static boards = new LRUCache<string, { board: Leaderboard; generation: number; global: number }>(200)
    private static generations = new Map<string, number>()
    private static globalGeneration = 0
    private static writeSeq = 0
    private static readonly locks = new KeyedMutex()

    constructor(emitter: Emitter, options?: IReForgeDBOptions) {
        super(options ?? { type: "sqlite" })
        DataBase.emitter = emitter
        DataBase.configure(options)
    }

    /** Applies the options of `new ReForgeDB()`. */
    private static configure(options: IReForgeDBOptions | undefined) {
        DataBase.settings = resolveSettings(options)
        if (options?.logLevel) DBLogger.level = options.logLevel
        const c = DataBase.settings.cache
        DataBase.readCache = c ? new LRUCache(c.max, c.ttl) : null
        DataBase.boards = new LRUCache(200, DataBase.settings.leaderboardCacheTTL)
    }

    protected override fallbackEntities(kind: DriverKind, error: unknown): EntityList | undefined {
        const e = error as { code?: string; errno?: number }
        if (kind === "mysql" && (e?.code === "ER_TOO_LONG_KEY" || e?.errno === 1071)) {
            DBLogger.warn("This MySQL server cannot index the variable names (keys are limited to 767 bytes). Leaderboards and searches will scan the table.")
            return [MySQLRecordWithoutIndex, SQLCooldown]
        }
        return undefined
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
                if (attempt) DBLogger.info(`Connected to ${type} after ${attempt + 1} attempts`)
                else DBLogger.info(`Connected to ${type}`)
                DataBase.emit("connect")
                return
            } catch (err) {
                DataBase.lastError = err
                const name = (err as Error)?.name
                if (FATAL_CONNECT_ERRORS.has(name) || err instanceof ReForgeDBError) {
                    DataBase.fail(new ReForgeDBError(`Cannot use the database: ${errorMessage(err)}`, err))
                    DBLogger.error(`Cannot use the database: ${errorMessage(err)}`)
                    return
                }
                const wait = Math.min(1000 * 2 ** attempt, 60_000)
                DBLogger.error(`Could not connect to the database (attempt ${attempt + 1}), retrying in ${wait / 1000}s: ${errorMessage(err)}`)
                DBLogger.debug(err)
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
            DBLogger.debug("Could not prepare the fast statements, using repositories:", err)
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
            if (slow > 0 && ms >= slow) DBLogger.warn(`Slow ${label} (${detail}): ${ms.toFixed(1)} ms`)
            else if (DBLogger.enabled("debug")) DBLogger.debug(`${label} ${detail} (${ms.toFixed(2)} ms)`)
            return result
        } catch (err) {
            if (err instanceof ReForgeDBError) throw err
            DBLogger.debug(`${label} ${detail} failed after ${(performance.now() - started).toFixed(1)} ms:`, err)
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

    private static listening(event: keyof IDBEvents) {
        return (DataBase.emitter?.listenerCount(event) ?? 0) > 0
    }

    /** Emits an event; a listener that throws is logged, never breaks the write. */
    private static emit<K extends keyof IDBEvents>(event: K, ...args: IDBEvents[K]) {
        try {
            ;(DataBase.emitter as unknown as { emit(e: string, ...a: unknown[]): boolean } | null)?.emit(event, ...args)
        } catch (err) {
            DBLogger.error(`A ${event} listener threw:`, err)
        }
    }

    /** Marks variables of `type`/`name` as changed (unknown: all of them). */
    private static touch(type?: string, name?: string) {
        DataBase.writeSeq++
        if (type !== undefined && name !== undefined) {
            const key = `${type}\u0000${name}`
            DataBase.generations.set(key, (DataBase.generations.get(key) ?? 0) + 1)
        } else DataBase.globalGeneration++
    }

    private static generation(type: string, name: string) {
        return DataBase.generations.get(`${type}\u0000${name}`) ?? 0
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
            DBLogger.trace(`get ${identifier} (cache)`)
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

    /** Converts `Like()` operators for MongoDB, which has no `LIKE`. */
    private static where(filter: Record<string, unknown>) {
        const where: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(filter)) {
            if (value === undefined) continue
            if (DataBase.mongo && value instanceof FindOperator) {
                if (value.type === "like") where[key] = likeToRegExp(String(value.value))
                else if (value.type === "in") where[key] = { $in: value.value }
                else where[key] = value.value
            } else where[key] = value
        }
        return where
    }

    /** Variables whose columns equal the given values (`Like()` operators are allowed). */
    public static async find(data?: RecordData | Record<string, unknown>): Promise<SQLiteRecord[]> {
        const where = DataBase.where({ ...(data ?? {}) })
        return DataBase.op("find", JSON.stringify(where), async (db) => (await DataBase.records(db).find({ where })) as SQLiteRecord[])
    }

    private static searchWhere(filter: SearchFilter) {
        const where: Record<string, unknown> = {}
        if (filter.name !== undefined) where.name = Like(filter.name)
        if (filter.id !== undefined) where.id = filter.id
        if (filter.type !== undefined) where.type = filter.type
        if (filter.value !== undefined) where.value = Like(filter.value)
        if (filter.guildId !== undefined) where.guildId = filter.guildId
        return DataBase.where(where)
    }

    /** Variables matching a filter, with `LIKE` patterns for name and value. */
    public static async search(filter: SearchFilter): Promise<SQLiteRecord[]> {
        const where = DataBase.searchWhere(filter)
        return DataBase.op("search", JSON.stringify(filter), async (db) => (await DataBase.records(db).find({ where })) as SQLiteRecord[])
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
        if (DataBase.listening("variableDelete")) return DataBase.deleteMany(await DataBase.search(filter))
        const where = DataBase.searchWhere(filter)
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
        DataBase.checkDuration(data.duration)
        const identifier = DataBase.make_cdIdentifier(data)
        return DataBase.locks.run(`cooldown\u0000${identifier}`, async () => {
            const { left } = await DataBase.cdTimeLeft(identifier)
            if (left > 0) return left
            await DataBase.cdAdd(data)
            return 0
        })
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
                .then((n) => n && DBLogger.debug(`Deleted ${n} expired cooldown(s)`))
                .catch((err) => DBLogger.warn(`Could not delete expired cooldowns: ${errorMessage(err)}`))
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
