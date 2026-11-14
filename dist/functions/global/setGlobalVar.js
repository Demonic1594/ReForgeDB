"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$setGlobalVar",
    version: "2.0.0",
    description: "Assigns a value to a global variable",
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable to set the value in",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
        {
            name: "value",
            description: "The value to be assigned",
            rest: false,
            required: true,
            type: forgescript_1.ArgType.String,
        },
    ],
    brackets: true,
    async execute(_ctx, [name, value]) {
        return (0, functions_1.guarded)(this, async () => {
            await util_1.DataBase.set({ name, value, type: "custom" });
            return this.success();
        });
    },
});
//# sourceMappingURL=setGlobalVar.js.map