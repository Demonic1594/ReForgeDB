import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase, SortType } from "../../util"
import { guarded, positiveInt, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$getChannelLeaderboardID",
    version: "2.1.0",
    description: "Returns the channel at a position of a channel leaderboard",
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
            description: "The position of the channel to find, starting at 1",
            rest: false,
            type: ArgType.Number,
            required: true,
        },
        {
            name: "guild ID",
            description: "The guild ID of the channels, defaults to the guild of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    output: ArgType.Channel,
    async execute(ctx, [name, sortType, pos, guild]) {
        return guarded(this, async () => {
            const guildId = requireId(guild, ctx.guild?.id, "guild ID")
            const position = positiveInt(pos, 0)
            if (!position) return this.success()
            const board = await DataBase.leaderboard({ type: "channel", name, guildId, sort: sortType === SortType.asc ? "asc" : "desc" })
            return this.success(board.entries[position - 1]?.id)
        })
    },
})
