"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getGlobalCooldownTime",
    aliases: ["$dbGetGlobalCooldownTime"],
    version: "2.0.0",
    description: "Returns the ms left of a global cooldown, or 0",
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
    ],
    async execute(_ctx, [name]) {
        return (0, functions_1.guarded)(this, async () => this.success((await util_1.DataBase.cdTimeLeft(util_1.DataBase.make_cdIdentifier({ name }))).left));
    },
});
//# sourceMappingURL=getGlobalCooldownTime.js.map