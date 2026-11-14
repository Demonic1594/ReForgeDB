"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$wipeDB",
    version: "2.0.8",
    aliases: ["$deleteDB", "$clearDB"],
    description: "Deletes every variable and every cooldown in the database",
    unwrap: false,
    async execute() {
        return (0, functions_1.guarded)(this, async () => {
            await util_1.DataBase.wipe();
            await util_1.DataBase.cdWipe();
            return this.success();
        });
    },
});
//# sourceMappingURL=wipeDB.js.map