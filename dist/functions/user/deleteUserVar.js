"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$deleteUserVar",
    version: "2.0.0",
    description: "Deletes a value from a user variable",
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
            name: "user ID",
            description: "The user ID, defaults to the user of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, user]) {
        return (0, functions_1.guarded)(this, async () => {
            await util_1.DataBase.delete({ name, id: (0, functions_1.requireId)(user, ctx.user?.id, "user ID"), type: "user" });
            return this.success();
        });
    },
});
//# sourceMappingURL=deleteUserVar.js.map