"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$setRoleVar",
    version: "2.0.0",
    description: "Sets a role's value in a variable",
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
            name: "value",
            description: "The value",
            rest: false,
            required: true,
            type: forgescript_1.ArgType.String,
        },
        {
            name: "role ID",
            description: "The ID of a role of the current guild",
            rest: false,
            type: forgescript_1.ArgType.Role,
            required: true,
        },
    ],
    async execute(_ctx, [name, value, role]) {
        return (0, functions_1.guarded)(this, async () => {
            await util_1.DataBase.set({ name, id: role.id, value, type: "role", guildId: role.guild.id });
            return this.success();
        });
    },
});
//# sourceMappingURL=setRoleVar.js.map