import "reflect-metadata";
import { DataSource, DeleteResult } from "typeorm";
import { TypedEmitter } from "tiny-typed-emitter";
import type { IDBEvents } from "../structures";
import type { TransformEvents } from "..";
import { DataBaseManager, EntityList } from "./databaseManager";
import { Cooldown, DriverKind, IReForgeDBOptions, MongoCooldown, MongoRecord, MySQLRecord, PostgreSQLRecord, RecordData, RecordType, SQLCooldown, SQLiteRecord, StoredRecord } from "./types";
type Emitter = TypedEmitter<TransformEvents<IDBEvents>>;
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
    cache: {
        max: number;
        ttl: number;
    } | null;
}
/** Validates the options of `new ReForgeDB()` and returns the resolved settings. */
export declare function resolveSettings(options: IReForgeDBOptions | undefined): Settings;
/**
 * ReForgeDB's storage: variables ("records") and cooldowns. Everything is
 * static, and the bot's client exposes the class as `client.db`.
 *
 * Every method waits for the connection (up to `readyTimeout`), so calling
 * one while the database is still connecting is safe. Failures are thrown as
 * `ReForgeDBError` with the driver's message.
 */
export declare class DataBase extends DataBaseManager {
    database: string;
    entityManager: {
        sqlite: (typeof SQLiteRecord | typeof Cooldown)[];
        mongodb: (typeof MongoRecord | typeof MongoCooldown)[];
        mysql: (typeof MySQLRecord | typeof SQLCooldown)[];
        postgres: (typeof PostgreSQLRecord | typeof SQLCooldown)[];
    };
    private static entities;
    private static db;
    private static sql;
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
    /** Marks variables of `type`/`name` as changed (unknown: all of them). */
    private static touch;
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
    /** Converts `Like()` operators for MongoDB, which has no `LIKE`. */
    private static where;
    /** Variables whose columns equal the given values (`Like()` operators are allowed). */
    static find(data?: RecordData | Record<string, unknown>): Promise<SQLiteRecord[]>;
    private static searchWhere;
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
    /** Deletes every cooldown. */
    static cdWipe(): Promise<void | import("typeorm/driver/mongodb/typings").DeleteResult>;
    /** Deletes cooldowns that have run out. Returns how many were deleted. */
    static sweepCooldowns(): Promise<number>;
    private static startSweeper;
    /**
     * Runs a raw query (SQL, not available on MongoDB). The read cache is
     * cleared, because the query may change variables.
     */
    static query(query: string, parameters?: unknown[]): Promise<any>;
    /** Round trip to the database in ms. */
    static ping(): Promise<number>;
    /** Closes the connection and stops background work (retries, cooldown sweep). */
    static close(): Promise<void>;
}
export {};
//# sourceMappingURL=database.d.ts.map