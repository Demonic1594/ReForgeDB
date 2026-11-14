import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase, SortType } from "../../util"
import { guarded, positiveInt, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$getMemberLeaderboardID",
    version: "2.1.0",
    description: "Returns the member at a position of a member leaderboard",
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
            description: "The position of the member to find, starting at 1",
            rest: false,
            type: ArgType.Number,
            required: true,
        },
        {
            name: "guild ID",
            description: "The guild ID to which the member belongs, defaults to the guild of the command",
            rest: false,
            type: ArgType.Guild,
        },
    ],
    output: ArgType.Member,
    async execute(ctx, [name, sortType, pos, guild]) {
        return guarded(this, async () => {
            const guildId = requireId(guild, ctx.guild?.id, "guild ID")
            const position = positiveInt(pos, 0)
            if (!position) return this.success()
            const board = await DataBase.leaderboard({ type: "member", name, guildId, sort: sortType === SortType.asc ? "asc" : "desc" })
            return this.success(board.entries[position - 1]?.id)
        })
    },
})
