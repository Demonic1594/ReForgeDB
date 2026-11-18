import { ForgeClient } from "@tryforge/forgescript";
/**
 * ForgeDB's names for its stored cooldowns, and the ReForgeDB function each one is. The arguments are the
 * same, in the same order (checked against ForgeDB 2.1.1). ForgeScript has functions with these names:
 * in-memory cooldowns whose first argument is an ID. `$getChannelCooldownTime` is not here: ReForgeDB's
 * answers for stored cooldowns by name already.
 */
export declare const FORGEDB_COOLDOWN_NAMES: Readonly<Record<string, string>>;
/**
 * `forgeDBCooldownNames: true`: registers ForgeDB's names as copies of the `$db` functions. They replace
 * ForgeScript's functions of those names, also when another client in this process loaded them first.
 */
export declare function registerForgeDBCooldownNames(): string[];
/** The ready event's name: `clientReady` on discord.js 14.22 and newer, `ready` before. */
export declare function readyEventName(): string;
export interface LegacyCooldownCall {
    /** The command, with its file when it was loaded from one. */
    command: string;
    /** The call as written, shortened: `$userCooldown[daily;...]`. */
    call: string;
    /** The first argument: ForgeDB's cooldown name. */
    name: string;
    /** The ReForgeDB function to use instead. */
    replacement: string;
}
/**
 * Finds calls written for ForgeDB's stored cooldowns, `$userCooldown[daily;1d;...]`: a first argument that
 * is not an ID. With ReForgeDB (without forgeDBCooldownNames) those run ForgeScript's in-memory cooldown,
 * which reads "daily" as the user ID: one cooldown for every user, lost on restart.
 */
export declare function findLegacyCooldownCalls(client: ForgeClient): LegacyCooldownCall[];
/** Logs each ForgeDB-style cooldown call once, with the two ways to fix it. */
export declare function warnLegacyCooldownCalls(client: ForgeClient, limit?: number): LegacyCooldownCall[];
//# sourceMappingURL=forgeDBNames.d.ts.map