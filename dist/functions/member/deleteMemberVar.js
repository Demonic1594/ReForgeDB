"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$deleteMemberVar",
    version: "2.0.0",
    description: "Removes a value from a member variable",
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The name of the variable from which to remove the value",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
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
            description: "The guild to which the member belongs, defaults to the guild of the command (also works for a guild the bot left)",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, member, guild]) {
        return (0, functions_1.guarded)(this, async () => {
            const id = (0, functions_1.requireId)(member, ctx.member?.id ?? (ctx.guild ? ctx.user?.id : undefined), "member ID");
            await util_1.DataBase.delete({ name, id, type: "member", guildId: (0, functions_1.requireId)(guild, ctx.guild?.id, "guild ID") });
            return this.success();
        });
    },
});
//# sourceMappingURL=deleteMemberVar.js.map