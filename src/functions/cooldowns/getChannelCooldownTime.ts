import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, pickId } from "../../util/functions"

/*
 * Kept for old code. ForgeScript's in-memory $channelCooldown has no working
 * getter (its file registers itself as $getCooldownTime), so this function
 * answers for both: a $dbChannelCooldown of that name for the channel, or
 * else ForgeScript's in-memory channel cooldown of this command, where the
 * first argument is the channel ID.
 */
export default new NativeFunction({
    name: "$getChannelCooldownTime",
    version: "2.0.0",
    description: "Returns the ms left of a channel cooldown, or 0: one started with $dbChannelCooldown[name], or ForgeScript's $channelCooldown[channel ID] of this command",
    output: ArgType.Number,
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The cooldown name ($dbChannelCooldown), or the channel ID (ForgeScript's $channelCooldown)",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "channel ID",
            description: "The channel ID, defaults to the channel of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, channel]) {
        return guarded(this, async () => {
            const id = pickId(channel) ?? ctx.channel?.id
            const stored = (await DataBase.cdTimeLeft(DataBase.make_cdIdentifier({ name, id }))).left
            if (stored > 0) return this.success(stored)
            const cooldowns = ctx.client.cooldowns as { getTimeLeft?(id: string): number; identifier?(...v: unknown[]): string } | undefined
            const command = ctx.cmd?.id
            if (command !== undefined && cooldowns?.getTimeLeft && cooldowns.identifier) {
                return this.success(cooldowns.getTimeLeft(cooldowns.identifier(command, "channel", pickId(name) ?? id)) || 0)
            }
            return this.success(0)
        })
    },
})
