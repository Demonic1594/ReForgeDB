import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { SortType } from "../../util"
import { guarded, renderLeaderboard } from "../../util/functions"

export default new NativeFunction({
    name: "$guildLeaderboard",
    version: "2.0.0",
    description: "Creates a guild leaderboard of a variable",
    aliases: ["$serverLeaderboard"],
    output: ArgType.String,
    brackets: true,
    unwrap: false,
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
            name: "max",
            description: "The maximum number of rows per page, defaults to 10",
            rest: false,
            type: ArgType.Number,
        },
        {
            name: "page",
            description: "The page number, defaults to 1",
            rest: false,
            type: ArgType.Number,
        },
        {
            name: "separator",
            description: "The separator to use for each row, defaults to a new line",
            rest: false,
            type: ArgType.String,
        },
        {
            name: "envValue",
            description: "The variable name to use for $env, retrieve the id with $env[<name>;id], the value with $env[<name>;value] and the name with $env[<name>;guild_name]",
            rest: false,
            required: false,
            type: ArgType.String,
        },
        {
            name: "envPosition",
            description: "The variable name to use for $env, retrieve the position with $env[<name>]",
            required: false,
            rest: false,
            type: ArgType.String,
        },
        {
            name: "code",
            description: "Code to execute for each row. Remember to use $return, otherwise it will not return anything.",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    async execute(ctx) {
        return guarded(this, () =>
            renderLeaderboard(this, ctx, {
                type: "guild",
                fields: { name: 0, sort: 1, max: 2, page: 3, separator: 4, envValue: 5, envPosition: 6, code: 7 },
                labelKey: "guild_name",
                label: (c, id) => c.client.guilds.cache.get(id)?.name,
            })
        )
    },
})
