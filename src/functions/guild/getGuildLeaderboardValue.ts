import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase, SortType } from "../../util"
import { guarded, pickId } from "../../util/functions"

export default new NativeFunction({
    name: "$getGuildLeaderboardValue",
    version: "2.0.0",
    description: "Retrieves the position of a guild in the leaderboard of a variable, or 0 when the guild is not on it",
    aliases: ["$getServerLeaderboardValue", "$getGuildLeaderboardPosition", "$getServerLeaderboardPosition"],
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
            name: "sort type",
            description: "The sort order for the leaderboard, either ascending (asc) or descending (desc, the default)",
            rest: false,
            type: ArgType.Enum,
            enum: SortType,
        },
        {
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, sortType, guild]) {
        return guarded(this, async () => {
            const board = await DataBase.leaderboard({ type: "guild", name, sort: sortType === SortType.asc ? "asc" : "desc" })
            return this.success(board.positionOf(pickId(guild) ?? ctx.guild?.id))
        })
    },
})
