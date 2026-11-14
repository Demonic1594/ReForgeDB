import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase, SortType } from "../../util"
import { guarded, positiveInt } from "../../util/functions"

export default new NativeFunction({
    name: "$getGuildLeaderboardID",
    version: "2.1.0",
    description: "Returns the guild at a position of a guild leaderboard",
    aliases: ["$getServerLeaderboardID"],
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The name of the variable",
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
            name: "position",
            description: "The position of the guild to find, starting at 1",
            rest: false,
            type: ArgType.Number,
            required: true,
        },
    ],
    output: ArgType.Guild,
    async execute(_ctx, [name, sortType, pos]) {
        return guarded(this, async () => {
            const position = positiveInt(pos, 0)
            if (!position) return this.success()
            const board = await DataBase.leaderboard({ type: "guild", name, sort: sortType === SortType.asc ? "asc" : "desc" })
            return this.success(board.entries[position - 1]?.id)
        })
    },
})
