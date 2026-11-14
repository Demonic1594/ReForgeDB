"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.internals = internals;
exports.pickId = pickId;
exports.requireId = requireId;
exports.pickText = pickText;
exports.guarded = guarded;
exports.readVariable = readVariable;
exports.sortOf = sortOf;
exports.positiveInt = positiveInt;
exports.renderLeaderboard = renderLeaderboard;
exports.cooldownGate = cooldownGate;
exports.resolveArgs = resolveArgs;
exports.findChannel = findChannel;
exports.channelScope = channelScope;
exports.pagesOf = pagesOf;
exports.eventRecord = eventRecord;
exports.variableTypeOf = variableTypeOf;
const async_hooks_1 = require("async_hooks");
const forgescript_1 = require("@tryforge/forgescript");
const database_1 = require("./database");
const logger_1 = require("./logger");
const types_1 = require("./types");
function internals(fn) {
    return fn;
}
/**
 * An ID from an argument. ForgeScript passes an empty optional argument as
 * `""`, not `null`; ForgeDB treated `""` as an ID and wrote to the wrong
 * variable (`$getUserVar[coins;;0]`). Empty, `null` and `undefined` mean "not
 * given". Objects (a resolved user, channel, guild, role) give their `id`.
 */
function pickId(value) {
    if (value === null || value === undefined)
        return undefined;
    if (typeof value === "object")
        return pickId(value.id);
    const text = String(value).trim();
    return text === "" ? undefined : text;
}
/** `pickId(given)`, else the context's ID; an error when there is neither. */
function requireId(given, fallback, what) {
    const id = pickId(given) ?? pickId(fallback);
    if (!id)
        throw new logger_1.ReForgeDBError(`No ${what} was given, and this command has no ${what} to use instead`);
    return id;
}
/** Text of an optional argument, or `undefined` when it is empty. */
function pickText(value) {
    if (value === null || value === undefined)
        return undefined;
    const text = String(value);
    return text === "" ? undefined : text;
}
/** How long (ms) an identical failure is not logged again. */
const REPEAT_WINDOW = 10_000;
const lastLogged = new Map();
/**
 * Logs a database failure once per `REPEAT_WINDOW`, with how often it
 * repeated in between: a database outage or a spammed command cannot flood
 * the console.
 */
function logFailure(line, cause) {
    const now = Date.now();
    const seen = lastLogged.get(line);
    if (seen && now - seen.at < REPEAT_WINDOW) {
        seen.skipped++;
        return;
    }
    if (lastLogged.size > 500)
        lastLogged.clear();
    lastLogged.set(line, { at: now, skipped: 0 });
    logger_1.ReForgeDBLogger.error(seen?.skipped ? `${line} (and ${seen.skipped} more times)` : line);
    if (cause)
        logger_1.ReForgeDBLogger.debug(cause);
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
async function guarded(fn, body) {
    try {
        return await body();
    }
    catch (err) {
        const message = (0, logger_1.errorMessage)(err);
        const line = `${fn.data.name}: ${message}`;
        if (err instanceof logger_1.ReForgeDBError && !err.cause)
            logger_1.ReForgeDBLogger.debug(line);
        else
            logFailure(line, err instanceof logger_1.ReForgeDBError ? err.cause : err);
        return fn.customError(`[ReForgeDB] ${message}`);
    }
}
/** Names of the variables whose default code is running in the current call chain. */
const defaultsInProgress = new async_hooks_1.AsyncLocalStorage();
function isCompiled(value) {
    return typeof value === "object" && value !== null && Array.isArray(value.functions);
}
/**
 * Reads a variable and applies, in order: the stored value, the default given
 * to the function, and the default declared with `ReForgeDB.variables()`.
 */
async function readVariable(fn, ctx, query, def) {
    const row = await database_1.DataBase.get(query);
    const value = row?.value;
    if (value !== null && value !== undefined)
        return fn.successJSON(value);
    const given = pickText(def);
    if (given !== undefined)
        return fn.successJSON(given);
    // Imported lazily: index.ts imports this file's module graph.
    const { ReForgeDB } = require("..");
    const fallback = ReForgeDB.defaultFor(query.name);
    if (!fallback)
        return fn.success();
    if ("value" in fallback)
        return fallback.value === null || fallback.value === undefined ? fn.success() : fn.successJSON(fallback.value);
    if (!isCompiled(fallback.code))
        return fn.success();
    // A default that reads its own variable (directly, or through another
    // default) would run forever.
    const name = query.name;
    const running = defaultsInProgress.getStore();
    if (running?.has(name))
        throw new logger_1.ReForgeDBError(`The default of variable "${name}" reads the variable itself (${[...running, name].join(" -> ")})`);
    const code = fallback.code;
    const result = await defaultsInProgress.run(new Set(running).add(name), () => forgescript_1.Interpreter.run(ctx.clone({
        data: code,
        allowTopLevelReturn: true,
        doNotSend: true,
        redirectErrorsToConsole: true,
    })));
    return result === null ? fn.stop() : fn.successJSON(result);
}
/** A leaderboard sort argument: `asc` (any case) or else `desc`. */
function sortOf(value) {
    if (value === 0 || value === "0")
        return "asc";
    return typeof value === "string" && value.trim().toLowerCase() === "asc" ? "asc" : "desc";
}
/** A positive whole number from an argument, or `fallback`. */
function positiveInt(value, fallback) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= 1 ? n : fallback;
}
/**
 * Renders `$userLeaderboard`, `$memberLeaderboard`, `$guildLeaderboard` and
 * `$channelLeaderboard`. Arguments are raw code, resolved here in order.
 */
async function renderLeaderboard(fn, ctx, spec) {
    const fields = (fn.data.fields ?? []);
    const it = internals(fn);
    const resolve = async (index) => (index === undefined ? fn.unsafeSuccess(null) : it.resolveCode(ctx, fields[index]));
    const name = await resolve(spec.fields.name);
    if (!it.isValidReturnType(name))
        return name;
    let guildId;
    if (spec.fields.guild !== undefined) {
        const guild = await resolve(spec.fields.guild);
        if (!it.isValidReturnType(guild))
            return guild;
        guildId = requireId(guild.value, ctx.guild?.id, "guild ID");
    }
    const sort = await resolve(spec.fields.sort);
    if (!it.isValidReturnType(sort))
        return sort;
    const max = await resolve(spec.fields.max);
    if (!it.isValidReturnType(max))
        return max;
    const page = await resolve(spec.fields.page);
    if (!it.isValidReturnType(page))
        return page;
    const separator = await resolve(spec.fields.separator);
    if (!it.isValidReturnType(separator))
        return separator;
    const envValue = await resolve(spec.fields.envValue);
    if (!it.isValidReturnType(envValue))
        return envValue;
    const envPosition = await resolve(spec.fields.envPosition);
    if (!it.isValidReturnType(envPosition))
        return envPosition;
    const perPage = positiveInt(max.value, 10);
    const pageNumber = positiveInt(page.value, 1);
    const board = await database_1.DataBase.leaderboard({ type: spec.type, name: String(name.value ?? ""), guildId, sort: sortOf(sort.value) });
    const { start, entries } = board.page(pageNumber, perPage);
    const valueKey = pickText(envValue.value);
    const positionKey = pickText(envPosition.value);
    const code = fields[spec.fields.code];
    const lines = [];
    for (let i = 0; i < entries.length; i++) {
        const row = entries[i];
        const position = start + i + 1;
        const label = spec.label(ctx, row.id, guildId);
        if (positionKey)
            ctx.setEnvironmentKey(positionKey, position);
        if (valueKey) {
            ctx.setEnvironmentKey(valueKey, {
                [spec.labelKey]: label,
                identifier: database_1.DataBase.make_intetifier({ type: spec.type, name: board.query.name, id: row.id, guildId }),
                name: board.query.name,
                id: row.id,
                type: spec.type,
                value: row.value,
                guildId: guildId ?? null,
            });
        }
        if (!code) {
            lines.push(`${position}. ${label ?? row.id} ~ ${row.value}`);
            continue;
        }
        const out = await it.resolveCode(ctx, code);
        if (out.success || out.return) {
            if (out.value !== null && out.value !== undefined && out.value !== "")
                lines.push(String(out.value));
        }
        else if (out.break)
            break;
        else if (out.continue)
            continue;
        else
            return out;
    }
    return fn.success(lines.join(pickText(separator.value) ?? "\n"));
}
/**
 * The body of the persistent cooldown functions: starts the cooldown, or,
 * when it is running, sets `$env[time]` to the ms left, sends the `code`
 * argument and stops the command.
 */
async function cooldownGate(fn, ctx, cooldown, codeIndex) {
    const left = await database_1.DataBase.cdClaim(cooldown);
    if (left === 0)
        return fn.success();
    ctx.setEnvironmentKey("time", left);
    const it = internals(fn);
    const content = await it.resolveCode(ctx, fn.data.fields?.[codeIndex]);
    if (!it.isValidReturnType(content))
        return content;
    ctx.container.content = content.value;
    await ctx.container.send(ctx.obj);
    return fn.stop();
}
/** Resolves arguments of an `unwrap: false` function by index, stopping at the first failure. */
async function resolveArgs(fn, ctx, indexes) {
    const it = internals(fn);
    const values = [];
    for (const i of indexes) {
        const rt = await it.resolveUnhandledArg(ctx, i);
        if (!it.isValidReturnType(rt))
            return { fail: rt };
        values.push(rt.value);
    }
    return { values };
}
/**
 * A channel by ID without crashing on a deleted or unknown one: ForgeScript's
 * `Channel` argument type lets the fetch error escape (`$try` cannot catch
 * it). Returns `null` when the channel cannot be found.
 */
async function findChannel(ctx, id) {
    const cached = ctx.client.channels.cache.get(id);
    if (cached)
        return cached;
    if (!/^\d{16,23}$/.test(id))
        return null;
    return ctx.client.channels.fetch(id).catch(() => null);
}
/** The guild of a channel variable: the channel's guild, else the command's guild. */
async function channelScope(ctx, given) {
    const id = requireId(given, ctx.channel?.id, "channel ID");
    const channel = id === ctx.channel?.id ? ctx.channel : await findChannel(ctx, id);
    const guildId = channel?.guildId ?? ctx.guild?.id;
    return { id, guildId: guildId ?? undefined };
}
/**
 * Pages of a leaderboard: `count / perPage`, rounded up unless `decimals`.
 * `perPage` defaults to 1 (the count itself) and must be above 0.
 */
function pagesOf(count, perPage, decimals) {
    const per = perPage === null || perPage === undefined || perPage === "" ? 1 : Number(perPage);
    if (!Number.isFinite(per) || per <= 0)
        throw new logger_1.ReForgeDBError(`The page length must be a number above 0, got ${String(perPage)}`);
    const pages = count / per;
    return decimals === true ? pages : Math.ceil(pages);
}
/**
 * The record a `$data`, `$newData` or `$oldData` call refers to, or `null`
 * outside ReForgeDB's events (ForgeDB threw a TypeError there).
 */
function eventRecord(ctx, which) {
    const extras = ctx.runtime.extras;
    if (!extras || typeof extras !== "object")
        return null;
    let record;
    if (which === "data")
        record = extras.data ?? extras.newData;
    else if (which === "newData")
        record = extras.newData ?? (extras.event === "variableCreate" ? extras.data : undefined);
    else
        record = extras.oldData ?? (extras.event === "variableDelete" ? extras.data : undefined);
    return record && typeof record === "object" ? record : null;
}
/** A `VariableType` enum argument as a record type (ForgeScript gives a number, or a name for numeric input). */
function variableTypeOf(value) {
    if (typeof value === "number")
        return types_1.VariableType[value] ?? undefined;
    if (typeof value === "string" && value in types_1.VariableType && Number.isNaN(Number(value)))
        return value;
    return undefined;
}
//# sourceMappingURL=functions.js.map