"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getMemberLeaderboardLength",
    version: "2.0.0",
    description: "Returns the number of pages of a member leaderboard (members with a number value)",
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
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: forgescript_1.ArgType.Guild,
            required: false,
        },
        {
            name: "length",
            description: "The number of members per page, defaults to 1 (the number of members)",
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
    async execute(ctx, [name, guild, length, decimals]) {
        return (0, functions_1.guarded)(this, async () => {
            const board = await util_1.DataBase.leaderboard({ type: "member", name, guildId: (0, functions_1.requireId)(guild, ctx.guild?.id, "guild ID") });
            return this.success((0, functions_1.pagesOf)(board.count, length, decimals));
        });
    },
});
//# sourceMappingURL=getMemberLeaderboardLength.js.map