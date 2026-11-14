"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getVar",
    version: "1.0.0",
    description: "Returns an identifier's value in a variable (legacy: prefer the typed functions such as $getUserVar)",
    output: forgescript_1.ArgType.Unknown,
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
            name: "default",
            description: "The value to return when the variable was never set",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, id, def]) {
        return (0, functions_1.guarded)(this, () => (0, functions_1.readVariable)(this, ctx, { name, id, type: "old" }, def));
    },
});
//# sourceMappingURL=getVar.js.map