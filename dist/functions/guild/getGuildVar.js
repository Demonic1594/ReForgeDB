"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getGuildVar",
    version: "2.0.0",
    description: "Retrieves the value of a variable associated with a guild",
    aliases: ["$getServerVar"],
    output: forgescript_1.ArgType.Unknown,
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
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
        {
            name: "default",
            description: "The value to return when the variable was never set",
            rest: false,
            required: false,
            type: forgescript_1.ArgType.String,
        },
    ],
    brackets: true,
    async execute(ctx, [name, guild, def]) {
        return (0, functions_1.guarded)(this, () => (0, functions_1.readVariable)(this, ctx, { name, id: (0, functions_1.requireId)(guild, ctx.guild?.id, "guild ID"), type: "guild" }, def));
    },
});
//# sourceMappingURL=getGuildVar.js.map