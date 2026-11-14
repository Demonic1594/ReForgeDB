import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase, SortType } from "../../util"
import { guarded, positiveInt } from "../../util/functions"

export default new NativeFunction({
    name: "$getUserLeaderboardID",
    version: "2.1.0",
    description: "Returns the user at a position of a user leaderboard",
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
            description: "The sort type for the leaderboard: 'asc' (ascending) or 'desc' (descending, the default)",
            rest: false,
            type: ArgType.Enum,
            enum: SortType,
        },
        {
            name: "position",
            description: "The position of the user to find, starting at 1",
            rest: false,
            type: ArgType.Number,
            required: true,
        },
    ],
    output: ArgType.User,
    async execute(_ctx, [name, sortType, pos]) {
        return guarded(this, async () => {
            const position = positiveInt(pos, 0)
            if (!position) return this.success()
            const board = await DataBase.leaderboard({ type: "user", name, sort: sortType === SortType.asc ? "asc" : "desc" })
            return this.success(board.entries[position - 1]?.id)
        })
    },
})
