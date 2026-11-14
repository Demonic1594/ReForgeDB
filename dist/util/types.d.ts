import type { IReForgeDBEvents } from "../structures";
import type { LogLevel } from "./logger";
export declare enum SortType {
    asc = 0,
    desc = 1
}
export declare enum DataType {
    identifier = 0,
    name = 1,
    id = 2,
    type = 3,
    value = 4,
    guildId = 5
}
export declare enum VariableType {
    user = 0,
    channel = 1,
    role = 2,
    message = 3,
    member = 4,
    custom = 5,
    guild = 6,
    old = 7
}
/** The database types ReForgeDB can use. `mariadb` uses the MySQL entities. */
export type DriverType = "mysql" | "mariadb" | "postgres" | "mongodb" | "better-sqlite3" | "sqlite";
/** What to do with a database file of an earlier name; see `DataBaseManager.previousDatabaseAction`. */
export type PreviousDatabaseAction = "use" | "copy" | "rename" | "ignore";
/** The four entity families (SQLite and better-sqlite3 share one, MySQL and MariaDB share one). */
export type DriverKind = "sqlite" | "mysql" | "postgres" | "mongodb";
export declare function driverKind(type: string | undefined): DriverKind;
export interface IReadCacheOptions {
    /** Most records kept in memory. Defaults to `10000`. */
    max?: number;
    /** How long (ms) a cached record is trusted. `0` keeps it until it is changed or evicted. Defaults to `0`. */
    ttl?: number;
}
/** Options shared by every database type. */
export interface IReForgeDBCommonOptions {
    /** The database events to listen to. */
    events?: Array<keyof IReForgeDBEvents>;
    /** Console output level. Defaults to `info`, or the `REFORGEDB_LOG_LEVEL` environment variable. */
    logLevel?: LogLevel;
    /** Operations slower than this many ms are logged as a warning. `0` disables it. Defaults to `1000`. */
    slowQueryThreshold?: number;
    /**
     * Keep recently read and written variables in memory, so reading them
     * again costs no query. Off by default.
     *
     * Only turn it on when **one** bot process uses the database: writes made
     * by another process (another shard process, a dashboard, a script) are
     * not seen until the cached copy expires (`ttl`) or is evicted.
     */
    cache?: boolean | IReadCacheOptions;
    /**
     * Leaderboards are built once and reused for this many ms, so a command
     * that shows a page, a position and a page count scans the variable once.
     * Writes made by this process refresh it right away. `0` disables it.
     * Defaults to `2000`.
     */
    leaderboardCacheTTL?: number;
    /** How often (ms) expired cooldowns are deleted from the database. `0` disables it. Defaults to 1 hour. */
    cooldownSweepInterval?: number;
    /**
     * How long (ms) a function waits for the database to connect before it
     * fails with an error. Defaults to `30000`.
     */
    readyTimeout?: number;
    /**
     * Let TypeORM create and update the tables. Defaults to `true`. With
     * `false` you create the tables yourself (see the README).
     */
    synchronize?: boolean;
    /**
     * Extra TypeORM `DataSource` options, merged over the ones ReForgeDB
     * builds (for example `{ ssl: { rejectUnauthorized: false } }` or
     * `{ extra: { max: 20 } }`).
     */
    typeorm?: Record<string, unknown>;
}
export type IReForgeDBOptions = ({
    type: "mysql" | "mariadb" | "postgres";
    url?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    database?: string;
    /** MySQL/MariaDB connection charset. Defaults to `utf8mb4_general_ci` so emojis can be stored. */
    charset?: string;
} | {
    type: "mongodb";
    url: string;
    database?: string;
} | {
    type: "better-sqlite3" | "sqlite";
    /** Folder of the database file (`<folder>/reforge.db`). Defaults to `database`. */
    folder?: string;
    /** Use SQLite's write-ahead log: much faster writes, readers never block. Defaults to `true`. */
    wal?: boolean;
    /**
     * What to do with ForgeDB's `forge.db`, when it is in the folder and
     * `reforge.db` is not:
     * - `use` (default): keep using `forge.db` where it is
     * - `copy`: copy it to `reforge.db` and use the copy; `forge.db` is kept as a backup
     * - `rename`: rename it to `reforge.db`
     * - `ignore`: start a new, empty `reforge.db`; `forge.db` is left alone
     *
     * When both files exist, `reforge.db` is used.
     */
    forgeDBFile?: PreviousDatabaseAction;
}) & IReForgeDBCommonOptions;
/** @deprecated Use `IReForgeDBOptions`. Kept so code typed against ForgeDB still compiles. */
export type IDataBaseOptions = IReForgeDBOptions;
export type RecordType = "user" | "channel" | "role" | "message" | "member" | "custom" | "guild" | "old";
export declare class MySQLRecord {
    identifier: string;
    name: string;
    id: string;
    type: RecordType;
    value: string;
    guildId?: string;
}
/**
 * The same table without the leaderboard index, used only when a MySQL server
 * refuses the index (MySQL 5.6 and old MariaDB limit index keys to 767 bytes).
 */
export declare class MySQLRecordWithoutIndex {
    identifier: string;
    name: string;
    id: string;
    type: RecordType;
    value: string;
    guildId?: string;
}
export declare class PostgreSQLRecord {
    identifier: string;
    name: string;
    id: string;
    type: RecordType;
    value: string;
    guildId?: string;
}
export declare class SQLiteRecord {
    identifier: string;
    name: string;
    id: string;
    type: RecordType;
    value: string;
    guildId?: string;
}
export type BaseData = {
    identifier?: string;
    name?: string;
    id?: string;
    value?: string;
};
export type GuildData = BaseData & {
    type?: "member" | "channel" | "role";
    guildId: string | undefined;
};
export type NonGuildData = BaseData & {
    type?: "user" | "message" | "custom" | "guild" | "old";
};
export type RecordData = BaseData & (GuildData | NonGuildData);
/** A stored variable, as returned by `DataBase.get`, `find` and the events. */
export type StoredRecord = {
    identifier: string;
    name: string;
    id: string;
    type: RecordType;
    value: string;
    guildId?: string | null;
};
/** SQLite cooldowns. SQLite integers are 64-bit, so these columns hold millisecond timestamps. */
export declare class Cooldown {
    identifier: string;
    name: string;
    id?: string;
    startedAt: number;
    duration: number;
}
/**
 * MySQL and PostgreSQL cooldowns. ForgeDB used 32-bit `integer` columns here,
 * which cannot hold a millisecond timestamp: every cooldown write failed on
 * these databases. `bigint` holds any timestamp and any duration.
 */
export declare class SQLCooldown {
    identifier: string;
    name: string;
    id?: string;
    startedAt: number;
    duration: number;
}
export type CooldownData = {
    identifier?: string;
    name?: string;
    id?: string;
    startedAt?: number;
    duration?: number;
};
export declare class MongoRecord extends SQLiteRecord {
    mongoId?: string;
}
export declare class MongoCooldown extends Cooldown {
    mongoId?: string;
}
//# sourceMappingURL=types.d.ts.map