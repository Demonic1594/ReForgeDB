"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$channelLeaderboard",
    version: "2.0.0",
    description: "Creates a leaderboard specific to channels based on a variable.",
    output: forgescript_1.ArgType.String,
    brackets: true,
    unwrap: false,
    args: [
        {
            name: "name",
            description: "The name of the variable used to create the leaderboard.",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
        {
            name: "guild ID",
            description: "The guild ID of the channels, defaults to the guild of the command.",
            rest: false,
            type: forgescript_1.ArgType.Guild,
            required: false,
        },
        {
            name: "sort type",
            description: "The sorting order for the leaderboard, either ascending (asc) or descending (desc, the default).",
            rest: false,
            type: forgescript_1.ArgType.Enum,
            enum: util_1.SortType,
        },
        {
            name: "max",
            description: "The maximum number of entries per page, defaults to 10.",
            rest: false,
            type: forgescript_1.ArgType.Number,
        },
        {
            name: "page",
            description: "The page number, defaults to 1.",
            rest: false,
            type: forgescript_1.ArgType.Number,
        },
        {
            name: "separator",
            description: "The separator between rows, defaults to a new line.",
            rest: false,
            type: forgescript_1.ArgType.String,
        },
        {
            name: "envValue",
            description: "The variable name for $env: $env[<name>;id], $env[<name>;value] and $env[<name>;channel_name].",
            rest: false,
            required: false,
            type: forgescript_1.ArgType.String,
        },
        {
            name: "envPosition",
            description: "The variable name for $env to get the position with $env[<name>].",
            rest: false,
            required: false,
            type: forgescript_1.ArgType.String,
        },
        {
            name: "code",
            description: "Code executed for each row. Remember to use $return, otherwise it will not return anything.",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    async execute(ctx) {
        return (0, functions_1.guarded)(this, () => (0, functions_1.renderLeaderboard)(this, ctx, {
            type: "channel",
            fields: { name: 0, guild: 1, sort: 2, max: 3, page: 4, separator: 5, envValue: 6, envPosition: 7, code: 8 },
            labelKey: "channel_name",
            label: (c, id) => c.client.channels.cache.get(id)?.name,
        }));
    },
});
//# sourceMappingURL=channelLeaderboard.js.map