import { CompiledFunction, Context, Return } from "@tryforge/forgescript";
import { RecordData, RecordType } from "./types";
type Fn = CompiledFunction;
/** The CompiledFunction methods ForgeScript marks private but extensions need. */
interface FnInternals {
    resolveCode(ctx: Context, field?: unknown): Promise<Return>;
    resolveUnhandledArg(ctx: Context, index: number): Promise<Return>;
    isValidReturnType(rt: Return): boolean;
}
export declare function internals(fn: Fn): FnInternals;
/**
 * An ID from an argument. ForgeScript passes an empty optional argument as
 * `""`, not `null`; ForgeDB treated `""` as an ID and wrote to the wrong
 * variable (`$getUserVar[coins;;0]`). Empty, `null` and `undefined` mean "not
 * given". Objects (a resolved user, channel, guild, role) give their `id`.
 */
export declare function pickId(value: unknown): string | undefined;
/** `pickId(given)`, else the context's ID; an error when there is neither. */
export declare function requireId(given: unknown, fallback: string | undefined | null, what: string): string;
/** Text of an optional argument, or `undefined` when it is empty. */
export declare function pickText(value: unknown): string | undefined;
/**
 * Runs a function body and turns any thrown error into a ForgeScript error,
 * so `$try` can catch it and the bot shows what went wrong. ForgeDB let them
 * escape: the command stopped silently and only the console had a trace.
 *
 * Database failures are logged as errors. Mistakes in the command (a missing
 * ID, a bad page length) and "not connected yet" are only logged at `debug`:
 * the command's author sees them in Discord, and the connection loop already
 * reports the outage.
 */
export declare function guarded(fn: Fn, body: () => Promise<Return> | Return): Promise<Return>;
/**
 * Reads a variable and applies, in order: the stored value, the default given
 * to the function, and the default declared with `ReForgeDB.variables()`.
 */
export declare function readVariable(fn: Fn, ctx: Context, query: RecordData, def: unknown): Promise<Return>;
/** A leaderboard sort argument: `asc` (any case) or else `desc`. */
export declare function sortOf(value: unknown): "asc" | "desc";
/** A positive whole number from an argument, or `fallback`. */
export declare function positiveInt(value: unknown, fallback: number): number;
export interface LeaderboardRender {
    type: RecordType;
    /** Field index of each argument; `guild` only for guild-scoped types. */
    fields: {
        name: number;
        guild?: number;
        sort: number;
        max: number;
        page: number;
        separator: number;
        envValue: number;
        envPosition: number;
        code: number;
    };
    /** Key of the display name in the `envValue` object (`username`, `guild_name`, `channel_name`). */
    labelKey: string;
    /** Display name of a row, or `undefined` when it is not cached. */
    label(ctx: Context, id: string, guildId: string | undefined): string | undefined;
}
/**
 * Renders `$userLeaderboard`, `$memberLeaderboard`, `$guildLeaderboard` and
 * `$channelLeaderboard`. Arguments are raw code, resolved here in order.
 */
export declare function renderLeaderboard(fn: Fn, ctx: Context, spec: LeaderboardRender): Promise<Return>;
/**
 * The body of the persistent cooldown functions: starts the cooldown, or,
 * when it is running, sets `$env[time]` to the ms left, sends the `code`
 * argument and stops the command.
 */
export declare function cooldownGate(fn: Fn, ctx: Context, cooldown: {
    name: string;
    id?: string;
    duration: number;
}, codeIndex: number): Promise<Return>;
/** Resolves arguments of an `unwrap: false` function by index, stopping at the first failure. */
export declare function resolveArgs(fn: Fn, ctx: Context, indexes: number[]): Promise<{
    values: unknown[];
} | {
    fail: Return;
}>;
/**
 * A channel by ID without crashing on a deleted or unknown one: ForgeScript's
 * `Channel` argument type lets the fetch error escape (`$try` cannot catch
 * it). Returns `null` when the channel cannot be found.
 */
export declare function findChannel(ctx: Context, id: string): Promise<import("discord.js").Channel | null>;
/** The guild of a channel variable: the channel's guild, else the command's guild. */
export declare function channelScope(ctx: Context, given: unknown): Promise<{
    id: string;
    guildId: string | undefined;
}>;
/**
 * Pages of a leaderboard: `count / perPage`, rounded up unless `decimals`.
 * `perPage` defaults to 1 (the count itself) and must be above 0.
 */
export declare function pagesOf(count: number, perPage: unknown, decimals: unknown): number;
/**
 * The record a `$data`, `$newData` or `$oldData` call refers to, or `null`
 * outside ReForgeDB's events (ForgeDB threw a TypeError there).
 */
export declare function eventRecord(ctx: Context, which: "data" | "newData" | "oldData"): Record<string, unknown> | null;
/** A `VariableType` enum argument as a record type (ForgeScript gives a number, or a name for numeric input). */
export declare function variableTypeOf(value: unknown): RecordType | undefined;
export {};
//# sourceMappingURL=functions.d.ts.map