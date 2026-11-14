"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getRoleVar",
    version: "2.0.0",
    description: "Retrieves the value of a variable associated with a role",
    output: forgescript_1.ArgType.Unknown,
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
            description: "The ID of a role of the current guild",
            rest: false,
            type: forgescript_1.ArgType.Role,
            required: true,
        },
        {
            name: "default",
            description: "The value to return when the variable was never set",
            rest: false,
            required: false,
            type: forgescript_1.ArgType.String,
        },
    ],
    async execute(ctx, [name, role, def]) {
        return (0, functions_1.guarded)(this, () => (0, functions_1.readVariable)(this, ctx, { name, id: role.id, type: "role", guildId: role.guild.id }, def));
    },
});
//# sourceMappingURL=getRoleVar.js.map