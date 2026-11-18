import { Entity, Column, PrimaryColumn, ObjectIdColumn, Index, ValueTransformer } from "typeorm"
import type { IReForgeDBEvents } from "../structures"
import type { LogLevel } from "./logger"

export enum SortType {
    asc,
    desc,
}

export enum DataType {
    identifier,
    name,
    id,
    type,
    value,
    guildId,
}

export enum VariableType {
    user,
    channel,
    role,
    message,
    member,
    custom,
    guild,
    old,
}

/** The database types ReForgeDB can use. `mariadb` uses the MySQL entities. */
export type DriverType = "mysql" | "mariadb" | "postgres" | "mongodb" | "better-sqlite3" | "sqlite"

/** What to do with a database file of an earlier name; see `DataBaseManager.previousDatabaseAction`. */
export type PreviousDatabaseAction = "use" | "copy" | "rename" | "ignore"

/** The four entity families (SQLite and better-sqlite3 share one, MySQL and MariaDB share one). */
export type DriverKind = "sqlite" | "mysql" | "postgres" | "mongodb"

export function driverKind(type: string | undefined): DriverKind {
    switch (type) {
        case "mysql":
        case "mariadb":
            return "mysql"
        case "postgres":
            return "postgres"
        case "mongodb":
            return "mongodb"
        default:
            return "sqlite"
    }
}

export interface IReadCacheOptions {
    /** Most records kept in memory. Defaults to `10000`. */
    max?: number
    /** How long (ms) a cached record is trusted. `0` keeps it until it is changed or evicted. Defaults to `0`. */
    ttl?: number
}

/** Options shared by every database type. */
export interface IReForgeDBCommonOptions {
    /** The database events to listen to. */
    events?: Array<keyof IReForgeDBEvents>

    /** Console output level. Defaults to `info`, or the `REFORGEDB_LOG_LEVEL` environment variable. */
    logLevel?: LogLevel

    /** Operations slower than this many ms are logged as a warning. `0` disables it. Defaults to `1000`. */
    slowQueryThreshold?: number

    /**
     * Keep recently read and written variables in memory, so reading them
     * again costs no query. Off by default.
     *
     * Only turn it on when **one** bot process uses the database: writes made
     * by another process (another shard process, a dashboard, a script) are
     * not seen until the cached copy expires (`ttl`) or is evicted.
     */
    cache?: boolean | IReadCacheOptions

    /**
     * Leaderboards are built once and reused for this many ms, so a command
     * that shows a page, a position and a page count scans the variable once.
     * Writes made by this process refresh it right away. `0` disables it.
     * Defaults to `2000`.
     */
    leaderboardCacheTTL?: number

    /** How often (ms) expired cooldowns are deleted from the database. `0` disables it. Defaults to 1 hour. */
    cooldownSweepInterval?: number

    /**
     * With a `cooldownExpire` listener: how often (ms) ReForgeDB looks for
     * cooldowns that ran out. `0` turns the event off. Defaults to `5000`.
     */
    cooldownExpireInterval?: number

    /**
     * A cooldown that ran out while the bot was offline still fires
     * `cooldownExpire` if it is at most this many ms late; older ones are
     * dropped (and deleted) without an event, so a restart never sends a flood.
     * Defaults to 12 hours, at least `60000`.
     */
    cooldownExpireMaxDelay?: number

    /**
     * How long (ms) a function waits for the database to connect before it
     * fails with an error. Defaults to `30000`.
     */
    readyTimeout?: number

    /**
     * Let TypeORM create and update the tables. Defaults to `true`. With
     * `false` you create the tables yourself (see the README).
     */
    synchronize?: boolean

    /**
     * Also register ForgeDB's cooldown names (`$userCooldown`, `$getUserCooldownTime`,
     * `$deleteUserCooldown` and the member, guild and channel ones) as stored cooldowns with ForgeDB's
     * arguments: the same functions as `$dbUserCooldown` and the others. For bots switching from ForgeDB
     * without renaming. Off by default: then these names are ForgeScript's in-memory cooldowns, whose
     * first argument is an ID. Defaults to `false`.
     */
    forgeDBCooldownNames?: boolean

    /**
     * Extra TypeORM `DataSource` options, merged over the ones ReForgeDB
     * builds (for example `{ ssl: { rejectUnauthorized: false } }` or
     * `{ extra: { max: 20 } }`).
     */
    typeorm?: Record<string, unknown>
}

export type IReForgeDBOptions = (
    | {
          type: "mysql" | "mariadb" | "postgres"
          url?: string
          host?: string
          port?: number
          username?: string
          password?: string
          database?: string
          /** MySQL/MariaDB connection charset. Defaults to `utf8mb4_general_ci` so emojis can be stored. */
          charset?: string
      }
    | {
          type: "mongodb"
          url: string
          database?: string
      }
    | {
          type: "better-sqlite3" | "sqlite"
          /** Folder of the database file (`<folder>/reforge.db`). Defaults to `database`. */
          folder?: string
          /** Use SQLite's write-ahead log: much faster writes, readers never block. Defaults to `true`. */
          wal?: boolean
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
          forgeDBFile?: PreviousDatabaseAction
      }
) &
    IReForgeDBCommonOptions

/** @deprecated Use `IReForgeDBOptions`. Kept so code typed against ForgeDB still compiles. */
export type IDataBaseOptions = IReForgeDBOptions

/** Reads 64-bit integer columns, which `pg` and `mysql2` return as strings, as numbers. */
const bigintToNumber: ValueTransformer = {
    to: (value: unknown) => value,
    from: (value: unknown) => (value === null || value === undefined ? value : Number(value)),
}

export type RecordType = "user" | "channel" | "role" | "message" | "member" | "custom" | "guild" | "old"

/*
 * Never change the type or length of an existing column below. TypeORM
 * synchronizes the schema, and on PostgreSQL and MySQL it changes a column by
 * dropping and re-creating it, which deletes its data. Adding indexes and
 * nullable columns is safe.
 */

@Entity("record")
@Index("IDX_record_name_type_guild", ["name", "type", "guildId"])
export class MySQLRecord {
    @PrimaryColumn()
    identifier!: string

    @Column()
    name!: string

    @Column({ nullable: true })
    id!: string

    @Column()
    type!: RecordType

    @Column("longtext")
    value!: string

    @Column({ nullable: true })
    guildId?: string
}

/**
 * The same table without the leaderboard index, used only when a MySQL server
 * refuses the index (MySQL 5.6 and old MariaDB limit index keys to 767 bytes).
 */
@Entity("record")
export class MySQLRecordWithoutIndex {
    @PrimaryColumn()
    identifier!: string

    @Column()
    name!: string

    @Column({ nullable: true })
    id!: string

    @Column()
    type!: RecordType

    @Column("longtext")
    value!: string

    @Column({ nullable: true })
    guildId?: string
}

@Entity("record")
@Index("IDX_record_name_type_guild", ["name", "type", "guildId"])
export class PostgreSQLRecord {
    @PrimaryColumn()
    identifier!: string

    @Column()
    name!: string

    @Column({ nullable: true })
    id!: string

    @Column()
    type!: RecordType

    @Column("text")
    value!: string

    @Column({ nullable: true })
    guildId?: string
}

@Entity("record")
@Index("IDX_record_name_type_guild", ["name", "type", "guildId"])
export class SQLiteRecord {
    @PrimaryColumn()
    identifier!: string

    @Column()
    name!: string

    @Column({ nullable: true })
    id!: string

    @Column()
    type!: RecordType

    @Column()
    value!: string

    @Column({ nullable: true })
    guildId?: string
}

export type BaseData = {
    identifier?: string
    name?: string
    id?: string
    value?: string
}

export type GuildData = BaseData & { type?: "member" | "channel" | "role"; guildId: string | undefined }
export type NonGuildData = BaseData & { type?: "user" | "message" | "custom" | "guild" | "old" }

export type RecordData = BaseData & (GuildData | NonGuildData)

/** A stored variable, as returned by `DataBase.get`, `find` and the events. */
export type StoredRecord = {
    identifier: string
    name: string
    id: string
    type: RecordType
    value: string
    guildId?: string | null
}

/** SQLite cooldowns. SQLite integers are 64-bit, so these columns hold millisecond timestamps. */
@Entity()
export class Cooldown {
    @PrimaryColumn()
    identifier!: string

    @Column()
    name!: string

    @Column({ nullable: true })
    id?: string

    @Column()
    startedAt!: number

    @Column()
    duration!: number
}

/**
 * MySQL and PostgreSQL cooldowns. ForgeDB used 32-bit `integer` columns here,
 * which cannot hold a millisecond timestamp: every cooldown write failed on
 * these databases. `bigint` holds any timestamp and any duration.
 */
@Entity("cooldown")
export class SQLCooldown {
    @PrimaryColumn()
    identifier!: string

    @Column()
    name!: string

    @Column({ nullable: true })
    id?: string

    @Column({ type: "bigint", transformer: bigintToNumber })
    startedAt!: number

    @Column({ type: "bigint", transformer: bigintToNumber })
    duration!: number
}

export type CooldownData = {
    identifier?: string
    name?: string
    id?: string
    startedAt?: number
    duration?: number
}

/*
 * MongoDB keys documents by `_id`, so `identifier` gets its own index: without
 * it every read was a full collection scan. It is unique, which is also what
 * makes an upsert safe: without it two first writes at the same moment insert
 * two documents. ForgeDB's read-then-write could leave such duplicates; they
 * are removed before the index is built (DataBase.beforeSynchronize). The
 * name/type/guildId index is inherited from SQLiteRecord.
 */
@Entity()
@Index("UQ_mongo_record_identifier", ["identifier"], { unique: true })
export class MongoRecord extends SQLiteRecord {
    @ObjectIdColumn()
    mongoId?: string
}

@Entity()
@Index("UQ_mongo_cooldown_identifier", ["identifier"], { unique: true })
export class MongoCooldown extends Cooldown {
    @ObjectIdColumn()
    mongoId?: string
}
