"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("..");
const eventManager_1 = require("../structures/eventManager");
const logger_1 = require("../util/logger");
exports.default = new eventManager_1.ReForgeDBEventHandler({
    name: "connect",
    version: "2.0.0",
    description: "This event is triggered when ReForgeDB has connected to the database",
    listener() {
        const commands = this.getExtension(__1.ReForgeDB, true).commands.get("connect");
        for (const command of commands) {
            forgescript_1.Interpreter.run({
                obj: {},
                client: this,
                command,
                data: command.compiled.code,
            }).catch((err) => logger_1.ReForgeDBLogger.error(`The connect command "${command.name ?? "unnamed"}" failed:`, err));
        }
    },
});
//# sourceMappingURL=connect.js.map