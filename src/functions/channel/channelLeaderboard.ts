import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { SortType } from "../../util"
import { guarded, renderLeaderboard } from "../../util/functions"

export default new NativeFunction({
    name: "$channelLeaderboard",
    version: "2.0.0",
    description: "Creates a leaderboard specific to channels based on a variable.",
    output: ArgType.String,
    brackets: true,
    unwrap: false,
    args: [
        {
            name: "name",
            description: "The name of the variable used to create the leaderboard.",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "guild ID",
            description: "The guild ID of the channels, defaults to the guild of the command.",
            rest: false,
            type: ArgType.Guild,
            required: false,
        },
        {
            name: "sort type",
            description: "The sorting order for the leaderboard, either ascending (asc) or descending (desc, the default).",
            rest: false,
            type: ArgType.Enum,
            enum: SortType,
        },
        {
            name: "max",
            description: "The maximum number of entries per page, defaults to 10.",
            rest: false,
            type: ArgType.Number,
        },
        {
            name: "page",
            description: "The page number, defaults to 1.",
            rest: false,
            type: ArgType.Number,
        },
        {
            name: "separator",
            description: "The separator between rows, defaults to a new line.",
            rest: false,
            type: ArgType.String,
        },
        {
            name: "envValue",
            description: "The variable name for $env: $env[<name>;id], $env[<name>;value] and $env[<name>;channel_name].",
            rest: false,
            required: false,
            type: ArgType.String,
        },
        {
            name: "envPosition",
            description: "The variable name for $env to get the position with $env[<name>].",
            rest: false,
            required: false,
            type: ArgType.String,
        },
        {
            name: "code",
            description: "Code executed for each row. Remember to use $return, otherwise it will not return anything.",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    async execute(ctx) {
        return guarded(this, () =>
            renderLeaderboard(this, ctx, {
                type: "channel",
                fields: { name: 0, guild: 1, sort: 2, max: 3, page: 4, separator: 5, envValue: 6, envPosition: 7, code: 8 },
                labelKey: "channel_name",
                label: (c, id) => (c.client.channels.cache.get(id) as { name?: string } | undefined)?.name,
            })
        )
    },
})
