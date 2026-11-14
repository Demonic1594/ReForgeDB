"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getUserLeaderboardID",
    version: "2.1.0",
    description: "Returns the user at a position of a user leaderboard",
    unwrap: true,
    brackets: true,
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
            description: "The sort type for the leaderboard: 'asc' (ascending) or 'desc' (descending, the default)",
            rest: false,
            type: forgescript_1.ArgType.Enum,
            enum: util_1.SortType,
        },
        {
            name: "position",
            description: "The position of the user to find, starting at 1",
            rest: false,
            type: forgescript_1.ArgType.Number,
            required: true,
        },
    ],
    output: forgescript_1.ArgType.User,
    async execute(_ctx, [name, sortType, pos]) {
        return (0, functions_1.guarded)(this, async () => {
            const position = (0, functions_1.positiveInt)(pos, 0);
            if (!position)
                return this.success();
            const board = await util_1.DataBase.leaderboard({ type: "user", name, sort: sortType === util_1.SortType.asc ? "asc" : "desc" });
            return this.success(board.entries[position - 1]?.id);
        });
    },
});
//# sourceMappingURL=getUserLeaderboardID.js.map