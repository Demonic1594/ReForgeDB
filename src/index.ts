import { Compiler, EventManager, ForgeClient, ForgeExtension, IExtendedCompilationResult } from "@tryforge/forgescript"
import { TypedEmitter } from "tiny-typed-emitter"
import { DataBase, DBLogger, errorMessage, IReForgeDBOptions, ReForgeDBError, resolveSettings } from "./util"
import { DBCommandManager, EVENT_HANDLER_NAME, IDBEvents } from "./structures"

const pkg = require("../package.json") as { version: string; description: string }

export type TransformEvents<T> = {
    [P in keyof T]: T[P] extends any[] ? (...args: T[P]) => any : never
}

/** A default value given to `ReForgeDB.variables()`. Strings are ForgeScript code. */
export type VariableDefault = string | number | boolean | null | object

/**
 * ReForgeDB: variables, leaderboards and cooldowns for ForgeScript, stored in
 * SQLite, better-sqlite3, MySQL/MariaDB, PostgreSQL or MongoDB.
 *
 * @example
 * const client = new ForgeClient({
 *     extensions: [new ReForgeDB({ type: "better-sqlite3", events: ["variableUpdate"] })],
 * })
 */
export class ReForgeDB extends ForgeExtension {
    /** Name this extension registers under, for `requireExtensions` of other extensions. */
    public static readonly extensionName = "reforge.db"

    private static rawDefaults: Record<string, VariableDefault> = {}
    private static compiledDefaults = new Map<string, IExtendedCompilationResult>()

    name: string = ReForgeDB.extensionName
    description: string = pkg.description
    version: string = pkg.version

    public commands!: DBCommandManager
    public emitter = new TypedEmitter<TransformEvents<IDBEvents>>()

    public constructor(public readonly options?: IReForgeDBOptions) {
        super()
        // Fail at start-up with a clear message, not on the first command.
        resolveSettings(options)
        if (options?.logLevel) DBLogger.level = options.logLevel
    }

    init(client: ForgeClient): void {
        this.commands = new DBCommandManager(client)

        EventManager.load(EVENT_HANDLER_NAME, __dirname + "/events")
        this.load(__dirname + "/functions")

        // Kept from ForgeDB: other code (QuorielDB's transfer, extensions) uses client.db.
        client.db = DataBase

        if (this.options?.events?.length) client.events.load(EVENT_HANDLER_NAME, this.options.events)

        // Connects in the background with retries; never rejects.
        void new DataBase(this.emitter, this.options).init()
    }

    /** Resolves once the database is connected (rejects after `timeout` ms). */
    public static ready(timeout?: number) {
        return DataBase.ready(timeout)
    }

    /**
     * Declares default values, used when a variable is read but was never
     * set (and the function call gives no default). Strings are ForgeScript
     * code and run in the reading command's context, so `"$username"` works.
     * Each call replaces the previous defaults.
     */
    public variables(rec: Record<string, VariableDefault>) {
        ReForgeDB.variables(rec)
    }

    public static variables(rec: Record<string, VariableDefault>) {
        if (!rec || typeof rec !== "object") throw new ReForgeDBError("ReForgeDB.variables() expects an object of name: default")
        ReForgeDB.rawDefaults = { ...rec }
        ReForgeDB.compiledDefaults.clear()
    }

    /** The declared defaults, as given to `variables()`. */
    public static get defaults(): Readonly<Record<string, VariableDefault>> {
        return ReForgeDB.rawDefaults
    }

    /** Whether a default was declared for `name`. */
    public static hasDefault(name: string) {
        return Object.prototype.hasOwnProperty.call(ReForgeDB.rawDefaults, name)
    }

    /**
     * The default for `name`: compiled ForgeScript for strings (compiled on
     * first use, once every extension's functions are registered), or the
     * value itself.
     */
    public static defaultFor(name: string): { code: IExtendedCompilationResult } | { value: unknown } | undefined {
        if (!ReForgeDB.hasDefault(name)) return undefined
        const raw = ReForgeDB.rawDefaults[name]
        if (typeof raw !== "string") return { value: raw }
        let code = ReForgeDB.compiledDefaults.get(name)
        if (!code) {
            try {
                code = Compiler.compile(raw)
            } catch (err) {
                throw new ReForgeDBError(`The default of variable "${name}" is not valid ForgeScript: ${errorMessage(err)}`, err)
            }
            ReForgeDB.compiledDefaults.set(name, code)
        }
        return { code }
    }
}

export { DataBaseManager, DataBase, Leaderboard, ReForgeDBError, DBLogger } from "./util"
export type { IReForgeDBOptions, IDataBaseOptions, LogLevel, SearchFilter, LeaderboardQuery, LeaderboardEntry, StoredRecord, RecordData } from "./util"
export { EVENT_HANDLER_NAME } from "./structures"
export type { IDBEvents } from "./structures"
