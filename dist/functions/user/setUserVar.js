"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$setUserVar",
    version: "2.0.0",
    description: "Sets a user's value in a variable",
    unwrap: true,
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
            name: "user ID",
            description: "The user ID, defaults to the user of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, value, user]) {
        return (0, functions_1.guarded)(this, async () => {
            await util_1.DataBase.set({ name, id: (0, functions_1.requireId)(user, ctx.user?.id, "user ID"), value, type: "user" });
            return this.success();
        });
    },
});
//# sourceMappingURL=setUserVar.js.map