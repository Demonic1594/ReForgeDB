import { AsyncLocalStorage } from "async_hooks"
import { CompiledFunction, Context, IExtendedCompiledFunctionField, Interpreter, Return } from "@tryforge/forgescript"
import { DataBase } from "./database"
import { ReForgeDBLogger, errorMessage, ReForgeDBError } from "./logger"
import { RecordData, RecordType, VariableType } from "./types"

/*
 * Shared code of the native functions. It lives outside `functions/`
 * because ForgeScript loads every file in that folder as a function.
 */

type Fn = CompiledFunction

/** The CompiledFunction methods ForgeScript marks private but extensions need. */
interface FnInternals {
    resolveCode(ctx: Context, field?: unknown): Promise<Return>
    resolveUnhandledArg(ctx: Context, index: number): Promise<Return>
    isValidReturnType(rt: Return): boolean
}

export function internals(fn: Fn) {
    return fn as unknown as FnInternals
}

/**
 * An ID from an argument. ForgeScript passes an empty optional argument as
 * `""`, not `null`; ForgeDB treated `""` as an ID and wrote to the wrong
 * variable (`$getUserVar[coins;;0]`). Empty, `null` and `undefined` mean "not
 * given". Objects (a resolved user, channel, guild, role) give their `id`.
 */
export function pickId(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined
    if (typeof value === "object") return pickId((value as { id?: unknown }).id)
    const text = String(value).trim()
    return text === "" ? undefined : text
}

/** `pickId(given)`, else the context's ID; an error when there is neither. */
export function requireId(given: unknown, fallback: string | undefined | null, what: string): string {
    const id = pickId(given) ?? pickId(fallback)
    if (!id) throw new ReForgeDBError(`No ${what} was given, and this command has no ${what} to use instead`)
    return id
}

/** Text of an optional argument, or `undefined` when it is empty. */
export function pickText(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined
    const text = String(value)
    return text === "" ? undefined : text
}

/** How long (ms) an identical failure is not logged again. */
const REPEAT_WINDOW = 10_000
const lastLogged = new Map<string, { at: number; skipped: number }>()

/**
 * Logs a database failure once per `REPEAT_WINDOW`, with how often it
 * repeated in between: a database outage or a spammed command cannot flood
 * the console.
 */
function logFailure(line: string, cause: unknown) {
    const now = Date.now()
    const seen = lastLogged.get(line)
    if (seen && now - seen.at < REPEAT_WINDOW) {
        seen.skipped++
        return
    }
    if (lastLogged.size > 500) lastLogged.clear()
    lastLogged.set(line, { at: now, skipped: 0 })
    ReForgeDBLogger.error(seen?.skipped ? `${line} (and ${seen.skipped} more times)` : line)
    if (cause) ReForgeDBLogger.debug(cause)
}

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
export async function guarded(fn: Fn, body: () => Promise<Return> | Return): Promise<Return> {
    try {
        return await body()
    } catch (err) {
        const message = errorMessage(err)
        const line = `${fn.data.name}: ${message}`
        if (err instanceof ReForgeDBError && !err.cause) ReForgeDBLogger.debug(line)
        else logFailure(line, err instanceof ReForgeDBError ? err.cause : err)
        return fn.customError(`[ReForgeDB] ${message}`)
    }
}

/** Names of the variables whose default code is running in the current call chain. */
const defaultsInProgress = new AsyncLocalStorage<Set<string>>()

function isCompiled(value: unknown): value is { functions: unknown[] } {
    return typeof value === "object" && value !== null && Array.isArray((value as { functions?: unknown }).functions)
}

/**
 * Reads a variable and applies, in order: the stored value, the default given
 * to the function, and the default declared with `ReForgeDB.variables()`.
 */
export async function readVariable(fn: Fn, ctx: Context, query: RecordData, def: unknown): Promise<Return> {
    const row = await DataBase.get(query)
    const value = row?.value
    if (value !== null && value !== undefined) return fn.successJSON(value)
    const given = pickText(def)
    if (given !== undefined) return fn.successJSON(given)

    // Imported lazily: index.ts imports this file's module graph.
    const { ReForgeDB } = require("..") as typeof import("..")
    const fallback = ReForgeDB.defaultFor(query.name!)
    if (!fallback) return fn.success()
    if ("value" in fallback) return fallback.value === null || fallback.value === undefined ? fn.success() : fn.successJSON(fallback.value)
    if (!isCompiled(fallback.code)) return fn.success()
    // A default that reads its own variable (directly, or through another
    // default) would run forever.
    const name = query.name!
    const running = defaultsInProgress.getStore()
    if (running?.has(name)) throw new ReForgeDBError(`The default of variable "${name}" reads the variable itself (${[...running, name].join(" -> ")})`)
    const code = fallback.code
    const result = await defaultsInProgress.run(new Set(running).add(name), () =>
        Interpreter.run(
            ctx.clone({
                data: code,
                allowTopLevelReturn: true,
                doNotSend: true,
                redirectErrorsToConsole: true,
            })
        )
    )
    return result === null ? fn.stop() : fn.successJSON(result)
}

/** A leaderboard sort argument: `asc` (any case) or else `desc`. */
export function sortOf(value: unknown): "asc" | "desc" {
    if (value === 0 || value === "0") return "asc"
    return typeof value === "string" && value.trim().toLowerCase() === "asc" ? "asc" : "desc"
}

/** A positive whole number from an argument, or `fallback`. */
export function positiveInt(value: unknown, fallback: number): number {
    const n = Math.floor(Number(value))
    return Number.isFinite(n) && n >= 1 ? n : fallback
}

export interface LeaderboardRender {
    type: RecordType
    /** Field index of each argument; `guild` only for guild-scoped types. */
    fields: { name: number; guild?: number; sort: number; max: number; page: number; separator: number; envValue: number; envPosition: number; code: number }
    /** Key of the display name in the `envValue` object (`username`, `guild_name`, `channel_name`). */
    labelKey: string
    /** Display name of a row, or `undefined` when it is not cached. */
    label(ctx: Context, id: string, guildId: string | undefined): string | undefined
}

/**
 * Renders `$userLeaderboard`, `$memberLeaderboard`, `$guildLeaderboard` and
 * `$channelLeaderboard`. Arguments are raw code, resolved here in order.
 */
export async function renderLeaderboard(fn: Fn, ctx: Context, spec: LeaderboardRender): Promise<Return> {
    const fields = (fn.data.fields ?? []) as IExtendedCompiledFunctionField[]
    const it = internals(fn)
    const resolve = async (index: number | undefined) => (index === undefined ? fn.unsafeSuccess(null) : it.resolveCode(ctx, fields[index]))

    const name = await resolve(spec.fields.name)
    if (!it.isValidReturnType(name)) return name
    let guildId: string | undefined
    if (spec.fields.guild !== undefined) {
        const guild = await resolve(spec.fields.guild)
        if (!it.isValidReturnType(guild)) return guild
        guildId = requireId(guild.value, ctx.guild?.id, "guild ID")
    }
    const sort = await resolve(spec.fields.sort)
    if (!it.isValidReturnType(sort)) return sort
    const max = await resolve(spec.fields.max)
    if (!it.isValidReturnType(max)) return max
    const page = await resolve(spec.fields.page)
    if (!it.isValidReturnType(page)) return page
    const separator = await resolve(spec.fields.separator)
    if (!it.isValidReturnType(separator)) return separator
    const envValue = await resolve(spec.fields.envValue)
    if (!it.isValidReturnType(envValue)) return envValue
    const envPosition = await resolve(spec.fields.envPosition)
    if (!it.isValidReturnType(envPosition)) return envPosition

    const perPage = positiveInt(max.value, 10)
    const pageNumber = positiveInt(page.value, 1)
    const board = await DataBase.leaderboard({ type: spec.type, name: String(name.value ?? ""), guildId, sort: sortOf(sort.value) })
    const { start, entries } = board.page(pageNumber, perPage)
    const valueKey = pickText(envValue.value)
    const positionKey = pickText(envPosition.value)
    const code = fields[spec.fields.code]
    const lines: string[] = []

    for (let i = 0; i < entries.length; i++) {
        const row = entries[i]
        const position = start + i + 1
        const label = spec.label(ctx, row.id, guildId)
        if (positionKey) ctx.setEnvironmentKey(positionKey, position)
        if (valueKey) {
            ctx.setEnvironmentKey(valueKey, {
                [spec.labelKey]: label,
                identifier: DataBase.make_intetifier({ type: spec.type, name: board.query.name, id: row.id, guildId } as RecordData),
                name: board.query.name,
                id: row.id,
                type: spec.type,
                value: row.value,
                guildId: guildId ?? null,
            })
        }
        if (!code) {
            lines.push(`${position}. ${label ?? row.id} ~ ${row.value}`)
            continue
        }
        const out = await it.resolveCode(ctx, code)
        if (out.success || out.return) {
            if (out.value !== null && out.value !== undefined && out.value !== "") lines.push(String(out.value))
        } else if (out.break) break
        else if (out.continue) continue
        else return out
    }
    return fn.success(lines.join(pickText(separator.value) ?? "\n"))
}

/**
 * The body of the persistent cooldown functions: starts the cooldown, or,
 * when it is running, sets `$env[time]` to the ms left, sends the `code`
 * argument and stops the command.
 */
export async function cooldownGate(fn: Fn, ctx: Context, cooldown: { name: string; id?: string; duration: number }, codeIndex: number): Promise<Return> {
    const left = await DataBase.cdClaim(cooldown)
    if (left === 0) return fn.success()
    ctx.setEnvironmentKey("time", left)
    const it = internals(fn)
    const content = await it.resolveCode(ctx, fn.data.fields?.[codeIndex])
    if (!it.isValidReturnType(content)) return content
    ctx.container.content = content.value as string
    await ctx.container.send(ctx.obj)
    return fn.stop()
}

/** Resolves arguments of an `unwrap: false` function by index, stopping at the first failure. */
export async function resolveArgs(fn: Fn, ctx: Context, indexes: number[]): Promise<{ values: unknown[] } | { fail: Return }> {
    const it = internals(fn)
    const values: unknown[] = []
    for (const i of indexes) {
        const rt = await it.resolveUnhandledArg(ctx, i)
        if (!it.isValidReturnType(rt)) return { fail: rt }
        values.push(rt.value)
    }
    return { values }
}

/**
 * A channel by ID without crashing on a deleted or unknown one: ForgeScript's
 * `Channel` argument type lets the fetch error escape (`$try` cannot catch
 * it). Returns `null` when the channel cannot be found.
 */
export async function findChannel(ctx: Context, id: string) {
    const cached = ctx.client.channels.cache.get(id)
    if (cached) return cached
    if (!/^\d{16,23}$/.test(id)) return null
    return ctx.client.channels.fetch(id).catch(() => null)
}

/** The guild of a channel variable: the channel's guild, else the command's guild. */
export async function channelScope(ctx: Context, given: unknown) {
    const id = requireId(given, ctx.channel?.id, "channel ID")
    const channel = id === ctx.channel?.id ? ctx.channel : await findChannel(ctx, id)
    const guildId = (channel as { guildId?: string | null } | null)?.guildId ?? ctx.guild?.id
    return { id, guildId: guildId ?? undefined }
}

/**
 * Pages of a leaderboard: `count / perPage`, rounded up unless `decimals`.
 * `perPage` defaults to 1 (the count itself) and must be above 0.
 */
export function pagesOf(count: number, perPage: unknown, decimals: unknown): number {
    const per = perPage === null || perPage === undefined || perPage === "" ? 1 : Number(perPage)
    if (!Number.isFinite(per) || per <= 0) throw new ReForgeDBError(`The page length must be a number above 0, got ${String(perPage)}`)
    const pages = count / per
    return decimals === true ? pages : Math.ceil(pages)
}

/**
 * The record a `$data`, `$newData` or `$oldData` call refers to, or `null`
 * outside ReForgeDB's events (ForgeDB threw a TypeError there).
 */
export function eventRecord(ctx: Context, which: "data" | "newData" | "oldData"): Record<string, unknown> | null {
    const extras = ctx.runtime.extras as { data?: unknown; newData?: unknown; oldData?: unknown; event?: string } | null | undefined
    if (!extras || typeof extras !== "object") return null
    let record: unknown
    if (which === "data") record = extras.data ?? extras.newData
    else if (which === "newData") record = extras.newData ?? (extras.event === "variableCreate" ? extras.data : undefined)
    else record = extras.oldData ?? (extras.event === "variableDelete" ? extras.data : undefined)
    return record && typeof record === "object" ? (record as Record<string, unknown>) : null
}

/** A `VariableType` enum argument as a record type (ForgeScript gives a number, or a name for numeric input). */
export function variableTypeOf(value: unknown): RecordType | undefined {
    if (typeof value === "number") return (VariableType[value] as RecordType | undefined) ?? undefined
    if (typeof value === "string" && value in VariableType && Number.isNaN(Number(value))) return value as RecordType
    return undefined
}
