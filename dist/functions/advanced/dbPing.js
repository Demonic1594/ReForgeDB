"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$dbPing",
    aliases: ["$dbLatency"],
    version: "2.0.9",
    description: "Returns the database round trip in ms (works on every database type, MongoDB included)",
    output: forgescript_1.ArgType.Number,
    unwrap: true,
    brackets: false,
    args: [
        {
            name: "full",
            description: "Return every decimal instead of 2",
            type: forgescript_1.ArgType.Boolean,
            required: false,
            rest: false,
        },
    ],
    async execute(_ctx, [full]) {
        return (0, functions_1.guarded)(this, async () => {
            const ms = await util_1.DataBase.ping();
            return this.success(full ? ms : Number(ms.toFixed(2)));
        });
    },
});
//# sourceMappingURL=dbPing.js.map