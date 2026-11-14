"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$dbDeleteGuildCooldown",
    version: "3.0.0",
    description: "Ends a guild cooldown started with $dbGuildCooldown",
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
            await util_1.DataBase.cdDelete(util_1.DataBase.make_cdIdentifier({ name: name, id: (0, functions_1.requireId)(id, ctx.guild?.id, "guild ID") }));
            return this.success();
        });
    },
});
//# sourceMappingURL=dbDeleteGuildCooldown.js.map