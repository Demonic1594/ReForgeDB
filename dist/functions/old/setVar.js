"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$setVar",
    version: "1.0.0",
    description: "Sets an identifier's value in a variable (legacy: prefer the typed functions such as $setUserVar)",
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
            name: "id",
            description: "The identifier for the value (a user, guild, channel, message, etc)",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
        {
            name: "value",
            description: "The value",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
    ],
    async execute(_ctx, [name, id, value]) {
        return (0, functions_1.guarded)(this, async () => {
            await util_1.DataBase.set({ name, id, value, type: "old" });
            return this.success();
        });
    },
});
//# sourceMappingURL=setVar.js.map