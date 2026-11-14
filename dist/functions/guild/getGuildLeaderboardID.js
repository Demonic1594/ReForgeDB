"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getGuildLeaderboardID",
    version: "2.1.0",
    description: "Returns the guild at a position of a guild leaderboard",
    aliases: ["$getServerLeaderboardID"],
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
            description: "The sort order for the leaderboard, either ascending (asc) or descending (desc, the default)",
            rest: false,
            type: forgescript_1.ArgType.Enum,
            enum: util_1.SortType,
        },
        {
            name: "position",
            description: "The position of the guild to find, starting at 1",
            rest: false,
            type: forgescript_1.ArgType.Number,
            required: true,
        },
    ],
    output: forgescript_1.ArgType.Guild,
    async execute(_ctx, [name, sortType, pos]) {
        return (0, functions_1.guarded)(this, async () => {
            const position = (0, functions_1.positiveInt)(pos, 0);
            if (!position)
                return this.success();
            const board = await util_1.DataBase.leaderboard({ type: "guild", name, sort: sortType === util_1.SortType.asc ? "asc" : "desc" });
            return this.success(board.entries[position - 1]?.id);
        });
    },
});
//# sourceMappingURL=getGuildLeaderboardID.js.map