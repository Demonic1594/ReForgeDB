"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getGuildLeaderboardLength",
    version: "2.0.0",
    description: "Returns the number of pages of a guild leaderboard (guilds with a number value)",
    aliases: ["$getServerLeaderboardLength"],
    output: forgescript_1.ArgType.Number,
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable to query",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
        {
            name: "length",
            description: "The number of guilds per page, defaults to 1 (the number of guilds)",
            rest: false,
            type: forgescript_1.ArgType.Number,
            required: false,
        },
        {
            name: "decimals",
            description: "Specify whether to return decimals for more precise results (default: false)",
            rest: false,
            type: forgescript_1.ArgType.Boolean,
            required: false,
        },
    ],
    brackets: true,
    async execute(_ctx, [name, length, decimals]) {
        return (0, functions_1.guarded)(this, async () => {
            const board = await util_1.DataBase.leaderboard({ type: "guild", name });
            return this.success((0, functions_1.pagesOf)(board.count, length, decimals));
        });
    },
});
//# sourceMappingURL=getGuildLeaderboardLength.js.map