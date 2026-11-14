import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase, SortType } from "../../util"
import { channelScope, guarded } from "../../util/functions"

export default new NativeFunction({
    name: "$getChannelLeaderboardValue",
    version: "2.0.0",
    description: "Fetches the position of a channel in the leaderboard of a variable, or 0 when the channel is not on it",
    aliases: ["$getChannelLeaderboardPosition"],
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
            name: "channel ID",
            description: "The channel ID, defaults to the channel of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, sortType, channel]) {
        return guarded(this, async () => {
            const { id, guildId } = await channelScope(ctx, channel)
            const board = await DataBase.leaderboard({ type: "channel", name, guildId, sort: sortType === SortType.asc ? "asc" : "desc" })
            return this.success(board.positionOf(id))
        })
    },
})
