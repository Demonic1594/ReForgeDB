"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getMemberLeaderboardID",
    version: "2.1.0",
    description: "Returns the member at a position of a member leaderboard",
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
            description: "The position of the member to find, starting at 1",
            rest: false,
            type: forgescript_1.ArgType.Number,
            required: true,
        },
        {
            name: "guild ID",
            description: "The guild ID to which the member belongs, defaults to the guild of the command",
            rest: false,
            type: forgescript_1.ArgType.Guild,
        },
    ],
    output: forgescript_1.ArgType.Member,
    async execute(ctx, [name, sortType, pos, guild]) {
        return (0, functions_1.guarded)(this, async () => {
            const guildId = (0, functions_1.requireId)(guild, ctx.guild?.id, "guild ID");
            const position = (0, functions_1.positiveInt)(pos, 0);
            if (!position)
                return this.success();
            const board = await util_1.DataBase.leaderboard({ type: "member", name, guildId, sort: sortType === util_1.SortType.asc ? "asc" : "desc" });
            return this.success(board.entries[position - 1]?.id);
        });
    },
});
//# sourceMappingURL=getMemberLeaderboardID.js.map