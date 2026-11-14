"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$dbGetGuildCooldownTime",
    version: "3.0.0",
    description: "Returns the ms left of a guild cooldown started with $dbGuildCooldown, or 0",
    output: forgescript_1.ArgType.Number,
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
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, id]) {
        return (0, functions_1.guarded)(this, async () => {
            const key = { name: name, id: (0, functions_1.requireId)(id, ctx.guild?.id, "guild ID") };
            return this.success((await util_1.DataBase.cdTimeLeft(util_1.DataBase.make_cdIdentifier(key))).left);
        });
    },
});
//# sourceMappingURL=dbGetGuildCooldownTime.js.map