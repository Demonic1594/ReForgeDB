import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, pagesOf } from "../../util/functions"

export default new NativeFunction({
    name: "$getUserLeaderboardLength",
    version: "2.0.0",
    description: "Returns the number of pages of a user leaderboard (users with a number value)",
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
            name: "length",
            description: "The number of users per page, defaults to 1 (the number of users)",
            rest: false,
            type: ArgType.Number,
            required: false,
        },
        {
            name: "decimals",
            description: "Return decimals for more accurate results, default: false",
            rest: false,
            type: ArgType.Boolean,
            required: false,
        },
    ],
    brackets: true,
    async execute(_ctx, [name, length, decimals]) {
        return guarded(this, async () => {
            const board = await DataBase.leaderboard({ type: "user", name })
            return this.success(pagesOf(board.count, length, decimals))
        })
    },
})
