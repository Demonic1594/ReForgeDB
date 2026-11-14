import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, pagesOf, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$getChannelLeaderboardLength",
    version: "2.0.0",
    description: "Returns the number of pages of a channel leaderboard (channels with a number value)",
    output: ArgType.Number,
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable to query",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "guild ID",
            description: "The guild ID of the channels, defaults to the guild of the command",
            rest: false,
            type: ArgType.Guild,
            required: false,
        },
        {
            name: "length",
            description: "The number of channels per page, defaults to 1 (the number of channels)",
            rest: false,
            type: ArgType.Number,
            required: false,
        },
        {
            name: "decimals",
            description: "Specify whether to return decimals for more precise results (default: false)",
            rest: false,
            type: ArgType.Boolean,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, guild, length, decimals]) {
        return guarded(this, async () => {
            const board = await DataBase.leaderboard({ type: "channel", name, guildId: requireId(guild, ctx.guild?.id, "guild ID") })
            return this.success(pagesOf(board.count, length, decimals))
        })
    },
})
