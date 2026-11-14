"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$deleteGlobalVar",
    version: "2.0.0",
    description: "Removes a global variable",
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The name of the variable to remove",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
    ],
    async execute(_ctx, [name]) {
        return (0, functions_1.guarded)(this, async () => {
            await util_1.DataBase.delete({ name, type: "custom" });
            return this.success();
        });
    },
});
//# sourceMappingURL=deleteGlobalVar.js.map