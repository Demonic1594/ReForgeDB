import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, pagesOf } from "../../util/functions"

export default new NativeFunction({
    name: "$getGuildLeaderboardLength",
    version: "2.0.0",
    description: "Returns the number of pages of a guild leaderboard (guilds with a number value)",
    aliases: ["$getServerLeaderboardLength"],
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
            name: "length",
            description: "The number of guilds per page, defaults to 1 (the number of guilds)",
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
    async execute(_ctx, [name, length, decimals]) {
        return guarded(this, async () => {
            const board = await DataBase.leaderboard({ type: "guild", name })
            return this.success(pagesOf(board.count, length, decimals))
        })
    },
})
