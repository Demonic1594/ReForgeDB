"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getUserLeaderboardLength",
    version: "2.0.0",
    description: "Returns the number of pages of a user leaderboard (users with a number value)",
    output: forgescript_1.ArgType.Number,
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
        {
            name: "length",
            description: "The number of users per page, defaults to 1 (the number of users)",
            rest: false,
            type: forgescript_1.ArgType.Number,
            required: false,
        },
        {
            name: "decimals",
            description: "Return decimals for more accurate results, default: false",
            rest: false,
            type: forgescript_1.ArgType.Boolean,
            required: false,
        },
    ],
    brackets: true,
    async execute(_ctx, [name, length, decimals]) {
        return (0, functions_1.guarded)(this, async () => {
            const board = await util_1.DataBase.leaderboard({ type: "user", name });
            return this.success((0, functions_1.pagesOf)(board.count, length, decimals));
        });
    },
});
//# sourceMappingURL=getUserLeaderboardLength.js.map