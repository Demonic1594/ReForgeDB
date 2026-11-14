import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase, SortType } from "../../util"
import { guarded, pickId } from "../../util/functions"

export default new NativeFunction({
    name: "$getUserLeaderboardValue",
    version: "2.0.0",
    description: "Returns the position of a user in the leaderboard of a variable, or 0 when the user is not on it",
    aliases: ["$getUserLeaderboardPosition"],
    output: ArgType.Number,
    unwrap: true,
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
            name: "user ID",
            description: "The user ID, defaults to the user of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, sortType, user]) {
        return guarded(this, async () => {
            const board = await DataBase.leaderboard({ type: "user", name, sort: sortType === SortType.asc ? "asc" : "desc" })
            return this.success(board.positionOf(pickId(user) ?? ctx.user?.id))
        })
    },
})
