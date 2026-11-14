"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getUserLeaderboardValue",
    version: "2.0.0",
    description: "Returns the position of a user in the leaderboard of a variable, or 0 when the user is not on it",
    aliases: ["$getUserLeaderboardPosition"],
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
            name: "sort type",
            description: "The sort order for the leaderboard, either ascending (asc) or descending (desc, the default)",
            rest: false,
            type: forgescript_1.ArgType.Enum,
            enum: util_1.SortType,
        },
        {
            name: "user ID",
            description: "The user ID, defaults to the user of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, sortType, user]) {
        return (0, functions_1.guarded)(this, async () => {
            const board = await util_1.DataBase.leaderboard({ type: "user", name, sort: sortType === util_1.SortType.asc ? "asc" : "desc" });
            return this.success(board.positionOf((0, functions_1.pickId)(user) ?? ctx.user?.id));
        });
    },
});
//# sourceMappingURL=getUserLeaderboardValue.js.map