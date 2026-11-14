import "reflect-metadata";
import { DataSource, EntitySchema, MixedList } from "typeorm";
import { DriverKind, IReForgeDBOptions, PreviousDatabaseAction } from "./types";
export type EntityList = MixedList<Function | string | EntitySchema>;
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
export declare abstract class DataBaseManager {
    #private;
    abstract database: string;
    abstract entityManager: {
        sqlite: EntityList;
        mongodb: EntityList;
        mysql: EntityList;
        postgres: EntityList;
    };
    /**
     * SQLite only: the file name this database had before (for example
     * ForgeDB's `forge.db`). See `previousDatabaseAction` for what happens to
     * it when `database` does not exist yet.
     */
    previousDatabase?: string;
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
    previousDatabaseAction: PreviousDatabaseAction;
    type?: IReForgeDBOptions["type"];
    static type: IReForgeDBOptions["type"];
    constructor(options?: IReForgeDBOptions);
    /** The settings given to `new ReForgeDB()`, once it has been constructed. */
    static get config(): Readonly<IReForgeDBOptions> | undefined;
    /** The entity family of the configured database type. */
    static get kind(): DriverKind;
    /**
     * Entities to retry with when the database refuses the schema of
     * `entityManager` (for example an index an old MySQL cannot build).
     * Return `undefined` to give up instead.
     */
    protected fallbackEntities(_kind: DriverKind, _error: unknown): EntityList | undefined;
    /**
     * Runs after connecting and before TypeORM synchronizes the schema, for
     * clean-ups the new schema needs (ReForgeDB removes duplicate MongoDB
     * documents before building a unique index). Does nothing by default.
     */
    protected beforeSynchronize(_db: DataSource): Promise<void>;
    /**
     * Returns the connected `DataSource` of this manager's database, opening
     * it on first use. Rejects when the connection fails; call it again to
     * retry.
     */
    protected getDB(): Promise<DataSource>;
    /** Closes every connection opened through `DataBaseManager`. */
    static closeAll(): Promise<void>;
    /** Forgets the configuration and connections. For tests only. */
    static _reset(): void;
}
//# sourceMappingURL=databaseManager.d.ts.map