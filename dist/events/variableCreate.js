"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("..");
const eventManager_1 = require("../structures/eventManager");
const logger_1 = require("../util/logger");
exports.default = new eventManager_1.DBEventHandler({
    name: "variableCreate",
    version: "2.0.0",
    description: "This event is triggered when a new variable gets created.",
    listener(extras) {
        const commands = this.getExtension(__1.ReForgeDB, true).commands.get("variableCreate");
        for (const command of commands) {
            forgescript_1.Interpreter.run({
                obj: {},
                client: this,
                command,
                data: command.compiled.code,
                extras,
            }).catch((err) => logger_1.DBLogger.error(`The variableCreate command "${command.name ?? "unnamed"}" failed:`, err));
        }
    },
});
//# sourceMappingURL=variableCreate.js.map