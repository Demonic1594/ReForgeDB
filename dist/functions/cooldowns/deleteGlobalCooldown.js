"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$deleteGlobalCooldown",
    aliases: ["$dbDeleteGlobalCooldown"],
    version: "2.0.0",
    description: "Ends a global cooldown",
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
    ],
    async execute(_ctx, [name]) {
        return (0, functions_1.guarded)(this, async () => {
            await util_1.DataBase.cdDelete(util_1.DataBase.make_cdIdentifier({ name }));
            return this.success();
        });
    },
});
//# sourceMappingURL=deleteGlobalCooldown.js.map