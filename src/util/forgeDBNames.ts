import { ForgeClient, FunctionManager, NativeFunction } from "@tryforge/forgescript"
import { ReForgeDBLogger as log } from "./logger"

/**
 * ForgeDB's names for its stored cooldowns, and the ReForgeDB function each one is. The arguments are the
 * same, in the same order (checked against ForgeDB 2.1.1). ForgeScript has functions with these names:
 * in-memory cooldowns whose first argument is an ID. `$getChannelCooldownTime` is not here: ReForgeDB's
 * answers for stored cooldowns by name already.
 */
export const FORGEDB_COOLDOWN_NAMES: Readonly<Record<string, string>> = Object.freeze({
    $userCooldown: "$dbUserCooldown",
    $memberCooldown: "$dbMemberCooldown",
    $guildCooldown: "$dbGuildCooldown",
    $channelCooldown: "$dbChannelCooldown",
    $getUserCooldownTime: "$dbGetUserCooldownTime",
    $getMemberCooldownTime: "$dbGetMemberCooldownTime",
    $getGuildCooldownTime: "$dbGetGuildCooldownTime",
    $deleteUserCooldown: "$dbDeleteUserCooldown",
    $deleteMemberCooldown: "$dbDeleteMemberCooldown",
    $deleteGuildCooldown: "$dbDeleteGuildCooldown",
    $deleteChannelCooldown: "$dbDeleteChannelCooldown",
})

/**
 * `forgeDBCooldownNames: true`: registers ForgeDB's names as copies of the `$db` functions. They replace
 * ForgeScript's functions of those names, also when another client in this process loaded them first.
 */
export function registerForgeDBCooldownNames(): string[] {
    const copies: NativeFunction[] = []
    for (const [legacy, stored] of Object.entries(FORGEDB_COOLDOWN_NAMES)) {
        const fn = FunctionManager.get(stored) as NativeFunction | undefined
        if (!fn) continue
        copies.push(
            new NativeFunction({
                ...fn.data,
                name: legacy,
                aliases: undefined,
                version: "3.3.0",
                description: `ForgeDB's name for ${stored} (forgeDBCooldownNames): ${fn.data.description}`,
            } as never)
        )
    }
    FunctionManager.addMany(copies)
    log.info(
        `forgeDBCooldownNames: ${copies.map((c) => c.name).join(", ")} are stored cooldowns with ForgeDB's arguments. ForgeScript's start-up warning "Attempted to override the following ${copies.length} functions" is its own versions of these names being skipped.`
    )
    return copies.map((c) => c.name)
}

/** The ready event's name: `clientReady` on discord.js 14.22 and newer, `ready` before. */
export function readyEventName(): string {
    try {
        return require("discord.js").Events?.ClientReady ?? "ready"
    } catch {
        return "ready"
    }
}

const LEGACY_CALL = new RegExp(
    `\\$(${Object.keys(FORGEDB_COOLDOWN_NAMES)
        .map((n) => n.slice(1))
        .join("|")})\\[([^;\\]]*)`,
    "gi"
)
/** A first argument that is an ID (or a function that gives one): ForgeScript's own use of the name. */
const ID_LIKE = /^(\$|\d{15,21}$|<[@#][!&]?\d{15,21}>$)/

export interface LegacyCooldownCall {
    /** The command, with its file when it was loaded from one. */
    command: string
    /** The call as written, shortened: `$userCooldown[daily;...]`. */
    call: string
    /** The first argument: ForgeDB's cooldown name. */
    name: string
    /** The ReForgeDB function to use instead. */
    replacement: string
}

type CommandLike = { data?: { code?: unknown; name?: unknown; type?: unknown; path?: unknown } }

/** Walks command managers (collections of arrays of commands, nested for application commands). */
function* commandsIn(value: unknown, depth = 0): Generator<CommandLike> {
    if (!value || typeof value !== "object" || depth > 4) return
    const v = value as CommandLike & { values?: () => Iterable<unknown> }
    if (v.data && typeof v.data.code === "string") {
        yield v
        return
    }
    if (Array.isArray(value)) for (const x of value) yield* commandsIn(x, depth + 1)
    else if (typeof v.values === "function") for (const x of v.values()) yield* commandsIn(x, depth + 1)
}

/**
 * Finds calls written for ForgeDB's stored cooldowns, `$userCooldown[daily;1d;...]`: a first argument that
 * is not an ID. With ReForgeDB (without forgeDBCooldownNames) those run ForgeScript's in-memory cooldown,
 * which reads "daily" as the user ID: one cooldown for every user, lost on restart.
 */
export function findLegacyCooldownCalls(client: ForgeClient): LegacyCooldownCall[] {
    const managers: unknown[] = [
        (client.commands as unknown as { commands?: unknown })?.commands,
        (client as unknown as { applicationCommands?: { commands?: unknown } }).applicationCommands?.commands,
    ]
    for (const ext of client.options.extensions ?? []) {
        const cm = (ext as unknown as { commands?: { commands?: unknown } }).commands
        if (cm && (cm as unknown) !== (client.commands as unknown)) managers.push(cm.commands)
    }
    const found: LegacyCooldownCall[] = []
    const seen = new Set<unknown>()
    for (const manager of managers) {
        for (const cmd of commandsIn(manager)) {
            if (seen.has(cmd)) continue
            seen.add(cmd)
            for (const m of String(cmd.data?.code).matchAll(LEGACY_CALL)) {
                const first = m[2].trim()
                if (!first || ID_LIKE.test(first)) continue
                const legacy = Object.keys(FORGEDB_COOLDOWN_NAMES).find((k) => k.toLowerCase() === `$${m[1].toLowerCase()}`)!
                const label = cmd.data?.name ? `"${String(cmd.data.name)}"` : `of type ${String(cmd.data?.type ?? "?")}`
                const path = typeof cmd.data?.path === "string" ? ` (${cmd.data.path})` : ""
                found.push({ command: `${label}${path}`, call: `${legacy}[${first};...]`, name: first, replacement: FORGEDB_COOLDOWN_NAMES[legacy] })
            }
        }
    }
    return found
}

/** Logs each ForgeDB-style cooldown call once, with the two ways to fix it. */
export function warnLegacyCooldownCalls(client: ForgeClient, limit = 10): LegacyCooldownCall[] {
    const found = findLegacyCooldownCalls(client)
    for (const f of found.slice(0, limit)) {
        log.warn(
            `Command ${f.command} uses ${f.call}, written for ForgeDB's stored cooldowns. With ReForgeDB this name is ForgeScript's in-memory cooldown, which reads "${f.name}" as the ID: every user shares one cooldown, and it is lost on restart. Rename it to ${f.replacement}[${f.name};...], or set forgeDBCooldownNames: true to keep ForgeDB's names.`
        )
    }
    if (found.length > limit) log.warn(`...and ${found.length - limit} more ForgeDB-style cooldown calls.`)
    return found
}
