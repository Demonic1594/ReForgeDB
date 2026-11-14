"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("..");
const eventManager_1 = require("../structures/eventManager");
const logger_1 = require("../util/logger");
exports.default = new eventManager_1.ReForgeDBEventHandler({
    name: "cooldownExpire",
    version: "3.2.0",
    description: "This event is triggered when a stored cooldown runs out ($cooldownData has its name, ID and times). Fires once, also with several bot processes on one database.",
    listener(extras) {
        const commands = this.getExtension(__1.ReForgeDB, true).commands.get("cooldownExpire");
        for (const command of commands) {
            forgescript_1.Interpreter.run({
                obj: {},
                client: this,
                command,
                data: command.compiled.code,
                extras,
            }).catch((err) => logger_1.ReForgeDBLogger.error(`The cooldownExpire command "${command.name ?? "unnamed"}" failed:`, err));
        }
    },
});
//# sourceMappingURL=cooldownExpire.js.map