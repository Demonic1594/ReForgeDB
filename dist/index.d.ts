import { ForgeClient, ForgeExtension, IExtendedCompilationResult } from "@tryforge/forgescript";
import { TypedEmitter } from "tiny-typed-emitter";
import { IReForgeDBOptions } from "./util";
import { ReForgeDBCommandManager, IReForgeDBEvents } from "./structures";
export type TransformEvents<T> = {
    [P in keyof T]: T[P] extends any[] ? (...args: T[P]) => any : never;
};
/** A default value given to `ReForgeDB.variables()`. Strings are ForgeScript code. */
export type VariableDefault = string | number | boolean | null | object;
/**
 * ReForgeDB: variables, leaderboards and cooldowns for ForgeScript, stored in
 * SQLite, better-sqlite3, MySQL/MariaDB, PostgreSQL or MongoDB.
 *
 * @example
 * const client = new ForgeClient({
 *     extensions: [new ReForgeDB({ type: "better-sqlite3", events: ["variableUpdate"] })],
 * })
 */
export declare class ReForgeDB extends ForgeExtension {
    readonly options?: IReForgeDBOptions | undefined;
    /** Name this extension registers under, for `requireExtensions` of other extensions. */
    static readonly extensionName = "reforge.db";
    private static rawDefaults;
    private static compiledDefaults;
    name: string;
    description: string;
    version: string;
    commands: ReForgeDBCommandManager;
    emitter: TypedEmitter<TransformEvents<IReForgeDBEvents>>;
    constructor(options?: IReForgeDBOptions | undefined);
    init(client: ForgeClient): void;
    /** Resolves once the database is connected (rejects after `timeout` ms). */
    static ready(timeout?: number): Promise<void>;
    /**
     * Declares default values, used when a variable is read but was never
     * set (and the function call gives no default). Strings are ForgeScript
     * code and run in the reading command's context, so `"$username"` works.
     * Each call replaces the previous defaults.
     */
    variables(rec: Record<string, VariableDefault>): void;
    static variables(rec: Record<string, VariableDefault>): void;
    /** The declared defaults, as given to `variables()`. */
    static get defaults(): Readonly<Record<string, VariableDefault>>;
    /** Whether a default was declared for `name`. */
    static hasDefault(name: string): boolean;
    /**
     * The default for `name`: compiled ForgeScript for strings (compiled on
     * first use, once every extension's functions are registered), or the
     * value itself.
     */
    static defaultFor(name: string): {
        code: IExtendedCompilationResult;
    } | {
        value: unknown;
    } | undefined;
}
export { DataBaseManager, DataBase, Leaderboard, ReForgeDBError, ReForgeDBLogger, FORGEDB_COOLDOWN_NAMES, findLegacyCooldownCalls } from "./util";
export type { IReForgeDBOptions, IDataBaseOptions, LogLevel, SearchFilter, LeaderboardQuery, LeaderboardEntry, StoredRecord, RecordData, LegacyCooldownCall } from "./util";
export { EVENT_HANDLER_NAME } from "./structures";
export type { IReForgeDBEvents } from "./structures";
//# sourceMappingURL=index.d.ts.map