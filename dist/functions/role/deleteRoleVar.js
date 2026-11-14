"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$deleteRoleVar",
    version: "2.0.0",
    description: "Deletes a value from a role variable (also works for a deleted role)",
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
            name: "role ID",
            description: "The ID of the role",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
        {
            name: "guild ID",
            description: "The guild of the role, defaults to the guild of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, role, guild]) {
        return (0, functions_1.guarded)(this, async () => {
            await util_1.DataBase.delete({ name, id: (0, functions_1.requireId)(role, undefined, "role ID"), type: "role", guildId: (0, functions_1.requireId)(guild, ctx.guild?.id, "guild ID") });
            return this.success();
        });
    },
});
//# sourceMappingURL=deleteRoleVar.js.map