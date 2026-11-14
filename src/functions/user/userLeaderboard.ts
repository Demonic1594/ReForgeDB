import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { SortType } from "../../util"
import { guarded, renderLeaderboard } from "../../util/functions"

export default new NativeFunction({
    name: "$userLeaderboard",
    version: "2.0.0",
    description: "Creates a user leaderboard for a variable",
    output: ArgType.String,
    brackets: true,
    unwrap: false,
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
            description: "The sort type for the leaderboard, either asc (ascending) or desc (descending, the default)",
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
            description: "The variable name to use for $env. Retrieve the id with $env[<name>;id], the value with $env[<name>;value] and the name with $env[<name>;username]",
            rest: false,
            required: false,
            type: ArgType.String,
        },
        {
            name: "envPosition",
            description: "The variable name to use for $env. Retrieve the position with $env[<name>]",
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
                type: "user",
                fields: { name: 0, sort: 1, max: 2, page: 3, separator: 4, envValue: 5, envPosition: 6, code: 7 },
                labelKey: "username",
                label: (c, id) => c.client.users.cache.get(id)?.username,
            })
        )
    },
})
