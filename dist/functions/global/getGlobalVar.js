"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getGlobalVar",
    version: "2.0.0",
    description: "Retrieves the value of a global variable",
    output: forgescript_1.ArgType.Unknown,
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable to query",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
        {
            name: "default",
            description: "The value to return when the variable was never set",
            rest: false,
            required: false,
            type: forgescript_1.ArgType.String,
        },
    ],
    brackets: true,
    async execute(ctx, [name, def]) {
        return (0, functions_1.guarded)(this, () => (0, functions_1.readVariable)(this, ctx, { name, type: "custom" }, def));
    },
});
//# sourceMappingURL=getGlobalVar.js.map