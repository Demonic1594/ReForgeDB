"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$userLeaderboard",
    version: "2.0.0",
    description: "Creates a user leaderboard for a variable",
    output: forgescript_1.ArgType.String,
    brackets: true,
    unwrap: false,
    args: [
        {
            name: "name",
            description: "The name of the variable",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
        {
            name: "sort type",
            description: "The sort type for the leaderboard, either asc (ascending) or desc (descending, the default)",
            rest: false,
            type: forgescript_1.ArgType.Enum,
            enum: util_1.SortType,
        },
        {
            name: "max",
            description: "The maximum number of rows per page, defaults to 10",
            rest: false,
            type: forgescript_1.ArgType.Number,
        },
        {
            name: "page",
            description: "The page number, defaults to 1",
            rest: false,
            type: forgescript_1.ArgType.Number,
        },
        {
            name: "separator",
            description: "The separator to use for each row, defaults to a new line",
            rest: false,
            type: forgescript_1.ArgType.String,
        },
        {
            name: "envValue",
            description: "The variable name to use for $env. Retrieve the id with $env[<name>;id], the value with $env[<name>;value] and the name with $env[<name>;username]",
            rest: false,
            required: false,
            type: forgescript_1.ArgType.String,
        },
        {
            name: "envPosition",
            description: "The variable name to use for $env. Retrieve the position with $env[<name>]",
            required: false,
            rest: false,
            type: forgescript_1.ArgType.String,
        },
        {
            name: "code",
            description: "Code to execute for each row. Remember to use $return, otherwise it will not return anything.",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    async execute(ctx) {
        return (0, functions_1.guarded)(this, () => (0, functions_1.renderLeaderboard)(this, ctx, {
            type: "user",
            fields: { name: 0, sort: 1, max: 2, page: 3, separator: 4, envValue: 5, envPosition: 6, code: 7 },
            labelKey: "username",
            label: (c, id) => c.client.users.cache.get(id)?.username,
        }));
    },
});
//# sourceMappingURL=userLeaderboard.js.map