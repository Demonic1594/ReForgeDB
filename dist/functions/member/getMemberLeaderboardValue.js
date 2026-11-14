"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getMemberLeaderboardValue",
    version: "2.0.0",
    description: "Retrieves the position of a member in the leaderboard of a variable, or 0 when the member is not on it",
    aliases: ["$getMemberLeaderboardPosition"],
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
            name: "member ID",
            description: "The member ID, defaults to the member of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
        {
            name: "guild ID",
            description: "The guild ID to which the member belongs, defaults to the guild of the command",
            rest: false,
            type: forgescript_1.ArgType.Guild,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, sortType, member, guild]) {
        return (0, functions_1.guarded)(this, async () => {
            const guildId = (0, functions_1.requireId)(guild, ctx.guild?.id, "guild ID");
            const board = await util_1.DataBase.leaderboard({ type: "member", name, guildId, sort: sortType === util_1.SortType.asc ? "asc" : "desc" });
            return this.success(board.positionOf((0, functions_1.pickId)(member) ?? ctx.member?.id ?? ctx.user?.id));
        });
    },
});
//# sourceMappingURL=getMemberLeaderboardValue.js.map