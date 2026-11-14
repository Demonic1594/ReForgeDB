"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$dbDeleteMemberCooldown",
    version: "3.0.0",
    description: "Ends a member cooldown started with $dbMemberCooldown",
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The name of the cooldown",
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
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, id, guild]) {
        return (0, functions_1.guarded)(this, async () => {
            await util_1.DataBase.cdDelete(util_1.DataBase.make_cdIdentifier({ name: `${name}-${(0, functions_1.requireId)(guild, ctx.guild?.id, "guild ID")}`, id: (0, functions_1.requireId)(id, ctx.member?.id ?? (ctx.guild ? ctx.user?.id : undefined), "member ID") }));
            return this.success();
        });
    },
});
//# sourceMappingURL=dbDeleteMemberCooldown.js.map