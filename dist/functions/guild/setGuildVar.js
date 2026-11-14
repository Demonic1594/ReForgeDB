"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$setGuildVar",
    version: "2.0.0",
    description: "Assigns a value to a variable associated with a guild",
    aliases: ["$setServerVar"],
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable to set the value in",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
        {
            name: "value",
            description: "The value to be assigned",
            rest: false,
            required: true,
            type: forgescript_1.ArgType.String,
        },
        {
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, value, guild]) {
        return (0, functions_1.guarded)(this, async () => {
            await util_1.DataBase.set({ name, id: (0, functions_1.requireId)(guild, ctx.guild?.id, "guild ID"), value, type: "guild" });
            return this.success();
        });
    },
});
//# sourceMappingURL=setGuildVar.js.map