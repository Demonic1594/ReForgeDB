"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$setMessageVar",
    version: "2.0.0",
    description: "Sets a message's value in a variable",
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
            name: "value",
            description: "The value",
            rest: false,
            required: true,
            type: forgescript_1.ArgType.String,
        },
        {
            name: "message ID",
            description: "The message ID, defaults to the message of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, value, message]) {
        return (0, functions_1.guarded)(this, async () => {
            await util_1.DataBase.set({ name, id: (0, functions_1.requireId)(message, ctx.message?.id, "message ID"), value, type: "message" });
            return this.success();
        });
    },
});
//# sourceMappingURL=setMessageVar.js.map