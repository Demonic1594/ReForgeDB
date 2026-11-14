"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getGuildLeaderboardValue",
    version: "2.0.0",
    description: "Retrieves the position of a guild in the leaderboard of a variable, or 0 when the guild is not on it",
    aliases: ["$getServerLeaderboardValue", "$getGuildLeaderboardPosition", "$getServerLeaderboardPosition"],
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
            name: "sort type",
            description: "The sort order for the leaderboard, either ascending (asc) or descending (desc, the default)",
            rest: false,
            type: forgescript_1.ArgType.Enum,
            enum: util_1.SortType,
        },
        {
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, sortType, guild]) {
        return (0, functions_1.guarded)(this, async () => {
            const board = await util_1.DataBase.leaderboard({ type: "guild", name, sort: sortType === util_1.SortType.asc ? "asc" : "desc" });
            return this.success(board.positionOf((0, functions_1.pickId)(guild) ?? ctx.guild?.id));
        });
    },
});
//# sourceMappingURL=getGuildLeaderboardValue.js.map