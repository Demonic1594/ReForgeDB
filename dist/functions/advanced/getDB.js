"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getDB",
    version: "1.0.0",
    aliases: ["$getDataBase", "$getRecords"],
    description: "Returns every stored variable as JSON",
    output: forgescript_1.ArgType.Json,
    unwrap: false,
    async execute() {
        return (0, functions_1.guarded)(this, async () => this.successJSON(await util_1.DataBase.getAll()));
    },
});
//# sourceMappingURL=getDB.js.map