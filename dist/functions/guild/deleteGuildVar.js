"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$deleteGuildVar",
    version: "2.0.0",
    description: "Removes a value from a guild variable",
    aliases: ["$deleteServerVar"],
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
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, guild]) {
        return (0, functions_1.guarded)(this, async () => {
            await util_1.DataBase.delete({ name, id: (0, functions_1.requireId)(guild, ctx.guild?.id, "guild ID"), type: "guild" });
            return this.success();
        });
    },
});
//# sourceMappingURL=deleteGuildVar.js.map