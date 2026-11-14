import "reflect-metadata";
import { DataSource, DeleteResult } from "typeorm";
import { TypedEmitter } from "tiny-typed-emitter";
import type { IReForgeDBEvents } from "../structures";
import type { TransformEvents } from "..";
import { DataBaseManager, EntityList } from "./databaseManager";
import { Cooldown, DriverKind, IReForgeDBOptions, MongoCooldown, MongoRecord, MySQLRecord, PostgreSQLRecord, RecordData, RecordType, SQLCooldown, SQLiteRecord, StoredRecord } from "./types";
type Emitter = TypedEmitter<TransformEvents<IReForgeDBEvents>>;
export interface SearchFilter {
    /** `LIKE` pattern for the variable name (`%` any text, `_` one character). */
    name?: string;
    /** Exact ID. */
    id?: string;
    /** Exact variable type. */
    type?: RecordType;
    /** `LIKE` pattern for the value. */
    value?: string;
    /** Exact guild ID. */
    guildId?: string;
}
export interface LeaderboardQuery {
    type: RecordType;
    name: string;
    /** Only rows of this guild (member, channel and role variables). */
    guildId?: string;
    /** Defaults to `desc` (highest first). */
    sort?: "asc" | "desc";
}
export interface LeaderboardEntry {
    /** The user, member, guild or channel ID. */
    id: string;
    /** The stored value. */
    value: string;
    /** The value as a number. */
    score: number;
}
/**
 * A sorted leaderboard. Only values that are numbers take part; ties are
 * broken by ID (lowest first), so positions are the same in every function.
 */
export declare class Leaderboard {
    readonly query: Readonly<LeaderboardQuery>;
    readonly entries: readonly LeaderboardEntry[];
    private index;
    constructor(query: Readonly<LeaderboardQuery>, entries: readonly LeaderboardEntry[]);
    get count(): number;
    /** 1-based position of an ID, or `0` when it is not on the leaderboard. */
    positionOf(id: string | undefined | null): number;
    /** The entries of a page (1-based), `perPage` per page. */
    page(page: number, perPage: number): {
        start: number;
        entries: LeaderboardEntry[];
    };
}
interface Settings {
    slowQueryThreshold: number;
    readyTimeout: number;
    leaderboardCacheTTL: number;
    cooldownSweepInterval: number;
    cooldownExpireInterval: number;
    cooldownExpireMaxDelay: number;
    cache: {
        max: number;
        ttl: number;
    } | null;
}
/** The smallest `cooldownExpireMaxDelay`: checks run every few seconds, and a restart takes a while. */
export declare const MIN_COOLDOWN_EXPIRE_MAX_DELAY = 60000;
/** Validates the options of `new ReForgeDB()` and returns the resolved settings. */
export declare function resolveSettings(options: IReForgeDBOptions | undefined): Settings;
/** What `client.db.export()` returns and `client.db.import()` reads. */
export interface ReForgeDBExport {
    format: "reforge.db";
    version: 1;
    exportedAt: string;
    /** The database family it was exported from. */
    source: string;
    records: Array<{
        identifier: string;
        name: string;
        id: string | null;
        type: string;
        value: string;
        guildId: string | null;
    }>;
    cooldowns: Array<{
        identifier: string;
        name: string;
        id: string | null;
        startedAt: number;
        duration: number;
    }>;
}
export interface ImportResult {
    records: {
        created: number;
        overwritten: number;
        skipped: number;
    };
    cooldowns: {
        created: number;
        overwritten: number;
        skipped: number;
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
export declare class DataBase extends DataBaseManager {
    /** The SQLite file, in the `folder` option (`database/reforge.db` by default). */
    database: string;
    /** ForgeDB's file name; the `forgeDBFile` option says what happens to it. */
    previousDatabase: string;
    entityManager: {
        sqlite: (typeof SQLiteRecord | typeof Cooldown)[];
        mongodb: (typeof MongoRecord | typeof MongoCooldown)[];
        mysql: (typeof MySQLRecord | typeof SQLCooldown)[];
        postgres: (typeof PostgreSQLRecord | typeof SQLCooldown)[];
    };
    private static entities;
    private static db;
    private static sql;
    /**
     * When each cooldown this process saw runs out (ms since epoch). Only a
     * guess of whether a claim will pass, used to pick the statement that
     * likely decides it in one round trip; the database still decides every
     * claim, so a stale guess costs a round trip, never a wrong answer.
     */
    private static cooldownHints;
    private static emitter;
    private static settings;
    private static fatal;
    private static lastError;
    private static closed;
    private static waiters;
    private static retryTimer;
    private static wakeRetry;
    private static sweeper;
    private static readCache;
    private static boards;
    private static generations;
    private static globalGeneration;
    private static writeSeq;
    private static readonly locks;
    constructor(emitter: Emitter, options?: IReForgeDBOptions);
    /** Applies the options of `new ReForgeDB()`. */
    private static configure;
    protected fallbackEntities(kind: DriverKind, error: unknown): EntityList | undefined;
    /**
     * MongoDB: removes duplicate documents of one key before the unique key
     * indexes are built. ForgeDB read and then wrote, so two first writes at
     * the same moment could both insert. The document kept is the first one
     * in the collection's natural order: the one ForgeDB read and updated.
     */
    protected beforeSynchronize(db: DataSource): Promise<void>;
    /**
     * Connects, retrying with backoff (1 s, doubling up to 60 s) while the
     * database is unreachable. Never rejects: functions wait for the
     * connection, and fail with a clear error after `readyTimeout`.
     */
    init(): Promise<void>;
    private static attach;
    private static fail;
    /** Whether the database is connected. */
    static get connected(): boolean;
    /** The entity family in use: `sqlite`, `mysql`, `postgres` or `mongodb`. */
    static get kind(): DriverKind;
    /** The TypeORM `DataSource`, or `null` before the connection is made. */
    static get dataSource(): DataSource | null;
    /**
     * Resolves once the database is connected. Rejects after `timeout` ms
     * (the `readyTimeout` option by default) or when the database cannot be
     * used at all (for example a missing driver package).
     */
    static ready(timeout?: number): Promise<void>;
    private static connection;
    private static records;
    private static cooldowns;
    private static get mongo();
    /** Runs a database operation with timing, debug logging and error wrapping. */
    private static op;
    /**
     * With the read cache on, writes to one key run one at a time, so the
     * cache ends up holding the value the database holds. Without it the
     * database orders them and nothing needs to wait.
     */
    private static ordered;
    private static listening;
    /** Emits an event; a listener that throws is logged, never breaks the write. */
    private static emit;
    /**
     * Marks variables of `type`/`name` as changed (unknown: all of them).
     * Only names that have had a leaderboard are counted: bots often build
     * names from IDs (`warn_<user>`), and counting every name ever written
     * would grow without end.
     */
    private static touch;
    /** The change counter of a leaderboard's variable; starts counting it if needed. */
    private static generation;
    /** One record by identifier. */
    private static readRecord;
    private static entity;
    /**
     * The key a variable is stored under. Unchanged from ForgeDB, so existing
     * databases keep working: `<type>_<name>_[<guildId>_]<id>`.
     */
    static make_intetifier(data: RecordData): string;
    /** Same as `make_intetifier` (which keeps its misspelled name for compatibility). */
    static makeIdentifier(data: RecordData): string;
    private static toRecord;
    private static upsertRecord;
    /**
     * Creates or replaces a variable. One atomic upsert, so concurrent writes
     * to the same new variable never fail. The previous value is only read
     * when a `variableCreate` or `variableUpdate` listener needs it.
     */
    static set(data: RecordData): Promise<void>;
    /** Gets a variable, or `null` when it does not exist. */
    static get(data: RecordData): Promise<SQLiteRecord | null>;
    /** Every stored variable. */
    static getAll(): Promise<SQLiteRecord[]>;
    /**
     * Turns a filter into the database's `where`, plus checks to run on the
     * rows it returns. `LIKE` patterns are normalized (see `normalizeLike`).
     * MongoDB has no `LIKE`: it is sent only the pattern's literal prefix,
     * and the pattern itself is matched here (a regular expression for it
     * could take exponential time on the database server).
     */
    private static where;
    private static findWhere;
    /** Variables whose columns equal the given values (`Like()` operators are allowed). */
    static find(data?: RecordData | Record<string, unknown>): Promise<SQLiteRecord[]>;
    private static searchFilter;
    /** Variables matching a filter, with `LIKE` patterns for name and value. */
    static search(filter: SearchFilter): Promise<SQLiteRecord[]>;
    /** Deletes a variable. `variableDelete` is emitted only when it existed. */
    static delete(data: RecordData): Promise<DeleteResult>;
    /** Deletes the given variables in batches. Returns how many were deleted. */
    static deleteMany(records: Array<Pick<StoredRecord, "identifier"> & Partial<StoredRecord>>): Promise<number>;
    /**
     * Deletes every variable matching the filter. Without delete listeners
     * this is one query; with them the rows are read first for the events.
     */
    static deleteMatching(filter: SearchFilter): Promise<number>;
    /** Deletes every variable (not the cooldowns). */
    static wipe(): Promise<void | import("typeorm/driver/mongodb/typings").DeleteResult>;
    /**
     * A sorted leaderboard of a variable. Built once and reused for
     * `leaderboardCacheTTL` ms; any write of that variable by this process
     * rebuilds it.
     */
    static leaderboard(query: LeaderboardQuery): Promise<Leaderboard>;
    /** The key a cooldown is stored under. Unchanged from ForgeDB: `<name>[_<id>]`. */
    static make_cdIdentifier(data: {
        name?: string;
        id?: string;
    }): string;
    private static checkDuration;
    /** Starts (or restarts) a cooldown. */
    static cdAdd(data: {
        name: string;
        id?: string;
        duration: number;
    }): Promise<{
        identifier: string;
        name: string;
        id: string | undefined;
        startedAt: number;
        duration: number;
    }>;
    /** Ends a cooldown. */
    static cdDelete(identifier: string): Promise<void>;
    /** Remembers when a cooldown runs out, at most 10,000 of them (the oldest are forgotten first). */
    private static hint;
    /** The stored cooldown with `left` (ms remaining, `0` when none or expired). */
    static cdTimeLeft(identifier: string): Promise<{
        left: number;
        identifier?: string;
        name?: string;
        id?: string;
        startedAt?: number;
        duration?: number;
    }>;
    /**
     * Checks a cooldown and starts it when it is not running, as one step:
     * concurrent claims of the same cooldown in this process run one after
     * the other, so only one of them gets through. Returns `0` when the
     * cooldown was started, or the ms left when it was already running.
     */
    static cdClaim(data: {
        name: string;
        id?: string;
        duration: number;
    }): Promise<number>;
    /** Whether a claim can be decided by one write on this database. */
    private static get canClaimFirst();
    /**
     * Starts a cooldown with one write if it does not exist or has run out.
     * `true` when this call started it, `false` when it was running.
     */
    private static claimFirst;
    /**
     * Starts a cooldown only if it is still free in the database: one that
     * exists is restarted only if it has run out, a new one is inserted only
     * if nobody inserted it first. `true` when this call started it.
     */
    private static claimInDatabase;
    /** Deletes every cooldown. */
    static cdWipe(): Promise<void | import("typeorm/driver/mongodb/typings").DeleteResult>;
    /** Deletes cooldowns that have run out. Returns how many were deleted. */
    static sweepCooldowns(): Promise<number>;
    private static startSweeper;
    private static expirer;
    private static expiring;
    /** Whether cooldownExpire is on: something listens to it and the check runs. */
    private static get expiryActive();
    private static startExpirer;
    /**
     * Fires cooldownExpire for cooldowns that ran out, and deletes them. Each
     * one is claimed with a conditional delete (same identifier, start and
     * duration), so with several processes on one database exactly one fires
     * it, and a cooldown restarted or deleted meanwhile fires nothing. One
     * that ran out more than `cooldownExpireMaxDelay` ago (the bot was off) is
     * deleted without an event. Returns how many were fired and dropped.
     */
    static expireCooldowns(now?: number): Promise<{
        fired: number;
        dropped: number;
    }>;
    /**
     * SQLite: writes a consistent copy of the database to `file` while the bot
     * runs (`VACUUM INTO`), and returns its path. Without `file`, the copy goes
     * to `backups/reforge-<date>.db` next to the database. An existing file is
     * never overwritten. On other databases, use `export()` or the database's
     * own tools (pg_dump, mysqldump, mongodump).
     */
    static backup(file?: string): Promise<string>;
    /**
     * Every variable and cooldown as plain JSON-safe data, for any database.
     * `import()` reads it back, also into another type of database.
     */
    static export(): Promise<ReForgeDBExport>;
    /**
     * Writes data from `export()` (the object or its JSON text) into the
     * database. Existing variables and cooldowns (same identifier) are left as
     * they are unless `overwrite` is true. Everything is checked before the
     * first write, so invalid data writes nothing. Emits no events.
     */
    static import(input: ReForgeDBExport | string, options?: {
        overwrite?: boolean;
    }): Promise<ImportResult>;
    /**
     * Runs a raw query (SQL, not available on MongoDB). The read cache is
     * cleared, because the query may change variables.
     */
    static query(query: string, parameters?: unknown[]): Promise<any>;
    /** Round trip to the database in ms. */
    static ping(): Promise<number>;
    /**
     * Forgets the cached variables and leaderboards, so the next reads go to
     * the database. Use it after changing the database outside ReForgeDB (a
     * script, a dashboard) when the `cache` option is on.
     */
    static clearCache(): void;
    /** Closes the connection and stops background work (retries, cooldown sweep). */
    static close(): Promise<void>;
}
export {};
//# sourceMappingURL=database.d.ts.map