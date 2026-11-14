import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { SortType } from "../../util"
import { guarded, renderLeaderboard } from "../../util/functions"

export default new NativeFunction({
    name: "$memberLeaderboard",
    version: "2.0.0",
    description: "Creates a leaderboard of members for a variable",
    output: ArgType.String,
    brackets: true,
    unwrap: false,
    args: [
        {
            name: "name",
            description: "The name of the variable to create the leaderboard for",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: ArgType.Guild,
            required: false,
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
            description: "The variable name to use for $env, retrieve the id with $env[<name>;id], the value with $env[<name>;value] and the name with $env[<name>;username]",
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
                type: "member",
                fields: { name: 0, guild: 1, sort: 2, max: 3, page: 4, separator: 5, envValue: 6, envPosition: 7, code: 8 },
                labelKey: "username",
                label: (c, id, guildId) => (guildId ? c.client.guilds.cache.get(guildId)?.members.cache.get(id)?.user.username : undefined) ?? c.client.users.cache.get(id)?.username,
            })
        )
    },
})
