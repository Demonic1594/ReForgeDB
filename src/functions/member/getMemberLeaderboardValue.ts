import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase, SortType } from "../../util"
import { guarded, pickId, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$getMemberLeaderboardValue",
    version: "2.0.0",
    description: "Retrieves the position of a member in the leaderboard of a variable, or 0 when the member is not on it",
    aliases: ["$getMemberLeaderboardPosition"],
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
            name: "member ID",
            description: "The member ID, defaults to the member of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
        {
            name: "guild ID",
            description: "The guild ID to which the member belongs, defaults to the guild of the command",
            rest: false,
            type: ArgType.Guild,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, sortType, member, guild]) {
        return guarded(this, async () => {
            const guildId = requireId(guild, ctx.guild?.id, "guild ID")
            const board = await DataBase.leaderboard({ type: "member", name, guildId, sort: sortType === SortType.asc ? "asc" : "desc" })
            return this.success(board.positionOf(pickId(member) ?? ctx.member?.id ?? ctx.user?.id))
        })
    },
})
