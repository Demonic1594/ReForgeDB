"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getUserVar",
    version: "2.0.0",
    description: "Retrieves the value of a specified variable for a user",
    output: forgescript_1.ArgType.Unknown,
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable.",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
        {
            name: "user ID",
            description: "The user ID, defaults to the user of the command.",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
        {
            name: "default value",
            description: "The value to return when the variable was never set.",
            rest: false,
            required: false,
            type: forgescript_1.ArgType.String,
        },
    ],
    brackets: true,
    async execute(ctx, [name, user, def]) {
        return (0, functions_1.guarded)(this, () => (0, functions_1.readVariable)(this, ctx, { name, id: (0, functions_1.requireId)(user, ctx.user?.id, "user ID"), type: "user" }, def));
    },
});
//# sourceMappingURL=getUserVar.js.map