"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$setMemberVar",
    version: "2.0.0",
    description: "Sets a member's value in a variable",
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
            name: "value",
            description: "The value to set",
            rest: false,
            required: true,
            type: forgescript_1.ArgType.String,
        },
        {
            name: "member ID",
            description: "The ID of the member, defaults to the member of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
        {
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: forgescript_1.ArgType.Guild,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, value, member, guild]) {
        return (0, functions_1.guarded)(this, async () => {
            const id = (0, functions_1.requireId)(member, ctx.member?.id ?? (ctx.guild ? ctx.user?.id : undefined), "member ID");
            await util_1.DataBase.set({ name, id, value, type: "member", guildId: (0, functions_1.requireId)(guild, ctx.guild?.id, "guild ID") });
            return this.success();
        });
    },
});
//# sourceMappingURL=setMemberVar.js.map